import sql from "mssql";

import { withRequest } from "@/lib/db/connection";

/**
 * Resolução de código de barras (do Linx) para itens de compra em trânsito.
 *
 * Usado em dois lugares, com a MESMA regra:
 *  - na criação/edição (POST/PUT) → preenche o `codigoBarra` que faltar antes de salvar;
 *  - na migração de backfill → completa as compras já salvas.
 *
 * Regra de segurança: NUNCA sobrescreve um `codigoBarra` já existente nem altera qualquer
 * outro campo do item — apenas ADICIONA o código de barras quando ele está ausente/vazio.
 */

/** Cor canônica tolerante a zero à esquerda ('04' e '4' colapsam), espelhando TRY_CONVERT(INT) do SQL. */
function canonicalCor(code: string | null | undefined): string {
  const t = String(code ?? "").trim();
  if (t === "") return "";
  return /^\d+$/.test(t) ? String(Number.parseInt(t, 10)) : t.toUpperCase();
}

/** Preferência de código de barras: mais longo vence; empate → menor numérico; depois ordem alfabética. */
function compareBarcodePreference(current: string, candidate: string): number {
  const c = current.trim();
  const n = candidate.trim();
  if (!n) return 1;
  if (!c) return -1;
  if (n.length !== c.length) return n.length - c.length;
  const cn = Number(c);
  const nn = Number(n);
  if (Number.isFinite(cn) && Number.isFinite(nn) && nn !== cn) return nn < cn ? -1 : 1;
  return n.localeCompare(c);
}

function choosePreferredBarcode(current: string | null | undefined, candidate: string | null | undefined): string {
  const c = String(current ?? "").trim();
  const n = String(candidate ?? "").trim();
  return compareBarcodePreference(c, n) < 0 ? n : c;
}

export interface BarcodeItemLike {
  produto?: string | null;
  corProduto?: string | null;
  codigoBarra?: string | null;
}

function temBarcode(item: BarcodeItemLike): boolean {
  return !!(item.codigoBarra && String(item.codigoBarra).trim());
}

/**
 * Para cada produto, busca no Linx (PRODUTOS_BARRA) o código de barras PREFERIDO por
 * (produto × cor canônica). Uma consulta por lote de produtos. Chave: "PRODUTO||corCanonica".
 * Também guarda, sob "PRODUTO||", o preferido geral do produto (fallback para item sem cor).
 */
async function resolveBarcodesMap(produtos: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(produtos.map((p) => String(p ?? "").trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (uniq.length === 0) return map;

  const CHUNK = 200;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const rows = await withRequest(async (req) => {
      chunk.forEach((p, idx) => req.input(`p${idx}`, sql.VarChar, p));
      const inList = chunk.map((_, idx) => `@p${idx}`).join(", ");
      const query = `
        SELECT
          RTRIM(LTRIM(CAST(pb.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
          RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS COR,
          LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) AS CODIGO_BARRA
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.CODIGO_BARRA IS NOT NULL
          AND LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) <> ''
          AND RTRIM(LTRIM(CAST(pb.PRODUTO AS VARCHAR(50)))) IN (${inList})
      `;
      const result = await req.query<{ PRODUTO: string; COR: string | null; CODIGO_BARRA: string | null }>(query);
      return result.recordset;
    });

    for (const row of rows) {
      const produto = String(row.PRODUTO ?? "").trim();
      const codigo = String(row.CODIGO_BARRA ?? "").trim();
      if (!produto || !codigo) continue;
      const corKey = `${produto}||${canonicalCor(row.COR)}`;
      map.set(corKey, choosePreferredBarcode(map.get(corKey), codigo));
      const prodKey = `${produto}||`; // preferido geral (fallback p/ item sem cor)
      map.set(prodKey, choosePreferredBarcode(map.get(prodKey), codigo));
    }
  }
  return map;
}

/**
 * Completa o `codigoBarra` AUSENTE dos itens, resolvendo do Linx por produto+cor.
 * Itens que já têm barcode, ou cujo barcode não foi achado, ficam intactos. Nenhum outro
 * campo é tocado. Retorna a lista (mesma ordem) e quantos itens foram preenchidos.
 *
 * Tolerante a falha do Linx: se a consulta quebrar, devolve os itens como vieram (filled=0).
 */
export async function fillMissingBarcodes<T extends BarcodeItemLike>(
  items: T[]
): Promise<{ items: T[]; filled: number }> {
  const faltantes = items.filter((it) => !temBarcode(it) && String(it.produto ?? "").trim());
  if (faltantes.length === 0) return { items, filled: 0 };

  let map: Map<string, string>;
  try {
    map = await resolveBarcodesMap(faltantes.map((it) => String(it.produto)));
  } catch (error) {
    console.error("[compra-transito-barcodes] Falha ao resolver barcodes no Linx:", error);
    return { items, filled: 0 };
  }

  let filled = 0;
  const out = items.map((it) => {
    if (temBarcode(it) || !String(it.produto ?? "").trim()) return it;
    const produto = String(it.produto).trim();
    const corCanon = canonicalCor(it.corProduto);
    // Item COM cor: só aceita a barcode daquela cor (nunca chuta a de outra cor).
    // Item SEM cor: usa o preferido geral do produto.
    const bc = corCanon ? (map.get(`${produto}||${corCanon}`) ?? "") : (map.get(`${produto}||`) ?? "");
    if (!bc) return it;
    filled += 1;
    return { ...it, codigoBarra: bc };
  });

  return { items: out, filled };
}
