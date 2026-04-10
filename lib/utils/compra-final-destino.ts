import {
  aggregateVendasPorFilialByDisplayLabel,
  compareFilialDisplayOrder,
  resolveCompany,
  type CompanyKey,
} from "@/lib/config/company";

export type DestinoCompraFinalParte = { label: string; qtd: number };

function normalizeFilialKey(s?: string | null) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Demanda por filial com ajuste 60d; distribui apenas para filiais (exclui MATRIZ); sobra pelo maior resto. */
export function partesDestinoCompraFinal(
  qtdManual: number,
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number }>,
  companyKey: CompanyKey
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
  // A redistribuição acontece automaticamente entre as demais filiais
  // pelo mesmo método proporcional + maior resto.
  const filiais = agregadas.filter((r) => {
    const filialKey = normalizeFilialKey(r.filial);
    if (filialKey === "MATRIZ") return false;
    if (companyKey === "scarfme" && filialKey.includes("IBIRAPUERA")) return false;
    return true;
  });

  const demandas = filiais.map((r) => ({
    filial: r.filial,
    m12: r.qtde12m / 12,
    demanda: (() => {
      const m12 = r.qtde12m / 12;
      if (m12 <= 0) return 0;
      const peso = (r.qtde60d ?? 0) / (m12 * 2);
      return m12 * (0.5 + 0.5 * peso);
    })(),
  }));
  const somaDemanda = demandas.reduce((s, r) => s + r.demanda, 0);
  if (somaDemanda <= 0) return null;

  const pisos = demandas.map((r) => {
    const exato = (qtdManual * r.demanda) / somaDemanda;
    return { filial: r.filial, piso: Math.floor(exato), resto: exato - Math.floor(exato) };
  });
  const somaPisos = pisos.reduce((s, r) => s + r.piso, 0);
  const sobra = qtdManual - somaPisos;

  const boost = new Set(
    [...pisos].sort((a, b) => b.resto - a.resto).slice(0, sobra).map((r) => r.filial)
  );

  const partes: DestinoCompraFinalParte[] = pisos
    .map((r) => ({ label: r.filial, qtd: r.piso + (boost.has(r.filial) ? 1 : 0) }))
    .filter((r) => r.qtd > 0);

  partes.sort((a, b) => compareFilialDisplayOrder(a.label, b.label, cfg));

  return partes;
}

export function textoDestinoCompraFinal(
  qtdManual: number,
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number }>,
  companyKey: CompanyKey
): string {
  const partesH = partesDestinoCompraFinal(qtdManual, vendasPorFilial, companyKey);
  if (partesH === null) return "—";
  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return partesH.map((p) => `${p.label}: ${fmt(p.qtd)}`).join(" · ");
}
