import { resolveCompany, VAREJO_VALUE } from "@/lib/config/company";
import { fetchSalesTotals } from "@/lib/services/salesTotals";
import type { NormalizedRange } from "@/lib/utils/date";
import type { ReceitaMesRealizado, StatusMes } from "@/lib/types/planejamento-receita";

/**
 * Realizado mensal por canal para o Planejamento de Receita.
 *
 * Não escreve SQL de venda: tudo sai de `fetchSalesTotals`, a regra canônica "com trocas"
 * (ver CLAUDE.md). Lojas = escopo VAREJO (POS sem e-commerce); Web = qualquer filial do
 * grupo e-commerce, que o filtro expande para o grupo inteiro (MSC/AKS/matrizes), então o
 * rodízio de CNPJ não perde metade do mês.
 *
 * Por mês:
 *  - fechado   → mês cheio, comparisonMode 'year' (o anterior vem junto na mesma query);
 *  - corrente  → dia 1 até hoje (o anterior nos mesmos dias) + o mês cheio do ano anterior;
 *  - futuro    → só o mês cheio do ano anterior.
 */

const BUSINESS_TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CONCORRENCIA = 3;

export interface HojeBrasil {
  ano: number;
  /** 1..12 */
  mes: number;
  dia: number;
  iso: string;
}

export function hojeBrasil(agora: Date = new Date()): HojeBrasil {
  const brt = new Date(agora.getTime() - BUSINESS_TZ_OFFSET_MS);
  const ano = brt.getUTCFullYear();
  const mes = brt.getUTCMonth() + 1;
  const dia = brt.getUTCDate();
  const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  return { ano, mes, dia, iso };
}

function statusDoMes(ano: number, mes: number, hoje: HojeBrasil): StatusMes {
  if (ano < hoje.ano || (ano === hoje.ano && mes < hoje.mes)) return "fechado";
  if (ano === hoje.ano && mes === hoje.mes) return "corrente";
  return "futuro";
}

/** Range normalizado (end exclusivo) do mês inteiro. */
function mesCheio(ano: number, mes: number): NormalizedRange {
  return {
    start: new Date(Date.UTC(ano, mes - 1, 1)),
    end: new Date(Date.UTC(ano, mes, 1)),
  };
}

interface Totais {
  lojas: number;
  web: number;
  lojasAnterior: number;
  webAnterior: number;
}

async function totaisPorCanal(
  company: string,
  range: NormalizedRange,
  comparisonMode: "month" | "year"
): Promise<Totais> {
  const ecommerceFilial = resolveCompany(company)?.ecommerceFilials?.[0] ?? null;
  const [lojas, web] = await Promise.all([
    fetchSalesTotals({ company, range, filial: VAREJO_VALUE, comparisonMode }),
    ecommerceFilial
      ? fetchSalesTotals({ company, range, filial: ecommerceFilial, comparisonMode })
      : Promise.resolve(null),
  ]);
  return {
    lojas: lojas.vendas,
    web: web?.vendas ?? 0,
    lojasAnterior: lojas.vendasPrevious,
    webAnterior: web?.vendasPrevious ?? 0,
  };
}

async function calcularMes(
  company: string,
  ano: number,
  mes: number,
  hoje: HojeBrasil
): Promise<ReceitaMesRealizado> {
  const status = statusDoMes(ano, mes, hoje);
  const aaStatus = statusDoMes(ano - 1, mes, hoje);
  const base: ReceitaMesRealizado = {
    mes,
    status,
    lojas: 0,
    web: 0,
    aaLojas: 0,
    aaWeb: 0,
    aaStatus,
    aaLojasMesmosDias: null,
    aaWebMesmosDias: null,
  };

  if (status === "fechado") {
    const t = await totaisPorCanal(company, mesCheio(ano, mes), "year");
    return { ...base, lojas: t.lojas, web: t.web, aaLojas: t.lojasAnterior, aaWeb: t.webAnterior };
  }

  if (status === "corrente") {
    const ateHoje: NormalizedRange = {
      start: new Date(Date.UTC(ano, mes - 1, 1)),
      end: new Date(Date.UTC(ano, mes - 1, hoje.dia + 1)),
    };
    const [parcial, aaCheio] = await Promise.all([
      totaisPorCanal(company, ateHoje, "year"),
      totaisPorCanal(company, mesCheio(ano - 1, mes), "month"),
    ]);
    return {
      ...base,
      lojas: parcial.lojas,
      web: parcial.web,
      aaLojas: aaCheio.lojas,
      aaWeb: aaCheio.web,
      aaLojasMesmosDias: parcial.lojasAnterior,
      aaWebMesmosDias: parcial.webAnterior,
    };
  }

  // Futuro: o próprio mês ainda não tem venda; só o ano anterior interessa.
  if (aaStatus === "futuro") return base;
  const aa = await totaisPorCanal(company, mesCheio(ano - 1, mes), "month");
  return { ...base, aaLojas: aa.lojas, aaWeb: aa.web };
}

async function emLotes<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultado: R[] = new Array(itens.length);
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultado[i] = await fn(itens[i]);
    }
  });
  await Promise.all(trabalhadores);
  return resultado;
}

const cache = new Map<string, { em: number; meses: ReceitaMesRealizado[] }>();

/**
 * Venda é dado do Linx, não digitado: um cache curto só evita refazer 24+ consultas
 * quando alguém alterna o ano ou o canal. `fresh` ignora o cache.
 */
export async function fetchReceitaRealizadaMensal(
  company: string,
  ano: number,
  opts: { fresh?: boolean } = {}
): Promise<{ meses: ReceitaMesRealizado[]; hoje: HojeBrasil; consultadoEm: Date }> {
  const hoje = hojeBrasil();
  const chave = `${company}|${ano}|${hoje.iso}`;
  const guardado = cache.get(chave);
  if (!opts.fresh && guardado && Date.now() - guardado.em < CACHE_TTL_MS) {
    return { meses: guardado.meses, hoje, consultadoEm: new Date(guardado.em) };
  }

  const meses = await emLotes(
    Array.from({ length: 12 }, (_, i) => i + 1),
    CONCORRENCIA,
    (mes) => calcularMes(company, ano, mes, hoje)
  );
  const em = Date.now();
  cache.set(chave, { em, meses });
  return { meses, hoje, consultadoEm: new Date(em) };
}
