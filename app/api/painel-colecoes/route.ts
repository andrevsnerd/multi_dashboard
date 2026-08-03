import { NextResponse } from "next/server";
import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import { fetchSalesTotals } from "@/lib/services/salesTotals";
import { fetchCollectionComparativeExtras } from "@/lib/repositories/collectionReport";
import { getColecaoDescMap, getColecaoInicioMatrizMap } from "@/lib/repositories/colecao";
import { resolveCompanyLive } from "@/lib/server/company-live";
import { VAREJO_VALUE, type CompanyKey } from "@/lib/config/company";
import { PAINEL_COLECOES, type PainelColecaoConfig } from "@/lib/config/painel-colecoes";
import { normalizeRangeForQuery, type NormalizedRange } from "@/lib/utils/date";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Painel de Coleções (SCARFME).
 *
 * Compara coleções pelas MESMAS regras da fonte global de vendas do app:
 * - VAREJO: `fetchSalesTotals` (a mesma do Dashboard/Curva ABC) — uma consulta
 *   AGREGADA por código (SUM líquido com trocas/cancelamentos/descontos).
 * - E-COMMERCE: consulta agregada própria e enxuta em FATURAMENTO +
 *   W_FATURAMENTO_PROD_02 (NÃO usamos `fetchEcommerceSummary`: ela tem um bug de
 *   parâmetro duplicado — "colecao already declared" — quando filtra por coleção).
 * - Peças (SKUs) = produto × cor CADASTRADOS no catálogo (PRODUTOS_BARRA),
 *   decisão do dono; independe de período/filial.
 *
 * "Todas as filiais" (filial null) = varejo + e-commerce, exatamente como as
 * demais telas de scarfme.
 */
// A lista mora em lib/config/painel-colecoes.ts porque o preset "Coleções do
// Painel" do Gerador de Apresentações consome exatamente a mesma definição.
type ColecaoConfig = PainelColecaoConfig;
const COLECOES = PAINEL_COLECOES;

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export interface ColecaoPanelMonthPoint {
  label: string;
  val: number;
  disp: string;
}

export interface ColecaoPanelItem {
  key: string;
  label: string;
  codes: string[];
  subtitle?: string;
  vendas: number;
  qtdVendida: number;
  skus: number;
  /**
   * Início da coleção ("YYYY-MM-DD") = primeira entrada de estoque de um item dela
   * na MATRIZ. Em agregados (ex.: Galisteu), a mais antiga entre os códigos.
   * null quando nenhum código teve entrada na Matriz.
   */
  inicio: string | null;
  /** Evolução mensal da venda líquida (mesma métrica/escopo de `vendas`), para o
   * mini-gráfico do tema "Com fotos". Escalada para somar `vendas`. */
  months: ColecaoPanelMonthPoint[];
  maxV: number;
}

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function chartDisp(v: number): string {
  if (v >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString("pt-BR")}k`;
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

/**
 * Evolução mensal por GRUPO (mesmos códigos somados, ex.: Galisteu = T6+Y3+U5
 * numa única série) via `fetchCollectionComparativeExtras` — reusa a mesma
 * fonte/escopo (varejo+e-commerce, rodízio MSC/AKS) do Comparativo Resumido.
 * A série é escalada para somar exatamente `vendasByKey` (a VL já validada
 * pela lógica varejo/e-commerce específica deste painel).
 */
async function fetchMonthsByGroup(
  groups: ColecaoConfig[],
  company: string,
  filial: string | null,
  range: { start: string; end: string },
  vendasByKey: Map<string, number>
): Promise<Map<string, { months: ColecaoPanelMonthPoint[]; maxV: number }>> {
  const out = new Map<string, { months: ColecaoPanelMonthPoint[]; maxV: number }>();
  const CONCURRENCY = 4;
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const batch = groups.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (group) => {
        try {
          const extras = await fetchCollectionComparativeExtras({
            company,
            filial,
            range,
            colecoes: group.codes,
          });
          const rawMonths = extras.monthly.map((m) => ({
            label: MESES_CURTOS[m.month - 1] ?? String(m.month),
            val: Math.max(0, m.revenue),
          }));
          const rawSum = rawMonths.reduce((s, m) => s + m.val, 0);
          const target = vendasByKey.get(group.key) ?? rawSum;
          const scale = rawSum > 0 ? target / rawSum : 1;
          const months = rawMonths.map((m) => ({
            label: m.label,
            val: m.val * scale,
            disp: chartDisp(m.val * scale),
          }));
          const maxV = Math.max(...months.map((m) => m.val), 1) * 1.08;
          out.set(group.key, { months, maxV });
        } catch (err) {
          console.error(`painel-colecoes: falha série mensal ${group.key}`, err);
          out.set(group.key, { months: [], maxV: 1 });
        }
      })
    );
  }
  return out;
}

/**
 * Peças (SKUs) CADASTRADAS por código — métrica de CATÁLOGO (PRODUTOS_BARRA join
 * PRODUTOS.COLECAO). Cor canônica via TRY_CONVERT(INT) colapsa '06' == '6' (ver
 * [[cor-produto-formato-duas-fontes]]) p/ não contar a mesma variação 2×.
 */
async function fetchSkusCadastradosPorCodigo(
  codes: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (codes.length === 0) return out;

  return withRequest(async (req) => {
    codes.forEach((code, idx) => req.input(`col${idx}`, sql.VarChar, code));
    const placeholders = codes.map((_, idx) => `@col${idx}`).join(", ");

    const corCanonica = `
      CASE
        WHEN TRY_CONVERT(INT, LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20))))) IS NOT NULL
          THEN CAST(TRY_CONVERT(INT, LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20))))) AS VARCHAR(20))
        ELSE UPPER(LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))))
      END`;

    const result = await req.query<{ colecao: string; skus: number }>(
      `SELECT
         UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) AS colecao,
         COUNT(DISTINCT
           LTRIM(RTRIM(CAST(pb.PRODUTO AS VARCHAR(60)))) + '|' + ${corCanonica}
         ) AS skus
       FROM PRODUTOS_BARRA pb WITH (NOLOCK)
       INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
       WHERE UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})
         AND pb.COR_PRODUTO IS NOT NULL
         AND LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''
       GROUP BY UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, ''))))`
    );

    for (const row of result.recordset) {
      out.set((row.colecao ?? "").trim().toUpperCase(), Number(row.skus ?? 0));
    }
    return out;
  });
}

/**
 * Vendas de E-COMMERCE por código de coleção — uma consulta agregada em
 * FATURAMENTO + W_FATURAMENTO_PROD_02 (mesma fonte/regra de fetchEcommerceSummary:
 * NOTA_CANCELADA=0, NATUREZA_SAIDA de venda, EMISSAO no período), agrupada por
 * PRODUTOS.COLECAO. Escrita à parte porque o summary oficial quebra ao filtrar coleção.
 */
async function fetchEcommerceVendasPorColecao(
  codes: string[],
  ecommerceFilials: string[],
  range: NormalizedRange
): Promise<Map<string, { vendas: number; qtd: number }>> {
  const out = new Map<string, { vendas: number; qtd: number }>();
  if (codes.length === 0 || ecommerceFilials.length === 0) return out;

  return withRequest(async (req) => {
    req.input("ecStart", sql.DateTime, range.start);
    req.input("ecEnd", sql.DateTime, range.end);
    codes.forEach((c, i) => req.input(`ecCol${i}`, sql.VarChar, c));
    ecommerceFilials.forEach((f, i) => req.input(`ecFil${i}`, sql.VarChar, f));

    const colPlaceholders = codes.map((_, i) => `@ecCol${i}`).join(", ");
    const filPlaceholders = ecommerceFilials.map((_, i) => `@ecFil${i}`).join(", ");

    const result = await req.query<{
      colecao: string;
      vendas: number | null;
      qtd: number | null;
    }>(
      `SELECT
         UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) AS colecao,
         SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS vendas,
         SUM(ISNULL(fp.QTDE, 0)) AS qtd
       FROM FATURAMENTO f WITH (NOLOCK)
       JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
         ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
       LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
       WHERE CAST(f.EMISSAO AS DATE) >= CAST(@ecStart AS DATE)
         AND CAST(f.EMISSAO AS DATE) < CAST(@ecEnd AS DATE)
         AND f.NOTA_CANCELADA = 0
         AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
         AND f.FILIAL IN (${filPlaceholders})
         AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${colPlaceholders})
       GROUP BY UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, ''))))`
    );

    for (const row of result.recordset) {
      out.set((row.colecao ?? "").trim().toUpperCase(), {
        vendas: Number(row.vendas ?? 0),
        qtd: Number(row.qtd ?? 0),
      });
    }
    return out;
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const filialParam = searchParams.get("filial");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      { error: "Parâmetros start e end são obrigatórios" },
      { status: 400 }
    );
  }

  // Coleções (COLECAO) só existem para SCARFME.
  if (company !== "scarfme") {
    return NextResponse.json(
      { error: "Painel de Coleções disponível apenas para SCARF ME" },
      { status: 400 }
    );
  }

  const filial = filialParam || null;
  const normRange = normalizeRangeForQuery({ start, end });

  try {
    const uniqueCodes = Array.from(new Set(COLECOES.flatMap((c) => c.codes)));

    // Resolve os nomes vivos das filiais de e-commerce (rodízio MSC/AKS na scarfme).
    const companyLive = await resolveCompanyLive(company);
    const ecommerceFilials = companyLive?.ecommerceFilials ?? [];
    const selectedIsEcom = !!filial && ecommerceFilials.includes(filial);
    const isAll = filial === null;

    // Escopo de canal conforme a filial escolhida:
    // - Todas (null)        → varejo (lojas) + e-commerce
    // - VAREJO              → só lojas
    // - filial de e-commerce→ só e-commerce (aquela filial)
    // - loja específica     → só aquela loja
    const includeVarejo = !selectedIsEcom;
    const includeEcom = isAll || selectedIsEcom;
    const varejoFilial = isAll ? VAREJO_VALUE : filial;

    const perCode = new Map<string, { vendas: number; qtd: number }>();
    for (const code of uniqueCodes) perCode.set(code, { vendas: 0, qtd: 0 });

    // ── Varejo/loja: fonte global fetchSalesTotals, uma consulta agregada por código.
    if (includeVarejo) {
      const CONCURRENCY = 4;
      for (let i = 0; i < uniqueCodes.length; i += CONCURRENCY) {
        const batch = uniqueCodes.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (code) => {
            try {
              const totals = await fetchSalesTotals({
                company: company as CompanyKey,
                range: normRange,
                filial: varejoFilial,
                colecoes: [code],
              });
              const acc = perCode.get(code)!;
              acc.vendas += totals.vendas;
              acc.qtd += totals.qtde;
            } catch (err) {
              console.error(`painel-colecoes: falha varejo ${code}`, err);
            }
          })
        );
      }
    }

    // ── E-commerce: uma única consulta agregada por coleção.
    if (includeEcom) {
      const ecomFilials = selectedIsEcom ? [filial as string] : ecommerceFilials;
      const ecomByCode = await fetchEcommerceVendasPorColecao(
        uniqueCodes,
        ecomFilials,
        normRange
      ).catch((err) => {
        console.error("painel-colecoes: falha e-commerce", err);
        return new Map<string, { vendas: number; qtd: number }>();
      });
      for (const code of uniqueCodes) {
        const ec = ecomByCode.get(code.trim().toUpperCase());
        if (ec) {
          const acc = perCode.get(code)!;
          acc.vendas += ec.vendas;
          acc.qtd += ec.qtd;
        }
      }
    }

    // ── SKUs cadastrados (catálogo): independe de período/filial.
    const skusByCode = await fetchSkusCadastradosPorCodigo(uniqueCodes).catch(
      (err) => {
        console.error("painel-colecoes: falha ao contar SKUs cadastrados", err);
        return new Map<string, number>();
      }
    );

    // Nomes: idênticos aos do banco (COLECOES.DESC_COLECAO) para coleções de 1
    // código; os agregados (Galisteu, AG) usam `customLabel` — não há uma única
    // descrição no banco para "vários códigos somados".
    const descByCode = await getColecaoDescMap().catch(
      () => new Map<string, string>()
    );

    // ── Início da coleção: primeira entrada na Matriz (independe de período/filial).
    const inicioByCode = await getColecaoInicioMatrizMap(uniqueCodes, "scarfme").catch(
      (err) => {
        console.error("painel-colecoes: falha ao buscar início das coleções", err);
        return new Map<string, string>();
      }
    );

    const baseData: Omit<ColecaoPanelItem, "months" | "maxV">[] = COLECOES.map((c) => {
      let vendas = 0;
      let qtd = 0;
      let skus = 0;
      // Agregado começa na entrada mais antiga entre seus códigos (ordem lexicográfica
      // de "YYYY-MM-DD" == ordem cronológica).
      let inicio: string | null = null;
      for (const code of c.codes) {
        const bucket = perCode.get(code);
        if (bucket) {
          vendas += bucket.vendas;
          qtd += bucket.qtd;
        }
        // Agregados somam SKUs por código (um produto pertence a um só código →
        // conjuntos disjuntos, sem dupla contagem).
        skus += skusByCode.get(code.trim().toUpperCase()) ?? 0;
        const codeInicio = inicioByCode.get(code.trim().toUpperCase());
        if (codeInicio && (!inicio || codeInicio < inicio)) inicio = codeInicio;
      }
      const singleCode = c.codes.length === 1 ? c.codes[0].trim().toUpperCase() : null;
      const label =
        c.customLabel ?? (singleCode ? descByCode.get(singleCode) || singleCode : c.codes.join(" + "));
      return {
        key: c.key,
        label,
        codes: c.codes,
        subtitle: c.subtitle,
        vendas: round2(vendas),
        qtdVendida: Math.round(qtd),
        skus,
        inicio,
      };
    });

    // ── Evolução mensal (tema "Com fotos"): uma série por grupo, escalada p/
    // bater com a VL já calculada acima.
    const vendasByKey = new Map(baseData.map((d) => [d.key, d.vendas]));
    const monthsByKey = await fetchMonthsByGroup(COLECOES, company, filial, { start, end }, vendasByKey);

    const data: ColecaoPanelItem[] = baseData.map((item) => {
      const mm = monthsByKey.get(item.key);
      return { ...item, months: mm?.months ?? [], maxV: mm?.maxV ?? 1 };
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar painel de coleções", error);
    return NextResponse.json(
      { error: "Erro ao carregar painel de coleções" },
      { status: 500 }
    );
  }
}
