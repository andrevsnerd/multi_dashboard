/**
 * Executor do Ajuste de Estoque por Contagem (réplica fiel da Contagem Física do Linx).
 *
 * NÃO faz UPDATE direto em ESTOQUE_PRODUTOS. Em vez disso, insere a contagem nas
 * tabelas nativas do Linx (ESTOQUE_PROD_CONTAGEM + ESTOQUE_PROD_CTG_AJUSTE) e deixa
 * a trigger LXI_ESTOQUE_PROD_CTG_AJUSTE aplicar o estoque sozinha:
 *
 *   UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = ESTOQUE + SUM(Ax), ESx = ESx + Ax, ...
 *
 * Resultado: o ajuste fica registrado igual a uma contagem real do Linx, aparece no
 * extrato do item (CONTAGEM/AJUSTE) com a descrição (NOME_CONTAGEM) e o responsável.
 * O "desfazer" (estorno) cria uma nova contagem com os deltas invertidos — nada é
 * apagado do Linx; original e estorno ficam ambos no histórico.
 *
 * Ver memória: ajuste-estoque-mecanismo-trigger.
 */

import sql from 'mssql';

export interface AjusteContagemItem {
  /** Código do produto (PRODUTOS.PRODUTO). */
  produto: string;
  /** Cor (PRODUTOS.COR_PRODUTO) — pode ser vazio. */
  cor: string;
  /** Quantidade contada (alvo). O delta é recalculado contra o saldo atual. */
  contagem: number;
}

export interface AjusteContagemParams {
  /** Nome EXATO da filial (FILIAIS.FILIAL / ESTOQUE_PRODUTOS.FILIAL), já resolvido. */
  filialNome: string;
  /** NOME_CONTAGEM (PK, max 25 chars) — é a "descrição" que aparece no extrato. */
  nomeContagem: string;
  /** Data da contagem (início do dia). Vira EMISSAO/DATA_AJUSTE do header. */
  emissao: string; // 'YYYY-MM-DD HH:mm:ss'
  /** Responsável (login do usuário). */
  responsavel: string;
  /** Observação livre (opcional, vai em OBS text do header). */
  obs?: string | null;
  /** Itens com a contagem alvo. */
  itens: AjusteContagemItem[];
}

export interface AjusteContagemResult {
  success: true;
  nomeContagem: string;
  itensAjustados: number;
  somaDelta: number;
  semDiferenca: number;
}

export interface EstornoResult {
  success: true;
  nomeContagem: string; // o nome do estorno criado
  nomeOriginal: string;
  itensAjustados: number;
  somaDelta: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoolLike = { request: () => any };

const NOME_MAX = 25;

function escapeLike(value: string): string {
  return value.replace(/'/g, "''");
}

interface ItemDelta {
  produto: string;
  cor: string;
  delta: number;
  slot: number; // 1..48 (TAMANHO_BASE; UNICO => 1)
}

/** TAMANHO_BASE (slot da grade) por produto; default 1 (tamanho único). */
async function carregarSlots(pool: PoolLike, produtos: string[]): Promise<Map<string, number>> {
  const slotByProduto = new Map<string, number>();
  const unicos = [...new Set(produtos.map((p) => p.trim()))];
  for (let i = 0; i < unicos.length; i += 800) {
    const chunk = unicos.slice(i, i + 800);
    const inList = chunk.map((p) => `'${escapeLike(p)}'`).join(',');
    const req = pool.request();
    const res = await req.query(`
      SELECT RTRIM(LTRIM(PRODUTO)) AS PRODUTO, ISNULL(TAMANHO_BASE,1) AS TB
      FROM PRODUTOS WITH (NOLOCK) WHERE RTRIM(LTRIM(PRODUTO)) IN (${inList})
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of res.recordset as any[]) {
      const n = parseInt(r.TB, 10);
      slotByProduto.set(r.PRODUTO, n >= 1 && n <= 48 ? n : 1);
    }
  }
  return slotByProduto;
}

/** Saldo atual + slot por (produto,cor) para a filial. */
async function carregarSaldoESlots(
  pool: PoolLike,
  filialNome: string,
  produtosCores: Array<{ produto: string; cor: string }>
): Promise<Map<string, { estoque: number; slot: number }>> {
  const map = new Map<string, { estoque: number; slot: number }>();
  if (produtosCores.length === 0) return map;

  const reqSaldo = pool.request();
  reqSaldo.input('filial', filialNome);
  const saldoRes = await reqSaldo.query(`
    SELECT RTRIM(LTRIM(PRODUTO)) AS PRODUTO,
           RTRIM(LTRIM(ISNULL(COR_PRODUTO,''))) AS COR,
           ESTOQUE
    FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
    WHERE RTRIM(LTRIM(FILIAL)) = RTRIM(LTRIM(@filial))
  `);
  const saldoByKey = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of saldoRes.recordset as any[]) {
    saldoByKey.set(`${r.PRODUTO}|${r.COR}`, Number(r.ESTOQUE) || 0);
  }

  const slots = await carregarSlots(pool, produtosCores.map((p) => p.produto));
  for (const pc of produtosCores) {
    const produto = pc.produto.trim();
    const cor = (pc.cor ?? '').trim();
    const key = `${produto}|${cor}`;
    map.set(key, { estoque: saldoByKey.get(key) ?? 0, slot: slots.get(produto) ?? 1 });
  }
  return map;
}

async function nomeJaExiste(pool: PoolLike, nome: string): Promise<boolean> {
  const req = pool.request();
  req.input('nome', nome);
  const res = await req.query(`
    SELECT COUNT(*) AS TOTAL FROM ESTOQUE_PROD_CONTAGEM WITH (NOLOCK)
    WHERE RTRIM(LTRIM(NOME_CONTAGEM)) = RTRIM(LTRIM(@nome))
  `);
  return (res.recordset[0]?.TOTAL ?? 0) > 0;
}

/**
 * Gera um NOME_CONTAGEM livre (≤25 chars) a partir de uma base, sufixando com um
 * número quando a base já existir. Usado quando uma operação cria várias contagens
 * (ex.: Zerar Item em N filiais) e cada uma precisa de uma PK única.
 */
export async function encontrarNomeContagemLivre(pool: PoolLike, base: string): Promise<string> {
  const limpa = (base || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, NOME_MAX);
  const inicial = limpa || 'ZERITEM';
  if (!(await nomeJaExiste(pool, inicial))) return inicial;
  for (let i = 2; i <= 999; i++) {
    const sufixo = String(i);
    const cand = inicial.slice(0, NOME_MAX - sufixo.length) + sufixo;
    if (!(await nomeJaExiste(pool, cand))) return cand;
  }
  throw new Error('Não foi possível gerar uma descrição única de contagem.');
}

/**
 * Insere a contagem (header + itens com deltas já calculados). A trigger
 * LXI_ESTOQUE_PROD_CTG_AJUSTE aplica o estoque a cada INSERT (soma A1..A48 →
 * ESTOQUE/ESx). QTDE_AJUSTE guarda o delta; A{slot} dirige o movimento.
 */
async function aplicarContagem(
  pool: PoolLike,
  params: {
    filialNome: string;
    nomeContagem: string;
    emissao: string;
    responsavel: string;
    obs?: string | null;
    deltas: ItemDelta[];
  }
): Promise<{ itensAjustados: number; somaDelta: number }> {
  const { filialNome, emissao, deltas } = params;
  const nomeContagem = params.nomeContagem.trim();
  const responsavel = (params.responsavel || '').trim().slice(0, 25) || 'AJUSTE';
  const obs = params.obs?.trim() || null;

  if (!filialNome) throw new Error('Filial não informada.');
  if (!nomeContagem) throw new Error('Descrição (nome da contagem) não informada.');
  if (nomeContagem.length > NOME_MAX) {
    throw new Error(`A descrição deve ter no máximo ${NOME_MAX} caracteres.`);
  }
  if (deltas.length === 0) throw new Error('Nenhuma diferença a ajustar.');

  if (await nomeJaExiste(pool, nomeContagem)) {
    throw new Error(`Já existe uma contagem com a descrição "${nomeContagem}". Escolha outra.`);
  }

  // Header (FILIAL deve existir em FILIAIS — FK via trigger).
  const reqHeader = pool.request();
  reqHeader.input('nome', nomeContagem);
  reqHeader.input('filial', filialNome);
  reqHeader.input('emissao', emissao);
  reqHeader.input('responsavel', responsavel);
  reqHeader.input('obs', obs);
  await reqHeader.query(`
    INSERT INTO ESTOQUE_PROD_CONTAGEM (
      NOME_CONTAGEM, FILIAL, EMISSAO, RESPONSAVEL, ESTOQUE_AJUSTADO,
      DATA_AJUSTE, TIPO, SALDO_ARMAZENADO, CONTAGEM_POR_AREA_FECHADA, OBS
    ) VALUES (
      @nome, @filial, @emissao, @responsavel, 1,
      @emissao, 'C', 1, 0, @obs
    )
  `);

  // Itens — multi-row INSERT por (chunk, slot). Header sem itens (se falhar) é inofensivo.
  const somaDelta = deltas.reduce((s, d) => s + d.delta, 0);
  const CHUNK = 300; // < limite de 2100 parâmetros (3/linha + @nome)
  for (let i = 0; i < deltas.length; i += CHUNK) {
    const chunk = deltas.slice(i, i + CHUNK);
    const bySlot = new Map<number, ItemDelta[]>();
    for (const d of chunk) {
      const arr = bySlot.get(d.slot) ?? [];
      arr.push(d);
      bySlot.set(d.slot, arr);
    }
    for (const [slot, rows] of bySlot) {
      const reqSlot = pool.request();
      reqSlot.input('nome', nomeContagem);
      const tuples: string[] = [];
      rows.forEach((d, idx) => {
        reqSlot.input(`p${idx}`, d.produto);
        reqSlot.input(`c${idx}`, d.cor ? d.cor : '');
        reqSlot.input(`q${idx}`, sql.Int, d.delta);
        tuples.push(`(@nome, @p${idx}, @c${idx}, @q${idx}, @q${idx})`);
      });
      await reqSlot.query(`
        INSERT INTO ESTOQUE_PROD_CTG_AJUSTE (NOME_CONTAGEM, PRODUTO, COR_PRODUTO, QTDE_AJUSTE, A${slot})
        VALUES ${tuples.join(',')}
      `);
    }
  }

  return { itensAjustados: deltas.length, somaDelta };
}

/**
 * Executa o ajuste: recalcula o delta contra o saldo ATUAL (corrida-seguro):
 * delta = contagem - saldoAtual; depois cria a contagem (a trigger aplica o estoque).
 */
export async function executarAjusteContagem(
  pool: PoolLike,
  params: AjusteContagemParams
): Promise<AjusteContagemResult> {
  const filialNome = params.filialNome.trim();
  const nomeContagem = params.nomeContagem.trim();

  if (!params.itens || params.itens.length === 0) {
    throw new Error('Nenhum item para ajustar.');
  }

  const saldoMap = await carregarSaldoESlots(
    pool,
    filialNome,
    params.itens.map((it) => ({ produto: it.produto, cor: it.cor }))
  );

  const deltas: ItemDelta[] = [];
  let semDiferenca = 0;
  for (const it of params.itens) {
    const produto = it.produto.trim();
    const cor = (it.cor ?? '').trim();
    const info = saldoMap.get(`${produto}|${cor}`);
    const saldoAtual = info?.estoque ?? 0;
    const slot = info?.slot ?? 1;
    const delta = Math.trunc(it.contagem) - saldoAtual;
    if (delta === 0) {
      semDiferenca += 1;
      continue;
    }
    deltas.push({ produto, cor, delta, slot });
  }

  if (deltas.length === 0) {
    throw new Error('Nenhuma diferença a ajustar (todos os itens já batem com o saldo atual).');
  }

  const { itensAjustados, somaDelta } = await aplicarContagem(pool, {
    filialNome,
    nomeContagem,
    emissao: params.emissao,
    responsavel: params.responsavel,
    obs: params.obs,
    deltas,
  });

  return { success: true, nomeContagem, itensAjustados, somaDelta, semDiferenca };
}

/**
 * Desfaz (estorna) uma contagem: lê os deltas originais e cria uma nova contagem
 * com os deltas invertidos. Nada é apagado — original e estorno ficam no histórico.
 */
export async function estornarContagem(
  pool: PoolLike,
  params: { nomeOriginal: string; novoNome: string; emissao: string; responsavel: string }
): Promise<EstornoResult> {
  const nomeOriginal = params.nomeOriginal.trim();
  const novoNome = params.novoNome.trim();
  if (!nomeOriginal) throw new Error('Contagem original não informada.');
  if (!novoNome || novoNome.length > NOME_MAX) throw new Error('Nome de estorno inválido.');

  // Header original (filial).
  const reqH = pool.request();
  reqH.input('nome', nomeOriginal);
  const hRes = await reqH.query(`
    SELECT TOP 1 RTRIM(FILIAL) AS FILIAL FROM ESTOQUE_PROD_CONTAGEM WITH (NOLOCK)
    WHERE RTRIM(LTRIM(NOME_CONTAGEM)) = RTRIM(LTRIM(@nome))
  `);
  const filialNome = hRes.recordset[0]?.FILIAL?.trim();
  if (!filialNome) throw new Error(`Contagem "${nomeOriginal}" não encontrada.`);

  // Itens originais (deltas a inverter).
  const reqI = pool.request();
  reqI.input('nome', nomeOriginal);
  const iRes = await reqI.query(`
    SELECT RTRIM(PRODUTO) AS PRODUTO, RTRIM(ISNULL(COR_PRODUTO,'')) AS COR, ISNULL(QTDE_AJUSTE,0) AS Q
    FROM ESTOQUE_PROD_CTG_AJUSTE WITH (NOLOCK)
    WHERE RTRIM(LTRIM(NOME_CONTAGEM)) = RTRIM(LTRIM(@nome)) AND ISNULL(QTDE_AJUSTE,0) <> 0
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orig = iRes.recordset as any[];
  if (orig.length === 0) throw new Error('A contagem não tem itens para estornar.');

  const slots = await carregarSlots(pool, orig.map((r) => String(r.PRODUTO).trim()));
  const deltas: ItemDelta[] = orig
    .map((r) => {
      const produto = String(r.PRODUTO).trim();
      return {
        produto,
        cor: String(r.COR ?? '').trim(),
        delta: -(Number(r.Q) || 0),
        slot: slots.get(produto) ?? 1,
      };
    })
    .filter((d) => d.delta !== 0);

  const { itensAjustados, somaDelta } = await aplicarContagem(pool, {
    filialNome,
    nomeContagem: novoNome,
    emissao: params.emissao,
    responsavel: params.responsavel,
    obs: `ESTORNO de ${nomeOriginal}`,
    deltas,
  });

  return { success: true, nomeContagem: novoNome, nomeOriginal, itensAjustados, somaDelta };
}
