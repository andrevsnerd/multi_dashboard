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
 * extrato do item (CONTAGEM/AJUSTE) com a descrição (NOME_CONTAGEM) e o responsável,
 * e o histórico fica computado nativamente. As triggers do header só carimbam
 * DATA_AJUSTE — setar ESTOQUE_AJUSTADO=1 não duplica o movimento.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoolLike = { request: () => any };

const NOME_MAX = 25;

function escapeLike(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Linha do saldo atual + slot de grade (TAMANHO_BASE) por produto.
 * O movimento é dirigido pela coluna A{slot}; para tamanho único (UNICO) slot=1.
 */
interface SaldoAtual {
  produto: string;
  cor: string;
  estoque: number;
  slot: number; // 1..48
}

async function carregarSaldoESlots(
  pool: PoolLike,
  filialNome: string,
  produtosCores: Array<{ produto: string; cor: string }>
): Promise<Map<string, SaldoAtual>> {
  const map = new Map<string, SaldoAtual>();
  if (produtosCores.length === 0) return map;

  // Saldo atual de TODOS os itens da filial (uma query). Chave = produto|cor (trim).
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

  // TAMANHO_BASE por produto (slot da grade). Default 1 (UNICO).
  const produtosUnicos = [...new Set(produtosCores.map((p) => p.produto.trim()))];
  const slotByProduto = new Map<string, number>();
  for (let i = 0; i < produtosUnicos.length; i += 800) {
    const chunk = produtosUnicos.slice(i, i + 800);
    const inList = chunk.map((p) => `'${escapeLike(p)}'`).join(',');
    const reqTb = pool.request();
    const tbRes = await reqTb.query(`
      SELECT RTRIM(LTRIM(PRODUTO)) AS PRODUTO, ISNULL(TAMANHO_BASE,1) AS TB
      FROM PRODUTOS WITH (NOLOCK)
      WHERE RTRIM(LTRIM(PRODUTO)) IN (${inList})
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of tbRes.recordset as any[]) {
      const n = parseInt(r.TB, 10);
      slotByProduto.set(r.PRODUTO, n >= 1 && n <= 48 ? n : 1);
    }
  }

  for (const pc of produtosCores) {
    const produto = pc.produto.trim();
    const cor = (pc.cor ?? '').trim();
    const key = `${produto}|${cor}`;
    map.set(key, {
      produto,
      cor,
      estoque: saldoByKey.get(key) ?? 0,
      slot: slotByProduto.get(produto) ?? 1,
    });
  }
  return map;
}

/**
 * Executa o ajuste: cria a contagem e deixa a trigger aplicar o estoque.
 * Recalcula o delta contra o saldo ATUAL (corrida-seguro): delta = contagem - saldoAtual.
 */
export async function executarAjusteContagem(
  pool: PoolLike,
  params: AjusteContagemParams
): Promise<AjusteContagemResult> {
  const filialNome = params.filialNome.trim();
  const nomeContagem = params.nomeContagem.trim();
  const responsavel = (params.responsavel || '').trim().slice(0, 25) || 'AJUSTE';
  const emissao = params.emissao;
  const obs = params.obs?.trim() || null;

  if (!filialNome) throw new Error('Filial não informada.');
  if (!nomeContagem) throw new Error('Descrição (nome da contagem) não informada.');
  if (nomeContagem.length > NOME_MAX) {
    throw new Error(`A descrição deve ter no máximo ${NOME_MAX} caracteres.`);
  }
  if (!params.itens || params.itens.length === 0) {
    throw new Error('Nenhum item para ajustar.');
  }

  // 0) NOME_CONTAGEM é PK — garante unicidade (erro claro em vez de violar PK).
  const reqDup = pool.request();
  reqDup.input('nome', nomeContagem);
  const dupRes = await reqDup.query(`
    SELECT COUNT(*) AS TOTAL FROM ESTOQUE_PROD_CONTAGEM WITH (NOLOCK)
    WHERE RTRIM(LTRIM(NOME_CONTAGEM)) = RTRIM(LTRIM(@nome))
  `);
  if ((dupRes.recordset[0]?.TOTAL ?? 0) > 0) {
    throw new Error(`Já existe uma contagem com a descrição "${nomeContagem}". Escolha outra.`);
  }

  // 1) Recalcula deltas contra o saldo atual.
  const saldoMap = await carregarSaldoESlots(
    pool,
    filialNome,
    params.itens.map((it) => ({ produto: it.produto, cor: it.cor }))
  );

  interface ItemDelta {
    produto: string;
    cor: string;
    delta: number;
    slot: number;
  }
  const deltas: ItemDelta[] = [];
  let semDiferenca = 0;
  for (const it of params.itens) {
    const produto = it.produto.trim();
    const cor = (it.cor ?? '').trim();
    const info = saldoMap.get(`${produto}|${cor}`);
    const saldoAtual = info?.estoque ?? 0;
    const slot = info?.slot ?? 1;
    const contagem = Math.trunc(it.contagem);
    const delta = contagem - saldoAtual;
    if (delta === 0) {
      semDiferenca += 1;
      continue;
    }
    deltas.push({ produto, cor, delta, slot });
  }

  if (deltas.length === 0) {
    throw new Error('Nenhuma diferença a ajustar (todos os itens já batem com o saldo atual).');
  }

  // 2) Header da contagem (FILIAL deve existir em FILIAIS — FK via trigger).
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

  // 3) Itens de ajuste. A trigger LXI_ESTOQUE_PROD_CTG_AJUSTE aplica o estoque
  //    a cada INSERT (agrupa por produto/cor/filial e soma A1..A48). QTDE_AJUSTE
  //    guarda o delta para exibição; a coluna A{slot} é quem dirige o movimento
  //    (TAMANHO_BASE; UNICO => A1). Como a coluna de slot varia por produto,
  //    agrupamos por slot e emitimos um multi-row INSERT por (chunk, slot).
  //    Header sem itens (se algo falhar) é inofensivo: não altera estoque.
  const somaDelta = deltas.reduce((s, d) => s + d.delta, 0);
  const CHUNK = 300; // < limite de 2100 parâmetros (3 params/linha + @nome)
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

  return {
    success: true,
    nomeContagem,
    itensAjustados: deltas.length,
    somaDelta,
    semDiferenca,
  };
}
