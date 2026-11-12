import 'server-only';

/**
 * Aba "Por cor" da tela Alterar Custo / Preço: ligar o modo cor de UM produto e alterar o
 * PRECO_LIQUIDO1 de cada cor numa tabela de preço.
 *
 * No Linx quem decide de onde o PDV tira o preço é `PRODUTOS.VARIA_PRECO_COR`
 * (view W_LJ_PRECO_PRODUTO):
 *   0 → PRODUTOS_PRECOS     (produto × tabela — todas as cores iguais)
 *   1 → PRODUTOS_PRECO_COR  (produto × tabela × cor; PRODUTOS_PRECOS é ignorada no PDV)
 *
 * Ligar o modo cor = espelhar PRODUTOS_PRECOS em PRODUTOS_PRECO_COR para TODAS as cores ×
 * TODAS as tabelas COM A FLAG AINDA EM 0 (os blocos de custo/sugerido/preço por filial dos
 * gatilhos só agem com flag 1), conferir o espelho e só então ligar a flag.
 *
 * Alterar o líquido = UPDATE só de PRECO_LIQUIDO1. O LXU_PRODUTOS_PRECO_COR só recalcula o
 * líquido quando PRECO1..4 muda, então o valor gravado fica. Ele propaga para as tabelas
 * derivadas daquela cor (ND, 09, 12…) e para PRODUTOS_PRECO_FILIAL — é o Linx, de propósito.
 *
 * Histórico em NERD_PRECO_COR_HISTORICO (separado do NERD_PRECO_HISTORICO, para o Reverter
 * da aba por produto nunca tratar um lote por cor como por produto). Conferido em 12/11/2026
 * na pashmina 07.A1.00B3 cor 121 (lote PRCC202611121755202WV08).
 */

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import type { RequestLike } from '@/lib/db/proxy';
import { mapearCodigosOuBarras, type PrecoCompany } from '@/lib/repositories/precos';

const TABELA_HISTORICO = 'NERD_PRECO_COR_HISTORICO';
const TABELA_RE = /^[A-Z0-9]{1,2}$/;

/** Campos do cadastro que o gatilho de cor pode zerar — devolvidos ao valor de antes. */
const CAMPOS_CADASTRO = [
  'CUSTO_REPOSICAO1', 'CUSTO_REPOSICAO2', 'CUSTO_REPOSICAO3', 'CUSTO_REPOSICAO4',
  'PRECO_REPOSICAO_1', 'PRECO_REPOSICAO_2', 'PRECO_REPOSICAO_3', 'PRECO_REPOSICAO_4',
  'PRECO_A_VISTA_REPOSICAO_1', 'PRECO_A_VISTA_REPOSICAO_2', 'PRECO_A_VISTA_REPOSICAO_3', 'PRECO_A_VISTA_REPOSICAO_4',
] as const;

type Req = sql.Request | RequestLike;

function limpar(value: unknown): string {
  return String(value ?? '').trim();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mudou(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b;
  return Math.abs(a - b) > 0.005;
}

function novoLoteCor(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `PRCC${stamp}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/* ─────────────────────────────── leitura ─────────────────────────────── */

export interface CorPreco {
  cor: string;
  descricao: string;
  preco1: number | null;
  liquido1: number | null;
}

export interface ProdutoCor {
  produto: string;
  descricao: string;
  variaPrecoCor: boolean;
  tabela: string;
  tabelas: Array<{ codigo: string; descricao: string; inativa: boolean }>;
  /** Preço que o PDV vê em cada cor na tabela escolhida. */
  cores: CorPreco[];
}

export async function fetchProdutoCor(codigo: string, tabelaPedida?: string | null): Promise<ProdutoCor | null> {
  const entrada = limpar(codigo);
  if (!entrada) return null;
  const produto = (await mapearCodigosOuBarras([entrada])).get(entrada);
  if (!produto) return null;

  return withRequest(async (request) => {
    request.input('pcProd', sql.VarChar, produto);
    const cad = await request.query<{ descricao: string; varia: number }>(`
      SELECT LTRIM(RTRIM(DESC_PRODUTO)) AS descricao, CAST(ISNULL(VARIA_PRECO_COR, 0) AS INT) AS varia
      FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @pcProd
    `);
    const info = cad.recordset[0];
    if (!info) return null;
    const varia = Number(info.varia) === 1;

    const tabs = await request.query<{ codigo: string; descricao: string; inativa: number }>(`
      SELECT LTRIM(RTRIM(pp.CODIGO_TAB_PRECO)) AS codigo, LTRIM(RTRIM(ISNULL(tp.TABELA, ''))) AS descricao,
             CAST(ISNULL(tp.INATIVO, 0) AS INT) AS inativa
      FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
      LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
      WHERE pp.PRODUTO = @pcProd
      ORDER BY pp.CODIGO_TAB_PRECO
    `);
    const tabelas = tabs.recordset
      .map((t) => ({ codigo: limpar(t.codigo).toUpperCase(), descricao: limpar(t.descricao), inativa: Number(t.inativa) === 1 }))
      .filter((t) => TABELA_RE.test(t.codigo));

    const pedida = limpar(tabelaPedida).toUpperCase();
    const tabela = tabelas.some((t) => t.codigo === pedida)
      ? pedida
      : tabelas.find((t) => t.codigo === '01')?.codigo ?? tabelas[0]?.codigo ?? '';

    let cores: CorPreco[] = [];
    if (tabela) {
      request.input('pcTab', sql.VarChar, tabela);
      // Mesma escolha da W_LJ_PRECO_PRODUTO (sem o preço por filial).
      const r = await request.query<{ cor: string; descricao: string; p1: unknown; l1: unknown }>(`
        SELECT LTRIM(RTRIM(pc.COR_PRODUTO)) AS cor, LTRIM(RTRIM(ISNULL(pc.DESC_COR_PRODUTO, ''))) AS descricao,
               ${varia ? 'c' : 'pp'}.PRECO1 AS p1, ${varia ? 'c' : 'pp'}.PRECO_LIQUIDO1 AS l1
        FROM PRODUTO_CORES pc WITH (NOLOCK)
        INNER JOIN PRODUTOS_PRECOS pp WITH (NOLOCK) ON pp.PRODUTO = pc.PRODUTO AND pp.CODIGO_TAB_PRECO = @pcTab
        LEFT JOIN PRODUTOS_PRECO_COR c WITH (NOLOCK)
          ON c.PRODUTO = pc.PRODUTO AND c.COR_PRODUTO = pc.COR_PRODUTO AND c.CODIGO_TAB_PRECO = @pcTab
        WHERE pc.PRODUTO = @pcProd
        ORDER BY pc.COR_PRODUTO
      `);
      cores = r.recordset.map((row) => ({
        cor: limpar(row.cor),
        descricao: limpar(row.descricao),
        preco1: toNumber(row.p1),
        liquido1: toNumber(row.l1),
      }));
    }

    return { produto, descricao: limpar(info.descricao), variaPrecoCor: varia, tabela, tabelas, cores };
  });
}

/* ─────────────────────────────── histórico ─────────────────────────────── */

let historicoGarantido = false;

async function ensureHistoricoCorTable(request: Req): Promise<void> {
  if (historicoGarantido) return;
  await request.query(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'${TABELA_HISTORICO}') AND type = N'U')
    CREATE TABLE ${TABELA_HISTORICO} (
      ID             INT IDENTITY(1,1) PRIMARY KEY,
      LOTE           VARCHAR(40)   NOT NULL,
      DATA_ALTERACAO DATETIME      NOT NULL DEFAULT GETDATE(),
      EMPRESA        VARCHAR(20)   NOT NULL,
      USUARIO        VARCHAR(100)  NOT NULL,
      PRODUTO        VARCHAR(20)   NOT NULL,
      COR_PRODUTO    VARCHAR(10)   NULL,
      COD_TABELA     VARCHAR(10)   NULL,
      CAMPO          VARCHAR(40)   NOT NULL,
      VALOR_ANTERIOR NUMERIC(14,4) NULL,
      VALOR_NOVO     NUMERIC(14,4) NULL,
      OBS            VARCHAR(300)  NULL,
      REVERTE_LOTE   VARCHAR(40)   NULL
    )
  `);
  historicoGarantido = true;
}

interface LinhaHist {
  cor: string | null;
  tabela: string | null;
  campo: string;
  anterior: number | null;
  novo: number | null;
}

async function gravarHistorico(
  lote: string,
  company: PrecoCompany,
  usuario: string,
  produto: string,
  obs: string,
  linhas: LinhaHist[]
): Promise<void> {
  if (linhas.length === 0) return;
  await withRequest(async (request) => {
    await ensureHistoricoCorTable(request);
    request.input('hLote', sql.VarChar, lote);
    request.input('hEmpresa', sql.VarChar, company);
    request.input('hUsuario', sql.VarChar, usuario.slice(0, 100));
    request.input('hProd', sql.VarChar, produto);
    request.input('hObs', sql.VarChar, obs.slice(0, 300));
    const values = linhas.map((l, i) => {
      request.input(`hc${i}`, sql.VarChar, l.cor);
      request.input(`ht${i}`, sql.VarChar, l.tabela);
      request.input(`hf${i}`, sql.VarChar, l.campo);
      request.input(`ha${i}`, sql.VarChar, l.anterior === null ? null : l.anterior.toFixed(4));
      request.input(`hn${i}`, sql.VarChar, l.novo === null ? null : l.novo.toFixed(4));
      return `(@hLote, @hEmpresa, @hUsuario, @hProd, @hc${i}, @ht${i}, @hf${i}, CAST(@ha${i} AS NUMERIC(14,4)), CAST(@hn${i} AS NUMERIC(14,4)), @hObs)`;
    });
    await request.query(`
      INSERT INTO ${TABELA_HISTORICO}
        (LOTE, EMPRESA, USUARIO, PRODUTO, COR_PRODUTO, COD_TABELA, CAMPO, VALOR_ANTERIOR, VALOR_NOVO, OBS)
      VALUES ${values.join(', ')}
    `);
  });
}

/* ─────────────────────────────── cadastro ─────────────────────────────── */

type Cadastro = Record<string, number | null> & { varia: number | null };

async function lerCadastro(produto: string): Promise<Cadastro | null> {
  return withRequest(async (request) => {
    request.input('lcProd', sql.VarChar, produto);
    const r = await request.query<Record<string, unknown>>(`
      SELECT CAST(ISNULL(VARIA_PRECO_COR, 0) AS INT) AS varia, ${CAMPOS_CADASTRO.map((c) => `${c} AS [${c}]`).join(', ')}
      FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @lcProd
    `);
    const row = r.recordset[0];
    if (!row) return null;
    const out: Cadastro = { varia: toNumber(row.varia) };
    for (const c of CAMPOS_CADASTRO) out[c] = toNumber(row[c]);
    return out;
  });
}

/** Devolve custo/sugerido do produto ao snapshot, só nas colunas que um gatilho mexeu. */
async function restaurarCadastro(produto: string, antes: Cadastro): Promise<void> {
  const agora = await lerCadastro(produto);
  if (!agora) return;
  const mudaram = CAMPOS_CADASTRO.filter((c) => mudou(agora[c], antes[c]));
  if (mudaram.length === 0) return;
  await withRequest(async (request) => {
    request.input('rcProd', sql.VarChar, produto);
    const sets = mudaram.map((c, i) => {
      const v = antes[c];
      request.input(`rc${i}`, sql.VarChar, v === null ? null : v.toFixed(4));
      return `${c} = CAST(@rc${i} AS NUMERIC(14,4))`;
    });
    await request.query(`UPDATE PRODUTOS SET ${sets.join(', ')} WHERE PRODUTO = @rcProd`);
  });
}

/* ─────────────────────────────── ligar modo cor ─────────────────────────────── */

export interface LigarModoCorResult {
  lote: string;
  linhasCriadas: number;
}

export async function ligarModoCor(params: {
  produto: string;
  company: PrecoCompany;
  usuario: string;
  /** Lote já aberto (tarefa programada grava tudo num lote só). */
  lote?: string;
  obs?: string;
}): Promise<LigarModoCorResult> {
  const produto = limpar(params.produto);
  const antes = await lerCadastro(produto);
  if (!antes) throw new Error(`Produto ${produto} não encontrado.`);
  if (antes.varia === 1) throw new Error(`O produto ${produto} já está no modo cor.`);

  let linhasCriadas = 0;
  try {
    await withRequest(async (request) => {
      request.input('cvProd', sql.VarChar, produto);
      // Linhas velhas de outra época voltam ao preço atual do produto antes de valerem.
      await request.query(`
        UPDATE c SET
          PRECO1 = ISNULL(pp.PRECO1, 0), PRECO2 = ISNULL(pp.PRECO2, 0), PRECO3 = ISNULL(pp.PRECO3, 0), PRECO4 = ISNULL(pp.PRECO4, 0),
          PRECO_LIQUIDO1 = pp.PRECO_LIQUIDO1, PRECO_LIQUIDO2 = pp.PRECO_LIQUIDO2,
          PRECO_LIQUIDO3 = pp.PRECO_LIQUIDO3, PRECO_LIQUIDO4 = pp.PRECO_LIQUIDO4,
          PROMOCAO_DESCONTO = ISNULL(pp.PROMOCAO_DESCONTO, 0), INICIO_PROMOCAO = pp.INICIO_PROMOCAO, FIM_PROMOCAO = pp.FIM_PROMOCAO
        FROM PRODUTOS_PRECO_COR c
        INNER JOIN PRODUTOS_PRECOS pp ON pp.PRODUTO = c.PRODUTO AND pp.CODIGO_TAB_PRECO = c.CODIGO_TAB_PRECO
        WHERE c.PRODUTO = @cvProd
          AND (ABS(ISNULL(c.PRECO1,0) - ISNULL(pp.PRECO1,0)) > 0.005 OR ABS(ISNULL(c.PRECO2,0) - ISNULL(pp.PRECO2,0)) > 0.005
            OR ABS(ISNULL(c.PRECO3,0) - ISNULL(pp.PRECO3,0)) > 0.005 OR ABS(ISNULL(c.PRECO4,0) - ISNULL(pp.PRECO4,0)) > 0.005
            OR ABS(ISNULL(c.PRECO_LIQUIDO1,0) - ISNULL(pp.PRECO_LIQUIDO1,0)) > 0.005
            OR ISNULL(c.PROMOCAO_DESCONTO,0) <> ISNULL(pp.PROMOCAO_DESCONTO,0))
      `);
      // Conta antes de inserir: o INSERT dispara gatilhos, e o @@ROWCOUNT/recordset depois
      // dele não é confiável pelo proxy.
      const falt = await request.query<{ n: number }>(`
        SELECT COUNT(*) AS n
        FROM PRODUTOS_PRECOS pp
        INNER JOIN PRODUTO_CORES pc ON pc.PRODUTO = pp.PRODUTO
        LEFT JOIN PRODUTOS_PRECO_COR x
          ON x.PRODUTO = pp.PRODUTO AND x.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO AND x.COR_PRODUTO = pc.COR_PRODUTO
        WHERE pp.PRODUTO = @cvProd AND x.PRODUTO IS NULL
      `);
      linhasCriadas = Number(falt.recordset?.[0]?.n ?? 0);
      await request.query(`
        INSERT INTO PRODUTOS_PRECO_COR
          (CODIGO_TAB_PRECO, PRODUTO, COR_PRODUTO, PRECO1, PRECO2, PRECO3, PRECO4,
           PRECO_LIQUIDO1, PRECO_LIQUIDO2, PRECO_LIQUIDO3, PRECO_LIQUIDO4,
           MARK_UP_PREVISTO, PROMOCAO_DESCONTO, INICIO_PROMOCAO, FIM_PROMOCAO)
        SELECT pp.CODIGO_TAB_PRECO, pp.PRODUTO, pc.COR_PRODUTO,
               ISNULL(pp.PRECO1, 0), ISNULL(pp.PRECO2, 0), ISNULL(pp.PRECO3, 0), ISNULL(pp.PRECO4, 0),
               pp.PRECO_LIQUIDO1, pp.PRECO_LIQUIDO2, pp.PRECO_LIQUIDO3, pp.PRECO_LIQUIDO4,
               ISNULL(pp.MARK_UP_PREVISTO, 0), ISNULL(pp.PROMOCAO_DESCONTO, 0), pp.INICIO_PROMOCAO, pp.FIM_PROMOCAO
        FROM PRODUTOS_PRECOS pp
        INNER JOIN PRODUTO_CORES pc ON pc.PRODUTO = pp.PRODUTO
        LEFT JOIN PRODUTOS_PRECO_COR x
          ON x.PRODUTO = pp.PRODUTO AND x.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO AND x.COR_PRODUTO = pc.COR_PRODUTO
        WHERE pp.PRODUTO = @cvProd AND x.PRODUTO IS NULL
      `);

      // Conferência: toda cor × toda tabela tem linha, com o mesmo preço e líquido.
      const r = await request.query<{ faltando: number; diferentes: number }>(`
        SELECT
          SUM(CASE WHEN x.PRODUTO IS NULL THEN 1 ELSE 0 END) AS faltando,
          SUM(CASE WHEN x.PRODUTO IS NOT NULL AND (ABS(ISNULL(x.PRECO1,0) - ISNULL(pp.PRECO1,0)) > 0.005
                OR ABS(ISNULL(x.PRECO_LIQUIDO1,0) - ISNULL(pp.PRECO_LIQUIDO1,0)) > 0.005) THEN 1 ELSE 0 END) AS diferentes
        FROM PRODUTOS_PRECOS pp
        INNER JOIN PRODUTO_CORES pc ON pc.PRODUTO = pp.PRODUTO
        LEFT JOIN PRODUTOS_PRECO_COR x
          ON x.PRODUTO = pp.PRODUTO AND x.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO AND x.COR_PRODUTO = pc.COR_PRODUTO
        WHERE pp.PRODUTO = @cvProd
      `);
      const faltando = Number(r.recordset[0]?.faltando ?? 0);
      const diferentes = Number(r.recordset[0]?.diferentes ?? 0);
      if (faltando > 0 || diferentes > 0) {
        throw new Error(
          `A cópia do preço para as cores não fechou (${faltando} linha(s) faltando, ${diferentes} com preço diferente). O modo cor NÃO foi ligado.`
        );
      }

      await request.query(`UPDATE PRODUTOS SET VARIA_PRECO_COR = 1 WHERE PRODUTO = @cvProd AND ISNULL(VARIA_PRECO_COR, 0) = 0`);
    });
  } finally {
    await restaurarCadastro(produto, antes);
  }

  const lote = params.lote || novoLoteCor();
  await gravarHistorico(lote, params.company, params.usuario, produto, params.obs ?? 'Ligar modo cor (aba Por cor)', [
    { cor: null, tabela: null, campo: 'VARIA_PRECO_COR', anterior: 0, novo: 1 },
  ]);
  return { lote, linhasCriadas };
}

/* ─────────────────────────────── alterar líquido ─────────────────────────────── */

export interface AlteracaoLiquidoCor {
  cor: string;
  valor: number;
}

export interface AlterarLiquidoCorResult {
  lote: string;
  aplicados: number;
  semMudanca: number;
  naoConfirmados: number;
  erros: string[];
}

async function lerLiquidos(produto: string, tabela: string, cores: string[]): Promise<Map<string, number | null>> {
  return withRequest(async (request) => {
    request.input('llProd', sql.VarChar, produto);
    request.input('llTab', sql.VarChar, tabela);
    const ph = cores.map((c, i) => {
      request.input(`llc${i}`, sql.VarChar, c);
      return `@llc${i}`;
    });
    const r = await request.query<{ cor: string; l1: unknown }>(`
      SELECT LTRIM(RTRIM(COR_PRODUTO)) AS cor, PRECO_LIQUIDO1 AS l1
      FROM PRODUTOS_PRECO_COR WITH (NOLOCK)
      WHERE PRODUTO = @llProd AND CODIGO_TAB_PRECO = @llTab AND COR_PRODUTO IN (${ph.join(', ')})
    `);
    return new Map(r.recordset.map((row) => [limpar(row.cor), toNumber(row.l1)]));
  });
}

export async function alterarLiquidoCor(params: {
  produto: string;
  tabela: string;
  alteracoes: AlteracaoLiquidoCor[];
  company: PrecoCompany;
  usuario: string;
  lote?: string;
  obs?: string;
}): Promise<AlterarLiquidoCorResult> {
  const produto = limpar(params.produto);
  const tabela = limpar(params.tabela).toUpperCase();
  if (!TABELA_RE.test(tabela)) throw new Error('Tabela de preço inválida.');

  const erros: string[] = [];
  const porCor = new Map<string, number>();
  for (const a of params.alteracoes ?? []) {
    const cor = limpar(a?.cor);
    const valor = Number(a?.valor);
    if (!cor || !Number.isFinite(valor) || valor < 0) {
      erros.push(`Valor inválido para a cor ${cor || '?'}.`);
      continue;
    }
    porCor.set(cor, Math.round(valor * 100) / 100);
  }
  if (porCor.size === 0) throw new Error(erros[0] ?? 'Nenhuma alteração informada.');

  const cadastro = await lerCadastro(produto);
  if (!cadastro) throw new Error(`Produto ${produto} não encontrado.`);
  if (cadastro.varia !== 1) {
    throw new Error(`O produto ${produto} não está no modo cor: ligue o modo cor antes de alterar o líquido por cor.`);
  }

  const cores = [...porCor.keys()];
  const antes = await lerLiquidos(produto, tabela, cores);
  const aAlterar = cores.filter((cor) => {
    if (!antes.has(cor)) {
      erros.push(`A cor ${cor} não tem linha na tabela ${tabela}.`);
      return false;
    }
    return mudou(antes.get(cor) ?? null, porCor.get(cor)!);
  });
  const semMudanca = cores.filter((c) => antes.has(c)).length - aAlterar.length;

  const vazio = { lote: '', aplicados: 0, semMudanca, naoConfirmados: 0, erros };
  if (aAlterar.length === 0) return vazio;

  try {
    await withRequest(async (request) => {
      request.input('upProd', sql.VarChar, produto);
      request.input('upTab', sql.VarChar, tabela);
      const values = aAlterar.map((cor, i) => {
        request.input(`uc${i}`, sql.VarChar, cor);
        request.input(`uv${i}`, sql.VarChar, porCor.get(cor)!.toFixed(4));
        return `(@uc${i}, @uv${i})`;
      });
      // Só o PRECO_LIQUIDO1: sem tocar PRECO1 o gatilho não recalcula o líquido por cima.
      await request.query(`
        UPDATE c SET c.PRECO_LIQUIDO1 = CAST(v.V AS NUMERIC(14,4))
        FROM PRODUTOS_PRECO_COR c
        INNER JOIN (VALUES ${values.join(', ')}) AS v(C, V) ON c.COR_PRODUTO = v.C
        WHERE c.PRODUTO = @upProd AND c.CODIGO_TAB_PRECO = @upTab
      `);
    });
  } catch (erro) {
    erros.push(`Falha ao gravar: ${erro instanceof Error ? erro.message : String(erro)}`);
  } finally {
    await restaurarCadastro(produto, cadastro);
  }

  const depois = await lerLiquidos(produto, tabela, aAlterar);
  const historico: LinhaHist[] = [];
  let naoConfirmados = 0;
  for (const cor of aAlterar) {
    const d = depois.get(cor) ?? null;
    if (d !== null && !mudou(d, porCor.get(cor)!)) {
      historico.push({ cor, tabela, campo: 'PRECO_LIQUIDO1', anterior: antes.get(cor) ?? null, novo: d });
    } else {
      naoConfirmados += 1;
    }
  }

  const lote = historico.length > 0 ? params.lote || novoLoteCor() : '';
  if (lote) {
    await gravarHistorico(lote, params.company, params.usuario, produto, params.obs ?? 'Preço líquido por cor (aba Por cor)', historico);
  }

  return { lote, aplicados: historico.length, semMudanca, naoConfirmados, erros };
}

/* ─────────────────────────── tarefa programada (Programar Preços) ─────────────────────────── */
/* Chave, parser e executor da tarefa por cor (ver lib/precos/tarefas-executor.ts). */

/** Chave da alteração por cor numa tarefa: `COR::<tabela>::<cor>::PRECO_LIQUIDO1`. */
export function chaveCor(tabela: string, cor: string): string {
  return `COR::${limpar(tabela).toUpperCase()}::${limpar(cor)}::PRECO_LIQUIDO1`;
}

const COR_RE = /^[A-Za-z0-9._\- ]{1,10}$/;

export function parseChaveCor(chave: string): { tabela: string; cor: string } | null {
  const m = /^COR::([A-Z0-9]{1,2})::(.+)::PRECO_LIQUIDO1$/.exec(limpar(chave));
  if (!m || !COR_RE.test(m[2])) return null;
  return { tabela: m[1], cor: m[2] };
}

export interface ItemTarefaCor {
  produto: string;
  tabela: string;
  cor: string;
  valor: number;
}

export interface ExecutarTarefaCorResult {
  lote: string;
  aplicados: number;
  semMudanca: number;
  semRegistro: number;
  naoConfirmados: number;
  /** Produtos que a tarefa passou para o modo cor. */
  ligados: string[];
  erros: string[];
}

/**
 * Aplica uma tarefa por cor do Programar Preços: para cada produto, liga o modo cor se
 * ainda não estiver (copiando o preço de NA HORA da execução) e grava o Preço Líquido (1)
 * das cores. Tudo num lote só, com a observação da tarefa. Falha num produto não para os outros.
 */
export async function executarTarefaCor(params: {
  company: PrecoCompany;
  usuario: string;
  obs: string;
  itens: ItemTarefaCor[];
}): Promise<ExecutarTarefaCorResult> {
  const lote = novoLoteCor();
  const r: ExecutarTarefaCorResult = {
    lote: '', aplicados: 0, semMudanca: 0, semRegistro: 0, naoConfirmados: 0, ligados: [], erros: [],
  };

  const porProduto = new Map<string, ItemTarefaCor[]>();
  for (const it of params.itens) {
    const produto = limpar(it.produto);
    if (!produto) continue;
    const lista = porProduto.get(produto) ?? [];
    lista.push(it);
    porProduto.set(produto, lista);
  }

  let gravouAlgo = false;
  for (const [produto, itens] of porProduto) {
    try {
      const cad = await lerCadastro(produto);
      if (!cad) {
        r.semRegistro += itens.length;
        r.erros.push(`Produto ${produto} não encontrado.`);
        continue;
      }
      if (cad.varia !== 1) {
        await ligarModoCor({ produto, company: params.company, usuario: params.usuario, lote, obs: params.obs });
        r.ligados.push(produto);
        gravouAlgo = true;
      }
      const porTabela = new Map<string, AlteracaoLiquidoCor[]>();
      for (const it of itens) {
        const tab = limpar(it.tabela).toUpperCase();
        const lista = porTabela.get(tab) ?? [];
        lista.push({ cor: it.cor, valor: it.valor });
        porTabela.set(tab, lista);
      }
      for (const [tabela, alteracoes] of porTabela) {
        const res = await alterarLiquidoCor({
          produto, tabela, alteracoes, company: params.company, usuario: params.usuario, lote, obs: params.obs,
        });
        r.aplicados += res.aplicados;
        r.semMudanca += res.semMudanca;
        r.naoConfirmados += res.naoConfirmados;
        r.erros.push(...res.erros.map((e) => `${produto}: ${e}`));
        if (res.lote) gravouAlgo = true;
      }
    } catch (erro) {
      r.naoConfirmados += itens.length;
      r.erros.push(`${produto}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  r.lote = gravouAlgo ? lote : '';
  return r;
}
