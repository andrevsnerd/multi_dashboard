import 'server-only';

/**
 * Painel Black Friday — o que ENTROU na Black e como está o preço/estoque de cada item.
 *
 * Fonte da verdade de "quem está na Black" = histórico de preço (NERD_PRECO_HISTORICO),
 * o mesmo da tela Programar Preços: lotes cuja OBS fala em "Black Friday" (as tarefas
 * "Tarefa: Black Friday …" e as rebaixas feitas por este painel), sem estornos.
 *
 *  - Item da Black   = produto com pelo menos UMA linha PRECO1 ainda em vigor
 *                      (REVERTIDO_POR IS NULL) num lote da Black. Produto revertido
 *                      (lote inteiro ou só ele) sai sozinho.
 *  - Preço original  = VALOR_ANTERIOR da 1ª linha da Black do produto (antes de tudo).
 *  - Preço atual     = PRODUTOS_PRECOS.PRECO1 AO VIVO (vale o que o PDV lê hoje).
 *  - Custo (piso)    = PRODUTOS.CUSTO_REPOSICAO1 — limite do quanto o preço pode descer.
 *
 * Nada de VENDA aqui: a venda sai da função canônica `fetchFilialProdutoSales` na rota.
 * Estoque é lido de ESTOQUE_PRODUTOS (número do Linx), só os positivos.
 */

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import type { PrecoCompany } from '@/lib/repositories/precos';

/** OBS que marca os lotes da Black (tarefas do Programar Preços e rebaixas do painel). */
const OBS_BLACK = '%Black Friday%';
/** Prefixo da OBS das rebaixas gravadas por este painel (cai no filtro acima). */
export const OBS_REBAIXA_PAINEL = 'Black Friday · rebaixa pelo painel';

const CHUNK = 900;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function limpar(value: unknown): string {
  return String(value ?? '').trim();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * DATA_ALTERACAO é hora de Brasília gravada como se fosse UTC (GETDATE() no servidor);
 * por isso o ISO "cru" já é o relógio de Brasília — não converter fuso.
 */
function isoBrasilia(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 19);
  return limpar(value).replace(' ', 'T').slice(0, 19);
}

export interface BlackRebaixa {
  /** yyyy-MM-ddTHH:mm:ss, relógio de Brasília. */
  data: string;
  lote: string;
  de: number | null;
  para: number | null;
  usuario: string;
  /** true = rebaixa feita por este painel; false = tarefa da Black. */
  painel: boolean;
}

export interface BlackItem {
  produto: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  colecao: string;
  grade: string;
  tipo: string;
  /** Cores do cadastro do produto (PRODUTO_CORES): código → descrição. */
  coresCadastro: Array<{ cor: string; desc: string }>;
  /** Tabelas de preço que a Black mexeu (hoje sempre '01'). */
  tabelas: string[];
  precoOriginal: number | null;
  precoAtual: number | null;
  custo: number;
  /** yyyy-MM-dd (Brasília) da 1ª vez que o produto entrou na Black. */
  entrada: string;
  rebaixas: BlackRebaixa[];
}

export interface BlackItensResult {
  /** yyyy-MM-dd do 1º lote da Black da empresa (início da campanha). */
  inicio: string | null;
  itens: BlackItem[];
}

interface HistRow {
  ID: number;
  LOTE: string;
  DATA_ALTERACAO: Date | string;
  USUARIO: string;
  PRODUTO: string;
  COD_TABELA: string | null;
  VALOR_ANTERIOR: number | null;
  VALOR_NOVO: number | null;
  OBS: string | null;
  REVERTIDO_POR: string | null;
}

/** Itens que estão na Black hoje, com preço original/atual, custo e trilha de rebaixas. */
export async function fetchItensBlackFriday(company: PrecoCompany): Promise<BlackItensResult> {
  const hist = await withRequest(async (request) => {
    request.input('bfEmpresa', sql.VarChar, company);
    request.input('bfObs', sql.VarChar, OBS_BLACK);
    const r = await request.query<HistRow>(`
      SELECT h.ID, h.LOTE, h.DATA_ALTERACAO, h.USUARIO, h.PRODUTO, h.COD_TABELA,
             h.VALOR_ANTERIOR, h.VALOR_NOVO, h.OBS, h.REVERTIDO_POR
      FROM NERD_PRECO_HISTORICO h WITH (NOLOCK)
      WHERE h.EMPRESA = @bfEmpresa
        AND h.ORIGEM = 'PRODUTOS_PRECOS'
        AND h.CAMPO = 'PRECO1'
        AND h.REVERTE_LOTE IS NULL
        AND (h.OBS LIKE @bfObs OR h.PRODUTO IN ('13.B1.0093', '13.B1.0094', '13.B1.0095'))
      ORDER BY h.ID
    `);
    return r.recordset;
  });

  if (hist.length === 0) return { inicio: null, itens: [] };

  // Início da campanha = 1º lote da Black, mesmo que depois tenha sido estornado e
  // reaplicado (a Scarfme foi refeita em 04/11, mas está na Black desde 01/11).
  let inicio: string | null = null;

  const porProduto = new Map<
    string,
    { tabelas: Set<string>; original: number | null; entrada: string; ativas: HistRow[] }
  >();
  for (const row of hist) {
    const produto = limpar(row.PRODUTO);
    if (!produto) continue;
    const data = isoBrasilia(row.DATA_ALTERACAO);
    if (!inicio || data < inicio) inicio = data;

    let item = porProduto.get(produto);
    if (!item) {
      // 1ª linha da Black do produto (ORDER BY ID): o VALOR_ANTERIOR é o preço de antes.
      item = { tabelas: new Set(), original: num(row.VALOR_ANTERIOR), entrada: data.slice(0, 10), ativas: [] };
      porProduto.set(produto, item);
    }
    if (!row.REVERTIDO_POR) {
      item.ativas.push(row);
      const tab = limpar(row.COD_TABELA);
      if (tab) item.tabelas.add(tab);
    }
  }

  // Só fica quem ainda tem alteração da Black em vigor.
  const produtos = [...porProduto.entries()].filter(([, v]) => v.ativas.length > 0).map(([p]) => p);
  if (produtos.length === 0) return { inicio: inicio?.slice(0, 10) ?? null, itens: [] };

  const cadastro = new Map<string, Record<string, unknown>>();
  const precos = new Map<string, number | null>();
  const cores = new Map<string, Array<{ cor: string; desc: string }>>();
  for (const parte of chunk(produtos, CHUNK)) {
    await withRequest(async (request) => {
      parte.forEach((p, i) => request.input(`bp${i}`, sql.VarChar, p));
      const ph = parte.map((_, i) => `@bp${i}`).join(', ');
      const r = await request.query<Record<string, unknown>>(`
        SELECT p.PRODUTO, p.DESC_PRODUTO, p.GRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, p.LINHA,
               CONVERT(VARCHAR(40), p.GRADE) AS GRADE, p.TIPO_PRODUTO,
               ISNULL(c.DESC_COLECAO, p.COLECAO) AS COLECAO,
               ISNULL(p.CUSTO_REPOSICAO1, 0) AS CUSTO
        FROM PRODUTOS p WITH (NOLOCK)
        LEFT JOIN COLECOES c WITH (NOLOCK) ON c.COLECAO = p.COLECAO
        WHERE p.PRODUTO IN (${ph})
      `);
      for (const row of r.recordset) cadastro.set(limpar(row.PRODUTO), row);

      const rp = await request.query<Record<string, unknown>>(`
        SELECT pp.PRODUTO, pp.CODIGO_TAB_PRECO, pp.PRECO1
        FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
        WHERE pp.PRODUTO IN (${ph})
      `);
      for (const row of rp.recordset) {
        precos.set(`${limpar(row.PRODUTO)}||${limpar(row.CODIGO_TAB_PRECO)}`, num(row.PRECO1));
      }

      // Descrição da cor vem do cadastro DO PRODUTO (código de cor não é global).
      const rc = await request.query<Record<string, unknown>>(`
        SELECT pc.PRODUTO, LTRIM(RTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) AS COR,
               MAX(pc.DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES pc WITH (NOLOCK)
        WHERE pc.PRODUTO IN (${ph})
        GROUP BY pc.PRODUTO, LTRIM(RTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20))))
      `);
      for (const row of rc.recordset) {
        const prod = limpar(row.PRODUTO);
        const lista = cores.get(prod) ?? [];
        lista.push({ cor: limpar(row.COR), desc: limpar(row.DESC_COR).replace(/\s+/g, ' ') });
        cores.set(prod, lista);
      }
    });
  }

  const itens: BlackItem[] = produtos.map((produto) => {
    const info = porProduto.get(produto)!;
    const cad = cadastro.get(produto) ?? {};
    const tabelas = [...info.tabelas].sort();
    // Preço atual = o da 1ª tabela da Black (hoje só existe a 01).
    const precoAtual = tabelas.length > 0 ? precos.get(`${produto}||${tabelas[0]}`) ?? null : null;
    const rebaixas: BlackRebaixa[] = info.ativas
      .filter((r) => limpar(r.COD_TABELA) === tabelas[0])
      .map((r) => ({
        data: isoBrasilia(r.DATA_ALTERACAO),
        lote: limpar(r.LOTE),
        de: num(r.VALOR_ANTERIOR),
        para: num(r.VALOR_NOVO),
        usuario: limpar(r.USUARIO),
        painel: limpar(r.OBS).startsWith(OBS_REBAIXA_PAINEL),
      }));
    return {
      produto,
      descricao: limpar(cad.DESC_PRODUTO).replace(/\s+/g, ' ') || produto,
      grupo: limpar(cad.GRUPO_PRODUTO),
      subgrupo: limpar(cad.SUBGRUPO_PRODUTO),
      linha: limpar(cad.LINHA),
      colecao: limpar(cad.COLECAO),
      grade: limpar(cad.GRADE),
      tipo: limpar(cad.TIPO_PRODUTO),
      coresCadastro: cores.get(produto) ?? [],
      tabelas,
      precoOriginal: info.original,
      precoAtual,
      custo: num(cad.CUSTO) ?? 0,
      entrada: info.entrada,
      rebaixas,
    };
  });

  return { inicio: inicio?.slice(0, 10) ?? null, itens };
}

export interface EstoqueProdutoFilialRow {
  produto: string;
  /** COR_PRODUTO como está no estoque (aparado). */
  cor: string;
  /** Nome cru da filial no Linx (aparado). */
  filial: string;
  estoque: number;
}

/**
 * Estoque do Linx (ESTOQUE_PRODUTOS.ESTOQUE) por produto × cor × filial, somando só os saldos
 * POSITIVOS de cada linha — negativo nunca entra em soma de estoque. O recorte de
 * filiais (perna ativa) é feito pela rota.
 */
export async function fetchEstoqueProdutosPorFilial(produtos: string[]): Promise<EstoqueProdutoFilialRow[]> {
  const lista = [...new Set(produtos.map(limpar).filter(Boolean))];
  const out: EstoqueProdutoFilialRow[] = [];
  for (const parte of chunk(lista, CHUNK)) {
    await withRequest(async (request) => {
      parte.forEach((p, i) => request.input(`ep${i}`, sql.VarChar, p));
      const ph = parte.map((_, i) => `@ep${i}`).join(', ');
      const r = await request.query<{ PRODUTO: string; COR: string; FILIAL: string; ESTOQUE: number }>(`
        SELECT e.PRODUTO, LTRIM(RTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) AS COR, LTRIM(RTRIM(e.FILIAL)) AS FILIAL,
               CAST(SUM(CASE WHEN ISNULL(e.ESTOQUE, 0) > 0 THEN e.ESTOQUE ELSE 0 END) AS FLOAT) AS ESTOQUE
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.PRODUTO IN (${ph})
        GROUP BY e.PRODUTO, LTRIM(RTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))), LTRIM(RTRIM(e.FILIAL))
        HAVING SUM(CASE WHEN ISNULL(e.ESTOQUE, 0) > 0 THEN e.ESTOQUE ELSE 0 END) > 0
      `);
      for (const row of r.recordset) {
        out.push({
          produto: limpar(row.PRODUTO),
          cor: limpar(row.COR),
          filial: limpar(row.FILIAL),
          estoque: Number(row.ESTOQUE ?? 0),
        });
      }
    });
  }
  return out;
}

/**
 * Chave de cor tolerante: '06' e '6' são a mesma cor (fontes diferentes devolvem formatos
 * diferentes); código não numérico só é aparado/maiúsculo.
 */
export function chaveCor(cor: string | null | undefined): string {
  const c = String(cor ?? '').trim().toUpperCase();
  return /^\d+$/.test(c) ? String(Number(c)) : c;
}
