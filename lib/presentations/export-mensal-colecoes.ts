/**
 * Pacote mensal de coleções (ScarfMe): os decks "Relatório Completo de Coleção"
 * que o dono envia todo mês, um PDF por coleção. A ordem é a dos arquivos.
 *
 * `slug` é o nome do arquivo (`<slug>-<mês>.pdf`, ex.: isa-outubro.pdf).
 * `destaque` liga o slide extra de conjunto com esse termo (mesma regra do campo
 * "Produtos com o nome" da página) — a Isabela Capeto sai sempre com os Dracena.
 */
export interface ExportMensalColecao {
  slug: string;
  code: string;
  destaque?: string;
}

export const EXPORT_MENSAL_COLECOES: ExportMensalColecao[] = [
  { slug: "astrid", code: "X15" },
  { slug: "caiman", code: "V9" },
  { slug: "chemise", code: "X8" },
  { slug: "galisteu-carnaval", code: "U5" },
  { slug: "galisteu-copa", code: "Y3" },
  { slug: "galisteu", code: "T6" },
  { slug: "gringa", code: "K1" },
  { slug: "isa", code: "X7", destaque: "Dracena" },
  { slug: "ju-helcer", code: "X2" },
  { slug: "portinari", code: "X10" },
  { slug: "suelen", code: "Y7" },
  { slug: "tarsila", code: "U7" },
  { slug: "toy", code: "Q6" },
];

const MESES = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * Sufixo do arquivo a partir do período (AAAA-MM-DD): mês único → "outubro";
 * meses diferentes → "setembro-outubro"; anos diferentes levam o ano em cada ponta.
 */
export function exportMensalPeriodoSlug(start: string, end: string): string {
  const [ys, ms] = start.split("-").map(Number);
  const [ye, me] = end.split("-").map(Number);
  const mes = (m: number) => MESES[m - 1] ?? String(m);
  if (ys === ye && ms === me) return mes(ms);
  if (ys === ye) return `${mes(ms)}-${mes(me)}`;
  return `${mes(ms)}-${ys}-${mes(me)}-${ye}`;
}

export function exportMensalFileName(slug: string, start: string, end: string): string {
  return `${slug}-${exportMensalPeriodoSlug(start, end)}.pdf`;
}
