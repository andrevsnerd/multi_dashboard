/**
 * Controle Financeiro — persistência no Neon.
 *
 * Tabelas:
 *  - financeiro_registros          → o dado vigente (uma linha por registro da planilha)
 *  - financeiro_abas               → metadado de cada aba (colunas, cabeçalho, layout da DRE)
 *  - financeiro_importacoes        → cada arquivo enviado (status, resumo da comparação)
 *  - financeiro_registros_staging  → o arquivo novo enquanto é enviado/comparado
 *  - financeiro_import_match       → resultado da comparação staging × vigente
 *  - financeiro_alteracoes         → histórico: antes/depois de cada registro que mudou
 *
 * Fluxo de importação: criar → lotes (staging) → analisar (compara, não grava) →
 * aplicar (recompara e grava tudo numa transação). A planilha é a fonte: registro que
 * sumiu do arquivo sai do vigente (fica no histórico como "removido"). Aba que não
 * veio no arquivo não é tocada.
 *
 * Comparação: dentro de cada aba, casa primeiro registros idênticos (mesma base e
 * mesmo hash), depois pareia o que sobrou pela base, na ordem das linhas — o par é
 * "alterado". Sobra do arquivo novo = "novo"; sobra do vigente = "removido".
 *
 * Exige Postgres: são ~185 mil linhas, não há fallback em data/*.json.
 */

import { getNeonSql, hasPostgres } from "@/lib/db/neon";

import {
  type AbaMeta,
  type Campo,
  type RegistroFin,
  CAMPOS_DATA,
  CAMPOS_TEXTO,
} from "./planilha";

export class FinanceiroSemBancoError extends Error {
  constructor() {
    super("O Controle Financeiro exige o banco Neon (DATABASE_URL).");
  }
}

function sqlOuErro() {
  if (!hasPostgres()) throw new FinanceiroSemBancoError();
  return getNeonSql();
}

/* -------------------------------------------------------------- DDL */

let tableChecked = false;
let ensurePromise: Promise<void> | null = null;

function objetoJaExiste(erro: unknown) {
  const code = (erro as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710";
}

async function ddl(exec: () => Promise<unknown>) {
  try {
    await exec();
  } catch (erro) {
    if (!objetoJaExiste(erro)) throw erro;
  }
}

/** Colunas tipadas, na ordem em que aparecem no INSERT/UPDATE. */
const COLS_TIPADAS: Campo[] = [...CAMPOS_DATA, "valor", ...CAMPOS_TEXTO];

const DDL_TIPADAS = COLS_TIPADAS.map((c) =>
  (CAMPOS_DATA as readonly string[]).includes(c) ? `${c} DATE` : c === "valor" ? `${c} NUMERIC` : `${c} TEXT`
).join(",\n  ");

export async function ensureTables(): Promise<void> {
  if (tableChecked) return;
  if (!ensurePromise) {
    ensurePromise = runMigrations()
      .then(() => {
        tableChecked = true;
      })
      .catch((erro) => {
        ensurePromise = null;
        throw erro;
      });
  }
  return ensurePromise;
}

async function runMigrations(): Promise<void> {
  const sql = sqlOuErro();
  await ddl(() =>
    sql.query(`
      CREATE TABLE IF NOT EXISTS financeiro_importacoes (
        id BIGSERIAL PRIMARY KEY,
        empresa TEXT NOT NULL,
        arquivo TEXT NOT NULL,
        tamanho BIGINT,
        status TEXT NOT NULL DEFAULT 'enviando',
        total_esperado INT NOT NULL DEFAULT 0,
        abas JSONB NOT NULL DEFAULT '[]'::jsonb,
        resumo JSONB,
        enviado_por TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        analisado_em TIMESTAMPTZ,
        aplicado_por TEXT,
        aplicado_em TIMESTAMPTZ
      )`)
  );
  await ddl(() =>
    sql.query(`CREATE INDEX IF NOT EXISTS financeiro_importacoes_empresa_idx ON financeiro_importacoes (empresa, criado_em DESC)`)
  );
  await ddl(() =>
    sql.query(`
      CREATE TABLE IF NOT EXISTS financeiro_registros (
        id BIGSERIAL PRIMARY KEY,
        empresa TEXT NOT NULL,
        aba TEXT NOT NULL,
        tipo TEXT NOT NULL,
        base TEXT NOT NULL,
        hash TEXT NOT NULL,
        linha INT NOT NULL,
        ${DDL_TIPADAS},
        extras JSONB NOT NULL DEFAULT '{}'::jsonb,
        criado_importacao BIGINT,
        atualizado_importacao BIGINT,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`)
  );
  await ddl(() =>
    sql.query(`CREATE INDEX IF NOT EXISTS financeiro_registros_aba_idx ON financeiro_registros (empresa, aba, linha)`)
  );
  await ddl(() =>
    sql.query(`CREATE INDEX IF NOT EXISTS financeiro_registros_base_idx ON financeiro_registros (empresa, aba, base)`)
  );
  await ddl(() =>
    sql.query(
      `CREATE INDEX IF NOT EXISTS financeiro_registros_classif_idx
         ON financeiro_registros (empresa, tipo, lower(btrim(classificacao)), mes_competencia)`
    )
  );
  await ddl(() =>
    sql.query(
      `CREATE INDEX IF NOT EXISTS financeiro_registros_comp_idx ON financeiro_registros (empresa, tipo, data_competencia)`
    )
  );
  await ddl(() =>
    sql.query(`
      CREATE TABLE IF NOT EXISTS financeiro_registros_staging (
        id BIGSERIAL PRIMARY KEY,
        importacao_id BIGINT NOT NULL,
        aba TEXT NOT NULL,
        tipo TEXT NOT NULL,
        base TEXT NOT NULL,
        hash TEXT NOT NULL,
        linha INT NOT NULL,
        ${DDL_TIPADAS},
        extras JSONB NOT NULL DEFAULT '{}'::jsonb
      )`)
  );
  await ddl(() =>
    sql.query(
      `CREATE INDEX IF NOT EXISTS financeiro_staging_imp_idx ON financeiro_registros_staging (importacao_id, aba, base)`
    )
  );
  await ddl(() =>
    sql.query(`
      CREATE TABLE IF NOT EXISTS financeiro_import_match (
        importacao_id BIGINT NOT NULL,
        aba TEXT NOT NULL,
        acao TEXT NOT NULL,
        registro_id BIGINT,
        staging_id BIGINT
      )`)
  );
  await ddl(() =>
    sql.query(`CREATE INDEX IF NOT EXISTS financeiro_match_imp_idx ON financeiro_import_match (importacao_id, acao)`)
  );
  await ddl(() =>
    sql.query(
      `CREATE INDEX IF NOT EXISTS financeiro_match_reg_idx ON financeiro_import_match (importacao_id, registro_id)`
    )
  );
  await ddl(() =>
    sql.query(
      `CREATE INDEX IF NOT EXISTS financeiro_match_stg_idx ON financeiro_import_match (importacao_id, staging_id)`
    )
  );
  await ddl(() =>
    sql.query(`
      CREATE TABLE IF NOT EXISTS financeiro_alteracoes (
        id BIGSERIAL PRIMARY KEY,
        importacao_id BIGINT NOT NULL,
        empresa TEXT NOT NULL,
        aba TEXT NOT NULL,
        acao TEXT NOT NULL,
        base TEXT NOT NULL,
        linha INT,
        antes JSONB,
        depois JSONB
      )`)
  );
  await ddl(() =>
    sql.query(
      `CREATE INDEX IF NOT EXISTS financeiro_alteracoes_imp_idx ON financeiro_alteracoes (importacao_id, aba, acao)`
    )
  );
  await ddl(() =>
    sql.query(`
      CREATE TABLE IF NOT EXISTS financeiro_abas (
        empresa TEXT NOT NULL,
        aba TEXT NOT NULL,
        tipo TEXT NOT NULL,
        ordem INT NOT NULL DEFAULT 0,
        oculta BOOLEAN NOT NULL DEFAULT false,
        titulo TEXT,
        data_referencia DATE,
        linha_cabecalho INT,
        colunas JSONB NOT NULL DEFAULT '[]'::jsonb,
        preambulo JSONB NOT NULL DEFAULT '[]'::jsonb,
        layout JSONB,
        total_registros INT NOT NULL DEFAULT 0,
        ignoradas INT NOT NULL DEFAULT 0,
        presente_ultima BOOLEAN NOT NULL DEFAULT true,
        importacao_id BIGINT,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (empresa, aba)
      )`)
  );
}

/* ------------------------------------------------------- tipos públicos */

export type AcaoAlteracao = "novo" | "alterado" | "removido";

export interface ResumoAba {
  aba: string;
  tipo: string;
  noArquivo: number;
  vigentes: number;
  iguais: number;
  novos: number;
  alterados: number;
  removidos: number;
}

export interface ExemploAlteracao {
  aba: string;
  linha: number | null;
  base: string;
  campos: { campo: string; antes: unknown; depois: unknown }[];
}

export interface ResumoImportacao {
  cargaInicial: boolean;
  abas: ResumoAba[];
  /** Abas que existem no banco mas não vieram no arquivo — ficam como estão. */
  ausentes: string[];
  exemplos: ExemploAlteracao[];
  totais: { novos: number; alterados: number; removidos: number; iguais: number; noArquivo: number };
}

export interface ImportacaoInfo {
  id: number;
  arquivo: string;
  tamanho: number | null;
  status: string;
  totalEsperado: number;
  enviadoPor: string | null;
  criadoEm: string;
  analisadoEm: string | null;
  aplicadoPor: string | null;
  aplicadoEm: string | null;
  resumo: ResumoImportacao | null;
}

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const dia = (v: unknown) => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const num = (v: unknown) => (v == null ? null : Number(v));

function rowToImportacao(r: Record<string, unknown>): ImportacaoInfo {
  return {
    id: Number(r.id),
    arquivo: String(r.arquivo),
    tamanho: num(r.tamanho),
    status: String(r.status),
    totalEsperado: Number(r.total_esperado ?? 0),
    enviadoPor: (r.enviado_por as string) ?? null,
    criadoEm: iso(r.criado_em)!,
    analisadoEm: iso(r.analisado_em),
    aplicadoPor: (r.aplicado_por as string) ?? null,
    aplicadoEm: iso(r.aplicado_em),
    resumo: (r.resumo as ResumoImportacao) ?? null,
  };
}

/* --------------------------------------------------------- importação */

export async function criarImportacao(input: {
  empresa: string;
  arquivo: string;
  tamanho: number | null;
  usuario: string;
  abas: AbaMeta[];
  totalEsperado: number;
}): Promise<number> {
  await ensureTables();
  const sql = sqlOuErro();
  // Envio abandonado (aba fechada no meio) não pode deixar staging órfão crescendo.
  const velhas = await sql`
    UPDATE financeiro_importacoes SET status = 'descartada'
    WHERE empresa = ${input.empresa} AND status IN ('enviando', 'analisada')
      AND criado_em < NOW() - INTERVAL '6 hours'
    RETURNING id`;
  for (const v of velhas) await limparStaging(Number(v.id));

  const rows = await sql`
    INSERT INTO financeiro_importacoes (empresa, arquivo, tamanho, total_esperado, abas, enviado_por)
    VALUES (${input.empresa}, ${input.arquivo}, ${input.tamanho}, ${input.totalEsperado},
            ${JSON.stringify(input.abas)}::jsonb, ${input.usuario})
    RETURNING id`;
  return Number(rows[0].id);
}

async function limparStaging(id: number) {
  const sql = sqlOuErro();
  await sql`DELETE FROM financeiro_registros_staging WHERE importacao_id = ${id}`;
  await sql`DELETE FROM financeiro_import_match WHERE importacao_id = ${id}`;
  await liberarEspacoStaging();
}

/**
 * DELETE não devolve espaço: cada envio deixa ~180 MB mortos em staging + match.
 * Sem nenhuma importação em andamento, TRUNCATE zera as duas tabelas de verdade.
 */
async function liberarEspacoStaging() {
  const sql = sqlOuErro();
  const ativas = await sql`SELECT count(*)::int AS n FROM financeiro_importacoes
                           WHERE status IN ('enviando', 'analisada')`;
  if (Number(ativas[0].n) === 0) {
    await sql`TRUNCATE financeiro_registros_staging, financeiro_import_match`;
  }
}

export async function obterImportacao(empresa: string, id: number): Promise<ImportacaoInfo | null> {
  await ensureTables();
  const sql = sqlOuErro();
  const rows = await sql`SELECT * FROM financeiro_importacoes WHERE id = ${id} AND empresa = ${empresa}`;
  return rows[0] ? rowToImportacao(rows[0] as Record<string, unknown>) : null;
}

const SELECT_TIPADAS_JSON = COLS_TIPADAS.map((c) =>
  c === "valor"
    ? `NULLIF(r.c->>'valor', '')::numeric`
    : (CAMPOS_DATA as readonly string[]).includes(c)
      ? `NULLIF(r.c->>'${c}', '')::date`
      : `r.c->>'${c}'`
).join(", ");

export async function inserirLote(empresa: string, id: number, registros: RegistroFin[]): Promise<number> {
  await ensureTables();
  const sql = sqlOuErro();
  const imp = await sql`SELECT status FROM financeiro_importacoes WHERE id = ${id} AND empresa = ${empresa}`;
  if (!imp[0]) throw new Error("Importação não encontrada.");
  if (imp[0].status !== "enviando") throw new Error("Esta importação não está mais recebendo dados.");

  const payload = JSON.stringify(
    registros.map((r) => ({ aba: r.aba, tipo: r.tipo, base: r.base, linha: r.linha, c: r.c ?? {}, x: r.x ?? {} }))
  );
  await sql.query(
    `INSERT INTO financeiro_registros_staging
       (importacao_id, aba, tipo, base, hash, linha, ${COLS_TIPADAS.join(", ")}, extras)
     SELECT $1, r.aba, r.tipo, r.base, md5(r.c::text || '|' || r.x::text), r.linha, ${SELECT_TIPADAS_JSON}, r.x
     FROM jsonb_to_recordset($2::jsonb) AS r(aba text, tipo text, base text, linha int, c jsonb, x jsonb)`,
    [id, payload]
  );
  return registros.length;
}

/** Compara o staging com o vigente e grava o pareamento em financeiro_import_match. */
async function calcularPareamento(empresa: string, id: number, abasArquivo: string[]) {
  const sql = sqlOuErro();
  await sql`DELETE FROM financeiro_import_match WHERE importacao_id = ${id}`;
  // Em etapas, cada uma anti-join indexado contra o que já foi pareado. Numa query só
  // (CTEs + NOT EXISTS) o planner caía em anti-join quadrático e passava de 5 minutos.
  const semPar = (alias: string, col: "registro_id" | "staging_id") =>
    `NOT EXISTS (SELECT 1 FROM financeiro_import_match m
                 WHERE m.importacao_id = $2 AND m.${col} = ${alias}.id)`;

  // Staging e match acabaram de receber ~185 mil linhas: sem ANALYZE o planner acha as
  // tabelas vazias e escolhe nested loop (cada etapa passa de 5 minutos em vez de <1s).
  await sql.query(`ANALYZE financeiro_registros_staging`);

  // 1) idênticos (mesma base e mesmo conteúdo); "movido" = só mudou de linha.
  await sql.query(
    `INSERT INTO financeiro_import_match (importacao_id, aba, acao, registro_id, staging_id)
     SELECT $2, o.aba, CASE WHEN o.linha = n.linha THEN 'igual' ELSE 'movido' END, o.id, n.id
     FROM (SELECT id, aba, base, hash, linha,
                  row_number() OVER (PARTITION BY aba, base, hash ORDER BY linha, id) AS rn
           FROM financeiro_registros WHERE empresa = $1 AND aba = ANY($3::text[])) o
     JOIN (SELECT id, aba, base, hash, linha,
                  row_number() OVER (PARTITION BY aba, base, hash ORDER BY linha, id) AS rn
           FROM financeiro_registros_staging WHERE importacao_id = $2) n
       ON o.aba = n.aba AND o.base = n.base AND o.hash = n.hash AND o.rn = n.rn`,
    [empresa, id, abasArquivo]
  );
  await sql.query(`ANALYZE financeiro_import_match`);
  // 2) mesma identidade, conteúdo diferente → alterado (pareia na ordem das linhas).
  await sql.query(
    `INSERT INTO financeiro_import_match (importacao_id, aba, acao, registro_id, staging_id)
     SELECT $2, o.aba, 'alterado', o.id, n.id
     FROM (SELECT r.id, r.aba, r.base, row_number() OVER (PARTITION BY r.aba, r.base ORDER BY r.linha, r.id) AS rn
           FROM financeiro_registros r
           WHERE r.empresa = $1 AND r.aba = ANY($3::text[]) AND ${semPar("r", "registro_id")}) o
     JOIN (SELECT s.id, s.aba, s.base, row_number() OVER (PARTITION BY s.aba, s.base ORDER BY s.linha, s.id) AS rn
           FROM financeiro_registros_staging s
           WHERE s.importacao_id = $2 AND ${semPar("s", "staging_id")}) n
       ON o.aba = n.aba AND o.base = n.base AND o.rn = n.rn`,
    [empresa, id, abasArquivo]
  );
  // 3) sobra do arquivo = novo; 4) sobra do vigente (nas abas do arquivo) = removido.
  await sql.query(
    `INSERT INTO financeiro_import_match (importacao_id, aba, acao, registro_id, staging_id)
     SELECT $1, s.aba, 'novo', NULL, s.id FROM financeiro_registros_staging s
     WHERE s.importacao_id = $1 AND ${semPar("s", "staging_id").replace("$2", "$1")}`,
    [id]
  );
  await sql.query(
    `INSERT INTO financeiro_import_match (importacao_id, aba, acao, registro_id, staging_id)
     SELECT $2, r.aba, 'removido', r.id, NULL FROM financeiro_registros r
     WHERE r.empresa = $1 AND r.aba = ANY($3::text[]) AND ${semPar("r", "registro_id")}`,
    [empresa, id, abasArquivo]
  );
}

/** Snapshot JSON de um registro (alias `t`) para o histórico e a pré-visualização. */
const SNAP = (t: string) =>
  `jsonb_build_object(${COLS_TIPADAS.map((c) => `'${c}', ${t}.${c}`).join(", ")}, 'extras', ${t}.extras)`;

function diferencas(antes: Record<string, unknown>, depois: Record<string, unknown>) {
  const out: ExemploAlteracao["campos"] = [];
  const norm = (v: unknown) => (v == null || v === "" ? null : typeof v === "number" ? v : String(v));
  for (const c of COLS_TIPADAS) {
    const a = norm(antes[c]);
    const d = norm(depois[c]);
    if (c === "valor" ? Number(a ?? NaN) !== Number(d ?? NaN) && !(a == null && d == null) : a !== d) {
      out.push({ campo: c, antes: a, depois: d });
    }
  }
  const ea = (antes.extras ?? {}) as Record<string, unknown>;
  const ed = (depois.extras ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ea), ...Object.keys(ed)])) {
    if (JSON.stringify(ea[k] ?? null) !== JSON.stringify(ed[k] ?? null)) {
      out.push({ campo: k, antes: ea[k] ?? null, depois: ed[k] ?? null });
    }
  }
  return out;
}

async function montarResumo(empresa: string, id: number, abasArquivo: AbaMeta[]): Promise<ResumoImportacao> {
  const sql = sqlOuErro();
  const [acoes, noArquivo, vigentes, exemplos] = await Promise.all([
    sql`SELECT aba, acao, count(*)::int AS n FROM financeiro_import_match
        WHERE importacao_id = ${id} GROUP BY aba, acao`,
    sql`SELECT aba, count(*)::int AS n FROM financeiro_registros_staging
        WHERE importacao_id = ${id} GROUP BY aba`,
    sql`SELECT aba, count(*)::int AS n FROM financeiro_registros WHERE empresa = ${empresa} GROUP BY aba`,
    sql.query(
      `SELECT * FROM (
         SELECT m.aba, s.linha, s.base, ${SNAP("r")} AS antes, ${SNAP("s")} AS depois,
                row_number() OVER (PARTITION BY m.aba ORDER BY s.linha) AS rn
         FROM financeiro_import_match m
         JOIN financeiro_registros r ON r.id = m.registro_id
         JOIN financeiro_registros_staging s ON s.id = m.staging_id
         WHERE m.importacao_id = $1 AND m.acao = 'alterado'
       ) q WHERE rn <= 6 ORDER BY aba, linha`,
      [id]
    ),
  ]);

  const mapa = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [String(r.aba), Number(r.n)]));
  const arq = mapa(noArquivo as Record<string, unknown>[]);
  const vig = mapa(vigentes as Record<string, unknown>[]);
  const cont = new Map<string, Record<string, number>>();
  for (const r of acoes as Record<string, unknown>[]) {
    const m = cont.get(String(r.aba)) ?? {};
    m[String(r.acao)] = Number(r.n);
    cont.set(String(r.aba), m);
  }

  const abas: ResumoAba[] = abasArquivo.map((a) => {
    const c = cont.get(a.aba) ?? {};
    const novos = c.novo ?? 0;
    const alterados = c.alterado ?? 0;
    const total = arq.get(a.aba) ?? 0;
    return {
      aba: a.aba,
      tipo: a.tipo,
      noArquivo: total,
      vigentes: vig.get(a.aba) ?? 0,
      iguais: total - novos - alterados,
      novos,
      alterados,
      removidos: c.removido ?? 0,
    };
  });
  const nomes = new Set(abasArquivo.map((a) => a.aba));
  const totalVigente = [...vig.values()].reduce((s, v) => s + v, 0);

  return {
    cargaInicial: totalVigente === 0,
    abas,
    ausentes: [...vig.keys()].filter((a) => !nomes.has(a)),
    exemplos: (exemplos as Record<string, unknown>[]).map((e) => ({
      aba: String(e.aba),
      linha: num(e.linha),
      base: String(e.base),
      campos: diferencas(e.antes as Record<string, unknown>, e.depois as Record<string, unknown>),
    })),
    totais: abas.reduce(
      (t, a) => ({
        novos: t.novos + a.novos,
        alterados: t.alterados + a.alterados,
        removidos: t.removidos + a.removidos,
        iguais: t.iguais + a.iguais,
        noArquivo: t.noArquivo + a.noArquivo,
      }),
      { novos: 0, alterados: 0, removidos: 0, iguais: 0, noArquivo: 0 }
    ),
  };
}

async function carregarParaComparar(empresa: string, id: number) {
  const sql = sqlOuErro();
  const rows = await sql`SELECT status, abas, total_esperado FROM financeiro_importacoes
                         WHERE id = ${id} AND empresa = ${empresa}`;
  if (!rows[0]) throw new Error("Importação não encontrada.");
  const abas = rows[0].abas as AbaMeta[];
  const recebidos = await sql`SELECT count(*)::int AS n FROM financeiro_registros_staging WHERE importacao_id = ${id}`;
  if (Number(recebidos[0].n) !== Number(rows[0].total_esperado)) {
    throw new Error(
      `Envio incompleto: ${recebidos[0].n} de ${rows[0].total_esperado} registros chegaram. Envie o arquivo de novo.`
    );
  }
  return { status: String(rows[0].status), abas };
}

export async function analisarImportacao(empresa: string, id: number): Promise<ResumoImportacao> {
  await ensureTables();
  const sql = sqlOuErro();
  const { status, abas } = await carregarParaComparar(empresa, id);
  if (status !== "enviando" && status !== "analisada") throw new Error(`Importação já ${status}.`);

  await calcularPareamento(empresa, id, abas.map((a) => a.aba));
  const resumo = await montarResumo(empresa, id, abas);
  await sql`UPDATE financeiro_importacoes
            SET status = 'analisada', resumo = ${JSON.stringify(resumo)}::jsonb, analisado_em = NOW()
            WHERE id = ${id}`;
  return resumo;
}

export async function aplicarImportacao(empresa: string, id: number, usuario: string): Promise<ResumoImportacao> {
  await ensureTables();
  const sql = sqlOuErro();
  const { status, abas } = await carregarParaComparar(empresa, id);
  if (status !== "analisada") throw new Error("Analise a importação antes de aplicar.");

  // Recompara na hora de gravar: se outra importação entrou depois da análise, o
  // pareamento antigo estaria velho.
  await calcularPareamento(empresa, id, abas.map((a) => a.aba));
  const resumo = await montarResumo(empresa, id, abas);
  const nomes = abas.map((a) => a.aba);
  const cols = COLS_TIPADAS.join(", ");
  const setCols = COLS_TIPADAS.map((c) => `${c} = s.${c}`).join(", ");

  await sql.transaction([
    sql.query(
      `INSERT INTO financeiro_alteracoes (importacao_id, empresa, aba, acao, base, linha, antes, depois)
       SELECT m.importacao_id, $2, m.aba, m.acao, COALESCE(s.base, r.base), COALESCE(s.linha, r.linha),
              CASE WHEN r.id IS NULL THEN NULL ELSE ${SNAP("r")} END,
              CASE WHEN s.id IS NULL THEN NULL ELSE ${SNAP("s")} END
       FROM financeiro_import_match m
       LEFT JOIN financeiro_registros r ON r.id = m.registro_id
       LEFT JOIN financeiro_registros_staging s ON s.id = m.staging_id
       WHERE m.importacao_id = $1
         AND (m.acao IN ('alterado', 'removido') OR (m.acao = 'novo' AND NOT $3::boolean))`,
      [id, empresa, resumo.cargaInicial]
    ),
    sql.query(
      `UPDATE financeiro_registros t
       SET tipo = s.tipo, base = s.base, hash = s.hash, linha = s.linha, ${setCols},
           extras = s.extras, atualizado_importacao = $1, atualizado_em = NOW()
       FROM (
         SELECT m.registro_id, st.* FROM financeiro_import_match m
         JOIN financeiro_registros_staging st ON st.id = m.staging_id
         WHERE m.importacao_id = $1 AND m.acao IN ('alterado', 'movido')
       ) s
       WHERE t.id = s.registro_id`,
      [id]
    ),
    sql.query(
      `DELETE FROM financeiro_registros t USING financeiro_import_match m
       WHERE m.importacao_id = $1 AND m.acao = 'removido' AND t.id = m.registro_id`,
      [id]
    ),
    sql.query(
      `INSERT INTO financeiro_registros
         (empresa, aba, tipo, base, hash, linha, ${cols}, extras, criado_importacao, atualizado_importacao)
       SELECT $2, s.aba, s.tipo, s.base, s.hash, s.linha, ${COLS_TIPADAS.map((c) => `s.${c}`).join(", ")}, s.extras, $1, $1
       FROM financeiro_import_match m
       JOIN financeiro_registros_staging s ON s.id = m.staging_id
       WHERE m.importacao_id = $1 AND m.acao = 'novo'`,
      [id, empresa]
    ),
    sql.query(
      `INSERT INTO financeiro_abas
         (empresa, aba, tipo, ordem, oculta, titulo, data_referencia, linha_cabecalho, colunas, preambulo,
          layout, total_registros, ignoradas, presente_ultima, importacao_id, atualizado_em)
       SELECT $2, a.aba, a.tipo, a.ordem, a.oculta, a.titulo, NULLIF(a."dataReferencia", '')::date,
              a."linhaCabecalho", COALESCE(a.colunas, '[]'::jsonb), COALESCE(a.preambulo, '[]'::jsonb),
              a.layout, a."totalRegistros", a.ignoradas, true, $1, NOW()
       FROM jsonb_to_recordset((SELECT abas FROM financeiro_importacoes WHERE id = $1)) AS a(
         aba text, tipo text, ordem int, oculta boolean, titulo text, "dataReferencia" text,
         "linhaCabecalho" int, colunas jsonb, preambulo jsonb, layout jsonb, "totalRegistros" int, ignoradas int)
       ON CONFLICT (empresa, aba) DO UPDATE SET
         tipo = EXCLUDED.tipo, ordem = EXCLUDED.ordem, oculta = EXCLUDED.oculta, titulo = EXCLUDED.titulo,
         data_referencia = EXCLUDED.data_referencia, linha_cabecalho = EXCLUDED.linha_cabecalho,
         colunas = EXCLUDED.colunas, preambulo = EXCLUDED.preambulo, layout = EXCLUDED.layout,
         total_registros = EXCLUDED.total_registros, ignoradas = EXCLUDED.ignoradas,
         presente_ultima = true, importacao_id = EXCLUDED.importacao_id, atualizado_em = NOW()`,
      [id, empresa]
    ),
    sql.query(
      `UPDATE financeiro_abas SET presente_ultima = false WHERE empresa = $1 AND NOT (aba = ANY($2::text[]))`,
      [empresa, nomes]
    ),
    sql.query(
      `UPDATE financeiro_importacoes
       SET status = 'aplicada', resumo = $2::jsonb, aplicado_por = $3, aplicado_em = NOW()
       WHERE id = $1`,
      [id, JSON.stringify(resumo), usuario]
    ),
    sql.query(`DELETE FROM financeiro_registros_staging WHERE importacao_id = $1`, [id]),
    sql.query(`DELETE FROM financeiro_import_match WHERE importacao_id = $1`, [id]),
  ]);
  await liberarEspacoStaging();
  return resumo;
}

export async function descartarImportacao(empresa: string, id: number): Promise<void> {
  await ensureTables();
  const sql = sqlOuErro();
  const rows = await sql`
    UPDATE financeiro_importacoes SET status = 'descartada'
    WHERE id = ${id} AND empresa = ${empresa} AND status IN ('enviando', 'analisada')
    RETURNING id`;
  if (rows[0]) await limparStaging(id);
}

export async function listarImportacoes(empresa: string, limite = 50): Promise<ImportacaoInfo[]> {
  await ensureTables();
  const sql = sqlOuErro();
  const rows = await sql`SELECT * FROM financeiro_importacoes WHERE empresa = ${empresa}
                         AND status <> 'descartada' ORDER BY criado_em DESC LIMIT ${limite}`;
  return rows.map((r) => rowToImportacao(r as Record<string, unknown>));
}

export interface AlteracaoRegistro {
  id: number;
  aba: string;
  acao: AcaoAlteracao;
  linha: number | null;
  base: string;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  campos: ExemploAlteracao["campos"];
}

export async function listarAlteracoes(
  empresa: string,
  importacaoId: number,
  filtro: { aba?: string; acao?: string; pagina: number; porPagina: number }
): Promise<{ total: number; itens: AlteracaoRegistro[] }> {
  await ensureTables();
  const sql = sqlOuErro();
  const params: unknown[] = [importacaoId, empresa];
  let where = "importacao_id = $1 AND empresa = $2";
  if (filtro.aba) {
    params.push(filtro.aba);
    where += ` AND aba = $${params.length}`;
  }
  if (filtro.acao) {
    params.push(filtro.acao);
    where += ` AND acao = $${params.length}`;
  }
  const [cnt, rows] = await Promise.all([
    sql.query(`SELECT count(*)::int AS n FROM financeiro_alteracoes WHERE ${where}`, params),
    sql.query(
      `SELECT * FROM financeiro_alteracoes WHERE ${where} ORDER BY aba, linha, id
       LIMIT ${filtro.porPagina} OFFSET ${(filtro.pagina - 1) * filtro.porPagina}`,
      params
    ),
  ]);
  return {
    total: Number((cnt as Record<string, unknown>[])[0].n),
    itens: (rows as Record<string, unknown>[]).map((r) => {
      const antes = (r.antes as Record<string, unknown>) ?? null;
      const depois = (r.depois as Record<string, unknown>) ?? null;
      return {
        id: Number(r.id),
        aba: String(r.aba),
        acao: r.acao as AcaoAlteracao,
        linha: num(r.linha),
        base: String(r.base),
        antes,
        depois,
        campos: antes && depois ? diferencas(antes, depois) : [],
      };
    }),
  };
}

/* ------------------------------------------------------------ consultas */

export interface AbaInfo {
  aba: string;
  tipo: string;
  ordem: number;
  oculta: boolean;
  titulo: string | null;
  dataReferencia: string | null;
  linhaCabecalho: number | null;
  colunas: AbaMeta["colunas"];
  preambulo: AbaMeta["preambulo"];
  totalRegistros: number;
  ignoradas: number;
  presenteUltima: boolean;
  atualizadoEm: string;
}

function rowToAba(r: Record<string, unknown>): AbaInfo {
  return {
    aba: String(r.aba),
    tipo: String(r.tipo),
    ordem: Number(r.ordem),
    oculta: !!r.oculta,
    titulo: (r.titulo as string) ?? null,
    dataReferencia: dia(r.data_referencia),
    linhaCabecalho: num(r.linha_cabecalho),
    colunas: (r.colunas as AbaMeta["colunas"]) ?? [],
    preambulo: (r.preambulo as AbaMeta["preambulo"]) ?? [],
    totalRegistros: Number(r.total_registros),
    ignoradas: Number(r.ignoradas),
    presenteUltima: !!r.presente_ultima,
    atualizadoEm: iso(r.atualizado_em)!,
  };
}

export async function obterMeta(empresa: string) {
  await ensureTables();
  const sql = sqlOuErro();
  const [abas, ultima, registros] = await Promise.all([
    sql`SELECT * FROM financeiro_abas WHERE empresa = ${empresa} ORDER BY ordem`,
    sql`SELECT * FROM financeiro_importacoes WHERE empresa = ${empresa} AND status = 'aplicada'
        ORDER BY aplicado_em DESC LIMIT 1`,
    sql`SELECT count(*)::int AS n FROM financeiro_registros WHERE empresa = ${empresa}`,
  ]);
  return {
    abas: abas.map((a) => rowToAba(a as Record<string, unknown>)),
    ultimaImportacao: ultima[0] ? rowToImportacao(ultima[0] as Record<string, unknown>) : null,
    totalRegistros: Number(registros[0].n),
  };
}

/* ---------------------------------------------------------------- DRE */

export interface DreCelula {
  linha: number;
  mes: string;
  valor: number | null;
  texto: string | null;
}

export async function obterDre(empresa: string, de: string, ate: string) {
  await ensureTables();
  const sql = sqlOuErro();
  const [aba, celulas, meses] = await Promise.all([
    sql`SELECT layout FROM financeiro_abas WHERE empresa = ${empresa} AND tipo = 'dre' ORDER BY ordem LIMIT 1`,
    sql`SELECT linha, mes_competencia, valor, extras->>'texto' AS texto FROM financeiro_registros
        WHERE empresa = ${empresa} AND tipo = 'dre' AND mes_competencia BETWEEN ${de}::date AND ${ate}::date`,
    sql`SELECT min(mes_competencia) AS min, max(mes_competencia) AS max FROM financeiro_registros
        WHERE empresa = ${empresa} AND tipo = 'dre'`,
  ]);
  return {
    layout: (aba[0]?.layout as AbaMeta["layout"]) ?? [],
    celulas: celulas.map(
      (c): DreCelula => ({
        linha: Number(c.linha),
        mes: dia(c.mes_competencia)!,
        valor: num(c.valor),
        texto: (c.texto as string) ?? null,
      })
    ),
    mesMin: dia(meses[0]?.min),
    mesMax: dia(meses[0]?.max),
  };
}

/* ---------------------------------------------------------- lançamentos */

export interface FiltroLancamentos {
  abas?: string[];
  classificacoes?: string[];
  matrizes?: string[];
  lojas?: string[];
  status?: string;
  formaPgto?: string;
  /** Data usada no período e na série mensal. */
  data: "competencia" | "caixa";
  de?: string;
  ate?: string;
  /** Mês exato de competência (drill-down da DRE). */
  mesCompetencia?: string;
  sinal?: "saida" | "entrada";
  q?: string;
  ordem?: "data_desc" | "data_asc" | "valor_asc" | "valor_desc";
  pagina: number;
  porPagina: number;
}

function whereLancamentos(empresa: string, f: FiltroLancamentos) {
  const params: unknown[] = [empresa];
  const conds = ["empresa = $1", "tipo = 'lancamento'"];
  const add = (sqlFrag: (p: string) => string, v: unknown) => {
    params.push(v);
    conds.push(sqlFrag(`$${params.length}`));
  };
  const colData = f.data === "caixa" ? "data_caixa" : "data_competencia";
  if (f.abas?.length) add((p) => `aba = ANY(${p}::text[])`, f.abas);
  if (f.classificacoes?.length)
    add((p) => `lower(btrim(classificacao)) = ANY(${p}::text[])`, f.classificacoes.map((c) => c.trim().toLowerCase()));
  if (f.matrizes?.length)
    add((p) => `upper(btrim(matriz)) = ANY(${p}::text[])`, f.matrizes.map((c) => c.trim().toUpperCase()));
  if (f.lojas?.length) add((p) => `lower(btrim(loja)) = ANY(${p}::text[])`, f.lojas.map((c) => c.trim().toLowerCase()));
  if (f.status) add((p) => `upper(btrim(status)) = ${p}`, f.status.toUpperCase());
  if (f.formaPgto) add((p) => `lower(btrim(forma_pgto)) = ${p}`, f.formaPgto.trim().toLowerCase());
  if (f.de) add((p) => `${colData} >= ${p}::date`, f.de);
  if (f.ate) add((p) => `${colData} <= ${p}::date`, f.ate);
  if (f.mesCompetencia) add((p) => `mes_competencia = ${p}::date`, f.mesCompetencia);
  if (f.sinal === "saida") conds.push("valor < 0");
  if (f.sinal === "entrada") conds.push("valor > 0");
  if (f.q?.trim()) {
    add(
      (p) =>
        `(descricao ILIKE ${p} OR loja ILIKE ${p} OR classificacao ILIKE ${p} OR colecao ILIKE ${p}
          OR conta_contabil ILIKE ${p} OR extras::text ILIKE ${p})`,
      `%${f.q.trim()}%`
    );
  }
  return { where: conds.join(" AND "), params, colData };
}

export interface LancamentoRow {
  id: number;
  aba: string;
  linha: number;
  dataCompetencia: string | null;
  dataCaixa: string | null;
  mesCompetencia: string | null;
  mesCaixa: string | null;
  valor: number | null;
  descricao: string | null;
  matriz: string | null;
  loja: string | null;
  classificacao: string | null;
  formaPgto: string | null;
  status: string | null;
  banco: string | null;
  contaContabil: string | null;
  colecao: string | null;
  extras: Record<string, unknown>;
}

export async function consultarLancamentos(empresa: string, f: FiltroLancamentos) {
  await ensureTables();
  const sql = sqlOuErro();
  const { where, params, colData } = whereLancamentos(empresa, f);
  const mesCol = colData === "data_caixa" ? "mes_caixa" : "mes_competencia";
  const ordem = {
    data_desc: `${colData} DESC NULLS LAST, id DESC`,
    data_asc: `${colData} ASC NULLS LAST, id`,
    valor_asc: "valor ASC NULLS LAST, id",
    valor_desc: "valor DESC NULLS LAST, id",
  }[f.ordem ?? "data_desc"];

  const [tot, rows, porMes, porClassif, porAba] = await Promise.all([
    sql.query(
      `SELECT count(*)::int AS n, COALESCE(sum(valor), 0) AS soma,
              COALESCE(sum(valor) FILTER (WHERE valor < 0), 0) AS saidas,
              COALESCE(sum(valor) FILTER (WHERE valor > 0), 0) AS entradas,
              COALESCE(sum(valor) FILTER (WHERE upper(btrim(status)) = 'PENDENTE'), 0) AS pendente
       FROM financeiro_registros WHERE ${where}`,
      params
    ),
    sql.query(
      `SELECT id, aba, linha, data_competencia, data_caixa, mes_competencia, mes_caixa, valor, descricao, matriz,
              loja, classificacao, forma_pgto, status, banco, conta_contabil, colecao, extras
       FROM financeiro_registros WHERE ${where} ORDER BY ${ordem}
       LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}`,
      params
    ),
    sql.query(
      `SELECT ${mesCol} AS mes, sum(valor) AS soma, count(*)::int AS n FROM financeiro_registros
       WHERE ${where} AND ${mesCol} IS NOT NULL GROUP BY 1 ORDER BY 1`,
      params
    ),
    sql.query(
      `SELECT lower(btrim(classificacao)) AS chave, mode() WITHIN GROUP (ORDER BY btrim(classificacao)) AS rotulo,
              sum(valor) AS soma, count(*)::int AS n
       FROM financeiro_registros WHERE ${where} GROUP BY 1 ORDER BY sum(valor) ASC NULLS LAST LIMIT 60`,
      params
    ),
    sql.query(
      `SELECT aba, sum(valor) AS soma, count(*)::int AS n FROM financeiro_registros
       WHERE ${where} GROUP BY aba ORDER BY sum(valor) ASC NULLS LAST`,
      params
    ),
  ]);
  const t = (tot as Record<string, unknown>[])[0];
  return {
    total: Number(t.n),
    soma: Number(t.soma),
    saidas: Number(t.saidas),
    entradas: Number(t.entradas),
    pendente: Number(t.pendente),
    itens: (rows as Record<string, unknown>[]).map(
      (r): LancamentoRow => ({
        id: Number(r.id),
        aba: String(r.aba),
        linha: Number(r.linha),
        dataCompetencia: dia(r.data_competencia),
        dataCaixa: dia(r.data_caixa),
        mesCompetencia: dia(r.mes_competencia),
        mesCaixa: dia(r.mes_caixa),
        valor: num(r.valor),
        descricao: (r.descricao as string) ?? null,
        matriz: (r.matriz as string) ?? null,
        loja: (r.loja as string) ?? null,
        classificacao: (r.classificacao as string) ?? null,
        formaPgto: (r.forma_pgto as string) ?? null,
        status: (r.status as string) ?? null,
        banco: (r.banco as string) ?? null,
        contaContabil: (r.conta_contabil as string) ?? null,
        colecao: (r.colecao as string) ?? null,
        extras: (r.extras as Record<string, unknown>) ?? {},
      })
    ),
    porMes: (porMes as Record<string, unknown>[]).map((m) => ({
      mes: dia(m.mes)!,
      soma: Number(m.soma ?? 0),
      n: Number(m.n),
    })),
    porClassificacao: (porClassif as Record<string, unknown>[]).map((m) => ({
      chave: String(m.chave ?? ""),
      rotulo: String(m.rotulo ?? "(sem classificação)"),
      soma: Number(m.soma ?? 0),
      n: Number(m.n),
    })),
    porAba: (porAba as Record<string, unknown>[]).map((m) => ({
      aba: String(m.aba),
      soma: Number(m.soma ?? 0),
      n: Number(m.n),
    })),
  };
}

export async function opcoesLancamentos(empresa: string) {
  await ensureTables();
  const sql = sqlOuErro();
  const agrupar = (col: string, normaliza: string) =>
    sql.query(
      `SELECT ${normaliza}(btrim(${col})) AS chave, mode() WITHIN GROUP (ORDER BY btrim(${col})) AS rotulo,
              count(*)::int AS n
       FROM financeiro_registros
       WHERE empresa = $1 AND tipo = 'lancamento' AND ${col} IS NOT NULL AND btrim(${col}) <> ''
       GROUP BY 1 ORDER BY 3 DESC`,
      [empresa]
    );
  const [abas, classif, matrizes, lojas, status, formas, datas] = await Promise.all([
    sql`SELECT aba, count(*)::int AS n FROM financeiro_registros
        WHERE empresa = ${empresa} AND tipo = 'lancamento' GROUP BY aba ORDER BY 2 DESC`,
    agrupar("classificacao", "lower"),
    agrupar("matriz", "upper"),
    agrupar("loja", "lower"),
    agrupar("status", "upper"),
    agrupar("forma_pgto", "lower"),
    sql`SELECT min(data_competencia) AS min, max(data_competencia) AS max FROM financeiro_registros
        WHERE empresa = ${empresa} AND tipo = 'lancamento' AND data_competencia >= '2000-01-01'`,
  ]);
  const op = (rows: unknown) =>
    (rows as Record<string, unknown>[]).map((r) => ({ chave: String(r.chave), rotulo: String(r.rotulo), n: Number(r.n) }));
  return {
    abas: abas.map((a) => ({ chave: String(a.aba), rotulo: String(a.aba), n: Number(a.n) })),
    classificacoes: op(classif),
    matrizes: op(matrizes),
    lojas: op(lojas),
    status: op(status),
    formas: op(formas),
    dataMin: dia(datas[0]?.min),
    dataMax: dia(datas[0]?.max),
  };
}

/* ------------------------------------------------- qualquer aba (grade) */

export interface FiltroAba {
  aba: string;
  q?: string;
  /** Campo de data para o período e para a série mensal. */
  campoData?: "data_caixa" | "data_competencia" | "mes_competencia";
  de?: string;
  ate?: string;
  ordem?: "linha" | "data_desc" | "data_asc";
  pagina: number;
  porPagina: number;
  /** Chaves de `extras` numéricas para somar por mês (ex.: colunas de banco). */
  somarExtras?: string[];
  serieMensal?: boolean;
}

export async function consultarAba(empresa: string, f: FiltroAba) {
  await ensureTables();
  const sql = sqlOuErro();
  const params: unknown[] = [empresa, f.aba];
  const conds = ["empresa = $1", "aba = $2"];
  const campoData = f.campoData ?? "data_caixa";
  if (f.de) {
    params.push(f.de);
    conds.push(`${campoData} >= $${params.length}::date`);
  }
  if (f.ate) {
    params.push(f.ate);
    conds.push(`${campoData} <= $${params.length}::date`);
  }
  if (f.q?.trim()) {
    params.push(`%${f.q.trim()}%`);
    const p = `$${params.length}`;
    conds.push(
      `(extras::text ILIKE ${p} OR ${CAMPOS_TEXTO.map((c) => `${c} ILIKE ${p}`).join(" OR ")})`
    );
  }
  const where = conds.join(" AND ");
  const ordem =
    f.ordem === "data_desc"
      ? `${campoData} DESC NULLS LAST, linha`
      : f.ordem === "data_asc"
        ? `${campoData} ASC NULLS LAST, linha`
        : "linha, id";

  const somas = (f.somarExtras ?? []).filter((k) => k.length < 120);
  const extrasSoma = somas
    .map((k, i) => `sum(CASE WHEN jsonb_typeof(extras->$${params.length + i + 1}) = 'number'
                     THEN (extras->>$${params.length + i + 1})::numeric END) AS e${i}`)
    .join(", ");
  const mesExpr = `date_trunc('month', ${campoData})::date`;

  const [aba, tot, rows, serie] = await Promise.all([
    sql`SELECT * FROM financeiro_abas WHERE empresa = ${empresa} AND aba = ${f.aba}`,
    sql.query(
      `SELECT count(*)::int AS n, COALESCE(sum(valor), 0) AS soma FROM financeiro_registros WHERE ${where}`,
      params
    ),
    sql.query(
      `SELECT id, linha, ${COLS_TIPADAS.join(", ")}, extras FROM financeiro_registros WHERE ${where}
       ORDER BY ${ordem} LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}`,
      params
    ),
    f.serieMensal
      ? sql.query(
          `SELECT ${mesExpr} AS mes, sum(valor) AS soma, count(*)::int AS n${extrasSoma ? `, ${extrasSoma}` : ""}
           FROM financeiro_registros WHERE ${where} AND ${campoData} IS NOT NULL GROUP BY 1 ORDER BY 1`,
          [...params, ...somas]
        )
      : Promise.resolve([]),
  ]);

  const t = (tot as Record<string, unknown>[])[0];
  return {
    aba: aba[0] ? rowToAba(aba[0] as Record<string, unknown>) : null,
    total: Number(t.n),
    soma: Number(t.soma),
    itens: (rows as Record<string, unknown>[]).map((r) => {
      const c: Record<string, unknown> = {};
      for (const col of COLS_TIPADAS) {
        const v = r[col];
        c[col] = (CAMPOS_DATA as readonly string[]).includes(col) ? dia(v) : col === "valor" ? num(v) : v ?? null;
      }
      return { id: Number(r.id), linha: Number(r.linha), c, x: (r.extras as Record<string, unknown>) ?? {} };
    }),
    serie: (serie as Record<string, unknown>[]).map((m) => ({
      mes: dia(m.mes)!,
      soma: Number(m.soma ?? 0),
      n: Number(m.n),
      extras: Object.fromEntries(somas.map((k, i) => [k, Number(m[`e${i}`] ?? 0)])),
    })),
  };
}
