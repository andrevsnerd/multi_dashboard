import { NextResponse } from "next/server";

import { fetchFilialProdutoSales } from "@/lib/repositories/performance";
import { type CompanyKey, VAREJO_VALUE } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { normalizeRangeForQuery } from "@/lib/utils/date";

export const maxDuration = 300;

const MATRIZ_FILIAIS: Record<string, string[]> = {
  scarfme: ["SCARF ME - MATRIZ"],
  nerd: ["NERD"],
};

// Teto de dias por consulta (evita varreduras absurdas). ~2 meses já é folgado.
const MAX_DIAS = 62;
// Concorrência das consultas por dia (mesma preocupação de não saturar o proxy).
const CONCURRENCY = 6;

function isValidYmd(value: string | null): value is string {
  if (!value) return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return !Number.isNaN(dt.getTime());
}

/** Lista de dias 'yyyy-MM-dd' de start a end (inclusive). */
function listDays(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = startYmd.split("-").map(Number);
  const [ye, me, de] = endYmd.split("-").map(Number);
  const cur = new Date(Date.UTC(ys, ms - 1, ds, 12, 0, 0));
  const end = new Date(Date.UTC(ye, me - 1, de, 12, 0, 0));
  while (cur.getTime() <= end.getTime() && out.length < MAX_DIAS) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * Vendas por DIA × item×cor para a Produto Giro. Uma consulta por dia reusando a lógica
 * VALIDADA `fetchFilialProdutoSales` (POS com trocas + e-commerce) — sem SQL de venda nova
 * (regra do CLAUDE.md). Como cada dia usa a mesma função canônica, a soma dos dias bate com
 * o total do período mostrado na tela.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") as CompanyKey;
  const filialParam = searchParams.get("filial") || null;
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const produtoIds = searchParams.getAll("produto").map((p) => p.trim()).filter(Boolean);

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" obrigatório' }, { status: 400 });
  }
  if (!isValidYmd(startParam) || !isValidYmd(endParam)) {
    return NextResponse.json({ error: 'Parâmetros "start"/"end" (yyyy-MM-dd) inválidos' }, { status: 400 });
  }

  const company = await resolveCompanyDynamic(companyKey);
  if (!company) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
  }

  // Resolve os membros (POS / e-commerce) do escopo, com os nomes VIVOS.
  const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
  const matrizSet = new Set(MATRIZ_FILIAIS[companyKey] ?? []);
  const todasFiliais = (company.filialFilters.sales ?? []).filter((f) => !matrizSet.has(f));

  let escopoFiliais: string[];
  if (!filialParam || filialParam === VAREJO_VALUE) {
    escopoFiliais = todasFiliais;
  } else {
    const filialGroups = company.filialGroups ?? {};
    escopoFiliais = filialGroups[filialParam] ?? [filialParam];
  }
  const posMembers = escopoFiliais.filter((f) => !ecommerceFilials.has(f));
  const ecomMembers = escopoFiliais.filter((f) => ecommerceFilials.has(f));
  // No modo Varejo, e-commerce fica de fora.
  const ecomEscopo = filialParam === VAREJO_VALUE ? [] : ecomMembers;

  const dias = listDays(startParam, endParam);
  if (dias.length === 0) {
    return NextResponse.json({ dias: [], itens: [] });
  }

  type ItemAcc = {
    produto: string;
    cor: string;
    corDescricao: string;
    descricao: string;
    codigoBarra: string;
    subgrupo: string;
    colecao: string;
    grade: string;
    porDia: Record<string, number>;
    totalQtde: number;
    totalVendas: number;
  };

  try {
    const acc = new Map<string, ItemAcc>();
    // Total agregado por dia (todos os itens do escopo) — qtd e R$.
    const totaisPorDiaMap = new Map<string, { qtde: number; vendas: number }>();

    await mapWithConcurrency(dias, CONCURRENCY, async (dia) => {
      const range = normalizeRangeForQuery({ start: dia, end: dia });
      const rows = await fetchFilialProdutoSales(companyKey, posMembers, ecomEscopo, range, "month", {
        groupByCor: true,
        produtoIds: produtoIds.length > 0 ? produtoIds : null,
        includePrevious: false,
        limit: produtoIds.length > 0 ? 0 : 2000,
      });
      for (const r of rows) {
        const cor = (r.cor ?? "").trim();
        const key = `${r.produto}||${cor}`;
        let item = acc.get(key);
        if (!item) {
          item = {
            produto: r.produto,
            cor,
            corDescricao: r.corDescricao ?? "",
            descricao: r.descricao ?? "",
            codigoBarra: r.codigoBarra ?? "",
            subgrupo: r.subgrupo ?? "",
            colecao: r.colecao ?? "",
            grade: r.grade ?? "",
            porDia: {},
            totalQtde: 0,
            totalVendas: 0,
          };
          acc.set(key, item);
        }
        if (!item.corDescricao && r.corDescricao) item.corDescricao = r.corDescricao;
        if (!item.descricao && r.descricao) item.descricao = r.descricao;
        if (!item.codigoBarra && r.codigoBarra) item.codigoBarra = r.codigoBarra;
        const qtd = Math.round(Number(r.qtde ?? 0));
        const val = Number(r.vendas ?? 0);
        item.porDia[dia] = (item.porDia[dia] ?? 0) + qtd;
        item.totalQtde += qtd;
        item.totalVendas += val;
        const tot = totaisPorDiaMap.get(dia) ?? { qtde: 0, vendas: 0 };
        tot.qtde += qtd;
        tot.vendas += val;
        totaisPorDiaMap.set(dia, tot);
      }
    });

    // totalVendas fica em precisão PLENA (arredondar cada item e depois somar tirava ~R$
    // do total). O frontend/export arredondam só na exibição.
    const itens = Array.from(acc.values()).sort((a, b) => b.totalQtde - a.totalQtde);
    const totaisPorDia = dias.map((d) => ({
      dia: d,
      qtde: totaisPorDiaMap.get(d)?.qtde ?? 0,
      vendas: totaisPorDiaMap.get(d)?.vendas ?? 0,
    }));

    return NextResponse.json({ dias, itens, totaisPorDia }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro em /api/produto-giro/diario:", error);
    return NextResponse.json({ error: "Erro ao carregar vendas por dia" }, { status: 500 });
  }
}
