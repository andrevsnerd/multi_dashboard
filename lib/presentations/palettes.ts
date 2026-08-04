/**
 * Paletas do "Relatório Comparativo entre Coleções".
 *
 * Cada coleção recebe uma paleta própria (como no fonte do Claude web, onde cada
 * coleção tinha primary/accent/tint/circ específicos). As 6 primeiras replicam
 * exatamente as paletas do fonte; as demais foram desenhadas no mesmo espírito —
 * tons sofisticados e elegantes (jewel/terrosos), sempre um primary profundo +
 * um accent quente de contraste.
 *
 * Atribuição (ver `paletteForIndex`): a coleção na posição i do relatório recebe
 * PALETTES[i % PALETTES.length]. Assim, num relatório com até 12 coleções todas
 * têm paletas DIFERENTES; a partir da 13ª a sequência repete — uma vez cada até
 * todas terem 2, depois de novo até todas terem 3, e assim por diante.
 */

import type { CSSProperties } from "react";

import { PAINEL_COLECOES } from "@/lib/config/painel-colecoes";

export interface CollectionPalette {
  /** Nome exibido no seletor de paletas (Gerador de Apresentações). */
  name: string;
  /** Cor-tema principal: eyebrow, linha do gráfico, pontos, rótulo do highlight. */
  primary: string;
  /** Cor de destaque quente: número de crescimento e sub do desconto. */
  accent: string;
  /** Quase-preto do título/valores. */
  ink: string;
  /** Cinza dos rótulos/labels. */
  grey: string;
  /** Fundo dos cards de KPI (neutro claríssimo). */
  cardbg: string;
  /** Tint claro do primary: backdrop do painel direito + highlight card. */
  tint: string;
  /** Tint da área do gráfico (normalmente = tint). */
  chartTint: string;
  /** Cor do corpo de texto. */
  bodyColor: string;
  /** Círculo/anel de motivo atrás da imagem. */
  circ: string;
  /**
   * Tom escuro do primary (gradiente do KPI destaque, barra da maior loja).
   * Ausente = derivado do primary por `deckThemeVars`. Existe para o coral
   * SCARF·ME manter o tom exato do template original (#E8554A).
   */
  accentDark?: string;
}

/** Hex sem "#", como no fonte pptxgenjs. */
export const PALETTES: CollectionPalette[] = [
  // 1 — Verde Brasil (Copa Galisteu)
  { name: "Verde Brasil", primary: "009C3B", accent: "1A9E48", ink: "0A1A2F", grey: "6B7785", cardbg: "F2F5F0", tint: "E6F2EA", chartTint: "E6F2EA", bodyColor: "37423B", circ: "8CCEA3" },
  // 2 — Verde oriental + terracota (Astrid)
  { name: "Verde oriental & terracota", primary: "1F4A3D", accent: "B86B4B", ink: "1A2620", grey: "6E776F", cardbg: "F1F3EF", tint: "E4EAE2", chartTint: "E4EAE2", bodyColor: "37423B", circ: "DBB5A5" },
  // 3 — Petróleo + telha (Portinari)
  { name: "Petróleo & telha", primary: "1E4A57", accent: "B0563A", ink: "16282E", grey: "6C757A", cardbg: "F0F2F1", tint: "E1EAEC", chartTint: "E1EAEC", bodyColor: "33403F", circ: "D7AA9C" },
  // 4 — Terracota + turquesa (Isabela Capeto)
  { name: "Terracota & turquesa", primary: "C2683C", accent: "2E9CA6", ink: "3A2418", grey: "7A7068", cardbg: "F3F1ED", tint: "F3E3D6", chartTint: "F3E3D6", bodyColor: "4A3A2E", circ: "96CDD2" },
  // 5 — Azul + laranja modernista (Tarsila)
  { name: "Azul & laranja modernista", primary: "2E86C1", accent: "E2703A", ink: "16344A", grey: "6C757D", cardbg: "EFF2F4", tint: "DCEBF5", chartTint: "DCEBF5", bodyColor: "2E4456", circ: "F0B79C" },
  // 6 — Verde Pantanal + âmbar (Caiman)
  { name: "Verde Pantanal & âmbar", primary: "3E8A4F", accent: "E08A4A", ink: "1E3A2A", grey: "6E776F", cardbg: "F0F3EF", tint: "DFEEDF", chartTint: "DFEEDF", bodyColor: "33403B", circ: "EFC4A4" },
  // 7 — Vinho + ocre
  { name: "Vinho & ocre", primary: "6D2E46", accent: "C08552", ink: "2A1620", grey: "7A6B70", cardbg: "F4F0F1", tint: "EFE3E8", chartTint: "EFE3E8", bodyColor: "4A3540", circ: "C99DAE" },
  // 8 — Navy + dourado
  { name: "Navy & dourado", primary: "22364F", accent: "C9A24B", ink: "121C2A", grey: "6E7681", cardbg: "EFF1F4", tint: "E2E7EE", chartTint: "E2E7EE", bodyColor: "33414F", circ: "AEBBCB" },
  // 9 — Borgonha + pêssego
  { name: "Borgonha & pêssego", primary: "7B2D3A", accent: "D08C6A", ink: "2A1218", grey: "7C6E71", cardbg: "F5F0F0", tint: "F0E1E2", chartTint: "F0E1E2", bodyColor: "4A3339", circ: "D9A9A0" },
  // 10 — Berinjela + sálvia
  { name: "Berinjela & sálvia", primary: "4A3A5A", accent: "8FA37E", ink: "1F1826", grey: "736E78", cardbg: "F2F1F4", tint: "E7E3EC", chartTint: "E7E3EC", bodyColor: "3E3646", circ: "B8A9C7" },
  // 11 — Teal profundo + coral
  { name: "Teal profundo & coral", primary: "1F6E6A", accent: "E07856", ink: "122A28", grey: "6B7674", cardbg: "EEF3F2", tint: "DCEBE9", chartTint: "DCEBE9", bodyColor: "2E4442", circ: "9CCFC8" },
  // 12 — Ardósia + argila-rosé
  { name: "Ardósia & argila-rosé", primary: "3A4750", accent: "C57B67", ink: "1B2126", grey: "727A80", cardbg: "F1F2F3", tint: "E4E8EA", chartTint: "E4E8EA", bodyColor: "39434A", circ: "B7A39B" },
];

/**
 * Coral SCARF·ME — tema histórico do "Relatório Completo de Coleção" (o laranja
 * do template copa-galisteu.hbs). Fica FORA de `PALETTES` de propósito: entrar na
 * lista deslocaria os índices e mudaria as cores do Painel de Coleções e dos
 * comparativos. É só uma opção a mais no seletor (e o fallback de coleções que
 * não estão no Painel).
 */
export const CORAL_PALETTE: CollectionPalette = {
  name: "Coral SCARF·ME",
  primary: "FF6F61",
  accent: "E8554A",
  ink: "2B2024",
  grey: "8A7B7E",
  cardbg: "FFF7F5",
  tint: "FFF0EE",
  chartTint: "FFF0EE",
  bodyColor: "4A3A3C",
  circ: "FFC9C2",
  accentDark: "E8554A",
};

/**
 * Paleta da coleção na posição `index` do relatório. Distintas até
 * `PALETTES.length` (12); depois repete uma vez cada, ciclicamente.
 */
export function paletteForIndex(index: number): CollectionPalette {
  const n = PALETTES.length;
  const i = ((index % n) + n) % n;
  return PALETTES[i];
}

// ---------------------------------------------------------------------------
// Paleta "do Painel de Coleções" por coleção
// ---------------------------------------------------------------------------

/**
 * O Painel de Coleções pinta o card i com `paletteForIndex(i)`, e a ordem dos
 * cards é a ordem FIXA de `PAINEL_COLECOES` (a rota não reordena). Logo a paleta
 * do painel é estável por coleção e pode ser reproduzida em qualquer outra tela
 * a partir do código da coleção — é o que o Gerador de Apresentações usa para o
 * deck sair na mesma cor do painel.
 *
 * Retorna null para coleção que não está no painel (aí o deck cai no coral).
 */
export function painelPaletteForColecao(code: string | null | undefined): CollectionPalette | null {
  const target = (code ?? "").trim().toUpperCase();
  if (!target) return null;
  const index = PAINEL_COLECOES.findIndex((grupo) =>
    grupo.codes.some((c) => c.trim().toUpperCase() === target)
  );
  return index >= 0 ? paletteForIndex(index) : null;
}

// ---------------------------------------------------------------------------
// Seletor de paleta do deck (Relatório Completo de Coleção)
// ---------------------------------------------------------------------------

/** Valor do seletor: "auto" segue o Painel de Coleções; o resto é escolha manual. */
export const DECK_PALETTE_AUTO = "auto";
/** Id da paleta coral (tema histórico do deck). */
export const DECK_PALETTE_CORAL = "coral";

export interface DeckPaletteOption {
  id: string;
  palette: CollectionPalette;
}

/** Paletas oferecidas no seletor, na ordem: coral (padrão antigo) + as 12 do painel. */
export const DECK_PALETTE_OPTIONS: DeckPaletteOption[] = [
  { id: DECK_PALETTE_CORAL, palette: CORAL_PALETTE },
  ...PALETTES.map((palette, i) => ({ id: `p${i}`, palette })),
];

/** Paleta de um id do seletor; null quando o id é "auto" ou desconhecido. */
export function deckPaletteById(id: string | null | undefined): CollectionPalette | null {
  if (!id || id === DECK_PALETTE_AUTO) return null;
  return DECK_PALETTE_OPTIONS.find((o) => o.id === id)?.palette ?? null;
}

/**
 * Paleta efetiva do deck: escolha manual > paleta do painel para a coleção >
 * coral. Nunca retorna null, então o deck sempre tem um tema definido.
 */
export function resolveDeckPalette(
  selectedId: string | null | undefined,
  colecaoCode: string | null | undefined
): CollectionPalette {
  return (
    deckPaletteById(selectedId) ?? painelPaletteForColecao(colecaoCode) ?? CORAL_PALETTE
  );
}

// ---------------------------------------------------------------------------
// Tradução paleta → variáveis CSS do deck
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mistura `ratio` de `color` sobre `base` (ratio 0 = base puro, 1 = color puro). */
function mix(color: string, base: string, ratio: number): string {
  const a = parseHex(color);
  const b = parseHex(base);
  return toHex([
    b[0] + (a[0] - b[0]) * ratio,
    b[1] + (a[1] - b[1]) * ratio,
    b[2] + (a[2] - b[2]) * ratio,
  ]);
}

const WHITE = "#FFFFFF";
const BLACK = "#000000";
/** Cinza-neutro de base das bordas (mantém a linha discreta em qualquer paleta). */
const LINE_BASE = "#F2EFEF";

/**
 * Variáveis CSS do `ColecaoDeck` a partir de uma paleta do painel. Os tons
 * derivados (accent escuro, blobs, borda, papel) são calculados no mesmo grau de
 * clareza do tema coral original, então qualquer paleta cai no layout sem ajuste
 * manual. Aplicado inline no deck E em cada slide (o export PDF renderiza slide
 * por slide, então cada um precisa carregar o tema por conta própria).
 */
export function deckThemeVars(palette: CollectionPalette): CSSProperties {
  const primary = `#${palette.primary.replace("#", "")}`;
  return {
    "--accent": primary,
    "--accent-d": palette.accentDark
      ? `#${palette.accentDark.replace("#", "")}`
      : mix(primary, BLACK, 0.86),
    "--accent-2": `#${palette.accent.replace("#", "")}`,
    "--accent-soft": `#${palette.tint.replace("#", "")}`,
    "--accent-soft2": mix(primary, WHITE, 0.18),
    "--ink": `#${palette.ink.replace("#", "")}`,
    "--muted": `#${palette.grey.replace("#", "")}`,
    "--line": mix(primary, LINE_BASE, 0.1),
    "--paper": mix(primary, WHITE, 0.015),
  } as CSSProperties;
}

/** Cor de fundo usada no export PDF (o `backgroundColor` do html2canvas). */
export function deckPaperColor(palette: CollectionPalette): string {
  return mix(`#${palette.primary.replace("#", "")}`, WHITE, 0.015);
}
