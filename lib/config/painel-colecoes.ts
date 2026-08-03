/**
 * Coleções do PAINEL DE COLEÇÕES (SCARFME) — fonte única.
 *
 * Vivia dentro de `app/api/painel-colecoes/route.ts`. Foi extraída para cá porque
 * o Gerador de Apresentações passou a oferecer o preset "Coleções do Painel", que
 * precisa exatamente da MESMA lista. Editar aqui muda os dois lugares de uma vez.
 *
 * É um módulo de dados puro (sem `server-only`), então pode ser importado tanto
 * pela rota quanto por componente client.
 */
export interface PainelColecaoConfig {
  key: string;
  /**
   * Rótulo fixo — usado para agregados de vários códigos (Galisteu), que não têm
   * correspondência 1:1 na tabela COLECOES, ou para sobrescrever visualmente o
   * nome de uma coleção de 1 código (ex.: Pantanal). Quando ausente numa coleção
   * de 1 código, o nome vem do banco (COLECOES.DESC_COLECAO).
   */
  customLabel?: string;
  /** Códigos de COLECAO que compõem a coleção (agregado = múltiplos). */
  codes: string[];
  subtitle?: string;
}

// Ordem fixa e intencional: "Coleções Galisteu" (agregado) SEMPRE em primeiro.
export const PAINEL_COLECOES: PainelColecaoConfig[] = [
  {
    key: "galisteu",
    customLabel: "Coleções Galisteu",
    codes: ["T6", "Y3", "U5"],
    subtitle: "Adriane Galisteu 24 (T6) + Copa 26 (Y3) + Carnaval (U5)",
  },
  { key: "isabela", codes: ["X7"] },
  { key: "astrid", codes: ["X15"] },
  { key: "tarsila", codes: ["U7"] },
  { key: "portinari", codes: ["X10"] },
  { key: "toy", codes: ["Q6"] },
  { key: "brasilidade", codes: ["P8"] },
  { key: "origem", codes: ["O8"] },
  { key: "seaside", codes: ["Y4"] },
  { key: "suelen", codes: ["Y7"] },
  { key: "pantanal", customLabel: "PANTANAL (CAIMAN)", codes: ["V9"] },
];

/** Todos os códigos do painel, achatados e sem repetição (ordem do painel). */
export const PAINEL_COLECAO_CODES: string[] = Array.from(
  new Set(PAINEL_COLECOES.flatMap((c) => c.codes.map((code) => code.trim().toUpperCase())))
);
