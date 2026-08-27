import * as XLSX from "xlsx";

import {
  COMPRA_GASTO_CANAL_LABEL,
  COMPRA_GASTO_ORIGEM_LABEL,
  COMPRA_GASTO_TIPO_LABEL,
  type CompraGastoLote,
  type CompraGastoMes,
} from "@/lib/types/compra-gasto";
import {
  agendaDePagamentos,
  itensTotal,
  loteStatus,
  loteTotal,
} from "@/lib/utils/compra-gastos-agregacao";

function dataBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function mesBr(ym: string): string {
  const mes = parseInt(ym.slice(5, 7), 10);
  return `${MESES[mes - 1] ?? ym}/${ym.slice(0, 4)}`;
}

/**
 * Exporta o painel em três abas:
 *  - "Agenda de pagamentos": uma linha por parcela (valor negativo, como o
 *    financeiro consome — competência, vencimento, valor, categoria, descrição).
 *  - "Resumo mensal": orçamento × comprometido × pago × saldo.
 *  - "Compras": um lote por linha, com datas e origem do valor.
 */
export function exportGastosCompraXlsx(
  lotes: CompraGastoLote[],
  meses: CompraGastoMes[],
  options: {
    companyKey: string;
    companyName?: string;
    ano?: string;
    hoje: string;
    /** YYYY-MM-DD: corta parcelas anteriores a esta data (recorte "mês atual em diante"). */
    desde?: string;
  }
): void {
  const agenda = agendaDePagamentos(lotes, { ano: options.ano }).filter(
    (l) => !options.desde || l.parcela.vencimento >= options.desde
  );
  if (agenda.length === 0) {
    alert("Não há parcelas para exportar no período selecionado.");
    return;
  }

  const abaAgenda = agenda.map((linha) => ({
    COMPETENCIA: dataBr(linha.lote.dataCompra),
    VENCIMENTO: dataBr(linha.parcela.vencimento),
    VALOR: -Math.abs(linha.parcela.valor),
    CATEGORIA: COMPRA_GASTO_TIPO_LABEL[linha.lote.tipo],
    DESCRICAO: `${linha.lote.codigo} · ${linha.lote.titulo}`,
    PARCELA: `${linha.indice}/${linha.total}`,
    PAGAMENTO: linha.parcela.canal ? COMPRA_GASTO_CANAL_LABEL[linha.parcela.canal] : "",
    ETAPA: linha.parcela.etapa ?? "",
    FORNECEDOR: linha.lote.fornecedor ?? "",
    SITUACAO: linha.parcela.pago
      ? "Pago"
      : linha.lote.estimado
        ? "Estimativa"
        : linha.parcela.vencimento < options.hoje
          ? "Vencido"
          : "A pagar",
  }));

  const abaResumo = meses.map((m) => ({
    MES: mesBr(m.ym),
    ORCAMENTO: m.temOrcamento ? m.orcamento : "",
    COMPROMETIDO: m.comprometido,
    PAGO: m.pago,
    A_PAGAR: m.aPagar,
    ESTIMATIVA: m.estimado,
    SALDO: m.temOrcamento ? m.saldo : "",
    COMPRAS: m.lotes.length,
  }));

  const idsNaAgenda = new Set(agenda.map((l) => l.lote.id));
  const abaCompras = lotes
    .filter((l) => (options.ano ? l.parcelas.some((p) => p.vencimento.startsWith(options.ano!)) : true))
    .filter((l) => !options.desde || idsNaAgenda.has(l.id))
    .map((l) => ({
      CODIGO: l.codigo,
      DESCRICAO: l.titulo,
      FORNECEDOR: l.fornecedor ?? "",
      CATEGORIA: COMPRA_GASTO_TIPO_LABEL[l.tipo],
      ORIGEM: COMPRA_GASTO_ORIGEM_LABEL[l.origem],
      DATA_COMPRA: dataBr(l.dataCompra),
      PREVISAO_CHEGADA: dataBr(l.chegadaIni),
      CHEGADA_REAL: dataBr(l.chegadaReal),
      STATUS: loteStatus(l, options.hoje).label,
      ESTIMATIVA: l.estimado ? "sim" : "",
      LINHAS: l.itens.length,
      SOMA_LINHAS: l.itens.length ? itensTotal(l.itens) : "",
      VALOR_TOTAL: loteTotal(l),
      PARCELAS: l.parcelas.length,
      OBSERVACAO: (l.observacao ?? "").replace(/\n/g, " · "),
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(abaAgenda), "Agenda de pagamentos");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(abaResumo), "Resumo mensal");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(abaCompras), "Compras");

  const anoPart = options.ano ? `-${options.ano}` : "";
  XLSX.writeFile(wb, `gastos-compra-${options.companyKey}${anoPart}.xlsx`);
}
