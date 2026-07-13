/**
 * Mapa UF → macro-região do Linx (campo REGIAO de CLIENTES_ATACADO).
 * Fonte única compartilhada entre o form (client) e a padronização (server).
 */
export const UF_REGIAO: Record<string, string> = {
  AC: "NORTE", AP: "NORTE", AM: "NORTE", PA: "NORTE", RO: "NORTE", RR: "NORTE", TO: "NORTE",
  AL: "NORDESTE", BA: "NORDESTE", CE: "NORDESTE", MA: "NORDESTE", PB: "NORDESTE", PE: "NORDESTE", PI: "NORDESTE", RN: "NORDESTE", SE: "NORDESTE",
  DF: "CENTRO OESTE", GO: "CENTRO OESTE", MT: "CENTRO OESTE", MS: "CENTRO OESTE",
  ES: "SUDESTE", MG: "SUDESTE", RJ: "SUDESTE", SP: "SUDESTE",
  PR: "SUL", RS: "SUL", SC: "SUL",
};

/** Região a partir da UF; cai em SUDESTE (matriz) quando a UF é desconhecida/vazia. */
export function regiaoFromUf(uf: string | undefined | null): string {
  const key = String(uf ?? "").trim().toUpperCase();
  return UF_REGIAO[key] ?? "SUDESTE";
}
