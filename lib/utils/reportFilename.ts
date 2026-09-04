/**
 * Nome dos arquivos exportados pelo Gerador de Relatórios (e pelos exports que
 * compartilham o mesmo núcleo, como a Compra Ideal por Loja da Curva ABC).
 *
 * Regra: nome CURTO e legível — o que é o relatório, o filtro que importa e o período
 * escrito como a gente fala, nunca duas datas completas:
 *
 *   mês inteiro ............. `set`            (ano só aparece se não for o ano corrente: `set25`)
 *   ano inteiro ............. `2025`
 *   meses inteiros seguidos . `jan_mar`
 *   um dia .................. `17set`
 *   período no mesmo mês .... `17_25_set`
 *   período entre meses ..... `28ago_03set` / `17dez25_05jan`
 *
 * O nome final sai como `base[-hint][-filial]-empresa-periodo.xlsx`, tudo minúsculo e
 * sem acento. Filial "todas" some do nome (sem filial = rede inteira).
 */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Minúsculo, sem acento, só letras/números separados por hífen. Quando passa do limite,
 * corta na última palavra inteira — nome cortado no meio da palavra ("mochila-executi")
 * fica pior que um nome mais curto.
 */
export function slugFilenamePart(value: string, maxLen = 32): string {
  const slug = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= maxLen) return slug;
  const cortado = slug.slice(0, maxLen);
  const ultimoHifen = cortado.lastIndexOf("-");
  return (ultimoHifen > 0 ? cortado.slice(0, ultimoHifen) : cortado).replace(/-+$/g, "");
}

/**
 * Filial pro nome do arquivo: devolve "" quando é a rede inteira (sem filial no nome já
 * quer dizer "todas") e enxuga o que é ruído — o prefixo da bandeira e o nome da empresa,
 * que aparecem quando o rótulo cai no nome cru do ERP:
 *   "todas-filiais"              → ""
 *   "GALEÃO RJ"                  → `galeao-rj`
 *   "SCARFME LLL -  GALEAO RJ"   → `galeao-rj`   (companyKey "scarfme")
 */
export function slugFilialPart(label?: string | null, companyKey?: string): string {
  if (!label) return "";
  const bruto = slugFilenamePart(label, 60);
  if (!bruto || bruto === "todas" || bruto.startsWith("todas-")) return "";

  // Tira o prefixo da bandeira ("LLL - ", "RSR - ") e, na sequência, os pedaços do nome da
  // empresa ("scarf", "me" em "scarfme") que sobram no começo do nome vindo do ERP.
  const semPrefixo = label.replace(/\s+[A-Za-z0-9]{2,6}\s*-\s*/, " ").replace(/^[A-Za-z0-9]{2,6}\s*-\s*/, "");
  const empresa = companyKey ? slugFilenamePart(companyKey, 20).replace(/-/g, "") : "";
  const tokens = slugFilenamePart(semPrefixo, 60).split("-").filter(Boolean);
  // Casa palavra a palavra ("scarf" + "me" = "scarfme"), nunca por substring — senão o "e"
  // de "e-commerce" bateria com o "e" de "scarfme" e o nome viraria "commerce".
  let prefixo = "";
  while (tokens.length > 1 && empresa) {
    const proximo = prefixo + tokens[0]!;
    if (!empresa.startsWith(proximo)) break;
    prefixo = proximo;
    tokens.shift();
  }

  return slugFilenamePart(tokens.join("-"), 24);
}

function isPrimeiroDia(d: Date): boolean {
  return d.getDate() === 1;
}

function isUltimoDia(d: Date): boolean {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();
}

/** `set` no ano corrente, `set25` nos outros — o ano só entra quando é ambíguo. */
function mesToken(d: Date, anoAtual: number): string {
  const mes = MESES[d.getMonth()];
  return d.getFullYear() === anoAtual ? mes : `${mes}${String(d.getFullYear()).slice(2)}`;
}

/** Período em formato curto. Ver a tabela no topo do arquivo. */
export function formatPeriodoArquivo(start: Date, end: Date, hoje: Date = new Date()): string {
  const anoAtual = hoje.getFullYear();
  const mesmoAno = start.getFullYear() === end.getFullYear();
  const mesmoMes = mesmoAno && start.getMonth() === end.getMonth();
  const dia = (d: Date) => String(d.getDate()).padStart(2, "0");

  // Mês, meses ou ano fechados: só o nome, sem dia nenhum.
  if (isPrimeiroDia(start) && isUltimoDia(end) && mesmoAno) {
    if (start.getMonth() === 0 && end.getMonth() === 11) return String(start.getFullYear());
    if (mesmoMes) return mesToken(start, anoAtual);
    return `${MESES[start.getMonth()]}_${mesToken(end, anoAtual)}`;
  }

  if (mesmoMes && start.getDate() === end.getDate()) return `${dia(start)}${mesToken(start, anoAtual)}`;
  if (mesmoMes) return `${dia(start)}_${dia(end)}_${mesToken(start, anoAtual)}`;
  return `${dia(start)}${mesToken(start, anoAtual)}_${dia(end)}${mesToken(end, anoAtual)}`;
}

/** Uma data só (ex.: a data-base da Projeção de vendas): `04set`. */
export function formatDataArquivo(d: Date, hoje: Date = new Date()): string {
  return `${String(d.getDate()).padStart(2, "0")}${mesToken(d, hoje.getFullYear())}`;
}

export interface ReportFilenameParts {
  /** Slug curto do relatório (ex.: "vendas", "compra-sugerida"). */
  base: string;
  companyKey: string;
  /** Filtro que vale a pena no nome (fornecedor, grupo, produto…). */
  hint?: string | null;
  filialLabel?: string | null;
  range?: { startDate: Date; endDate: Date } | null;
  /** Usado quando a análise não tem período (ex.: projeção a partir de hoje). */
  data?: Date | null;
  ext?: string;
}

/** Monta `base[-hint][-filial]-empresa-periodo.ext`, pulando o que estiver vazio. */
export function buildReportFilename(parts: ReportFilenameParts): string {
  const periodo = parts.range
    ? formatPeriodoArquivo(parts.range.startDate, parts.range.endDate)
    : parts.data
      ? formatDataArquivo(parts.data)
      : "";
  const pedacos = [
    // Base um pouco mais folgada: no export de compra o filtro já vem embutido nela
    // (ex.: "compra-sugerida-volt").
    slugFilenamePart(parts.base, 40),
    parts.hint ? slugFilenamePart(parts.hint, 28) : "",
    slugFilialPart(parts.filialLabel, parts.companyKey),
    slugFilenamePart(parts.companyKey, 12),
    periodo,
  ].filter(Boolean);
  return `${pedacos.join("-")}.${parts.ext ?? "xlsx"}`;
}
