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
 * Grade: o delta é calculado POR TAMANHO (A1..A48 contra ES1..ES48). Jogar o delta
 * inteiro no tamanho base deixava ESx negativo em item P/M/G, e o LXU_ESTOQUE_PRODUTOS
 * recusa estoque negativo em QUALQUER tamanho nas filiais sem PERMITE_EST_NEGATIVO
 * (caso SCARF ME - MATRIZ, 13/10/2026: inventário quebrou no meio).
 *
 * Gravação: tudo-ou-nada. Cabendo numa requisição (o normal), header + itens vão
 * numa transação. Quando o lote passa do limite do proxy, vai em partes e, se uma
 * falhar, a contagem é excluída — o LXD_ESTOQUE_PROD_CONTAGEM desfaz o estoque dos
 * itens que já tinham entrado (uma vez só: o LXD dos itens, em cascata, já não acha
 * o header).
 *
 * Ver memórias: ajuste-estoque-mecanismo-trigger, ajuste-inventario-grade-e-gravacao-parcial.
 */

export interface AjusteContagemItem {
  /** Código do produto (PRODUTOS.PRODUTO). */
  produto: string;
  /** Cor (PRODUTOS.COR_PRODUTO) — pode ser vazio. */
  cor: string;
  /** Quantidade contada (alvo). O delta é recalculado contra o saldo atual. */
  contagem: number;
  /**
   * Contagem por tamanho (posição da grade 1..48 → qtd), quando se sabe o tamanho
   * (arquivo de inventário). A soma tem que bater com `contagem`. Ausente/null:
   * mantém a distribuição atual do saldo e acerta só a diferença.
   */
  tamanhos?: Record<string, number> | null;
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
const TAMANHOS = 48;
/** Teto de texto SQL por requisição — o proxy (express.json) recusa corpo > 100 KB. */
const LOTE_MAX_CHARS = 60_000;
/** Limite do SQL Server de linhas por INSERT ... VALUES. */
const LINHAS_POR_INSERT = 900;

function escapeLike(value: string): string {
  return value.replace(/'/g, "''");
}

interface ItemDelta {
  produto: string;
  cor: string;
  /** Delta por tamanho: índice 0..47 = A1..A48. */
  deltas: number[];
}

const soma = (v: number[]) => v.reduce((s, x) => s + x, 0);

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
      slotByProduto.set(r.PRODUTO, n >= 1 && n <= TAMANHOS ? n : 1);
    }
  }
  return slotByProduto;
}

interface SaldoAtual {
  estoque: number;
  /** ES1..ES48 (índice 0..47). */
  es: number[];
  slot: number;
}

/** Saldo atual (total + por tamanho) e slot base por (produto,cor) na filial. */
async function carregarSaldos(
  pool: PoolLike,
  filialNome: string,
  produtos: string[]
): Promise<{ saldos: Map<string, SaldoAtual>; slots: Map<string, number> }> {
  const saldos = new Map<string, SaldoAtual>();
  const unicos = [...new Set(produtos.map((p) => p.trim()))];
  const esCols = Array.from({ length: TAMANHOS }, (_, i) => `ES${i + 1}`).join(', ');
  for (let i = 0; i < unicos.length; i += 800) {
    const inList = unicos
      .slice(i, i + 800)
      .map((p) => `'${escapeLike(p)}'`)
      .join(',');
    const req = pool.request();
    req.input('filial', filialNome);
    const res = await req.query(`
      SELECT RTRIM(LTRIM(PRODUTO)) AS PRODUTO,
             RTRIM(LTRIM(ISNULL(COR_PRODUTO,''))) AS COR,
             ESTOQUE, ${esCols}
      FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
      WHERE RTRIM(LTRIM(FILIAL)) = RTRIM(LTRIM(@filial))
        AND RTRIM(LTRIM(PRODUTO)) IN (${inList})
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of res.recordset as any[]) {
      saldos.set(`${r.PRODUTO}|${r.COR}`, {
        estoque: Number(r.ESTOQUE) || 0,
        es: Array.from({ length: TAMANHOS }, (_, k) => Number(r[`ES${k + 1}`]) || 0),
        slot: 1,
      });
    }
  }
  const slots = await carregarSlots(pool, unicos);
  return { saldos, slots };
}

/**
 * Quanto cada tamanho deve ter depois do ajuste.
 *  - Com `tamanhos` (somando `contagem`): é o alvo, tamanho a tamanho.
 *  - Contagem 0: zero em todos os tamanhos.
 *  - Só o total: mantém a distribuição atual (sem negativos) e acerta a diferença —
 *    sobra entra no tamanho base; falta sai do base e depois dos maiores.
 * Para contagem ≥ 0 nenhum tamanho fica negativo.
 */
export function alvoPorTamanho(
  atual: number[],
  contagem: number,
  slotBase: number,
  tamanhos?: Record<string, number> | null
): number[] {
  const base = slotBase - 1;
  const alvo = Array<number>(TAMANHOS).fill(0);

  if (tamanhos) {
    let valido = true;
    for (const [k, v] of Object.entries(tamanhos)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 1 || i > TAMANHOS) {
        valido = false;
        break;
      }
      alvo[i - 1] += Math.trunc(Number(v) || 0);
    }
    if (valido && soma(alvo) === contagem) return alvo;
    alvo.fill(0);
  }

  if (contagem <= 0) {
    alvo[base] = contagem; // 0 = zera tudo; negativo não deveria chegar aqui
    return alvo;
  }

  for (let i = 0; i < TAMANHOS; i++) alvo[i] = Math.max(0, atual[i] ?? 0);
  let diferenca = contagem - soma(alvo);
  if (diferenca > 0) {
    alvo[base] += diferenca;
  } else if (diferenca < 0) {
    const ordem = [
      base,
      ...alvo
        .map((v, i) => ({ v, i }))
        .filter(({ i }) => i !== base)
        .sort((a, b) => b.v - a.v)
        .map(({ i }) => i),
    ];
    for (const i of ordem) {
      if (diferenca === 0) break;
      const tira = Math.min(alvo[i], -diferenca);
      alvo[i] -= tira;
      diferenca += tira;
    }
  }
  return alvo;
}

/** Produto×cor que não existem em PRODUTO_CORES (o trigger recusaria a contagem inteira). */
async function semCadastroDeCor(
  pool: PoolLike,
  itens: Array<{ produto: string; cor: string }>
): Promise<string[]> {
  const existentes = new Set<string>();
  const produtos = [...new Set(itens.map((i) => i.produto))];
  for (let i = 0; i < produtos.length; i += 800) {
    const inList = produtos
      .slice(i, i + 800)
      .map((p) => `'${escapeLike(p)}'`)
      .join(',');
    const res = await pool.request().query(`
      SELECT RTRIM(LTRIM(PRODUTO)) AS PRODUTO, RTRIM(LTRIM(COR_PRODUTO)) AS COR
      FROM PRODUTO_CORES WITH (NOLOCK) WHERE RTRIM(LTRIM(PRODUTO)) IN (${inList})
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of res.recordset as any[]) existentes.add(`${r.PRODUTO}|${r.COR}`);
  }
  return itens.filter((i) => !existentes.has(`${i.produto}|${i.cor}`)).map((i) => `${i.produto} cor ${i.cor || '(vazia)'}`);
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
 * Erro do Linx em linguagem de gente. O trigger faz raiserror + rollback: o driver
 * entrega "The transaction ended in the trigger" e o motivo vem junto (via proxy,
 * concatenado com " | "; direto, em precedingErrors).
 */
function erroDoLinx(error: unknown, desfeito: boolean): Error {
  const principal = error instanceof Error ? error.message : String(error);
  // Sem resposta (timeout/conexão): não dá para afirmar se gravou — a mensagem do
  // proxy já manda conferir antes de repetir.
  if (/pode ter sido aplicada|Erro de conexão|Timeout ao conectar/i.test(principal)) {
    return error instanceof Error ? error : new Error(principal);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anteriores: string[] = ((error as any)?.precedingErrors ?? []).map((e: any) => String(e?.message ?? ''));
  const partes = [...principal.split(' | '), ...anteriores]
    .map((p) => p.replace(/^Erro do banco \(via proxy\):\s*/, '').trim())
    .filter((p) => p && !/transaction ended in the trigger|batch has been aborted/i.test(p));
  const motivo = partes.length > 0 ? [...new Set(partes)].join(' | ') : 'o Linx recusou a gravação (trigger).';
  return new Error(
    `${desfeito ? 'Nada foi gravado' : 'ATENÇÃO: a gravação falhou e não foi possível desfazer — confira a contagem no Linx'}. Motivo: ${motivo}`
  );
}

/**
 * Insere a contagem (header + itens com deltas por tamanho) tudo-ou-nada. A trigger
 * LXI_ESTOQUE_PROD_CTG_AJUSTE aplica o estoque a cada INSERT (A1..A48 → ESTOQUE/ESx).
 * QTDE_AJUSTE guarda o delta total = soma dos Ax.
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

  const semCor = await semCadastroDeCor(pool, deltas);
  if (semCor.length > 0) {
    throw new Error(
      `Nada foi gravado: ${semCor.length} item(ns) sem a cor cadastrada no produto (PRODUTO_CORES): ${semCor
        .slice(0, 10)
        .join(', ')}${semCor.length > 10 ? '…' : ''}`
    );
  }

  // Header (FILIAL deve existir em FILIAIS — FK via trigger).
  const header = `
    INSERT INTO ESTOQUE_PROD_CONTAGEM (
      NOME_CONTAGEM, FILIAL, EMISSAO, RESPONSAVEL, ESTOQUE_AJUSTADO,
      DATA_AJUSTE, TIPO, SALDO_ARMAZENADO, CONTAGEM_POR_AREA_FECHADA, OBS
    ) VALUES (
      @nome, @filial, @emissao, @responsavel, 1,
      @emissao, 'C', 1, 0, @obs
    );`;

  // Itens: um INSERT por conjunto de tamanhos usados (a imensa maioria é só A1),
  // só com as colunas necessárias — mantém o texto pequeno para o proxy.
  const porColunas = new Map<string, { slots: number[]; linhas: string[] }>();
  for (const d of deltas) {
    const slots = d.deltas.map((v, i) => (v !== 0 ? i + 1 : 0)).filter(Boolean);
    const chave = slots.join(',');
    const grupo = porColunas.get(chave) ?? { slots, linhas: [] };
    grupo.linhas.push(
      `(@nome,'${escapeLike(d.produto)}','${escapeLike(d.cor)}',${soma(d.deltas)},${slots
        .map((s) => d.deltas[s - 1])
        .join(',')})`
    );
    porColunas.set(chave, grupo);
  }
  const insertsItens: string[] = [];
  for (const { slots, linhas } of porColunas.values()) {
    const cols = slots.map((s) => `A${s}`).join(', ');
    for (let i = 0; i < linhas.length; i += LINHAS_POR_INSERT) {
      // Linhas por statement limitadas também pelo tamanho do lote.
      let fatia: string[] = [];
      let tamanho = 0;
      for (const linha of linhas.slice(i, i + LINHAS_POR_INSERT)) {
        if (tamanho + linha.length > LOTE_MAX_CHARS - 500 && fatia.length > 0) {
          insertsItens.push(`INSERT INTO ESTOQUE_PROD_CTG_AJUSTE (NOME_CONTAGEM, PRODUTO, COR_PRODUTO, QTDE_AJUSTE, ${cols}) VALUES ${fatia.join(',')};`);
          fatia = [];
          tamanho = 0;
        }
        fatia.push(linha);
        tamanho += linha.length + 1;
      }
      if (fatia.length > 0) {
        insertsItens.push(`INSERT INTO ESTOQUE_PROD_CTG_AJUSTE (NOME_CONTAGEM, PRODUTO, COR_PRODUTO, QTDE_AJUSTE, ${cols}) VALUES ${fatia.join(',')};`);
      }
    }
  }

  // Empacota os statements em lotes que caibam numa requisição.
  const lotes: string[][] = [[header]];
  let tamanhoLote = header.length;
  for (const stmt of insertsItens) {
    if (tamanhoLote + stmt.length > LOTE_MAX_CHARS) {
      lotes.push([]);
      tamanhoLote = 0;
    }
    lotes[lotes.length - 1].push(stmt);
    tamanhoLote += stmt.length;
  }

  const rodar = async (texto: string) => {
    const req = pool.request();
    req.input('nome', nomeContagem);
    req.input('filial', filialNome);
    req.input('emissao', emissao);
    req.input('responsavel', responsavel);
    req.input('obs', obs);
    return req.query(texto);
  };

  if (lotes.length === 1) {
    // Caso normal: uma transação só — o trigger que recusar desfaz tudo.
    try {
      await rodar(`SET XACT_ABORT ON;\nBEGIN TRANSACTION;\n${lotes[0].join('\n')}\nCOMMIT TRANSACTION;`);
    } catch (error) {
      throw erroDoLinx(error, true);
    }
  } else {
    for (const lote of lotes) {
      try {
        await rodar(lote.join('\n'));
      } catch (error) {
        // Desfaz o que entrou: excluir o header estorna os itens (LXD) e os apaga.
        let desfeito = false;
        try {
          if (await nomeJaExiste(pool, nomeContagem)) {
            await rodar('DELETE FROM ESTOQUE_PROD_CONTAGEM WHERE NOME_CONTAGEM = @nome;');
          }
          desfeito = !(await nomeJaExiste(pool, nomeContagem));
        } catch (errDesfazer) {
          console.error('[ajuste-estoque] falha ao desfazer contagem parcial', nomeContagem, errDesfazer);
        }
        throw erroDoLinx(error, desfeito);
      }
    }
  }

  return { itensAjustados: deltas.length, somaDelta: deltas.reduce((s, d) => s + soma(d.deltas), 0) };
}

/**
 * Executa o ajuste: recalcula o delta contra o saldo ATUAL (corrida-seguro), tamanho
 * por tamanho; depois cria a contagem (a trigger aplica o estoque).
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

  const { saldos, slots } = await carregarSaldos(
    pool,
    filialNome,
    params.itens.map((it) => it.produto)
  );

  const deltas: ItemDelta[] = [];
  let semDiferenca = 0;
  for (const it of params.itens) {
    const produto = it.produto.trim();
    const cor = (it.cor ?? '').trim();
    const saldo = saldos.get(`${produto}|${cor}`);
    const slot = slots.get(produto) ?? 1;
    const atual = saldo?.es ?? Array<number>(TAMANHOS).fill(0);
    const contagem = Math.trunc(it.contagem);
    const alvo = alvoPorTamanho(atual, contagem, slot, it.tamanhos);
    const porTamanho = alvo.map((v, i) => v - atual[i]);
    // Linha com ESTOQUE ≠ soma dos ESx: o total manda (é o que todo mundo lê).
    porTamanho[slot - 1] += soma(atual) - (saldo?.estoque ?? 0);
    if (porTamanho.every((v) => v === 0)) {
      semDiferenca += 1;
      continue;
    }
    deltas.push({ produto, cor, deltas: porTamanho });
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
 * Desfaz (estorna) uma contagem: lê os deltas originais (por tamanho) e cria uma nova
 * contagem com eles invertidos. Nada é apagado — original e estorno ficam no histórico.
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

  // Itens originais (deltas por tamanho a inverter).
  const aCols = Array.from({ length: TAMANHOS }, (_, i) => `ISNULL(A${i + 1},0) AS A${i + 1}`).join(', ');
  const reqI = pool.request();
  reqI.input('nome', nomeOriginal);
  const iRes = await reqI.query(`
    SELECT RTRIM(PRODUTO) AS PRODUTO, RTRIM(ISNULL(COR_PRODUTO,'')) AS COR, ${aCols}
    FROM ESTOQUE_PROD_CTG_AJUSTE WITH (NOLOCK)
    WHERE RTRIM(LTRIM(NOME_CONTAGEM)) = RTRIM(LTRIM(@nome))
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deltas: ItemDelta[] = (iRes.recordset as any[])
    .map((r) => ({
      produto: String(r.PRODUTO).trim(),
      cor: String(r.COR ?? '').trim(),
      deltas: Array.from({ length: TAMANHOS }, (_, i) => -(Number(r[`A${i + 1}`]) || 0)),
    }))
    .filter((d) => d.deltas.some((v) => v !== 0));
  if (deltas.length === 0) throw new Error('A contagem não tem itens para estornar.');

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
