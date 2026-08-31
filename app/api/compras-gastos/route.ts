import { NextResponse } from "next/server";

import { readOnlyBlock } from "@/lib/auth/route-guards";
import type {
  CompraGastoItem,
  CompraGastoLoteInput,
  CompraGastoParcela,
} from "@/lib/types/compra-gasto";
import { cents, gerarParcelas, itensTotal } from "@/lib/utils/compra-gastos-agregacao";
import {
  avisoDeCustoFaltante,
  combinarObservacao,
  materializarCompraTransito,
} from "@/lib/utils/compra-gastos-import";
import {
  createLote,
  existeLoteDaCompraTransito,
  listLotes,
  listOrcamento,
} from "@/lib/utils/compra-gastos-store";

/** Painel completo: lotes + orçamento. A agregação por mês roda na tela (função pura compartilhada). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }
  try {
    const [lotes, orcamento] = await Promise.all([
      listLotes(companyKey),
      listOrcamento(companyKey),
    ]);
    return NextResponse.json({ lotes, orcamento });
  } catch (error) {
    console.error("Erro ao carregar gastos de compra", error);
    return NextResponse.json({ error: "Erro ao carregar gastos de compra" }, { status: 500 });
  }
}

/**
 * Cria um lote de compra.
 *
 * Três origens:
 *  - "transito": os itens são materializados a partir de uma Compra em trânsito
 *    CONFIRMADA (qtd × custo, com fallback de custo no ERP). Rascunho é recusado.
 *    Item sem custo NÃO vira zero em silêncio — o lote nasce marcado como
 *    estimativa e a observação registra quantos.
 *  - "itens": as linhas vêm do corpo da requisição (com ou sem vínculo a produto).
 *  - "valor": só descrição e valor total.
 *
 * As parcelas podem vir prontas (`parcelas`) ou ser geradas do total resolvido
 * (`parcelasConfig`). Cada parcela conta uma vez, no mês do próprio vencimento.
 */
export async function POST(request: Request) {
  try {
    const bloqueado = await readOnlyBlock(request.headers.get("x-auth-username"));
    if (bloqueado) return bloqueado;

    const body = (await request.json()) as CompraGastoLoteInput & {
      companyKey?: string;
      parcelasConfig?: { quantidade?: number; primeiroVencimento?: string; intervalo?: "mensal" | "quinzenal" };
    };
    const companyKey = String(body?.companyKey ?? "").trim();
    if (!companyKey) {
      return NextResponse.json({ error: "companyKey é obrigatório" }, { status: 400 });
    }
    if (!String(body?.titulo ?? "").trim()) {
      return NextResponse.json({ error: "A compra precisa de uma descrição" }, { status: 400 });
    }
    if (!String(body?.dataCompra ?? "").trim()) {
      return NextResponse.json({ error: "A data da compra é obrigatória" }, { status: 400 });
    }

    const origem = body.origem === "transito" || body.origem === "itens" ? body.origem : "valor";
    let itens: CompraGastoItem[] = Array.isArray(body.itens) ? body.itens : [];
    let estimado = !!body.estimado;
    let observacao = body.observacao ? String(body.observacao).trim() : null;
    let valorUnico = body.valorUnico != null ? cents(body.valorUnico) : null;

    // Previsão de chegada da Compra em trânsito importada (a menor data de
    // recebimento dos itens). Só entra quando a tela não mandou uma.
    let previsaoChegadaTransito: string | null = null;

    if (origem === "transito") {
      const compraTransitoId = String(body.compraTransitoId ?? "").trim();
      if (!compraTransitoId) {
        return NextResponse.json(
          { error: "Selecione a Compra em trânsito de origem" },
          { status: 400 }
        );
      }
      // Uma Compra em trânsito entra no painel UMA vez. Lançar de novo duplicaria
      // o comprometido do mês com o mesmo dinheiro.
      if (await existeLoteDaCompraTransito(companyKey, compraTransitoId)) {
        return NextResponse.json(
          { error: "Esta Compra em trânsito já foi lançada como compra neste painel." },
          { status: 409 }
        );
      }
      const m = await materializarCompraTransito(companyKey, compraTransitoId);
      if (!m) {
        return NextResponse.json({ error: "Compra em trânsito não encontrada" }, { status: 404 });
      }
      // Só compra CONFIRMADA em trânsito é reconhecida como gasto: rascunho é
      // lista em montagem, não compra.
      if (m.status === "rascunho") {
        return NextResponse.json(
          {
            error:
              "Esta compra em trânsito ainda é um rascunho. Só compras confirmadas em trânsito entram no painel.",
          },
          { status: 409 }
        );
      }

      itens = m.itens;
      valorUnico = null;
      previsaoChegadaTransito = m.previsaoChegada ?? null;
      if (m.semCusto > 0) {
        // Nunca somar zero escondido: o lote vira estimativa e diz o porquê.
        estimado = true;
        observacao = combinarObservacao(observacao, avisoDeCustoFaltante(m));
      }
    }

    if (origem === "itens" && itens.length === 0) {
      return NextResponse.json({ error: "Adicione pelo menos uma linha à compra" }, { status: 400 });
    }
    if (origem === "valor") {
      itens = [];
      if (!valorUnico || valorUnico <= 0) {
        return NextResponse.json({ error: "Informe o valor total da compra" }, { status: 400 });
      }
    }

    const totalResolvido =
      origem === "valor" ? (valorUnico ?? 0) : itensTotal(itens);

    let parcelas: CompraGastoParcela[] = Array.isArray(body.parcelas) ? body.parcelas : [];
    if (parcelas.length === 0) {
      const cfg = body.parcelasConfig ?? {};
      const primeiro = String(cfg.primeiroVencimento ?? "").trim() || String(body.dataCompra).slice(0, 10);
      parcelas = gerarParcelas(
        totalResolvido,
        Number(cfg.quantidade ?? 1),
        primeiro,
        cfg.intervalo === "quinzenal" ? "quinzenal" : "mensal"
      );
    }

    const somaParcelas = cents(parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0));
    if (!parcelas.length || somaParcelas <= 0) {
      return NextResponse.json(
        { error: "A compra precisa de pelo menos uma parcela com valor e vencimento" },
        { status: 400 }
      );
    }
    if (parcelas.some((p) => !p.vencimento)) {
      return NextResponse.json({ error: "Toda parcela precisa de uma data de vencimento" }, { status: 400 });
    }

    const lote = await createLote(
      companyKey,
      {
        codigo: String(body.codigo ?? "").trim() || String(body.titulo).trim().slice(0, 24),
        titulo: String(body.titulo).trim(),
        colecao: body.colecao ?? null,
        fornecedor: body.fornecedor ?? null,
        tipo: body.tipo ?? "mercadoria",
        origem,
        compraTransitoId: origem === "transito" ? String(body.compraTransitoId) : null,
        dataCompra: String(body.dataCompra).slice(0, 10),
        chegadaIni: body.chegadaIni ?? previsaoChegadaTransito,
        chegadaReal: body.chegadaReal ?? null,
        estimado,
        valorUnico: origem === "valor" ? valorUnico : null,
        observacao,
        itens,
        parcelas,
      },
      request.headers.get("x-auth-username")
    );

    return NextResponse.json({ data: lote });
  } catch (error) {
    console.error("Erro ao criar compra", error);
    return NextResponse.json({ error: "Erro ao criar compra" }, { status: 500 });
  }
}
