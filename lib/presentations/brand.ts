/**
 * Marca exibida nos decks do Gerador de Apresentações.
 *
 * O logo é um asset POR EMPRESA (upload em `presentation_assets`, chave
 * company_key) — NERD tem o dela, ScarfMe a dela. Quando a empresa ainda não
 * subiu imagem, o deck escreve o nome da rede: ScarfMe tem grafia própria
 * (SCARF·ME, com o ponto no acento da paleta), as demais usam o próprio nome.
 *
 * Ponto único para não repetir "SCARF·ME" fixo em tela que também roda em NERD.
 */

export const SCARFME_WORDMARK = "SCARF·ME";

/** True quando a empresa é a ScarfMe (aceita "scarfme", "SCARF ME", "SCARF·ME"). */
export function isScarfmeBrand(company: string): boolean {
  return company.toLowerCase().includes("scarf");
}

/** Nome da marca para rótulos e para o wordmark de fallback do deck. */
export function presentationBrandName(company: string): string {
  const name = company.trim();
  return isScarfmeBrand(name) ? SCARFME_WORDMARK : name.toUpperCase();
}
