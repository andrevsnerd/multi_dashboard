/**
 * Metragem de tecido por peça — quanto pano uma unidade consome.
 *
 * Não existe campo no Linx com isso: a metragem é uma regra do dono, casada pelo
 * cadastro do produto (LINHA, GRUPO_PRODUTO, SUBGRUPO_PRODUTO, GRADE). Para acrescentar
 * outro produto, é só somar uma regra aqui — o resto (Compras Salvas, export) já lê
 * desta lista.
 *
 * Cada regra tem uma lista de `criterios`: o produto casa a regra quando bate TODOS os
 * campos preenchidos de PELO MENOS UM critério. A comparação ignora acento, caixa e
 * espaço duplo; na GRADE os espaços somem ("90 X 90" = "90X90"). A primeira regra que
 * casar vence.
 *
 * Mapeamento conferido no Linx:
 *   05/10/2026 — kaftans, pelo GRUPO (antigos cadastrados com C: "CAFTAN LONGO"):
 *     CAFTAN LONGO (269) / grupo CAFTAN + subgrupo LONGO (33)   → 3,00 m
 *     CAFTAN CURTO (185) / grupo CAFTAN + subgrupo CURTO (33)   → 2,04 m
 *     Sem regra: CAFTAN MIDI, CAFTAN COM VISTA, "caftan" em BATA/BLUSA/VESTIDO.
 *   07/10/2026 — lenços, por LINHA + GRADE + SUBGRUPO (linhas LENÇOS e APROVEITAMENTO LENÇO):
 *     90X90  cetim de poliéster      (404) → 0,95 m
 *     50X50  cetim de poliéster  (9 + 627 do aproveitamento) → 0,265 m
 *     45X210 mousseline de poliéster (354) → 1,075 m
 *     130X200 viscose (panneaux)     (138) → 2,15 m
 *     Fora (outra LINHA): PRIVATE LABEL, DESCONTINUADO.
 *   08/10/2026 — 70X70 cetim de poliéster (93 na linha LENÇOS) → 0,37 m
 *   08/10/2026 — 130X200 georgete de poliéster (panneaux, 100 na linha LENÇOS) → 2,07 m
 *     O cetim aparece com e sem "DE" no subgrupo ("CETIM POLIESTER") — as duas grafias entram.
 */

import type { CompanyKey } from "@/lib/config/company";

export interface MetragemCriterio {
  linha?: string;
  grupo?: string;
  subgrupo?: string;
  grade?: string;
}

export interface MetragemRegra {
  id: string;
  label: string;
  metrosPorPeca: number;
  criterios: MetragemCriterio[];
}

/** Cadastro do produto que as regras olham. */
export interface MetragemClassificacao {
  linha?: string | null;
  grupo?: string | null;
  subgrupo?: string | null;
  grade?: string | null;
}

const CETIM_POLIESTER = ["CETIM DE POLIESTER", "CETIM POLIESTER"];

/** Linhas de lenço que entram na metragem (decisão do dono, 07/10/2026). */
const LINHAS_LENCO = ["LENÇOS", "APROVEITAMENTO LENÇO"];

const lencos = (grade: string, subgrupos: string[]): MetragemCriterio[] =>
  LINHAS_LENCO.flatMap((linha) => subgrupos.map((subgrupo) => ({ linha, grade, subgrupo })));

export const METRAGEM_REGRAS: Partial<Record<CompanyKey, MetragemRegra[]>> = {
  scarfme: [
    {
      id: "kaftan-longo",
      label: "Kaftan longo",
      metrosPorPeca: 3,
      criterios: [
        { grupo: "CAFTAN LONGO" },
        { grupo: "KAFTAN LONGO" },
        { grupo: "CAFTAN", subgrupo: "LONGO" },
        { grupo: "KAFTAN", subgrupo: "LONGO" },
      ],
    },
    {
      id: "kaftan-curto",
      label: "Kaftan curto",
      metrosPorPeca: 2.04,
      criterios: [
        { grupo: "CAFTAN CURTO" },
        { grupo: "KAFTAN CURTO" },
        { grupo: "CAFTAN", subgrupo: "CURTO" },
        { grupo: "KAFTAN", subgrupo: "CURTO" },
      ],
    },
    {
      id: "lenco-90x90-cetim-poliester",
      label: "Lenço 90x90 cetim de poliéster",
      metrosPorPeca: 0.95,
      criterios: lencos("90X90", CETIM_POLIESTER),
    },
    {
      id: "lenco-70x70-cetim-poliester",
      label: "Lenço 70x70 cetim de poliéster",
      metrosPorPeca: 0.37,
      criterios: lencos("70X70", CETIM_POLIESTER),
    },
    {
      id: "lenco-50x50-cetim-poliester",
      label: "Lenço 50x50 cetim de poliéster",
      metrosPorPeca: 0.265,
      criterios: lencos("50X50", CETIM_POLIESTER),
    },
    {
      id: "lenco-45x210-mousseline-poliester",
      label: "Lenço 45x210 mousseline de poliéster",
      metrosPorPeca: 1.075,
      criterios: lencos("45X210", ["MOUSSELINE DE POLIESTER"]),
    },
    {
      id: "panneaux-130x200-viscose",
      label: "Panneaux 130x200 viscose",
      metrosPorPeca: 2.15,
      criterios: lencos("130X200", ["VISCOSE"]),
    },
    {
      id: "panneaux-130x200-georgete-poliester",
      label: "Panneaux 130x200 georgete de poliéster",
      metrosPorPeca: 2.07,
      criterios: lencos("130X200", ["GEORGETE DE POLIESTER"]),
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

function normGrade(value: string | null | undefined): string {
  return norm(value).replace(/\s+/g, "");
}

function casaCriterio(c: MetragemCriterio, p: MetragemClassificacao): boolean {
  const campos: Array<[string | undefined, string | null | undefined, (v: string | null | undefined) => string]> = [
    [c.linha, p.linha, norm],
    [c.grupo, p.grupo, norm],
    [c.subgrupo, p.subgrupo, norm],
    [c.grade, p.grade, normGrade],
  ];
  const preenchidos = campos.filter(([esperado]) => esperado != null);
  if (preenchidos.length === 0) return false;
  return preenchidos.every(([esperado, valor, f]) => {
    const v = f(valor);
    return v !== "" && v === f(esperado);
  });
}

export function temRegrasMetragem(companyKey: string): boolean {
  return (METRAGEM_REGRAS[companyKey as CompanyKey]?.length ?? 0) > 0;
}

export function resolveMetragemProduto(
  companyKey: string,
  produto: MetragemClassificacao
): MetragemProduto | null {
  const regras = METRAGEM_REGRAS[companyKey as CompanyKey] ?? [];
  for (const regra of regras) {
    if (regra.criterios.some((c) => casaCriterio(c, produto))) {
      return { metrosPorPeca: regra.metrosPorPeca, regraId: regra.id, regraLabel: regra.label };
    }
  }
  return null;
}
