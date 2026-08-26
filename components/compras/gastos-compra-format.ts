/** Formatação compartilhada pela tela de Gastos de Compra. */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = [
  "janeiro",
  "fevereiro",
  "março",
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

export function money(v: number): string {
  return (Number(v) || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function brl(v: number): string {
  return `R$ ${money(v)}`;
}

/** Rótulo curto de eixo: 250k, 1,2M. */
export function compacto(v: number): string {
  if (!v) return "0";
  if (Math.abs(v) >= 1_000_000) {
    return `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  return `${Math.round(v / 1000).toLocaleString("pt-BR")}k`;
}

/** "2026-09" → "set/26" */
export function mesCurto(ym: string): string {
  const mes = parseInt(ym.slice(5, 7), 10);
  return `${MESES[mes - 1] ?? "?"}/${ym.slice(2, 4)}`;
}

/** "2026-09" → "setembro de 2026" */
export function mesLongo(ym: string): string {
  const mes = parseInt(ym.slice(5, 7), 10);
  return `${MESES_LONGOS[mes - 1] ?? ym} de ${ym.slice(0, 4)}`;
}

/** "2026-09-15" → "15/09/26" */
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : iso;
}

/** "2026-09-15" → "15/09/2026" */
export function dataBrCompleta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

/** "2026-09-15" → "15/09" */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : iso;
}

/** Aceita "245.701,12", "245701.12" e "245701" — devolve número em reais. */
export function parseMoeda(texto: string): number {
  const limpo = String(texto ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return 0;
  const temVirgula = limpo.includes(",");
  const normalizado = temVirgula ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Hoje no fuso de Brasília, YYYY-MM-DD (a tela compara datas como string). */
export function hojeIso(): string {
  const agora = new Date();
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return brasilia.toISOString().slice(0, 10);
}

/**
 * Data (YYYY-MM-DD) no fuso de Brasília a partir de um ISO em UTC.
 * Fatiar o ISO direto erra o dia de tudo que foi salvo depois das 21h.
 * Versão de cliente — o equivalente de servidor vive em compra-gastos-import.
 */
export function dataBrasiliaDeIso(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso ?? "").slice(0, 10);
  return new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * O código da compra é derivado do título quando o usuário não digita nada, e
 * aí mostrar os dois lado a lado repete a mesma informação. Devolve `null`
 * quando não vale a pena exibir.
 */
export function codigoDistinto(codigo: string, titulo: string): string | null {
  const c = (codigo ?? "").trim();
  const t = (titulo ?? "").trim();
  if (!c || c === t || t.startsWith(c)) return null;
  return c;
}
