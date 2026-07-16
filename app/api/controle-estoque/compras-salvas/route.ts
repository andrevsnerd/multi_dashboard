import { NextResponse } from "next/server";

import { fetchCustosPorProdutos } from "@/lib/repositories/controleEstoque";
import type { CompraSalvaItemRow, CompraSalvaListEntry, CompraSalvaListSummary } from "@/lib/types/compra-salva";
import { createCompraSalva, listComprasSalvasFull } from "@/lib/utils/compra-salva-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }
  try {
    const fromDate = from ? new Date(`${from}T00:00:00`) : undefined;
    const toDate = to ? new Date(`${to}T23:59:59.999`) : undefined;
    const compras = await listComprasSalvasFull(companyKey, fromDate, toDate);

    // Coleta todos os códigos únicos de produto para buscar custo em lote
    const todosProdutos = Array.from(
      new Set(compras.flatMap((c) => c.items.map((i) => i.produto.trim())))
    );

    // Custo do ERP — fallback silencioso se SQL Server indisponível
    let custoMap = new Map<string, number>();
    try {
      custoMap = await fetchCustosPorProdutos(todosProdutos);
    } catch {
      // sem custo disponível — totalValor será 0
    }

    const data: CompraSalvaListEntry[] = compras.map((c) => {
      const totalQtdManual = c.items.reduce(
        (s, i) => s + Math.max(0, Math.round(i.qtdManual ?? 0)),
        0
      );
      const totalValor = c.items.reduce((s, i) => {
        // Custo salvo no item tem prioridade; fallback para lookup do ERP
        const cu = (i.custoUnitario ?? 0) > 0
          ? i.custoUnitario!
          : (custoMap.get(i.produto.trim()) ?? 0);
        return cu > 0 ? s + Math.round((i.qtdManual ?? 0) * cu) : s;
      }, 0);
      return {
        id: c.id,
        title: c.title,
        itemCount: c.items.length,
        totalQtdManual,
        totalValor,
        comprada: !!c.comprada,
        savedAt: c.savedAt,
        updatedAt: c.updatedAt,
      };
    });

    const porDataMap = new Map<string, { totalValor: number; totalCompras: number }>();
    for (const c of data) {
      const date = c.savedAt.slice(0, 10);
      const acc = porDataMap.get(date) ?? { totalValor: 0, totalCompras: 0 };
      acc.totalValor += c.totalValor;
      acc.totalCompras += 1;
      porDataMap.set(date, acc);
    }
    const summary: CompraSalvaListSummary = {
      totalGeralPeriodo: data.reduce((s, c) => s + c.totalValor, 0),
      totalCompras: data.length,
      porData: Array.from(porDataMap.entries())
        .map(([date, v]) => ({ date, totalValor: v.totalValor, totalCompras: v.totalCompras }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    };

    return NextResponse.json({ data, summary });
  } catch (error) {
    console.error("Erro ao listar compras salvas", error);
    return NextResponse.json({ error: "Erro ao listar compras salvas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      companyKey,
      sourceContextKey,
      title,
      expandirPorCor,
      items,
    } = body ?? {};

    if (!companyKey || !sourceContextKey) {
      return NextResponse.json({ error: "companyKey e sourceContextKey são obrigatórios" }, { status: 400 });
    }
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "items deve ser um array" }, { status: 400 });
    }

    const normalizedItems: CompraSalvaItemRow[] = items.map((row: CompraSalvaItemRow) => ({
      itemKey: String(row.itemKey ?? ""),
      produto: String(row.produto ?? ""),
      corProduto: row.corProduto ? String(row.corProduto) : undefined,
      corDescricao: row.corDescricao ? String(row.corDescricao) : undefined,
      descricao: String(row.descricao ?? row.produto ?? ""),
      grade: row.grade ? String(row.grade) : undefined,
      colecao: row.colecao ? String(row.colecao) : undefined,
      qtdManual: Number(row.qtdManual ?? 0),
      custoUnitario: row.custoUnitario != null ? Number(row.custoUnitario) : undefined,
      filialOrigem: row.filialOrigem === null
        ? null
        : row.filialOrigem != null
          ? String(row.filialOrigem)
          : undefined,
    }));

    const t =
      typeof title === "string" && title.trim()
        ? title.trim()
        : `Compra ${new Date().toLocaleDateString("pt-BR")}`;

    const created = await createCompraSalva({
      companyKey,
      sourceContextKey,
      title: t,
      expandirPorCor: !!expandirPorCor,
      items: normalizedItems,
    });

    return NextResponse.json({ data: created });
  } catch (error) {
    console.error("Erro ao criar compra salva", error);
    return NextResponse.json({ error: "Erro ao criar compra salva" }, { status: 500 });
  }
}
