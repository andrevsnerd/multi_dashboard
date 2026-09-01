/**
 * Confirmar uma Compra em trânsito lança a compra em Gastos de Compra.
 *
 * O caminho antigo era manual: confirmava aqui, ia no painel, escolhia a compra
 * no select e redigitava o parcelamento. Agora a forma de pagamento é
 * configurada na própria compra (`compra.pagamento`) e a confirmação materializa
 * o lote — mesma fonte de valor de sempre (`materializarCompraTransito`: qtd ×
 * custo item a item, com fallback de custo no ERP).
 *
 * Três garantias:
 *  - **Uma compra, um lote.** O vínculo é `compra_transito_id`. Reconfirmar
 *    sincroniza o lote existente em vez de criar um segundo com o mesmo dinheiro.
 *  - **Dinheiro que já saiu não é reescrito.** Se alguma parcela do lote está
 *    paga, a sincronização para e avisa: quem decide o que fazer é o financeiro,
 *    na tela dele.
 *  - **Nada some em silêncio.** Item sem custo marca o lote como estimativa e
 *    registra quantos ficaram de fora; falha aqui é devolvida ao chamador, que
 *    avisa na tela — a confirmação do trânsito continua valendo (é ela que
 *    manda no estoque), mas ninguém fica achando que lançou.
 */

import type { CompraTransito } from "@/lib/types/compra-transito";
import { cents } from "@/lib/utils/compra-gastos-agregacao";
import {
  avisoDeCustoFaltante,
  combinarObservacao,
  dataBrasiliaDe,
  materializarCompraTransito,
} from "@/lib/utils/compra-gastos-import";
import {
  createLote,
  getLoteDaCompraTransito,
  updateLote,
} from "@/lib/utils/compra-gastos-store";
import { parcelasDoPagamento } from "@/lib/utils/compra-transito-pagamento";

export type GastoSyncStatus =
  /** Lote novo criado no painel. */
  | "criado"
  /** Lote que já existia foi atualizado com os itens/valores desta confirmação. */
  | "atualizado"
  /** Nada a fazer (rascunho, ou pagamento desligado/não configurado). */
  | "ignorado"
  /** Lote existe e foi PRESERVADO — tem parcela paga. */
  | "preservado"
  | "erro";

export interface GastoSyncResultado {
  status: GastoSyncStatus;
  loteId?: string;
  /** Texto pronto para a tela mostrar. */
  mensagem: string;
}

/**
 * Cria (ou atualiza) a compra no painel de Gastos de Compra a partir de uma
 * Compra em trânsito recém-confirmada. Nunca lança: devolve o resultado.
 */
export async function sincronizarGastoDaCompraTransito(
  compra: CompraTransito,
  criadoPor?: string | null
): Promise<GastoSyncResultado> {
  try {
    // Rascunho é lista em montagem, não compra: a mesma regra que o painel já
    // aplica ao importar à mão.
    if (compra.status === "rascunho") {
      return { status: "ignorado", mensagem: "Rascunho não entra em Gastos de Compra." };
    }

    const pagamento = compra.pagamento ?? null;
    if (!pagamento || pagamento.lancar === false) {
      return {
        status: "ignorado",
        mensagem: "Forma de pagamento não configurada — nada lançado em Gastos de Compra.",
      };
    }

    const materializada = await materializarCompraTransito(compra.companyKey, compra.id);
    if (!materializada) {
      return {
        status: "erro",
        mensagem: "Não foi possível ler os itens da compra para lançar em Gastos de Compra.",
      };
    }

    // A compra existe a partir do momento em que foi confirmada em trânsito — é
    // essa data que ancora o parcelamento (o plano é gravado em dias sobre ela).
    const dataCompra = dataBrasiliaDe(compra.confirmedAt);
    const total = materializada.total;
    const parcelas = parcelasDoPagamento(total, dataCompra, pagamento);
    const estimado = materializada.semCusto > 0;
    const observacao = combinarObservacao(
      pagamento.observacao,
      avisoDeCustoFaltante(materializada)
    );

    const existente = await getLoteDaCompraTransito(compra.companyKey, compra.id);

    if (existente) {
      const pagas = existente.parcelas.filter((p) => p.pago);
      if (pagas.length > 0) {
        return {
          status: "preservado",
          loteId: existente.id,
          mensagem: `A compra já está em Gastos de Compra com ${pagas.length} ${
            pagas.length === 1 ? "parcela paga" : "parcelas pagas"
          } — o lançamento foi preservado. Ajuste no painel se o valor mudou.`,
        };
      }

      await updateLote(compra.companyKey, existente.id, {
        codigo: existente.codigo,
        titulo: compra.title.trim() || existente.titulo,
        fornecedor: pagamento.fornecedor ?? null,
        tipo: pagamento.tipo,
        origem: "transito",
        compraTransitoId: compra.id,
        dataCompra,
        chegadaIni: materializada.previsaoChegada ?? null,
        estimado,
        observacao,
        itens: materializada.itens,
        parcelas,
      });

      return {
        status: "atualizado",
        loteId: existente.id,
        mensagem: `Compra atualizada em Gastos de Compra: ${moeda(total)} em ${parcelas.length}x.`,
      };
    }

    const lote = await createLote(
      compra.companyKey,
      {
        codigo: compra.title.trim().slice(0, 24),
        titulo: compra.title.trim(),
        fornecedor: pagamento.fornecedor ?? null,
        tipo: pagamento.tipo,
        origem: "transito",
        compraTransitoId: compra.id,
        dataCompra,
        chegadaIni: materializada.previsaoChegada ?? null,
        estimado,
        observacao,
        itens: materializada.itens,
        parcelas,
      },
      criadoPor ?? null
    );

    return {
      status: "criado",
      loteId: lote.id,
      mensagem: `Compra lançada em Gastos de Compra: ${moeda(total)} em ${parcelas.length}${
        parcelas.length === 1 ? "x (à vista)" : "x"
      }.${estimado ? ` ${materializada.semCusto} item(ns) sem custo — lançada como estimativa.` : ""}`,
    };
  } catch (error) {
    console.error("Erro ao lançar compra em trânsito em Gastos de Compra", error);
    return {
      status: "erro",
      mensagem:
        "A compra foi confirmada, mas não foi possível lançá-la em Gastos de Compra. Lance por lá.",
    };
  }
}

function moeda(v: number): string {
  return cents(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
