import sql from "mssql";

import { getFiliaisByCompany, type FilialDef } from "@/lib/config/filial-registry";
import type { CompanyKey } from "@/lib/config/company";
import { withRequest } from "@/lib/db/connection";
import { ROW_COLECAO_COD_FIELD, ROW_COLECAO_DESC_FIELD } from "@/lib/reports/keys";
import type { ReportRow } from "@/lib/reports/types";
import { nameForId } from "@/lib/server/filial-resolver";

/**
 * Rótulo de coleção no formato "DESCRIÇÃO (CÓDIGO)" (ex.: "PERMANENTE (01)") por produto,
 * para o Gerador de Relatórios. Só faz sentido para SCARFME.
 *
 * Fonte da descrição: tabela MESTRE `COLECOES` (COLECAO = código, DESC_COLECAO = descrição),
 * NÃO o faturamento. Todo produto cadastrado tem coleção e toda coleção tem descrição na
 * COLECOES — então a descrição resolve para QUALQUER produto, inclusive os que nunca
 * venderam (caso dos Produtos Parados / recém-cadastrados). Join: COLECOES.COLECAO =
 * PRODUTOS.COLECAO (o COD_COLECAO não é usado). Validado: 314/314 códigos cobertos.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
// COLECOES é catálogo global (~329 linhas) — cabe inteiro num único mapa cacheado.
let descCache: { expires: number; map: Map<string, string> } | null = null;

export async function getColecaoDescMap(): Promise<Map<string, string>> {
  if (descCache && descCache.expires > Date.now()) return descCache.map;

  const map = await withRequest(async (req) => {
    const r = await req.query<{ cod: string; descricao: string | null }>(
      `SELECT
         UPPER(LTRIM(RTRIM(ISNULL(COLECAO, '')))) AS cod,
         MAX(LTRIM(RTRIM(ISNULL(DESC_COLECAO, '')))) AS descricao
       FROM COLECOES WITH (NOLOCK)
       WHERE ISNULL(COLECAO, '') <> ''
       GROUP BY UPPER(LTRIM(RTRIM(ISNULL(COLECAO, ''))))`
    );
    const m = new Map<string, string>();
    for (const row of r.recordset) {
      const cod = (row.cod ?? "").trim().toUpperCase();
      const desc = (row.descricao ?? "").trim();
      // Ignora descrição que é só o próprio código (não agrega leitura).
      if (cod) m.set(cod, desc && desc.toUpperCase() !== cod ? desc : "");
    }
    return m;
  }).catch(() => new Map<string, string>());

  descCache = { expires: Date.now() + CACHE_TTL_MS, map };
  return map;
}

/**
 * Data de INÍCIO de cada coleção = primeira entrada de estoque de um item dela na
 * MATRIZ (`ESTOQUE_PROD_ENT`/`ESTOQUE_PROD1_ENT`, `MIN(EMISSAO)`), que é quando a
 * coleção fisicamente chegou. Só a Matriz conta — entrada em loja é redistribuição
 * do que já existe, não o começo da coleção.
 *
 * Devolve um mapa CÓDIGO → "YYYY-MM-DD" (só os códigos que têm entrada na Matriz).
 */
export async function getColecaoInicioMatrizMap(
  codes: string[],
  company: CompanyKey = "scarfme"
): Promise<Map<string, string>> {
  const uniq = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, string>();
  if (uniq.length === 0) return out;

  // Nome vivo da(s) filial(is) MATRIZ da empresa (auto-corrige rename no ERP).
  const matrizDefs: FilialDef[] = getFiliaisByCompany(company).filter(
    (f) => f.display === "MATRIZ"
  );
  const matrizNames = (
    await Promise.all(matrizDefs.map(async (f) => (await nameForId(f.id)) ?? f.dbNameFallback))
  ).filter(Boolean);
  if (matrizNames.length === 0) return out;

  return withRequest(async (req) => {
    uniq.forEach((c, i) => req.input(`iniCol${i}`, sql.VarChar, c));
    matrizNames.forEach((n, i) => req.input(`iniMat${i}`, sql.VarChar, n));
    const colPh = uniq.map((_, i) => `@iniCol${i}`).join(", ");
    const matPh = matrizNames.map((_, i) => `@iniMat${i}`).join(", ");

    const r = await req.query<{ colecao: string; inicio: string | null }>(
      `SELECT
         UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) AS colecao,
         CONVERT(VARCHAR(10), MIN(e.EMISSAO), 120) AS inicio
       FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
       JOIN ESTOQUE_PROD1_ENT pe WITH (NOLOCK)
         ON pe.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO
       JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pe.PRODUTO
       WHERE UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${colPh})
         AND LTRIM(RTRIM(e.FILIAL)) IN (${matPh})
       GROUP BY UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, ''))))`
    );

    for (const row of r.recordset) {
      const cod = (row.colecao ?? "").trim().toUpperCase();
      const inicio = (row.inicio ?? "").trim();
      if (cod && inicio) out.set(cod, inicio);
    }
    return out;
  }).catch(() => out);
}

async function fetchColecaoCodeByProduto(produtos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(produtos.map((p) => p.trim()).filter(Boolean))];
  const BATCH = 1000;
  for (let i = 0; i < uniq.length; i += BATCH) {
    const batch = uniq.slice(i, i + BATCH);
    const rows = await withRequest(async (req) => {
      batch.forEach((p, idx) => req.input(`colProd${idx}`, sql.VarChar, p));
      const ph = batch.map((_, idx) => `@colProd${idx}`).join(", ");
      const r = await req.query<{ produto: string; colecao: string | null }>(
        `SELECT PRODUTO AS produto, ISNULL(COLECAO, '') AS colecao
         FROM PRODUTOS WITH (NOLOCK)
         WHERE PRODUTO IN (${ph})`
      );
      return r.recordset;
    });
    for (const r of rows) {
      out.set((r.produto ?? "").trim(), (r.colecao ?? "").trim().toUpperCase());
    }
  }
  return out;
}

/**
 * Preenche a coluna COLECAO de cada linha com "DESCRIÇÃO (CÓDIGO)". Só para SCARFME;
 * nas demais empresas não faz nada (mantém o que estiver na linha).
 */
export async function applyColecaoLabels(
  company: string | undefined,
  rows: ReportRow[]
): Promise<void> {
  if (company !== "scarfme" || rows.length === 0) return;

  const produtos = rows.map((r) => String(r.PRODUTO ?? "").trim()).filter(Boolean);
  const [descByCode, codeByProduto] = await Promise.all([
    getColecaoDescMap(),
    fetchColecaoCodeByProduto(produtos),
  ]);

  for (const r of rows) {
    const produto = String(r.PRODUTO ?? "").trim();
    const code = codeByProduto.get(produto) ?? "";
    const desc = code ? descByCode.get(code) ?? "" : "";
    // Tela: "DESC (COD)" numa coluna só (cai no próprio código se faltar descrição).
    r.COLECAO = code ? (desc ? `${desc} (${code})` : code) : "";
    // XLSX: descrição e código separados (ver exportRelatorioXlsx).
    r[ROW_COLECAO_DESC_FIELD] = desc;
    r[ROW_COLECAO_COD_FIELD] = code;
  }
}
