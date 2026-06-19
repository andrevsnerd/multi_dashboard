import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import { fetchAvailableColecoesWithDescriptions } from "@/lib/repositories/products";
import { ROW_COLECAO_COD_FIELD, ROW_COLECAO_DESC_FIELD } from "@/lib/reports/keys";
import type { ReportRow } from "@/lib/reports/types";

/** Extrai a descrição de um rótulo "DESC (COD)"; "" quando o rótulo é só o código. */
function descFromLabel(label: string, code: string): string {
  const suffix = ` (${code})`;
  if (label === code) return "";
  if (label.endsWith(suffix)) return label.slice(0, label.length - suffix.length).trim();
  return label;
}

/**
 * Rótulo de coleção no formato "DESCRIÇÃO (CÓDIGO)" (ex.: "TARSILA (U7)") por produto,
 * para o Gerador de Relatórios. Só faz sentido para SCARFME.
 *
 * Reusa `fetchAvailableColecoesWithDescriptions` (mesma formatação de rótulo já usada no
 * filtro de coleção) para o mapa código→rótulo (cacheado), e mapeia produto→código via
 * PRODUTOS. Coleções sem descrição conhecida caem no próprio código.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const labelMapCache = new Map<string, { expires: number; map: Map<string, string> }>();

async function getColecaoLabelMap(company: string): Promise<Map<string, string>> {
  const cached = labelMapCache.get(company);
  if (cached && cached.expires > Date.now()) return cached.map;

  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - 24); // janela ampla p/ cobrir coleções ativas
  const options = await fetchAvailableColecoesWithDescriptions({
    company,
    range: { start, end: now },
    filial: null,
  }).catch(() => []);

  const map = new Map<string, string>();
  for (const o of options) {
    const code = (o.value ?? "").trim().toUpperCase();
    if (code) map.set(code, o.label ?? code);
  }
  labelMapCache.set(company, { expires: Date.now() + CACHE_TTL_MS, map });
  return map;
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
  const [labelMap, codeByProduto] = await Promise.all([
    getColecaoLabelMap(company),
    fetchColecaoCodeByProduto(produtos),
  ]);

  for (const r of rows) {
    const produto = String(r.PRODUTO ?? "").trim();
    const code = codeByProduto.get(produto) ?? "";
    const label = code ? labelMap.get(code) ?? code : "";
    r.COLECAO = label; // tela: "DESC (COD)" numa coluna só
    // XLSX: descrição e código separados (ver exportRelatorioXlsx).
    r[ROW_COLECAO_DESC_FIELD] = code ? descFromLabel(label, code) : "";
    r[ROW_COLECAO_COD_FIELD] = code;
  }
}
