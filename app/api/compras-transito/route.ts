import { NextResponse } from "next/server";

import type { CompraTransitoItemRow } from "@/lib/types/compra-transito";
import {
  createCompraTransito,
  listComprasTransitoFull,
  listComprasTransito,
} from "@/lib/utils/compra-transito-store";

function formatDefaultTitle() {
  const now = new Date();
  const data = now.toLocaleDateString("pt-BR");
  const hora = now.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Compra em trânsito ${data} ${hora}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const includeItems = searchParams.get("includeItems") === "1";

  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }

  try {
    const data = includeItems
      ? await listComprasTransitoFull(companyKey)
      : await listComprasTransito(companyKey);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao listar compras em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao listar compras em trânsito" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyKey, title, items, draft } = body ?? {};

    if (!companyKey) {
      return NextResponse.json({ error: "companyKey é obrigatório" }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "items deve ser um array com ao menos um item" },
        { status: 400 }
      );
    }

    const normalizedItems: CompraTransitoItemRow[] = items.map((row: CompraTransitoItemRow) => ({
      itemKey: String(row.itemKey ?? ""),
      produto: String(row.produto ?? ""),
      descricao: String(row.descricao ?? row.produto ?? ""),
      corProduto: row.corProduto ? String(row.corProduto) : undefined,
      corDescricao: row.corDescricao ? String(row.corDescricao) : undefined,
      grade: row.grade ? String(row.grade) : undefined,
      dataRecebimento: String(row.dataRecebimento ?? ""),
      quantidade: Number(row.quantidade ?? 0),
      custoUnitario:
        row.custoUnitario != null ? Number(row.custoUnitario) : undefined,
      estoqueAtual: row.estoqueAtual != null ? Number(row.estoqueAtual) : undefined,
      status: "em_transito",
    }));

    if (!draft) {
      const hasInvalidItem = normalizedItems.some(
        (item) =>
          !item.itemKey.trim() ||
          !item.produto.trim() ||
          !item.dataRecebimento.trim() ||
          Math.round(item.quantidade) <= 0
      );

      if (hasInvalidItem) {
        return NextResponse.json(
          {
            error:
              "Todos os itens precisam ter produto, data de recebimento e quantidade maior que zero.",
          },
          { status: 400 }
        );
      }
    }

    const created = await createCompraTransito({
      companyKey: String(companyKey),
      title:
        typeof title === "string" && title.trim() ? title.trim() : formatDefaultTitle(),
      items: normalizedItems,
      forceStatus: draft ? "rascunho" : undefined,
    });

    return NextResponse.json({ data: created });
  } catch (error) {
    console.error("Erro ao criar compra em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao criar compra em trânsito" },
      { status: 500 }
    );
  }
}
