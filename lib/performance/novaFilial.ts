import { resolveCompany, type CompanyKey } from "@/lib/config/company";

export type Curva = "A" | "B" | "C";

export interface CurvaInfo {
  curva: Curva;
  percParticipacao: number;
  percCumulativo: number;
}

export interface ComparableFilialOption {
  value: string;
  label: string;
  members: string[];
}

export interface NovaFilialPreset {
  id: string;
  label: string;
  description: string;
  model: string;
  target: string;
}

const MATRIZ_FILIAIS: Record<CompanyKey, string[]> = {
  nerd: ["NERD"],
  scarfme: ["SCARF ME - MATRIZ"],
};

export const CURVA_LABELS: Record<Curva, string> = {
  A: "Curva A - 80% do faturamento",
  B: "Curva B - 15% do faturamento",
  C: "Curva C - 5% do faturamento",
};

const PRESETS: Record<CompanyKey, NovaFilialPreset[]> = {
  scarfme: [
    {
      id: "gru-gig",
      label: "Guarulhos -> Galeao RJ",
      description: "Quiosques de aeroporto com comparacao direta de sortimento e profundidade.",
      model: "GUARULHOS - RSR",
      target: "SCARFME LLL -  GALEAO RJ",
    },
  ],
  nerd: [
    {
      id: "villa-eldorado",
      label: "Villa Lobos -> Eldorado",
      description: "Shoppings similares para projetar o mix e o potencial mensal da nova operacao.",
      model: "NERD VILLA LOBOS",
      target: "NERD ELDORADO",
    },
    {
      id: "morumbi-rj-rx",
      label: "Morumbi 1 -> Morumbi 2",
      description: "Replica da loja nova do Morumbi com base no historico da unidade original.",
      model: "NERD MORUMBI RDRRRJ",
      target: "NERD MORUMBI RDRRX",
    },
  ],
};

export function normalizeNovaFilialKey(value?: string | null): string {
  return (value ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function buildNovaFilialItemKey(produto?: string | null, cor?: string | null): string {
  return `${normalizeNovaFilialKey(produto)}|${normalizeNovaFilialKey(cor)}`;
}

export function classifyAbc<T>(
  items: T[],
  getValue: (item: T) => number
): Array<T & CurvaInfo> {
  const sorted = [...items].sort((a, b) => getValue(b) - getValue(a));
  const total = sorted.reduce((acc, item) => acc + Math.max(0, getValue(item)), 0);
  let cumulative = 0;

  return sorted.map((item) => {
    const value = Math.max(0, getValue(item));
    cumulative += value;
    const percParticipacao = total > 0 ? (value / total) * 100 : 0;
    const percCumulativo = total > 0 ? (cumulative / total) * 100 : 100;
    const curva: Curva =
      percCumulativo <= 80 ? "A" : percCumulativo <= 95 ? "B" : "C";

    return {
      ...item,
      curva,
      percParticipacao,
      percCumulativo,
    };
  });
}

export function getComparableFilialOptions(companyKey: CompanyKey): ComparableFilialOption[] {
  const company = resolveCompany(companyKey);
  if (!company) return [];

  const matrizSet = new Set(MATRIZ_FILIAIS[companyKey] ?? []);
  const ecommerceSet = new Set(company.ecommerceFilials ?? []);
  const groupMap = company.filialGroups ?? {};
  const nonCanonicalMembers = new Set<string>();

  for (const [canonical, members] of Object.entries(groupMap)) {
    members.forEach((member) => {
      if (member !== canonical) nonCanonicalMembers.add(member);
    });
  }

  const rawFiliais = Array.from(
    new Set([
      ...company.filialFilters.sales,
      ...company.filialFilters.inventory,
    ])
  );

  const options: ComparableFilialOption[] = [];

  rawFiliais.forEach((filial) => {
    if (matrizSet.has(filial) || ecommerceSet.has(filial) || nonCanonicalMembers.has(filial)) {
      return;
    }

    const members = groupMap[filial] ?? [filial];
    options.push({
      value: filial,
      label: company.filialDisplayNames?.[filial] ?? filial,
      members,
    });
  });

  return options.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export function getNovaFilialPresets(companyKey: CompanyKey): NovaFilialPreset[] {
  return PRESETS[companyKey] ?? [];
}

export function getDefaultNovaFilialPreset(companyKey: CompanyKey): NovaFilialPreset | null {
  return getNovaFilialPresets(companyKey)[0] ?? null;
}
