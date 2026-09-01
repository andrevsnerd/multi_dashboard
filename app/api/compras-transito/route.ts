import { NextResponse } from "next/server";

import type { CompraTransitoItemRow } from "@/lib/types/compra-transito";
import {
  createCompraTransito,
  listComprasTransitoFull,
  listComprasTransito,
} from "@/lib/utils/compra-transito-store";
import { fillMissingBarcodes } from "@/lib/server/compra-transito-barcodes";
import {
  sincronizarGastoDaCompraTransito,
  type GastoSyncResultado,
} from "@/lib/server/compra-transito-gasto";
import { applyAutoRecebimento } from "@/lib/server/compra-transito-recebimento";

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
    const createdByName = request.headers.get("x-auth-username") ?? undefined;
    const body = await request.json();
    const { companyKey, title, items, draft, compraSalvaId, pagamento } = body ?? {};

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
      codigoBarra: row.codigoBarra ? String(row.codigoBarra) : undefined,
      corProduto: row.corProduto ? String(row.corProduto) : undefined,
      corDescricao: row.corDescricao ? String(row.corDescricao) : undefined,
      grade: row.grade ? String(row.grade) : undefined,
      dataRecebimento: String(row.dataRecebimento ?? ""),
      dataRecebimentoManual: row.dataRecebimentoManual === true ? true : undefined,
      quantidade: Number(row.quantidade ?? 0),
      custoUnitario:
        row.custoUnitario != null ? Number(row.custoUnitario) : undefined,
      estoqueAtual: row.estoqueAtual != null ? Number(row.estoqueAtual) : undefined,
      status: "em_transito",
    }));

    // Na CONFIRMAÇÃO, a data de recebimento dos itens não-manuais é calculada a partir de
    // AGORA + tempo de produção do ciclo do produto (mesmo lead time da Compra Ideal).
    // Roda antes da validação para que datas automáticas satisfaçam a exigência de data.
    const itemsComData = draft
      ? normalizedItems
      : await applyAutoRecebimento(String(companyKey), normalizedItems, new Date());

    if (!draft) {
      const hasInvalidItem = itemsComData.some(
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

    // Padroniza: completa o código de barras (do Linx) que faltar. Aditivo e tolerante a
    // falha — se o Linx estiver fora, salva sem barcode (não bloqueia a criação).
    const { items: itemsComBarcode } = await fillMissingBarcodes(itemsComData);

    const created = await createCompraTransito({
      companyKey: String(companyKey),
      title:
        typeof title === "string" && title.trim() ? title.trim() : formatDefaultTitle(),
      items: itemsComBarcode,
      forceStatus: draft ? "rascunho" : undefined,
      createdByName,
      // Vínculo com a Compra Salva de origem: é por ele que Gastos de Compra acha
      // a previsão de chegada desta compra ao importar a Compra Salva.
      compraSalvaId: compraSalvaId ? String(compraSalvaId) : null,
      // Forma de pagamento configurada na tela: é ela que faz a confirmação já
      // nascer lançada em Gastos de Compra.
      pagamento: pagamento ?? null,
    });

    // Confirmar a compra é o que a torna real: já lança em Gastos de Compra.
    // Falhar aqui NÃO desfaz a confirmação (o trânsito é quem manda no estoque),
    // mas o resultado volta para a tela avisar — nada some em silêncio.
    const gasto: GastoSyncResultado | null = draft
      ? null
      : await sincronizarGastoDaCompraTransito(created, createdByName);

    return NextResponse.json({ data: created, gasto });
  } catch (error) {
    console.error("Erro ao criar compra em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao criar compra em trânsito" },
      { status: 500 }
    );
  }
}
