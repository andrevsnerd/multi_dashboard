import "server-only";

import { resolveCompany } from "@/lib/config/company";
import { query } from "@/lib/db/connection";
import { getNeonSql } from "@/lib/db/neon";
import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { ensureCatalogTables } from "@/lib/shopify/catalog-store";
import type { ShopifyCompany } from "@/lib/shopify/config";

/**
 * Lotes anteriores do Linx (10/11/2026).
 *
 * No Linx, reposição e coleção nova da MESMA peça ganham código de produto novo
 * ("PILAR 09/24" → "PILAR C 11/24"; "ABAPORU 04/25" → "ABAPORU C 01/26"). O Shopify tem
 * uma variante só, e o SKU dela aponta para o lote atual; o estoque antigo continua sendo
 * faturado no código antigo, que fica sem variante. Medido: R$ 454 mil faturados no
 * e-commerce em 2025–26 em produto×cor do Linx sem nenhuma variante vinculada.
 *
 * Pareamento (só sugere quando é inequívoco):
 *   - item faturado no e-commerce do Linx (função canônica fetchProductsWithDetails) e sem
 *     variante vinculada (nem principal, nem lote, nem componente de kit);
 *   - nome da estampa do Linx (sem data "09/24", "C", "*") contido no título do Shopify;
 *   - cor do Linx confere com a opção "Cor" (ou o título);
 *   - TAMANHO: a grade do produto no Linx ("90X90", "8X130", "UNICO") igual ao tamanho da
 *     variante no Shopify — é o que separa lenço 40x40, 90x90 e twilly da mesma estampa;
 *   - uma única "família" de variante no Shopify (produto + opções, ignorando a
 *     personalização Sim/Não). Mais de uma → não pareia.
 * Grava em shopify_variant_linx_extra com origem 'auto' (recalculável); não mexe no vínculo
 * principal nem em nada manual.
 */

const nk = (s: string | null | undefined) => {
  const t = (s ?? "").trim().toUpperCase();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
};
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
const STOP = new Set(["DE", "DA", "DO", "DAS", "DOS", "EM", "E", "A", "O", "COM", "PARA", "C", "X", "CM", "SCARF", "ME", "NO", "NA"]);
const palavras = (s: string) => norm(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
const tamanhoNorm = (s: string | null | undefined) => norm(s).replace(/\s+/g, "").replace(/CM$/, "");
const esc = (s: string) => s.replace(/'/g, "''");

interface VarRow {
  variant_id: string;
  product_id: string;
  product_title: string;
  options: Array<{ name: string; value: string }>;
  status: string | null;
  produto: string | null;
  cor_produto: string | null;
  componentes: Array<{ produto: string; cor: string | null }> | null;
}

export interface LotesResult {
  itensSemVariante: number;
  receitaSemVariante: number;
  pareados: number;
  variantes: number;
  receitaPareada: number;
  ambiguos: number;
}

export async function parearLotesLinx(company: ShopifyCompany, meses = 24): Promise<LotesResult> {
  const vazio = { itensSemVariante: 0, receitaSemVariante: 0, pareados: 0, variantes: 0, receitaPareada: 0, ambiguos: 0 };
  const cfg = resolveCompany(company);
  const filialEcom = cfg?.ecommerceFilials?.[0];
  if (!filialEcom) return vazio; // NERD não tem e-commerce no Linx
  await ensureCatalogTables();
  const sql = getNeonSql();

  const fim = new Date();
  const inicio = new Date(fim.getTime() - meses * 30 * 86_400_000);
  const vendidos = await fetchProductsWithDetails({
    company,
    range: { start: inicio.toISOString(), end: fim.toISOString() },
    filial: filialEcom,
    groupByColor: true,
  } as Parameters<typeof fetchProductsWithDetails>[0]);

  const variantes = (await sql.query(
    `SELECT v.variant_id, v.product_id, v.product_title, v.options, m.status, m.produto, m.cor_produto, m.componentes
       FROM shopify_variants v
       LEFT JOIN shopify_variant_map m ON m.company = v.company AND m.variant_id = v.variant_id
      WHERE v.company = $1`,
    [company],
  )) as VarRow[];
  const extrasManuais = (await sql.query(
    `SELECT produto, cor_produto FROM shopify_variant_linx_extra WHERE company = $1 AND origem = 'manual'`,
    [company],
  )) as Array<{ produto: string; cor_produto: string }>;

  const ligado = new Set<string>();
  for (const v of variantes) {
    if (v.status === "vinculado" && v.produto) ligado.add(`${v.produto.trim().toUpperCase()}|${nk(v.cor_produto)}`);
    for (const c of v.componentes ?? []) ligado.add(`${c.produto.trim().toUpperCase()}|${nk(c.cor)}`);
  }
  for (const x of extrasManuais) ligado.add(`${x.produto.trim().toUpperCase()}|${nk(x.cor_produto)}`);

  type Item = { produto: string; cor: string; desc: string; descCor: string; receita: number };
  const porChave = new Map<string, Item>();
  for (const p of vendidos as Array<{ productId: string; productName: string; corProduto?: string; descCorProduto?: string; totalRevenue: number }>) {
    const k = `${p.productId.trim().toUpperCase()}|${nk(p.corProduto)}`;
    if (ligado.has(k)) continue;
    const cur = porChave.get(k);
    if (cur) cur.receita += p.totalRevenue;
    else
      porChave.set(k, {
        produto: p.productId.trim(),
        cor: (p.corProduto ?? "").trim(),
        desc: p.productName.trim(),
        descCor: (p.descCorProduto ?? "").trim(),
        receita: p.totalRevenue,
      });
  }
  const itens = [...porChave.values()];
  if (itens.length === 0) return { ...vazio };

  // Grade (tamanho) dos produtos do Linx.
  const grades = new Map<string, string>();
  const lista = [...new Set(itens.map((i) => i.produto))];
  for (let i = 0; i < lista.length; i += 500) {
    const rows = await query<{ PRODUTO: string; GRADE: string | null }>(
      `SELECT LTRIM(RTRIM(PRODUTO)) AS PRODUTO, LTRIM(RTRIM(ISNULL(GRADE,''))) AS GRADE
         FROM PRODUTOS WHERE PRODUTO IN (${lista.slice(i, i + 500).map((p) => `'${esc(p)}'`).join(",")})`,
    );
    for (const r of rows) grades.set(r.PRODUTO.trim().toUpperCase(), r.GRADE ?? "");
  }

  const info = variantes.map((v) => {
    const cor = v.options.find((o) => /^cor$/i.test(o.name))?.value ?? "";
    const tam = v.options.find((o) => /^tamanho$/i.test(o.name))?.value ?? (/(\d{1,3}\s?x\s?\d{2,3})\s?cm/i.exec(v.product_title)?.[1] ?? "");
    const familia = `${v.product_id}|${v.options
      .filter((o) => !/personaliz/i.test(o.name))
      .map((o) => norm(o.value))
      .join("/")}`;
    return { v, nome: new Set(palavras(v.product_title)), cor: new Set(palavras(`${cor} ${v.product_title}`)), tam: tamanhoNorm(tam), familia };
  });

  const salvar: Array<Record<string, unknown>> = [];
  let pareados = 0;
  let ambiguos = 0;
  let receitaPareada = 0;
  for (const it of itens) {
    const nomeL = palavras(it.desc.replace(/\b\d{2}\/\d{2,4}\b/g, "").replace(/\*/g, ""));
    if (nomeL.length === 0) continue;
    const corL = palavras(it.descCor);
    const grade = tamanhoNorm(grades.get(it.produto.toUpperCase()) ?? "");
    const unico = grade === "" || grade === "UNICO";
    const familias = new Map<string, typeof info>();
    for (const x of info) {
      if (!nomeL.every((t) => x.nome.has(t))) continue;
      if (corL.length > 0 && !corL.some((t) => x.cor.has(t))) continue;
      if (unico ? x.tam !== "" && x.tam !== "UNICO" : x.tam !== grade) continue;
      const l = familias.get(x.familia);
      if (l) l.push(x);
      else familias.set(x.familia, [x]);
    }
    if (familias.size !== 1) {
      if (familias.size > 1) ambiguos += 1;
      continue;
    }
    const [membros] = [...familias.values()];
    pareados += 1;
    receitaPareada += it.receita;
    for (const x of membros) {
      salvar.push({
        variant_id: x.v.variant_id,
        produto: it.produto,
        cor_produto: it.cor,
        desc_produto: it.desc,
        desc_cor: it.descCor || null,
        metodo: `lote anterior: nome + cor + tamanho (${grade || "único"})`,
      });
    }
  }

  // Recalcula só o automático: tira os lotes 'auto' antigos e grava os de agora.
  await sql.transaction([
    sql.query(`DELETE FROM shopify_variant_linx_extra WHERE company = $1 AND origem = 'auto'`, [company]),
    sql.query(
      `INSERT INTO shopify_variant_linx_extra (company, variant_id, produto, cor_produto, desc_produto, desc_cor, origem, metodo)
       SELECT $1, x.variant_id, x.produto, x.cor_produto, x.desc_produto, x.desc_cor, 'auto', x.metodo
         FROM jsonb_to_recordset($2::jsonb) AS x(variant_id text, produto text, cor_produto text,
              desc_produto text, desc_cor text, metodo text)
       ON CONFLICT (company, variant_id, produto, cor_produto) DO NOTHING`,
      [company, JSON.stringify(salvar)],
    ),
  ]);

  return {
    itensSemVariante: itens.length,
    receitaSemVariante: Math.round(itens.reduce((a, i) => a + i.receita, 0)),
    pareados,
    variantes: salvar.length,
    receitaPareada: Math.round(receitaPareada),
    ambiguos,
  };
}
