import { FILIAIS, type FilialDef } from '@/lib/config/filial-registry';

/**
 * Rótulo curto de filial para leitura rápida: `NÚMERO - APELIDO (SIGLA)`.
 *
 *   "MSC COMERCIO DE LENCOS LT"  → "111 - HIGIENÓPOLIS (MSC)"
 *   "FFFR COMERCIO DE LENCOS L"  → "110 - OSCAR FREIRE (FFFR)"
 *   "GUARULHOS - RSR"            → "79 - GUARULHOS (RSR)"
 *   "SCARF ME - MATRIZ LLL"      → "83 - E-COMMERCE (LLL)"
 *
 * O apelido (registry) diz QUAL loja é; o número e a sigla dizem QUAL CNPJ — importante
 * em grupo multi-CNPJ (troca de 19/11/2026, rodízio do e-commerce). Só exibição: nunca
 * use o resultado para casar filial ou montar SQL. Nome fora do registry volta como veio.
 */

/** Palavras do nome do Linx que não identificam o CNPJ (marca, razão social, UF). */
const PALAVRAS_GENERICAS = new Set([
  'SCARF', 'ME', 'SCARFME', 'NERD', 'COMERCIO', 'DE', 'LENCOS', 'LT', 'L', 'LTDA', 'SP', 'RJ',
]);

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function palavras(s: string): string[] {
  return normalizar(s).split(/[^A-Z0-9]+/).filter(Boolean);
}

const POR_NOME = new Map<string, FilialDef>(FILIAIS.map((f) => [normalizar(f.dbNameFallback), f]));

export function filialLabelCurta(nomeFilial: string | null | undefined): string {
  const bruto = (nomeFilial ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const def = POR_NOME.get(normalizar(bruto));
  if (!def) return bruto;

  const numero = String(Number.parseInt(def.id, 10) || def.id);
  const doApelido = new Set(palavras(def.display));
  const ehMatriz = doApelido.has('MATRIZ');
  const sigla = palavras(bruto).filter(
    (p) =>
      !doApelido.has(p) &&
      !PALAVRAS_GENERICAS.has(p) &&
      !(p === 'MATRIZ' && !ehMatriz) &&
      !/^\d+$/.test(p) // "HIGIENOPOLIS 2": o número da filial já diferencia
  );

  return sigla.length > 0 ? `${numero} - ${def.display} (${sigla.join(' ')})` : `${numero} - ${def.display}`;
}
