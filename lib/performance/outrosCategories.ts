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
  "VESTIDO",
  "VESTIDO MIDI",
  "CALCA",
  "CAMISA",
  "PASHMINA",
  "ECHARPE",
  "CASE",
  "GAMER",
  "CAFTAN LONGO",
  "ALMOFADA",
  "PROMOCIONAIS",
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
  "Vestido",
  "Vestido midi",
  "Calça",
  "Camisa",
  "Pashmina",
  "Echarpe",
  "Case",
  "Gamer",
  "Caftan longo",
  "Almofada",
  "Promocionais",
];

const OUTROS_SCARFME_TOOLTIP_LINES = Array.from(OUTROS_CATEGORIES_SCARFME);
if (!OUTROS_SCARFME_TOOLTIP_LINES.includes("PROMOCIONAIS")) {
  OUTROS_SCARFME_TOOLTIP_LINES.push("PROMOCIONAIS");
}

export function normalizeCategoryKey(cat: string): string {
  return cat
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

export function isOutrosCategory(companyKey: CompanyKey, cat: string): boolean {
  const normalized = normalizeCategoryKey(cat);
  if (companyKey === "nerd") {
    if (OUTROS_NERD_NORMALIZED.has(normalized)) return true;
    // Defensive match: handles naming variants like PROMOCIONAL/PROMOCIONAIS.
    if (normalized.startsWith("PROMOC")) return true;
    return false;
  }
  if (OUTROS_CATEGORIES_SCARFME.has(cat)) return true;
  // Defensive match for other companies too.
  if (normalized.startsWith("PROMOC")) return true;
  return false;
}

export function getOutrosTooltip(companyKey: CompanyKey): string {
  const lines = companyKey === "nerd" ? OUTROS_NERD_TOOLTIP_LINES : OUTROS_SCARFME_TOOLTIP_LINES;
  return `Composição do OUTROS:\n- ${lines.join("\n- ")}`;
}

export function filterOutrosKeys(categories: string[], companyKey: CompanyKey): string[] {
  return categories.filter(c => isOutrosCategory(companyKey, c));
}
