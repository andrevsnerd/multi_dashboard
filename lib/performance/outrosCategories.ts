import type { CompanyKey } from "@/lib/config/company";

/** Scarf Me: LINHA (UPPER) — mesmo agrupamento histórico */
export const OUTROS_CATEGORIES_SCARFME = new Set([
  "CAPAS E ACESSORIOS P/ CEL",
  "HOME",
  "PAPELARIA",
  "ELETRONICOS",
  "PERFUMARIA",
  "SEDA PREMIUM",
]);

export const OUTROS_LABEL = "OUTROS";

/** NERD: GRUPO_PRODUTO — chaves normalizadas (sem acento) para bater com UPPER() do SQL */
const OUTROS_NERD_NORMALIZED = new Set([
  "CASA E CONEXAO",
  "VEICULAR E SUPORTE",
  "BAG",
  "PELICULA",
  "ACESSORIOS",
  "ADAPTADOR",
  "CAMERA",
  "SAUDE",
  "LENCO",
  "IMPRESSOS",
  "CAPA PARA CELULAR",
  "PONCHO",
  "REGATA",
  "VESTIDO CURTO",
  "CAFTAN LONGO",
  "ALMOFADA",
]);

const OUTROS_NERD_TOOLTIP_LINES = [
  "Casa e conexão",
  "Veicular e suporte",
  "Bag",
  "Película",
  "Acessórios",
  "Adaptador",
  "Câmera",
  "Saúde",
  "Lenço",
  "Impressos",
  "Capa para celular",
  "Poncho",
  "Regata",
  "Vestido curto",
  "Caftan longo",
  "Almofada",
];

const OUTROS_SCARFME_TOOLTIP_LINES = Array.from(OUTROS_CATEGORIES_SCARFME);

export function normalizeCategoryKey(cat: string): string {
  return cat
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

export function isOutrosCategory(companyKey: CompanyKey, cat: string): boolean {
  if (companyKey === "nerd") {
    return OUTROS_NERD_NORMALIZED.has(normalizeCategoryKey(cat));
  }
  return OUTROS_CATEGORIES_SCARFME.has(cat);
}

export function getOutrosTooltip(companyKey: CompanyKey): string {
  const lines = companyKey === "nerd" ? OUTROS_NERD_TOOLTIP_LINES : OUTROS_SCARFME_TOOLTIP_LINES;
  return `Composição do OUTROS:\n- ${lines.join("\n- ")}`;
}

export function filterOutrosKeys(categories: string[], companyKey: CompanyKey): string[] {
  return categories.filter(c => isOutrosCategory(companyKey, c));
}
