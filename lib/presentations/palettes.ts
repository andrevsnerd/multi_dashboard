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

export interface CollectionPalette {
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
}

/** Hex sem "#", como no fonte pptxgenjs. */
export const PALETTES: CollectionPalette[] = [
  // 1 — Verde Brasil (Copa Galisteu)
  { primary: "009C3B", accent: "1A9E48", ink: "0A1A2F", grey: "6B7785", cardbg: "F2F5F0", tint: "E6F2EA", chartTint: "E6F2EA", bodyColor: "37423B", circ: "8CCEA3" },
  // 2 — Verde oriental + terracota (Astrid)
  { primary: "1F4A3D", accent: "B86B4B", ink: "1A2620", grey: "6E776F", cardbg: "F1F3EF", tint: "E4EAE2", chartTint: "E4EAE2", bodyColor: "37423B", circ: "DBB5A5" },
  // 3 — Petróleo + telha (Portinari)
  { primary: "1E4A57", accent: "B0563A", ink: "16282E", grey: "6C757A", cardbg: "F0F2F1", tint: "E1EAEC", chartTint: "E1EAEC", bodyColor: "33403F", circ: "D7AA9C" },
  // 4 — Terracota + turquesa (Isabela Capeto)
  { primary: "C2683C", accent: "2E9CA6", ink: "3A2418", grey: "7A7068", cardbg: "F3F1ED", tint: "F3E3D6", chartTint: "F3E3D6", bodyColor: "4A3A2E", circ: "96CDD2" },
  // 5 — Azul + laranja modernista (Tarsila)
  { primary: "2E86C1", accent: "E2703A", ink: "16344A", grey: "6C757D", cardbg: "EFF2F4", tint: "DCEBF5", chartTint: "DCEBF5", bodyColor: "2E4456", circ: "F0B79C" },
  // 6 — Verde Pantanal + âmbar (Caiman)
  { primary: "3E8A4F", accent: "E08A4A", ink: "1E3A2A", grey: "6E776F", cardbg: "F0F3EF", tint: "DFEEDF", chartTint: "DFEEDF", bodyColor: "33403B", circ: "EFC4A4" },
  // 7 — Vinho + ocre
  { primary: "6D2E46", accent: "C08552", ink: "2A1620", grey: "7A6B70", cardbg: "F4F0F1", tint: "EFE3E8", chartTint: "EFE3E8", bodyColor: "4A3540", circ: "C99DAE" },
  // 8 — Navy + dourado
  { primary: "22364F", accent: "C9A24B", ink: "121C2A", grey: "6E7681", cardbg: "EFF1F4", tint: "E2E7EE", chartTint: "E2E7EE", bodyColor: "33414F", circ: "AEBBCB" },
  // 9 — Borgonha + pêssego
  { primary: "7B2D3A", accent: "D08C6A", ink: "2A1218", grey: "7C6E71", cardbg: "F5F0F0", tint: "F0E1E2", chartTint: "F0E1E2", bodyColor: "4A3339", circ: "D9A9A0" },
  // 10 — Berinjela + sálvia
  { primary: "4A3A5A", accent: "8FA37E", ink: "1F1826", grey: "736E78", cardbg: "F2F1F4", tint: "E7E3EC", chartTint: "E7E3EC", bodyColor: "3E3646", circ: "B8A9C7" },
  // 11 — Teal profundo + coral
  { primary: "1F6E6A", accent: "E07856", ink: "122A28", grey: "6B7674", cardbg: "EEF3F2", tint: "DCEBE9", chartTint: "DCEBE9", bodyColor: "2E4442", circ: "9CCFC8" },
  // 12 — Ardósia + argila-rosé
  { primary: "3A4750", accent: "C57B67", ink: "1B2126", grey: "727A80", cardbg: "F1F2F3", tint: "E4E8EA", chartTint: "E4E8EA", bodyColor: "39434A", circ: "B7A39B" },
];

/**
 * Paleta da coleção na posição `index` do relatório. Distintas até
 * `PALETTES.length` (12); depois repete uma vez cada, ciclicamente.
 */
export function paletteForIndex(index: number): CollectionPalette {
  const n = PALETTES.length;
  const i = ((index % n) + n) % n;
  return PALETTES[i];
}
