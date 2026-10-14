/**
 * Normalização dos textos gravados (colunas `*_fmt` de financeiro_registros).
 *
 * - renormalizar: recalcula a forma normalizada de cada valor DISTINTO e grava só o
 *   que mudou. Roda depois de cada importação e de cada regra aprovada/removida.
 * - sugestoes: candidatos a unificação que NÃO são aplicados sozinhos — palavra rara a
 *   uma letra de uma palavra frequente, ou valor de loja/classificação/coleção a 1–2
 *   letras de outro. Similaridade erra ("bolha"/"folha", "gabriel"/"gabriela"), por
 *   isso só vira regra quando alguém aprova na tela. Rejeitar também fica gravado,
 *   para a sugestão não voltar a cada upload.
 */

import {
  type CampoNormalizado,
  type Dicionario,
  type RegraNormalizacao,
  CAMPOS_NORMALIZADOS,
  chaveTexto,
  normalizarTexto,
  regrasEmbutidas,
} from "./normalizacao";
import { carregarDicionario, carregarRegras, ensureTables, sqlOuErro } from "./store";

const LOTE_UPDATE = 4000;

export async function renormalizar(empresa: string, dic?: Dicionario): Promise<Record<string, number>> {
  await ensureTables();
  const sql = sqlOuErro();
  const d = dic ?? (await carregarDicionario(empresa));
  const alterados: Record<string, number> = {};

  for (const campo of CAMPOS_NORMALIZADOS) {
    const rows = await sql.query(
      `SELECT ${campo} AS v, ${campo}_fmt AS f FROM financeiro_registros
       WHERE empresa = $1 AND ${campo} IS NOT NULL GROUP BY 1, 2`,
      [empresa]
    );
    const mudar = new Map<string, string | null>();
    for (const r of rows as { v: string; f: string | null }[]) {
      const n = normalizarTexto(r.v, campo, d);
      if (n !== r.f) mudar.set(r.v, n);
    }
    const lista = [...mudar.entries()].map(([v, n]) => ({ v, n }));
    let total = 0;
    for (let i = 0; i < lista.length; i += LOTE_UPDATE) {
      const lote = lista.slice(i, i + LOTE_UPDATE);
      const res = await sql.query(
        `WITH m AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS m(v text, n text))
         UPDATE financeiro_registros r SET ${campo}_fmt = m.n
         FROM m WHERE r.empresa = $1 AND r.${campo} = m.v AND r.${campo}_fmt IS DISTINCT FROM m.n
         RETURNING 1`,
        [empresa, JSON.stringify(lote)]
      );
      total += (res as unknown[]).length;
    }
    alterados[campo] = total;
  }
  return alterados;
}

/* ------------------------------------------------------------- resumo */

export interface ResumoCampo {
  campo: CampoNormalizado;
  grafias: number;
  valores: number;
  registros: number;
  registrosAjustados: number;
}

export async function resumoNormalizacao(empresa: string): Promise<ResumoCampo[]> {
  await ensureTables();
  const sql = sqlOuErro();
  return Promise.all(
    CAMPOS_NORMALIZADOS.map(async (campo) => {
      const r = (await sql.query(
        `SELECT count(DISTINCT ${campo})::int AS grafias,
                count(DISTINCT COALESCE(${campo}_fmt, ${campo}))::int AS valores,
                count(*)::int AS registros,
                count(*) FILTER (WHERE ${campo}_fmt IS DISTINCT FROM ${campo})::int AS ajustados
         FROM financeiro_registros WHERE empresa = $1 AND ${campo} IS NOT NULL`,
        [empresa]
      )) as Record<string, number>[];
      return {
        campo,
        grafias: Number(r[0].grafias),
        valores: Number(r[0].valores),
        registros: Number(r[0].registros),
        registrosAjustados: Number(r[0].ajustados),
      };
    })
  );
}

/* --------------------------------------------------------- unificações */

export interface GrupoUnificado {
  valor: string;
  total: number;
  variantes: { v: string; n: number }[];
}

/** Valores normalizados que juntaram mais de uma grafia (ou só mudaram de forma). */
export async function unificacoes(
  empresa: string,
  campo: CampoNormalizado,
  opts: { q?: string; soVarias: boolean; limite: number }
): Promise<GrupoUnificado[]> {
  await ensureTables();
  const sql = sqlOuErro();
  const params: unknown[] = [empresa];
  let filtro = "";
  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim()}%`);
    filtro = `AND (${campo} ILIKE $2 OR ${campo}_fmt ILIKE $2)`;
  }
  const rows = (await sql.query(
    `WITH g AS (
       SELECT COALESCE(${campo}_fmt, ${campo}) AS f, ${campo} AS v, count(*)::int AS n
       FROM financeiro_registros WHERE empresa = $1 AND ${campo} IS NOT NULL ${filtro}
       GROUP BY 1, 2
     )
     SELECT f, sum(n)::int AS total, count(*)::int AS grafias,
            json_agg(json_build_object('v', v, 'n', n) ORDER BY n DESC) AS variantes
     FROM g GROUP BY f
     HAVING ${opts.soVarias ? "count(*) > 1" : "count(*) > 1 OR bool_or(v <> f)"}
     ORDER BY count(*) DESC, sum(n) DESC
     LIMIT ${opts.limite}`,
    params
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    valor: String(r.f),
    total: Number(r.total),
    variantes: (r.variantes as { v: string; n: number }[]).slice(0, 12),
  }));
}

/* ------------------------------------------------------------ sugestões */

/** Damerau-Levenshtein (OSA) com corte: devolve > limite assim que passa dele. */
function distancia(a: string, b: string, limite: number): number {
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < menor) menor = v;
    }
    if (menor > limite) return limite + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

const digitos = (s: string) => s.replace(/\D/g, "");

const MESES = new Set(
  (
    "jan fev mar abr mai jun jul ago set out nov dez janeiro fevereiro marco abril maio junho julho agosto " +
    "setembro outubro novembro dezembro"
  ).split(" ")
);

/** "transporte"/"transportes" não é erro de digitação: é plural. */
function ehPlural(a: string, b: string): boolean {
  const [c, l] = a.length < b.length ? [a, b] : [b, a];
  return l === `${c}s` || l === `${c}es`;
}

/**
 * Dois valores que diferem num mês ("Entrada Fev/19" × "Entrada Dez/19") ou num código
 * em maiúsculas ("Oscar Freire - RSR" × "Oscar Freire - FSZ") são coisas diferentes.
 */
function diferencaSignificativa(a: string, b: string): boolean {
  const tokens = (s: string) => s.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) ?? [];
  const ka = new Set(tokens(a).map(chaveTexto));
  const kb = new Set(tokens(b).map(chaveTexto));
  const diff = [...tokens(a), ...tokens(b)].filter((t) => !(ka.has(chaveTexto(t)) && kb.has(chaveTexto(t))));
  return diff.some((t) => MESES.has(chaveTexto(t)) || (t.length >= 2 && t.length <= 5 && t === t.toUpperCase()));
}

export interface SugestaoPalavra {
  de: string;
  ocorrencias: number;
  para: string;
  ocorrenciasPara: number;
  exemplos: string[];
}

export interface SugestaoValor {
  campo: CampoNormalizado;
  de: string;
  ocorrencias: number;
  para: string;
  ocorrenciasPara: number;
}

export async function sugestoes(empresa: string): Promise<{ palavras: SugestaoPalavra[]; valores: SugestaoValor[] }> {
  await ensureTables();
  const sql = sqlOuErro();
  const regras = await carregarRegras(empresa);
  const jaDecididas = new Set(
    [...regras, ...regrasEmbutidas()].map((r) => `${r.tipo}|${r.campo ?? ""}|${chaveTexto(r.de)}`)
  );

  /* palavras das descrições */
  const descs = (await sql.query(
    `SELECT COALESCE(descricao_fmt, descricao) AS d, count(*)::int AS n FROM financeiro_registros
     WHERE empresa = $1 AND tipo NOT IN ('dre', 'grade') AND descricao IS NOT NULL GROUP BY 1`,
    [empresa]
  )) as { d: string; n: number }[];
  const freq = new Map<string, number>();
  const exemplos = new Map<string, string[]>();
  const grafia = new Map<string, string>();
  for (const { d, n } of descs) {
    for (const p of d.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) ?? []) {
      const k = chaveTexto(p);
      freq.set(k, (freq.get(k) ?? 0) + n);
      if (!grafia.has(k)) grafia.set(k, p.toLocaleLowerCase("pt-BR"));
      const ex = exemplos.get(k) ?? [];
      if (ex.length < 3 && !ex.includes(d)) ex.push(d);
      exemplos.set(k, ex);
    }
  }
  const frequentes = [...freq.entries()].filter(([, f]) => f >= 10);
  const porTamanho = new Map<number, [string, number][]>();
  for (const e of frequentes) {
    const l = e[0].length;
    porTamanho.set(l, [...(porTamanho.get(l) ?? []), e]);
  }
  const palavras: SugestaoPalavra[] = [];
  for (const [k, f] of freq) {
    if (f > 3 || k.length < 5 || jaDecididas.has(`palavra||${k}`)) continue;
    let melhor: [string, number] | null = null;
    for (const l of [k.length - 1, k.length, k.length + 1]) {
      for (const [o, fo] of porTamanho.get(l) ?? []) {
        if (o === k || fo < Math.max(10, 8 * f) || ehPlural(k, o) || MESES.has(k) || MESES.has(o)) continue;
        if (distancia(k, o, 1) === 1 && (!melhor || fo > melhor[1])) melhor = [o, fo];
      }
    }
    if (melhor) {
      palavras.push({
        de: grafia.get(k) ?? k,
        ocorrencias: f,
        para: grafia.get(melhor[0]) ?? melhor[0],
        ocorrenciasPara: melhor[1],
        exemplos: exemplos.get(k) ?? [],
      });
    }
  }
  palavras.sort((a, b) => b.ocorrenciasPara - a.ocorrenciasPara);

  /* valores inteiros (loja, classificação, coleção) */
  const valores: SugestaoValor[] = [];
  for (const campo of ["loja", "classificacao", "colecao"] as CampoNormalizado[]) {
    const rows = (await sql.query(
      `SELECT COALESCE(${campo}_fmt, ${campo}) AS v, count(*)::int AS n FROM financeiro_registros
       WHERE empresa = $1 AND tipo NOT IN ('dre', 'grade') AND ${campo} IS NOT NULL GROUP BY 1`,
      [empresa]
    )) as { v: string; n: number }[];
    const itens = rows
      .map((r) => ({ v: r.v, n: r.n, k: chaveTexto(r.v) }))
      .filter((r) => r.k.length >= 4 && /[a-z]/.test(r.k));
    for (const a of itens) {
      if (jaDecididas.has(`valor|${campo}|${a.k}`)) continue;
      let melhor: (typeof itens)[number] | null = null;
      for (const b of itens) {
        if (b.k === a.k || b.n <= a.n || digitos(a.k) !== digitos(b.k)) continue;
        if (diferencaSignificativa(a.v, b.v)) continue;
        const lim = Math.min(a.k.length, b.k.length) >= 8 ? 2 : 1;
        if (distancia(a.k, b.k, lim) <= lim && (!melhor || b.n > melhor.n)) melhor = b;
      }
      if (melhor) valores.push({ campo, de: a.v, ocorrencias: a.n, para: melhor.v, ocorrenciasPara: melhor.n });
    }
  }
  valores.sort((a, b) => b.ocorrenciasPara - a.ocorrenciasPara);

  return { palavras: palavras.slice(0, 200), valores: valores.slice(0, 200) };
}

/* -------------------------------------------------------------- regras */

export async function salvarRegra(
  empresa: string,
  regra: RegraNormalizacao & { status: "aprovada" | "rejeitada" },
  usuario: string
) {
  await ensureTables();
  const sql = sqlOuErro();
  const de = chaveTexto(regra.de);
  if (!de || !regra.para.trim()) throw new Error("Regra incompleta.");
  if (regra.tipo === "valor" && !regra.campo) throw new Error("Informe o campo da regra.");
  await sql`
    INSERT INTO financeiro_normalizacao (empresa, tipo, campo, de, para, status, criado_por)
    VALUES (${empresa}, ${regra.tipo}, ${regra.tipo === "valor" ? regra.campo : null}, ${de},
            ${regra.para.trim()}, ${regra.status}, ${usuario})
    ON CONFLICT (empresa, tipo, COALESCE(campo, ''), de) DO UPDATE
      SET para = EXCLUDED.para, status = EXCLUDED.status, criado_por = EXCLUDED.criado_por, criado_em = NOW()`;
  return regra.status === "aprovada" ? renormalizar(empresa) : {};
}

export async function removerRegra(empresa: string, id: number) {
  await ensureTables();
  const sql = sqlOuErro();
  await sql`DELETE FROM financeiro_normalizacao WHERE empresa = ${empresa} AND id = ${id}`;
  return renormalizar(empresa);
}
