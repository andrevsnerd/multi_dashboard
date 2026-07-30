// Distribuição da Matriz → Lojas — repositório server-side (regra de MÍNIMO por loja).
//
// Substitui a lógica antiga (Compra Ideal por ritmo). Agora a fonte de "quanto cada loja deve ter"
// é a planilha "DIVISÃO LOJAS NOVO" codificada em lib/config/distribuicao-minimos.ts: um estoque
// MÍNIMO por loja × material × tamanho, no grão produto×cor, com sazonal (PANNEAUX) e overrides
// de coleção/cor. A origem é sempre a MATRIZ (depósito), que cede o que tem; o rateio de
// distribuicao-matriz.ts serve primeiro as lojas mais descobertas.
//
// SÓ ESTOQUE — nenhuma query de venda/faturamento (a regra do CLAUDE.md não se aplica aqui).
// Estoque vem de ESTOQUE_PRODUTOS (só saldos positivos), filial resolvida por COD_FILIAL
// (join FILIAIS) para ser robusto a rename de filial no ERP.

import { query } from "@/lib/db/connection";
import { getFiliaisByCompany } from "@/lib/config/filial-registry";
import type { CompanyKey } from "@/lib/config/company";
import {
  DISTRIBUICAO_FILIAIS,
  getMateriaisForCompany,
  isInverno,
  minimoEfetivo,
  produtoCasaMaterial,
  type MaterialDef,
  type ProdutoContexto,
} from "@/lib/config/distribuicao-minimos";
import {
  montarDistribuicaoItem,
  type DistribuicaoItem,
  type DistribuicaoResult,
  type LojaDistribuicaoInput,
} from "@/lib/utils/distribuicao-matriz";
import { fetchMenorCodigoBarra } from "@/lib/repositories/products";

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const esc = (s: string) => s.replace(/'/g, "''");
const inList = (values: string[]) => values.map((v) => `'${esc(up(v))}'`).join(", ");

/** Cláusula SQL que reconhece os produtos de UM material (mesmos matchers do config). */
function materialClause(m: MaterialDef, pfx = "p"): string {
  const parts: string[] = [];
  const { grupo, subgrupo, grade, gradeStartsWith, descContains } = m.match;
  if (grupo?.length) parts.push(`UPPER(LTRIM(RTRIM(ISNULL(${pfx}.GRUPO_PRODUTO,'')))) IN (${inList(grupo)})`);
  if (subgrupo?.length) parts.push(`UPPER(LTRIM(RTRIM(ISNULL(${pfx}.SUBGRUPO_PRODUTO,'')))) IN (${inList(subgrupo)})`);
  if (grade?.length)
    parts.push(`UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR,${pfx}.GRADE),'')))) IN (${inList(grade)})`);
  if (gradeStartsWith?.length)
    parts.push(
      `(${gradeStartsWith
        .map((g) => `UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR,${pfx}.GRADE),'')))) LIKE '${esc(up(g))}%'`)
        .join(" OR ")})`
    );
  if (descContains?.length)
    parts.push(`(${descContains.map((d) => `UPPER(${pfx}.DESC_PRODUTO) LIKE '%${esc(up(d))}%'`).join(" OR ")})`);
  return parts.length ? `(${parts.join(" AND ")})` : "(1=0)";
}

interface AttrRow {
  PRODUTO: string;
  GRUPO: string;
  SUBGRUPO: string;
  GRADE: string;
  DESC_PRODUTO: string;
  TIPO: string;
  COLECAO_DESC: string;
}

interface StockRow {
  COD_FILIAL: string;
  PRODUTO: string;
  COR: string;
  DESC_COR: string;
  ESTOQUE: number | null;
}

/**
 * Monta o board Matriz → Lojas pela regra de MÍNIMO por loja (planilha).
 */
export async function fetchDistribuicaoMatriz(company: CompanyKey): Promise<DistribuicaoResult> {
  const materiais = getMateriaisForCompany(company);
  if (materiais.length === 0) {
    return { matrizLabel: "Matriz", filiaisDestino: [], filialLabels: {}, itens: [] };
  }

  // Filiais por ID (registry é fonte de verdade). Matriz = origem; destinos = as 9 da planilha.
  const defs = getFiliaisByCompany(company).filter((f) => f.modules.includes("inventory"));
  const matrizIds = defs.filter((f) => f.display === "MATRIZ").map((f) => f.id);
  const idsByDisplay = new Map<string, string[]>();
  for (const f of defs) {
    if ((DISTRIBUICAO_FILIAIS as readonly string[]).includes(f.display)) {
      idsByDisplay.set(f.display, [...(idsByDisplay.get(f.display) ?? []), f.id]);
    }
  }
  if (matrizIds.length === 0 || idsByDisplay.size === 0) {
    return { matrizLabel: "MATRIZ", filiaisDestino: [], filialLabels: {}, itens: [] };
  }

  // Colunas destino: na ordem da planilha, só as que existem no registry.
  const destinos = DISTRIBUICAO_FILIAIS.filter((d) => idsByDisplay.has(d));
  const filialLabels: Record<string, string> = {};
  destinos.forEach((d) => (filialLabels[d] = d));

  // COD_FILIAL → display (para agregar grupos PAULISTA / E-COMMERCE por rótulo).
  const displayByCod = new Map<string, string>();
  matrizIds.forEach((id) => displayByCod.set(id, "MATRIZ"));
  for (const [display, ids] of idsByDisplay) ids.forEach((id) => displayByCod.set(id, display));

  const allIds = [...matrizIds, ...destinos.flatMap((d) => idsByDisplay.get(d)!)];
  const codList = allIds.map((id) => `'${esc(id)}'`).join(", ");
  const materialWhere = materiais.map((m) => materialClause(m, "p")).join("\n        OR ");

  // Atributos por produto (uma linha por PRODUTO).
  const attrSql = `
    SELECT
      RTRIM(p.PRODUTO) AS PRODUTO,
      UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO,'')))) AS GRUPO,
      UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) AS SUBGRUPO,
      UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR,p.GRADE),'')))) AS GRADE,
      LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO,''))) AS DESC_PRODUTO,
      UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO,'')))) AS TIPO,
      UPPER(LTRIM(RTRIM(ISNULL(col.DESC_COLECAO,'')))) AS COLECAO_DESC
    FROM PRODUTOS p WITH (NOLOCK)
    LEFT JOIN COLECOES col WITH (NOLOCK) ON col.COLECAO = p.COLECAO
    WHERE ${materialWhere}
  `;

  // Estoque positivo por COD_FILIAL × produto × cor (só as filiais que importam).
  const stockSql = `
    SELECT
      RTRIM(f.COD_FILIAL) AS COD_FILIAL,
      RTRIM(e.PRODUTO) AS PRODUTO,
      RTRIM(CONVERT(VARCHAR, e.COR_PRODUTO)) AS COR,
      ISNULL(MAX(c.DESC_COR), '') AS DESC_COR,
      SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS ESTOQUE
    FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
    JOIN FILIAIS f WITH (NOLOCK) ON f.FILIAL = e.FILIAL
    JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = e.PRODUTO
    LEFT JOIN (
      SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
      FROM PRODUTO_CORES WITH (NOLOCK)
      GROUP BY PRODUTO, COR_PRODUTO
    ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(e.PRODUTO))
       AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20))))
            OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, e.COR_PRODUTO))
    WHERE RTRIM(f.COD_FILIAL) IN (${codList})
      AND (${materialWhere})
    GROUP BY RTRIM(f.COD_FILIAL), RTRIM(e.PRODUTO), RTRIM(CONVERT(VARCHAR, e.COR_PRODUTO))
  `;

  const [attrRows, stockRows] = await Promise.all([
    query<AttrRow>(attrSql),
    query<StockRow>(stockSql),
  ]);

  const attrByProduto = new Map<string, AttrRow>();
  attrRows.forEach((r) => attrByProduto.set(r.PRODUTO.trim(), r));

  // produto×cor → estoque por display + desc da cor.
  interface Agg {
    produto: string;
    cor: string;
    descCor: string;
    matriz: number;
    porDisplay: Map<string, number>;
  }
  const aggByKey = new Map<string, Agg>();
  for (const row of stockRows) {
    const produto = row.PRODUTO.trim();
    const cor = (row.COR ?? "").trim();
    const key = `${produto}|${cor}`;
    const display = displayByCod.get(row.COD_FILIAL.trim());
    if (!display) continue;
    let agg = aggByKey.get(key);
    if (!agg) {
      agg = { produto, cor, descCor: (row.DESC_COR ?? "").trim(), matriz: 0, porDisplay: new Map() };
      aggByKey.set(key, agg);
    }
    if (!agg.descCor && row.DESC_COR) agg.descCor = row.DESC_COR.trim();
    const est = Math.max(0, Math.round(Number(row.ESTOQUE ?? 0)));
    if (display === "MATRIZ") agg.matriz += est;
    else agg.porDisplay.set(display, (agg.porDisplay.get(display) ?? 0) + est);
  }

  const inverno = isInverno(new Date());

  const itens: DistribuicaoItem[] = [];
  for (const agg of aggByKey.values()) {
    if (agg.matriz <= 0) continue; // só distribui o que a Matriz tem
    const attr = attrByProduto.get(agg.produto);
    if (!attr) continue;

    const ctx: ProdutoContexto = {
      grupo: attr.GRUPO,
      subgrupo: attr.SUBGRUPO,
      grade: attr.GRADE,
      descricao: attr.DESC_PRODUTO,
      colecaoDesc: attr.COLECAO_DESC,
      tipo: attr.TIPO,
      corCodigo: agg.cor,
    };
    const material = materiais.find((m) => produtoCasaMaterial(m, ctx));
    if (!material) continue;

    const lojasInput: LojaDistribuicaoInput[] = destinos.map((display) => {
      const filialIndex = DISTRIBUICAO_FILIAIS.indexOf(display);
      const minimo = minimoEfetivo(material, filialIndex, ctx, inverno);
      return {
        filial: display,
        filialLabel: display,
        estoqueAtual: agg.porDisplay.get(display) ?? 0,
        minimo,
      };
    });

    // Item sem nenhum mínimo > 0 (nenhuma loja estoca) → nada a distribuir.
    if (lojasInput.every((l) => l.minimo <= 0)) continue;

    itens.push(
      montarDistribuicaoItem(
        {
          produto: agg.produto,
          cor: agg.descCor || agg.cor,
          codigoCor: agg.cor,
          descricao: attr.DESC_PRODUTO,
          codigo: agg.produto,
          subgrupo: attr.SUBGRUPO,
          grade: attr.GRADE,
          material: material.label,
          matrizEstoque: agg.matriz,
        },
        lojasInput
      )
    );
  }

  // Código de barra (o MENOR/interno, não o EAN) por produto×cor — fonte canônica
  // fetchMenorCodigoBarra, a mesma do Gerador de Relatórios. O código da cor chega
  // como '06' ou '6' dependendo da fonte, então a chave é normalizada por número.
  const corKey = (cor: string | undefined) => {
    const t = (cor ?? "").trim();
    const n = Number(t);
    return t !== "" && Number.isFinite(n) ? String(n) : t.toUpperCase();
  };
  const barraByKey = new Map<string, string>();
  for (const b of await fetchMenorCodigoBarra(itens.map((i) => i.produto))) {
    barraByKey.set(`${b.produto}|${corKey(b.cor)}`, b.codigoBarra);
  }
  for (const it of itens) {
    it.codigoBarra = barraByKey.get(`${it.produto}|${corKey(it.codigoCor)}`) ?? "";
  }

  itens.sort((a, b) => {
    if (b.lojasSemEstoque !== a.lojasSemEstoque) return b.lojasSemEstoque - a.lojasSemEstoque;
    return b.totalNecessidade - a.totalNecessidade;
  });

  return { matrizLabel: "MATRIZ", filiaisDestino: destinos.slice(), filialLabels, itens };
}
