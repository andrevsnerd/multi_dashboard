/**
 * Preço por COR (tela Programar Preços, modo "preço por cor").
 *
 * No Linx quem decide de onde o PDV tira o preço é `PRODUTOS.VARIA_PRECO_COR`
 * (views W_LJ_PRECO_PRODUTO / W_LJ_PRECO_PRODUTO_BARRA):
 *   0 → PRODUTOS_PRECOS     (produto × tabela — todas as cores iguais)
 *   1 → PRODUTOS_PRECO_COR  (produto × tabela × cor; PRODUTOS_PRECOS é ignorada no PDV)
 *
 * Alterar uma cor de um produto que ainda é "por produto" exige CONVERTER o produto:
 *   1. espelhar PRODUTOS_PRECOS em PRODUTOS_PRECO_COR para TODAS as cores × TODAS as tabelas
 *      (com a flag ainda em 0 — os blocos de custo/filial dos gatilhos só agem com flag 1);
 *   2. ligar VARIA_PRECO_COR = 1 (LXU_PRODUTOS não reage a essa coluna);
 *   3. só então alterar a cor escolhida. LXU_PRODUTOS_PRECO_COR recalcula Preço Líquido,
 *      tabelas derivadas DAQUELA cor e o preço por loja (PRODUTOS_PRECO_FILIAL) daquela cor.
 *
 * Efeito colateral do Linx que neutralizamos: quando a tabela alterada é a TABELA_PRECO_COMPRA
 * (01) ou TABELA_PRECO_CUSTO (06) de um produto por cor, o gatilho ZERA o preço sugerido / custo
 * do produto (PRODUTOS.*_REPOSICAO*) e passa a guardá-los por cor. Os relatórios da dash leem o
 * cadastro do produto, então devolvemos esses 12 campos ao valor de antes da operação.
 *
 * Desfazer volta o preço da cor (o gatilho devolve lojas/derivadas) e, se o lote converteu o
 * produto, desliga VARIA_PRECO_COR — aí o PDV volta a ler PRODUTOS_PRECOS, que nunca mudou.
 * As linhas de PRODUTOS_PRECO_COR ficam (com a flag em 0 são ignoradas; apagar dispararia
 * cascatas sem ganho). Histórico em NERD_PRECO_COR_HISTORICO, separado do NERD_PRECO_HISTORICO
 * para o "Reverter" da tela Alterar Custo / Preço nunca tratar um lote por cor como por produto.
 */

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import type { RequestLike } from '@/lib/db/proxy';
import type { PrecoCompany } from '@/lib/repositories/precos';

const CHUNK = 300;
const TABELA_RE = /^[A-Z0-9]{1,2}$/;
const TABELA_HISTORICO = 'NERD_PRECO_COR_HISTORICO';
export const LIMITE_ITENS_COR = 3000;

/** Campos do cadastro que o gatilho zera em produto por cor — devolvidos ao valor anterior. */
const CAMPOS_CADASTRO = [
  'CUSTO_REPOSICAO1', 'CUSTO_REPOSICAO2', 'CUSTO_REPOSICAO3', 'CUSTO_REPOSICAO4',
  'PRECO_REPOSICAO_1', 'PRECO_REPOSICAO_2', 'PRECO_REPOSICAO_3', 'PRECO_REPOSICAO_4',
  'PRECO_A_VISTA_REPOSICAO_1', 'PRECO_A_VISTA_REPOSICAO_2', 'PRECO_A_VISTA_REPOSICAO_3', 'PRECO_A_VISTA_REPOSICAO_4',
] as const;

function limpar(value: unknown): string {
  return String(value ?? '').trim();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function valorParam(valor: number): string {
  return valor.toFixed(4);
}

function mudou(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b;
  return Math.abs(a - b) > 0.005;
}

function inLista(request: sql.Request | RequestLike, valores: string[], prefixo: string): string {
  valores.forEach((v, i) => request.input(`${prefixo}${i}`, sql.VarChar, v));
  return valores.map((_, i) => `@${prefixo}${i}`).join(', ');
}

/** Item da tela no modo cor: id = `PRODUTO|COR`. */
export function idItemCor(produto: string, cor: string): string {
  return `${limpar(produto)}|${limpar(cor)}`;
}

export function separarItemCor(id: string): { produto: string; cor: string } | null {
  const i = id.lastIndexOf('|');
  if (i <= 0 || i === id.length - 1) return null;
  return { produto: id.slice(0, i).trim(), cor: id.slice(i + 1).trim() };
}

// ───────────────────────── leitura (montar a tarefa) ─────────────────────────

export interface ItemCorRow {
  /** `PRODUTO|COR` — mesmo papel do `produto` no modo por produto. */
  produto: string;
  descricao: string;
  inativo: boolean;
  /** Já é preço por cor no Linx. Falso = aplicar converte o produto. */
  variaPorCor: boolean;
  v: Array<number | null>;
  sr: number[];
}

export interface PrecosCorResult {
  rows: ItemCorRow[];
  campos: Array<{ key: string; origem: 'PRODUTOS_PRECOS'; campo: string; codigoTabela: string }>;
  tabelas: Array<{ codigo: string; descricao: string; inativa: boolean; comRegistro: number; base: string | null }>;
  total: number;
  truncated: boolean;
  naoEncontrados: string[];
  /** Códigos de PRODUTO colados no modo cor: não dizem qual cor, ficam de fora. */
  semCor: string[];
}

/**
 * Entrada aceita: código de barras (identifica produto + cor) ou `PRODUTO|COR` (usado ao
 * reabrir uma tarefa salva). Código de produto puro não diz a cor e vai para `semCor`.
 */
async function resolverItensCor(entradas: string[]): Promise<{
  itens: Array<{ produto: string; cor: string }>;
  naoEncontrados: string[];
  semCor: string[];
}> {
  const limpos = [...new Set(entradas.map(limpar).filter(Boolean))];
  const porEntrada = new Map<string, { produto: string; cor: string }>();

  const explicitos = limpos.filter((e) => e.includes('|'));
  for (const e of explicitos) {
    const par = separarItemCor(e);
    if (par) porEntrada.set(e, par);
  }

  const barras = limpos.filter((e) => !e.includes('|'));
  for (const lote of chunk(barras, CHUNK)) {
    const rows = await withRequest(async (request) => {
      const ph = inLista(request, lote, 'rb');
      const r = await request.query<{ barra: string; produto: string; cor: string }>(`
        SELECT LTRIM(RTRIM(CAST(CODIGO_BARRA AS VARCHAR(50)))) AS barra,
               LTRIM(RTRIM(PRODUTO)) AS produto, LTRIM(RTRIM(COR_PRODUTO)) AS cor
        FROM PRODUTOS_BARRA WITH (NOLOCK)
        WHERE LTRIM(RTRIM(CAST(CODIGO_BARRA AS VARCHAR(50)))) IN (${ph})
      `);
      return r.recordset;
    });
    for (const row of rows) porEntrada.set(limpar(row.barra), { produto: limpar(row.produto), cor: limpar(row.cor) });
  }

  // O que não é código de barras pode ser código de produto: avisa que falta a cor.
  const restantes = barras.filter((e) => !porEntrada.has(e));
  const produtosPuros = new Set<string>();
  for (const lote of chunk(restantes, CHUNK)) {
    const rows = await withRequest(async (request) => {
      const ph = inLista(request, lote, 'rp');
      const r = await request.query<{ produto: string }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) AS produto FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO IN (${ph})
      `);
      return r.recordset;
    });
    for (const row of rows) produtosPuros.add(limpar(row.produto));
  }

  const itens: Array<{ produto: string; cor: string }> = [];
  const vistos = new Set<string>();
  const naoEncontrados: string[] = [];
  const semCor: string[] = [];
  for (const e of limpos) {
    const par = porEntrada.get(e);
    if (!par) {
      if (produtosPuros.has(e)) semCor.push(e);
      else naoEncontrados.push(e);
      continue;
    }
    const id = idItemCor(par.produto, par.cor);
    if (vistos.has(id)) continue;
    vistos.add(id);
    itens.push(par);
  }
  return { itens, naoEncontrados, semCor };
}

/**
 * Preço EFETIVO de cada produto×cor em cada tabela — o que o PDV vê: produto por cor lê
 * PRODUTOS_PRECO_COR; produto normal lê PRODUTOS_PRECOS (igual para todas as cores).
 */
export async function fetchPrecosCor(entradas: string[]): Promise<PrecosCorResult> {
  const { itens: todos, naoEncontrados, semCor } = await resolverItensCor(entradas);
  const truncated = todos.length > LIMITE_ITENS_COR;
  const itens = truncated ? todos.slice(0, LIMITE_ITENS_COR) : todos;
  const vazio: PrecosCorResult = { rows: [], campos: [], tabelas: [], total: todos.length, truncated, naoEncontrados, semCor };
  if (itens.length === 0) return vazio;

  const produtos = [...new Set(itens.map((i) => i.produto))];
  const infoProduto = new Map<string, { descricao: string; inativo: boolean; varia: boolean }>();
  const descCor = new Map<string, string>();
  /** `PRODUTO||TAB` → PRECO1/PRECO_LIQUIDO1 do produto. */
  const precoProduto = new Map<string, { p: number | null; l: number | null }>();
  /** `PRODUTO|COR||TAB` → PRECO1/PRECO_LIQUIDO1 da cor. */
  const precoCor = new Map<string, { p: number | null; l: number | null }>();
  const tabelasUsadas = new Map<string, Set<string>>();

  for (const lote of chunk(produtos, CHUNK)) {
    await withRequest(async (request) => {
      const ph = inLista(request, lote, 'fp');
      const p = await request.query<{ produto: string; descricao: string; inativo: number; varia: number }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) produto, LTRIM(RTRIM(ISNULL(DESC_PRODUTO,''))) descricao,
               CAST(ISNULL(INATIVO,0) AS INT) inativo, CAST(ISNULL(VARIA_PRECO_COR,0) AS INT) varia
        FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO IN (${ph})
      `);
      for (const r of p.recordset) {
        infoProduto.set(limpar(r.produto), { descricao: limpar(r.descricao), inativo: r.inativo === 1, varia: r.varia === 1 });
      }
      const c = await request.query<{ produto: string; cor: string; descricao: string }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) produto, LTRIM(RTRIM(COR_PRODUTO)) cor, LTRIM(RTRIM(ISNULL(DESC_COR_PRODUTO,''))) descricao
        FROM PRODUTO_CORES WITH (NOLOCK) WHERE PRODUTO IN (${ph})
      `);
      for (const r of c.recordset) descCor.set(idItemCor(r.produto, r.cor), limpar(r.descricao));
      const pp = await request.query<{ produto: string; tab: string; p1: unknown; l1: unknown }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) produto, LTRIM(RTRIM(CODIGO_TAB_PRECO)) tab, PRECO1 p1, PRECO_LIQUIDO1 l1
        FROM PRODUTOS_PRECOS WITH (NOLOCK) WHERE PRODUTO IN (${ph})
      `);
      for (const r of pp.recordset) {
        const tab = limpar(r.tab).toUpperCase();
        precoProduto.set(`${limpar(r.produto)}||${tab}`, { p: toNumber(r.p1), l: toNumber(r.l1) });
      }
      const pc = await request.query<{ produto: string; cor: string; tab: string; p1: unknown; l1: unknown }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) produto, LTRIM(RTRIM(COR_PRODUTO)) cor, LTRIM(RTRIM(CODIGO_TAB_PRECO)) tab,
               PRECO1 p1, PRECO_LIQUIDO1 l1
        FROM PRODUTOS_PRECO_COR WITH (NOLOCK) WHERE PRODUTO IN (${ph})
      `);
      for (const r of pc.recordset) {
        precoCor.set(`${idItemCor(r.produto, r.cor)}||${limpar(r.tab).toUpperCase()}`, { p: toNumber(r.p1), l: toNumber(r.l1) });
      }
    });
  }

  // Tabelas que algum item realmente tem (o produto precisa ter linha em PRODUTOS_PRECOS).
  for (const it of itens) {
    for (const chave of precoProduto.keys()) {
      const [prod, tab] = chave.split('||');
      if (prod !== it.produto) continue;
      const set = tabelasUsadas.get(tab) ?? new Set<string>();
      set.add(idItemCor(it.produto, it.cor));
      tabelasUsadas.set(tab, set);
    }
  }

  const meta = await withRequest(async (request) => {
    const r = await request.query<{ cod: string; nome: string; inativa: number; base: string }>(`
      SELECT LTRIM(RTRIM(CODIGO_TAB_PRECO)) cod, LTRIM(RTRIM(ISNULL(TABELA,''))) nome,
             CAST(ISNULL(INATIVO,0) AS INT) inativa, LTRIM(RTRIM(ISNULL(CODIGO_TAB_PRECO_BASE,''))) base
      FROM TABELAS_PRECO WITH (NOLOCK)
    `);
    return new Map(r.recordset.map((row) => [limpar(row.cod).toUpperCase(), row]));
  });

  const tabelas = [...tabelasUsadas.entries()]
    .filter(([cod]) => TABELA_RE.test(cod))
    .map(([cod, set]) => {
      const m = meta.get(cod);
      return {
        codigo: cod,
        descricao: limpar(m?.nome) || cod,
        inativa: Number(m?.inativa ?? 0) === 1,
        comRegistro: set.size,
        base: limpar(m?.base) || null,
      };
    })
    .sort((a, b) => (a.inativa === b.inativa ? b.comRegistro - a.comRegistro : a.inativa ? 1 : -1));

  const campos = tabelas.flatMap((t) => [
    { key: `T::${t.codigo}::PRECO1`, origem: 'PRODUTOS_PRECOS' as const, campo: 'PRECO1', codigoTabela: t.codigo },
    { key: `T::${t.codigo}::PRECO_LIQUIDO1`, origem: 'PRODUTOS_PRECOS' as const, campo: 'PRECO_LIQUIDO1', codigoTabela: t.codigo },
  ]);

  const rows: ItemCorRow[] = itens.map((it) => {
    const id = idItemCor(it.produto, it.cor);
    const info = infoProduto.get(it.produto);
    const v: Array<number | null> = [];
    const sr: number[] = [];
    campos.forEach((c, i) => {
      const doProduto = precoProduto.get(`${it.produto}||${c.codigoTabela}`);
      if (!doProduto) {
        v.push(null);
        sr.push(i);
        return;
      }
      // Produto por cor sem linha daquela cor: o PDV não acha preço. Mostra o do produto,
      // que é o que a conversão/escrita vai assumir como ponto de partida.
      const fonte = info?.varia ? precoCor.get(`${id}||${c.codigoTabela}`) ?? doProduto : doProduto;
      v.push(c.campo === 'PRECO1' ? fonte.p : fonte.l);
    });
    const corDesc = descCor.get(id);
    return {
      produto: id,
      descricao: `${info?.descricao ?? ''} · ${corDesc ? `${corDesc} (${it.cor})` : `cor ${it.cor}`}`,
      inativo: info?.inativo ?? false,
      variaPorCor: info?.varia ?? false,
      v,
      sr,
    };
  });

  return { rows, campos, tabelas, total: todos.length, truncated, naoEncontrados, semCor };
}

/** Produtos que já são "preço por cor" — no modo por produto a alteração não chega no PDV. */
export interface FlagsLoja {
  /** Já são preço por cor (modo por produto não chega ao PDV deles). */
  variaPorCor: string[];
  /**
   * Não vão para as lojas: o envio é a fila LJ_ETL_REPOSITORIO, e os gatilhos LX*_ETL_* só
   * enfileiram produto com ENVIA_LOJA_VAREJO = 1 e status LIBERADO (TIPO_STATUS_PRODUTO = 3).
   * Produto "EM DESENVOLVIMENTO" muda no Linx e a loja segue com o preço antigo — vale também
   * para alteração feita no próprio Linx. Foi o que travou o teste da capa 28.48.229.
   */
  naoVaoParaLoja: string[];
}

export async function fetchFlagsLoja(produtos: string[]): Promise<FlagsLoja> {
  const out: FlagsLoja = { variaPorCor: [], naoVaoParaLoja: [] };
  const limpos = [...new Set(produtos.map(limpar).filter(Boolean))];
  for (const lote of chunk(limpos, CHUNK)) {
    const rows = await withRequest(async (request) => {
      const ph = inLista(request, lote, 'vc');
      const r = await request.query<{ produto: string; varia: number; envia: number }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) produto,
               CAST(ISNULL(VARIA_PRECO_COR, 0) AS INT) varia,
               CASE WHEN ISNULL(ENVIA_LOJA_VAREJO, 0) = 1 AND ISNULL(TIPO_STATUS_PRODUTO, 0) = 3 THEN 1 ELSE 0 END envia
        FROM PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO IN (${ph})
      `);
      return r.recordset;
    });
    for (const r of rows) {
      if (r.varia === 1) out.variaPorCor.push(limpar(r.produto));
      if (r.envia !== 1) out.naoVaoParaLoja.push(limpar(r.produto));
    }
  }
  return out;
}

// ───────────────────────── histórico ─────────────────────────

let historicoGarantido = false;

export async function ensureHistoricoCorTable(): Promise<void> {
  if (historicoGarantido) return;
  await withRequest(async (request) => {
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
  });
  historicoGarantido = true;
}

interface LinhaHistCor {
  produto: string;
  cor: string | null;
  tabela: string | null;
  campo: string;
  anterior: number | null;
  novo: number | null;
}

async function gravarHistoricoCor(
  lote: string,
  company: PrecoCompany,
  usuario: string,
  obs: string | null,
  reverteLote: string | null,
  linhas: LinhaHistCor[]
): Promise<void> {
  if (linhas.length === 0) return;
  await ensureHistoricoCorTable();
  for (const parte of chunk(linhas, 100)) {
    await withRequest(async (request) => {
      request.input('hLote', sql.VarChar, lote);
      request.input('hEmpresa', sql.VarChar, company);
      request.input('hUsuario', sql.VarChar, usuario.slice(0, 100));
      request.input('hObs', sql.VarChar, obs ? obs.slice(0, 300) : null);
      request.input('hReverte', sql.VarChar, reverteLote);
      const values = parte.map((l, i) => {
        request.input(`hp${i}`, sql.VarChar, l.produto);
        request.input(`hc${i}`, sql.VarChar, l.cor);
        request.input(`ht${i}`, sql.VarChar, l.tabela);
        request.input(`hf${i}`, sql.VarChar, l.campo);
        request.input(`ha${i}`, sql.VarChar, l.anterior === null ? null : valorParam(l.anterior));
        request.input(`hn${i}`, sql.VarChar, l.novo === null ? null : valorParam(l.novo));
        return `(@hLote, @hEmpresa, @hUsuario, @hp${i}, @hc${i}, @ht${i}, @hf${i}, CAST(@ha${i} AS NUMERIC(14,4)), CAST(@hn${i} AS NUMERIC(14,4)), @hObs, @hReverte)`;
      });
      await request.query(`
        INSERT INTO ${TABELA_HISTORICO}
          (LOTE, EMPRESA, USUARIO, PRODUTO, COR_PRODUTO, COD_TABELA, CAMPO, VALOR_ANTERIOR, VALOR_NOVO, OBS, REVERTE_LOTE)
        VALUES ${values.join(', ')}
      `);
    });
  }
}

export interface HistoricoLoteCor {
  lote: string;
  data: string;
  usuario: string;
  empresa: string;
  alteracoes: number;
  produtos: number;
  campos: string[];
  obs: string | null;
  reverteLote: string | null;
  revertidoPor: string | null;
  porCor: true;
  convertidos: number;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return limpar(value);
}

export async function fetchHistoricoLotesCor(company: PrecoCompany, limite = 30): Promise<HistoricoLoteCor[]> {
  await ensureHistoricoCorTable();
  const top = Math.min(Math.max(limite, 1), 200);
  return withRequest(async (request) => {
    request.input('hcEmpresa', sql.VarChar, company);
    const r = await request.query<Record<string, unknown>>(`
      SELECT TOP ${top}
        h.LOTE AS lote, MIN(h.DATA_ALTERACAO) AS data, MAX(h.USUARIO) AS usuario, MAX(h.EMPRESA) AS empresa,
        SUM(CASE WHEN h.CAMPO = 'PRECO1' THEN 1 ELSE 0 END) AS alteracoes,
        -- Só linhas de preço: a linha de conversão (VARIA_PRECO_COR, sem cor) não é um item a mais.
        COUNT(DISTINCT CASE WHEN h.CAMPO = 'PRECO1' THEN h.PRODUTO + '|' + ISNULL(h.COR_PRODUTO, '') END) AS produtos,
        SUM(CASE WHEN h.CAMPO = 'VARIA_PRECO_COR' THEN 1 ELSE 0 END) AS convertidos,
        MAX(ISNULL(h.OBS, '')) AS obs, MAX(ISNULL(h.REVERTE_LOTE, '')) AS reverteLote,
        (SELECT TOP 1 e.LOTE FROM ${TABELA_HISTORICO} e WITH (NOLOCK) WHERE e.REVERTE_LOTE = h.LOTE) AS revertidoPor,
        STUFF((
          SELECT DISTINCT ', ' + LTRIM(RTRIM(d.COD_TABELA)) + '/' + LTRIM(RTRIM(d.CAMPO))
          FROM ${TABELA_HISTORICO} d WITH (NOLOCK)
          WHERE d.LOTE = h.LOTE AND d.COD_TABELA IS NOT NULL
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS campos
      FROM ${TABELA_HISTORICO} h WITH (NOLOCK)
      WHERE h.EMPRESA = @hcEmpresa
      GROUP BY h.LOTE
      ORDER BY MIN(h.DATA_ALTERACAO) DESC
    `);
    return r.recordset.map((row) => ({
      lote: limpar(row.lote),
      data: toIso(row.data),
      usuario: limpar(row.usuario),
      empresa: limpar(row.empresa),
      alteracoes: Number(row.alteracoes ?? 0),
      produtos: Number(row.produtos ?? 0),
      campos: limpar(row.campos).split(', ').map((c) => c.trim()).filter(Boolean),
      obs: limpar(row.obs) || null,
      reverteLote: limpar(row.reverteLote) || null,
      revertidoPor: limpar(row.revertidoPor) || null,
      porCor: true as const,
      convertidos: Number(row.convertidos ?? 0),
    }));
  });
}

async function fetchHistoricoLinhasCor(lote: string): Promise<Array<LinhaHistCor & { empresa: string }>> {
  await ensureHistoricoCorTable();
  return withRequest(async (request) => {
    request.input('hcLote', sql.VarChar, limpar(lote));
    const r = await request.query<Record<string, unknown>>(`
      SELECT EMPRESA, PRODUTO, COR_PRODUTO, COD_TABELA, CAMPO, VALOR_ANTERIOR, VALOR_NOVO
      FROM ${TABELA_HISTORICO} WITH (NOLOCK) WHERE LOTE = @hcLote ORDER BY ID
    `);
    return r.recordset.map((row) => ({
      empresa: limpar(row.EMPRESA),
      produto: limpar(row.PRODUTO),
      cor: limpar(row.COR_PRODUTO) || null,
      tabela: limpar(row.COD_TABELA) || null,
      campo: limpar(row.CAMPO),
      anterior: toNumber(row.VALOR_ANTERIOR),
      novo: toNumber(row.VALOR_NOVO),
    }));
  });
}

export interface LoteCorDetalheLinha {
  produto: string;
  cor: string;
  descricao: string;
  tabela: string;
  tabelaDesc: string;
  slot: number;
  precoAntes: number | null;
  precoDepois: number | null;
  liquidoAntes: number | null;
  liquidoDepois: number | null;
}

/** Linhas do lote no formato da tela (Preço e Líquido lado a lado) + produtos convertidos. */
export async function fetchLoteCorDetalhe(
  lote: string,
  company: PrecoCompany
): Promise<{ linhas: LoteCorDetalheLinha[]; convertidos: Array<{ produto: string; de: number | null; para: number | null }> }> {
  const linhas = (await fetchHistoricoLinhasCor(lote)).filter((l) => l.empresa === company);
  const produtos = [...new Set(linhas.map((l) => l.produto))];
  const desc = new Map<string, string>();
  const cores = new Map<string, string>();
  for (const parte of chunk(produtos, CHUNK)) {
    await withRequest(async (request) => {
      const ph = inLista(request, parte, 'dl');
      const p = await request.query<{ produto: string; d: string }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) produto, LTRIM(RTRIM(ISNULL(DESC_PRODUTO,''))) d FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO IN (${ph})
      `);
      for (const r of p.recordset) desc.set(limpar(r.produto), limpar(r.d));
      const c = await request.query<{ produto: string; cor: string; d: string }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) produto, LTRIM(RTRIM(COR_PRODUTO)) cor, LTRIM(RTRIM(ISNULL(DESC_COR_PRODUTO,''))) d
        FROM PRODUTO_CORES WITH (NOLOCK) WHERE PRODUTO IN (${ph})
      `);
      for (const r of c.recordset) cores.set(idItemCor(r.produto, r.cor), limpar(r.d));
    });
  }
  const tabelas = await withRequest(async (request) => {
    const r = await request.query<{ c: string; d: string }>(`
      SELECT LTRIM(RTRIM(CODIGO_TAB_PRECO)) c, LTRIM(RTRIM(ISNULL(TABELA,''))) d FROM TABELAS_PRECO WITH (NOLOCK)
    `);
    return new Map(r.recordset.map((row) => [limpar(row.c).toUpperCase(), limpar(row.d)]));
  });

  const porChave = new Map<string, LoteCorDetalheLinha>();
  const convertidos: Array<{ produto: string; de: number | null; para: number | null }> = [];
  for (const l of linhas) {
    if (l.campo === 'VARIA_PRECO_COR') {
      convertidos.push({ produto: l.produto, de: l.anterior, para: l.novo });
      continue;
    }
    const m = /^PRECO(_LIQUIDO)?(\d)$/.exec(l.campo);
    if (!m || !l.cor || !l.tabela) continue;
    const chave = `${l.produto}|${l.cor}||${l.tabela}||${m[2]}`;
    let alvo = porChave.get(chave);
    if (!alvo) {
      const corDesc = cores.get(idItemCor(l.produto, l.cor));
      alvo = {
        produto: l.produto,
        cor: l.cor,
        descricao: `${desc.get(l.produto) ?? ''} · ${corDesc ? `${corDesc} (${l.cor})` : `cor ${l.cor}`}`,
        tabela: l.tabela,
        tabelaDesc: tabelas.get(l.tabela.toUpperCase()) ?? l.tabela,
        slot: Number(m[2]),
        precoAntes: null,
        precoDepois: null,
        liquidoAntes: null,
        liquidoDepois: null,
      };
      porChave.set(chave, alvo);
    }
    if (m[1]) {
      alvo.liquidoAntes = l.anterior;
      alvo.liquidoDepois = l.novo;
    } else {
      alvo.precoAntes = l.anterior;
      alvo.precoDepois = l.novo;
    }
  }
  return {
    linhas: [...porChave.values()].sort((a, b) => a.produto.localeCompare(b.produto) || a.cor.localeCompare(b.cor) || a.tabela.localeCompare(b.tabela)),
    convertidos,
  };
}

// ───────────────────────── execução ─────────────────────────

export interface AlteracaoCorInput {
  produto: string;
  cor: string;
  tabela: string;
  /** null só no estorno (coluna que estava vazia). */
  valor: number | null;
}

export interface ExecutarCorParams {
  company: PrecoCompany;
  usuario: string;
  alteracoes: AlteracaoCorInput[];
  obs?: string | null;
  reverteLote?: string | null;
  /** Estorno: produtos que o lote original converteu — desliga VARIA_PRECO_COR no fim. */
  desconverter?: string[];
  permitirNulo?: boolean;
}

export interface ExecutarCorResult {
  lote: string;
  aplicados: number;
  semMudanca: number;
  semRegistro: number;
  naoConfirmados: number;
  convertidos: string[];
  desconvertidos: string[];
  erros: string[];
}

function novoLoteCor(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `PRCC${stamp}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

type Snapshot = Map<string, Record<string, number | null>>;

async function lerCadastro(produtos: string[]): Promise<{ varia: Map<string, boolean>; snap: Snapshot }> {
  const varia = new Map<string, boolean>();
  const snap: Snapshot = new Map();
  for (const parte of chunk(produtos, CHUNK)) {
    await withRequest(async (request) => {
      const ph = inLista(request, parte, 'lc');
      const r = await request.query<Record<string, unknown>>(`
        SELECT LTRIM(RTRIM(PRODUTO)) AS produto, CAST(ISNULL(VARIA_PRECO_COR,0) AS INT) AS varia,
               ${CAMPOS_CADASTRO.map((c) => `${c} AS [${c}]`).join(', ')}
        FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO IN (${ph})
      `);
      for (const row of r.recordset) {
        const p = limpar(row.produto);
        varia.set(p, Number(row.varia) === 1);
        snap.set(p, Object.fromEntries(CAMPOS_CADASTRO.map((c) => [c, toNumber(row[c])])));
      }
    });
  }
  return { varia, snap };
}

/**
 * Devolve preço sugerido/custo do produto ao snapshot quando o gatilho de cor mexeu neles
 * (ver cabeçalho). Só toca a coluna que mudou.
 */
async function restaurarCadastro(snap: Snapshot): Promise<void> {
  const produtos = [...snap.keys()];
  const { snap: agora } = await lerCadastro(produtos);
  for (const produto of produtos) {
    const antes = snap.get(produto)!;
    const depois = agora.get(produto);
    if (!depois) continue;
    const mudaram = CAMPOS_CADASTRO.filter((c) => mudou(depois[c], antes[c]));
    if (mudaram.length === 0) continue;
    await withRequest(async (request) => {
      request.input('rcProd', sql.VarChar, produto);
      const sets = mudaram.map((c, i) => {
        const v = antes[c];
        request.input(`rc${i}`, sql.VarChar, v === null ? null : valorParam(v));
        return `${c} = CAST(@rc${i} AS NUMERIC(14,4))`;
      });
      await request.query(`UPDATE PRODUTOS SET ${sets.join(', ')} WHERE PRODUTO = @rcProd`);
    });
  }
}

/**
 * Converte o produto para preço por cor: espelha PRODUTOS_PRECOS em PRODUTOS_PRECO_COR para
 * todas as cores (atualiza linhas velhas que sobraram de outra época, insere as que faltam),
 * confere que o espelho fechou e só então liga VARIA_PRECO_COR. Com a flag ainda em 0 os
 * gatilhos não mexem em custo, sugerido nem preço de loja.
 */
async function converterProduto(produto: string): Promise<void> {
  await withRequest(async (request) => {
    request.input('cvProd', sql.VarChar, produto);
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
    // Conferência: toda cor × toda tabela do produto tem linha e com o mesmo PRECO1.
    const r = await request.query<{ faltando: number; diferentes: number }>(`
      SELECT
        SUM(CASE WHEN x.PRODUTO IS NULL THEN 1 ELSE 0 END) AS faltando,
        SUM(CASE WHEN x.PRODUTO IS NOT NULL AND ABS(ISNULL(x.PRECO1,0) - ISNULL(pp.PRECO1,0)) > 0.005 THEN 1 ELSE 0 END) AS diferentes
      FROM PRODUTOS_PRECOS pp
      INNER JOIN PRODUTO_CORES pc ON pc.PRODUTO = pp.PRODUTO
      LEFT JOIN PRODUTOS_PRECO_COR x
        ON x.PRODUTO = pp.PRODUTO AND x.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO AND x.COR_PRODUTO = pc.COR_PRODUTO
      WHERE pp.PRODUTO = @cvProd
    `);
    const { faltando, diferentes } = r.recordset[0] ?? { faltando: 0, diferentes: 0 };
    if (Number(faltando) > 0 || Number(diferentes) > 0) {
      throw new Error(
        `Conversão de ${produto} não fechou (${faltando} linha(s) de cor faltando, ${diferentes} com preço diferente). Nada foi ligado.`
      );
    }
    await request.query(`UPDATE PRODUTOS SET VARIA_PRECO_COR = 1 WHERE PRODUTO = @cvProd AND ISNULL(VARIA_PRECO_COR, 0) = 0`);
  });
}

async function lerPrecosCor(
  itens: Array<{ produto: string; cor: string }>,
  tabela: string
): Promise<Map<string, { p: number | null; l: number | null }>> {
  const out = new Map<string, { p: number | null; l: number | null }>();
  for (const parte of chunk(itens, CHUNK)) {
    await withRequest(async (request) => {
      request.input('lpTab', sql.VarChar, tabela);
      const values = parte.map((it, i) => {
        request.input(`lp${i}`, sql.VarChar, it.produto);
        request.input(`lc${i}`, sql.VarChar, it.cor);
        return `(@lp${i}, @lc${i})`;
      });
      const r = await request.query<{ produto: string; cor: string; p1: unknown; l1: unknown }>(`
        SELECT LTRIM(RTRIM(c.PRODUTO)) produto, LTRIM(RTRIM(c.COR_PRODUTO)) cor, c.PRECO1 p1, c.PRECO_LIQUIDO1 l1
        FROM PRODUTOS_PRECO_COR c WITH (NOLOCK)
        INNER JOIN (VALUES ${values.join(', ')}) AS v(P, C) ON c.PRODUTO = v.P AND c.COR_PRODUTO = v.C
        WHERE c.CODIGO_TAB_PRECO = @lpTab
      `);
      for (const row of r.recordset) out.set(idItemCor(row.produto, row.cor), { p: toNumber(row.p1), l: toNumber(row.l1) });
    });
  }
  return out;
}

/**
 * Aplica preços por cor (convertendo produtos quando preciso). Ordem: converter → alterar →
 * reler para confirmar → devolver cadastro → (estorno) desligar flag → histórico.
 */
export async function executarAlteracaoPrecosCor(params: ExecutarCorParams): Promise<ExecutarCorResult> {
  const erros: string[] = [];
  const itens: AlteracaoCorInput[] = [];
  const vistos = new Set<string>();
  for (const a of params.alteracoes) {
    const produto = limpar(a.produto);
    const cor = limpar(a.cor);
    const tabela = limpar(a.tabela).toUpperCase();
    if (!produto || !cor || !TABELA_RE.test(tabela)) {
      erros.push(`Alteração inválida ignorada (${produto || '?'} / ${cor || '?'} / ${tabela || '?'}).`);
      continue;
    }
    if (a.valor === null || a.valor === undefined) {
      if (!params.permitirNulo) {
        erros.push(`Valor vazio para ${produto} cor ${cor} na tabela ${tabela}.`);
        continue;
      }
    } else if (!Number.isFinite(Number(a.valor)) || Number(a.valor) < 0) {
      erros.push(`Valor inválido para ${produto} cor ${cor} na tabela ${tabela}.`);
      continue;
    }
    const chave = `${idItemCor(produto, cor)}||${tabela}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push({ produto, cor, tabela, valor: a.valor === null ? null : Math.round(Number(a.valor) * 100) / 100 });
  }

  const vazio: ExecutarCorResult = {
    lote: '', aplicados: 0, semMudanca: 0, semRegistro: 0, naoConfirmados: 0, convertidos: [], desconvertidos: [], erros,
  };
  if (itens.length === 0 && (params.desconverter ?? []).length === 0) return vazio;

  const produtos = [...new Set([...itens.map((i) => i.produto), ...(params.desconverter ?? [])])];
  const { varia, snap } = await lerCadastro(produtos);

  // Existência: produto × tabela em PRODUTOS_PRECOS e a cor no cadastro do produto.
  const validos = new Set<string>();
  for (const parte of chunk(itens, CHUNK)) {
    await withRequest(async (request) => {
      const values = parte.map((it, i) => {
        request.input(`ep${i}`, sql.VarChar, it.produto);
        request.input(`ec${i}`, sql.VarChar, it.cor);
        request.input(`et${i}`, sql.VarChar, it.tabela);
        return `(@ep${i}, @ec${i}, @et${i})`;
      });
      const r = await request.query<{ produto: string; cor: string; tab: string }>(`
        SELECT LTRIM(RTRIM(v.P)) produto, LTRIM(RTRIM(v.C)) cor, LTRIM(RTRIM(v.T)) tab
        FROM (VALUES ${values.join(', ')}) AS v(P, C, T)
        WHERE EXISTS (SELECT 1 FROM PRODUTOS_PRECOS pp WITH (NOLOCK) WHERE pp.PRODUTO = v.P AND pp.CODIGO_TAB_PRECO = v.T)
          AND EXISTS (SELECT 1 FROM PRODUTO_CORES pc WITH (NOLOCK) WHERE pc.PRODUTO = v.P AND pc.COR_PRODUTO = v.C)
      `);
      for (const row of r.recordset) validos.add(`${idItemCor(row.produto, row.cor)}||${limpar(row.tab).toUpperCase()}`);
    });
  }
  let semRegistro = 0;
  const aplicaveis = itens.filter((it) => {
    const ok = validos.has(`${idItemCor(it.produto, it.cor)}||${it.tabela}`);
    if (!ok) semRegistro += 1;
    return ok;
  });

  const lote = novoLoteCor();
  const historico: LinhaHistCor[] = [];
  const convertidos: string[] = [];

  // 1. Conversão — produto a produto, para uma falha não arrastar os outros.
  const naoConvertidos = new Set<string>();
  if (!params.reverteLote) {
    for (const produto of [...new Set(aplicaveis.map((i) => i.produto))]) {
      if (varia.get(produto)) continue;
      try {
        await converterProduto(produto);
        convertidos.push(produto);
        historico.push({ produto, cor: null, tabela: null, campo: 'VARIA_PRECO_COR', anterior: 0, novo: 1 });
      } catch (erro) {
        naoConvertidos.add(produto);
        erros.push(erro instanceof Error ? erro.message : String(erro));
      }
    }
  }

  // 2. Alteração por tabela: ler → alterar → reler.
  let aplicados = 0;
  let semMudanca = 0;
  let naoConfirmados = 0;
  const porTabela = new Map<string, AlteracaoCorInput[]>();
  for (const it of aplicaveis) {
    if (naoConvertidos.has(it.produto)) {
      naoConfirmados += 1;
      continue;
    }
    const lista = porTabela.get(it.tabela) ?? [];
    lista.push(it);
    porTabela.set(it.tabela, lista);
  }

  try {
    for (const [tabela, lista] of porTabela) {
      const antes = await lerPrecosCor(lista, tabela);
      const aAlterar = lista.filter((it) => {
        const atual = antes.get(idItemCor(it.produto, it.cor));
        if (!atual) {
          semRegistro += 1;
          return false;
        }
        if (!mudou(atual.p, it.valor)) {
          semMudanca += 1;
          return false;
        }
        return true;
      });
      if (aAlterar.length === 0) continue;

      try {
        for (const parte of chunk(aAlterar, CHUNK)) {
          await withRequest(async (request) => {
            request.input('upTab', sql.VarChar, tabela);
            const values = parte.map((it, i) => {
              request.input(`up${i}`, sql.VarChar, it.produto);
              request.input(`uc${i}`, sql.VarChar, it.cor);
              request.input(`uv${i}`, sql.VarChar, it.valor === null ? null : valorParam(it.valor));
              return `(@up${i}, @uc${i}, @uv${i})`;
            });
            // PRECO_LIQUIDO1 junto, como no modo por produto; o gatilho ainda o recalcula
            // pelo PROMOCAO_DESCONTO da linha.
            await request.query(`
              UPDATE c SET c.PRECO1 = CAST(v.V AS NUMERIC(14,4)), c.PRECO_LIQUIDO1 = CAST(v.V AS NUMERIC(14,4))
              FROM PRODUTOS_PRECO_COR c
              INNER JOIN (VALUES ${values.join(', ')}) AS v(P, C, V) ON c.PRODUTO = v.P AND c.COR_PRODUTO = v.C
              WHERE c.CODIGO_TAB_PRECO = @upTab
            `);
          });
        }
        const depois = await lerPrecosCor(aAlterar, tabela);
        for (const it of aAlterar) {
          const id = idItemCor(it.produto, it.cor);
          const d = depois.get(id);
          if (d && !mudou(d.p, it.valor)) {
            aplicados += 1;
            const a = antes.get(id)!;
            historico.push({ produto: it.produto, cor: it.cor, tabela, campo: 'PRECO1', anterior: a.p, novo: d.p });
            historico.push({ produto: it.produto, cor: it.cor, tabela, campo: 'PRECO_LIQUIDO1', anterior: a.l, novo: d.l });
          } else {
            naoConfirmados += 1;
          }
        }
      } catch (erro) {
        naoConfirmados += aAlterar.length;
        erros.push(`Falha ao alterar a tabela ${tabela}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  } finally {
    // 3. Preço sugerido/custo do produto de volta ao que era (o gatilho de cor os zera).
    try {
      await restaurarCadastro(snap);
    } catch (erro) {
      erros.push(`Preços alterados, mas falhou ao devolver o preço sugerido/custo do cadastro: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  // 4. Estorno de conversão: só depois do preço da cor voltar (o gatilho devolve as lojas).
  const desconvertidos: string[] = [];
  for (const produto of params.desconverter ?? []) {
    if (!varia.get(produto)) continue;
    await withRequest(async (request) => {
      request.input('dcProd', sql.VarChar, produto);
      await request.query(`UPDATE PRODUTOS SET VARIA_PRECO_COR = 0 WHERE PRODUTO = @dcProd`);
    });
    desconvertidos.push(produto);
    historico.push({ produto, cor: null, tabela: null, campo: 'VARIA_PRECO_COR', anterior: 1, novo: 0 });
  }

  await gravarHistoricoCor(lote, params.company, params.usuario, params.obs ?? null, params.reverteLote ?? null, historico);

  return {
    lote: historico.length > 0 ? lote : '',
    aplicados,
    semMudanca,
    semRegistro,
    naoConfirmados,
    convertidos,
    desconvertidos,
    erros,
  };
}

/** Desfaz um lote por cor (novo lote marcado com REVERTE_LOTE, nada é apagado). */
export async function reverterLotePrecosCor(
  lote: string,
  company: PrecoCompany,
  usuario: string
): Promise<ExecutarCorResult> {
  const linhas = await fetchHistoricoLinhasCor(lote);
  if (linhas.length === 0) throw new Error('Lote não encontrado no histórico de preço por cor.');
  if (linhas.some((l) => l.empresa !== company)) throw new Error('Este lote pertence a outra empresa.');

  const jaRevertido = await withRequest(async (request) => {
    request.input('rvLote', sql.VarChar, limpar(lote));
    const r = await request.query<{ lote: string }>(`
      SELECT TOP 1 LOTE AS lote FROM ${TABELA_HISTORICO} WITH (NOLOCK) WHERE REVERTE_LOTE = @rvLote
    `);
    return r.recordset[0]?.lote ?? null;
  });
  if (jaRevertido) throw new Error(`Este lote já foi desfeito pelo lote ${limpar(jaRevertido)}.`);

  const alteracoes: AlteracaoCorInput[] = linhas
    .filter((l) => l.campo === 'PRECO1' && l.cor && l.tabela)
    .map((l) => ({ produto: l.produto, cor: l.cor!, tabela: l.tabela!, valor: l.anterior }));
  const desconverter = linhas.filter((l) => l.campo === 'VARIA_PRECO_COR' && l.anterior === 0 && l.novo === 1).map((l) => l.produto);

  return executarAlteracaoPrecosCor({
    company,
    usuario,
    alteracoes,
    desconverter,
    permitirNulo: true,
    obs: `Estorno do lote ${limpar(lote)}`,
    reverteLote: limpar(lote),
  });
}
