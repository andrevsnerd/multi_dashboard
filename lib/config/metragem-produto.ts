/**
 * Metragem de tecido por peça — quanto pano uma unidade consome.
 *
 * Não existe campo no Linx com isso: a metragem é uma regra do dono, casada pelo
 * GRUPO_PRODUTO (e, quando o grupo é genérico, pelo SUBGRUPO_PRODUTO). Para acrescentar
 * outro produto, é só somar uma regra aqui — o resto (Compras Salvas, export) já lê
 * desta lista.
 *
 * Grupos antigos foram cadastrados com C ("CAFTAN LONGO") e os novos podem vir com K;
 * as duas grafias entram em cada regra. A comparação ignora acento, caixa e espaço duplo.
 *
 * Mapeamento conferido no Linx em 05/10/2026:
 *   - CAFTAN LONGO (269 produtos)         → 3,00 m
 *   - CAFTAN CURTO (185 produtos)         → 2,04 m
 *   - CAFTAN + subgrupo LONGO (33) / CURTO (33) → idem
 *   - CAFTAN MIDI, CAFTAN COM VISTA, e "caftan" cadastrado em BATA/BLUSA/VESTIDO
 *     ficam SEM metragem até o dono definir.
 */

import type { CompanyKey } from "@/lib/config/company";

export interface MetragemRegra {
  id: string;
  label: string;
  metrosPorPeca: number;
  /** Casa quando o GRUPO_PRODUTO é um destes. */
  grupos?: string[];
  /** Casa quando grupo E subgrupo batem com um destes pares. */
  grupoSubgrupo?: Array<{ grupo: string; subgrupo: string }>;
}

export const METRAGEM_REGRAS: Partial<Record<CompanyKey, MetragemRegra[]>> = {
  scarfme: [
    {
      id: "kaftan-longo",
      label: "Kaftan longo",
      metrosPorPeca: 3,
      grupos: ["CAFTAN LONGO", "KAFTAN LONGO"],
      grupoSubgrupo: [
        { grupo: "CAFTAN", subgrupo: "LONGO" },
        { grupo: "KAFTAN", subgrupo: "LONGO" },
      ],
    },
    {
      id: "kaftan-curto",
      label: "Kaftan curto",
      metrosPorPeca: 2.04,
      grupos: ["CAFTAN CURTO", "KAFTAN CURTO"],
      grupoSubgrupo: [
        { grupo: "CAFTAN", subgrupo: "CURTO" },
        { grupo: "KAFTAN", subgrupo: "CURTO" },
      ],
    },
  ],
};

export interface MetragemProduto {
  metrosPorPeca: number;
  regraId: string;
  regraLabel: string;
}

function norm(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function temRegrasMetragem(companyKey: string): boolean {
  return (METRAGEM_REGRAS[companyKey as CompanyKey]?.length ?? 0) > 0;
}

export function resolveMetragemProduto(
  companyKey: string,
  grupo: string | null | undefined,
  subgrupo: string | null | undefined
): MetragemProduto | null {
  const regras = METRAGEM_REGRAS[companyKey as CompanyKey] ?? [];
  const g = norm(grupo);
  const s = norm(subgrupo);
  if (!g) return null;
  for (const regra of regras) {
    const porGrupo = (regra.grupos ?? []).some((x) => norm(x) === g);
    const porPar = (regra.grupoSubgrupo ?? []).some((p) => norm(p.grupo) === g && norm(p.subgrupo) === s);
    if (porGrupo || porPar) {
      return { metrosPorPeca: regra.metrosPorPeca, regraId: regra.id, regraLabel: regra.label };
    }
  }
  return null;
}
