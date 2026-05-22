import {
  aggregateVendasPorFilialByDisplayLabel,
  compareFilialDisplayOrder,
  normalizeFilialLookupKey,
  resolveCompany,
  type CompanyKey,
} from "@/lib/config/company";
import { calcTotalPerFilialFiliais } from "@/lib/utils/necessidade-minima";

export type DestinoCompraFinalParte = { label: string; qtd: number; qtde12m?: number; isNM?: boolean; nmQty?: number };

/**
 * Demanda por filial com ajuste 60d; distribui apenas para filiais (exclui MATRIZ); sobra pelo maior resto.
 * Quando `estoquePorFilial` é fornecido, filiais com estoque zerado e NM positivo recebem
 * a reserva mínima antes da distribuição proporcional do restante.
 */
export function partesDestinoCompraFinal(
  qtdManual: number,
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number; velocidadeAjustada?: number | null; mesesDisponiveis?: number | null; diasComEstoquePositivo?: number | null }>,
  companyKey: CompanyKey,
  estoquePorFilial?: Array<{ filial: string; estoque: number }>,
  limiteDias = 60
): DestinoCompraFinalParte[] | null {
  if (qtdManual <= 0) return null;
  const cfg = resolveCompany(companyKey);
  const agregadas = aggregateVendasPorFilialByDisplayLabel(
    vendasPorFilial.map((r) => ({
      filial: r.filial,
      qtde12m: r.qtde12m,
      qtde60d: r.qtde60d ?? 0,
    })),
    cfg
  );

  // Exclui MATRIZ e, para ScarfMe, não distribui para Ibirapuera.
  const filiais = agregadas.filter((r) => {
    const filialKey = normalizeFilialLookupKey(r.filial);
    if (filialKey === "MATRIZ") return false;
    if (companyKey === "scarfme" && filialKey.includes("IBIRAPUERA")) return false;
    return true;
  });

  const qtde12mMap = new Map<string, number>(filiais.map((r) => [normalizeFilialLookupKey(r.filial), r.qtde12m]));

  // Necessidade crítica por filial: estoque zero (NM) + cobertura abaixo do limite
  const nmReservas = estoquePorFilial
    ? calcTotalPerFilialFiliais({
        company: cfg,
        vendasPorFilial,
        estoquePorFilial,
        limiteDias,
      })
        .filter((row) => filiais.some((filial) => normalizeFilialLookupKey(filial.filial) === normalizeFilialLookupKey(row.filial)))
        .map((row) => ({ filial: row.filial, qty: row.qtd }))
    : [];

  // Reserva a quantidade NM por filial até o limite da compra manual.
  let qtdReservadaNM = 0;
  const resultado = new Map<string, { qtd: number; isNM: boolean; nmQty: number }>();
  for (const reserva of nmReservas) {
    const disponivel = qtdManual - qtdReservadaNM;
    if (disponivel <= 0) break;
    const alocada = Math.min(reserva.qty, disponivel);
    if (alocada <= 0) continue;
    resultado.set(reserva.filial, { qtd: alocada, isNM: true, nmQty: alocada });
    qtdReservadaNM += alocada;
  }
  const qtdRestante = qtdManual - qtdReservadaNM;

  // Distribui o restante proporcionalmente por demanda entre todas as filiais
  if (qtdRestante > 0) {
    const demandas = filiais.map((r) => ({
      filial: r.filial,
      demanda: (() => {
        const m12 = r.qtde12m / 12;
        if (m12 <= 0) return 0;
        const peso = (r.qtde60d ?? 0) / (m12 * 2);
        return m12 * (0.5 + 0.5 * peso);
      })(),
    }));
    const somaDemanda = demandas.reduce((s, r) => s + r.demanda, 0);
    if (somaDemanda > 0) {
      const pisos = demandas.map((r) => {
        const exato = (qtdRestante * r.demanda) / somaDemanda;
        return { filial: r.filial, piso: Math.floor(exato), resto: exato - Math.floor(exato) };
      });
      const somaPisos = pisos.reduce((s, r) => s + r.piso, 0);
      const sobra = qtdRestante - somaPisos;
      const boost = new Set(
        [...pisos].sort((a, b) => b.resto - a.resto).slice(0, sobra).map((r) => r.filial)
      );
      for (const p of pisos) {
        const qtdExtra = p.piso + (boost.has(p.filial) ? 1 : 0);
        if (qtdExtra > 0) {
          const prev = resultado.get(p.filial);
          resultado.set(p.filial, {
            qtd: (prev?.qtd ?? 0) + qtdExtra,
            isNM: prev?.isNM ?? false,
            nmQty: prev?.nmQty ?? 0,
          });
        }
      }
    }
  } else if (qtdReservadaNM === 0) {
    return null;
  }

  const partes: DestinoCompraFinalParte[] = Array.from(resultado.entries())
    .map(([label, { qtd, isNM, nmQty }]) => ({
      label,
      qtd,
      qtde12m: qtde12mMap.get(normalizeFilialLookupKey(label)),
      isNM: isNM || undefined,
      nmQty: nmQty > 0 ? nmQty : undefined,
    }))
    .filter((r) => r.qtd > 0);

  partes.sort((a, b) => compareFilialDisplayOrder(a.label, b.label, cfg));
  return partes.length > 0 ? partes : null;
}

export function textoDestinoCompraFinal(
  qtdManual: number,
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number; velocidadeAjustada?: number | null; mesesDisponiveis?: number | null; diasComEstoquePositivo?: number | null }>,
  companyKey: CompanyKey,
  estoquePorFilial?: Array<{ filial: string; estoque: number }>,
  limiteDias = 60
): string {
  const partesH = partesDestinoCompraFinal(qtdManual, vendasPorFilial, companyKey, estoquePorFilial, limiteDias);
  if (partesH === null) return "—";
  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return partesH.map((p) => `${p.label}: ${fmt(p.qtd)}`).join(" · ");
}
