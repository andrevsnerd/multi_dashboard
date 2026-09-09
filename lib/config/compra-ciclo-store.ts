import "server-only";

/**
 * Persistência da configuração de CICLO DE COMPRA (cobertura × produção) e dos PRESETS.
 *
 * Arquivo JSON local em dev, tabelas Postgres em produção — mesmo padrão de
 * `etiquetas-config-store.ts` e `compra-gastos-store.ts`.
 *
 * Além de ler e gravar, este módulo é quem PUBLICA a config para o resolvedor síncrono
 * (`setCompraCicloRuntime`): `ensureCompraCicloRuntime()` carrega uma vez, memoizado com TTL
 * curto, e deixa `resolveCicloCompra` respondendo com os prazos salvos. Todo backend que
 * calcula Compra Ideal faz esse await antes do loop de itens.
 */

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import { setCompraCicloRuntime } from "@/lib/config/compra-ciclo";
import {
  CONFIG_CICLO_FABRICA,
  PRESETS_FABRICA,
  clonarConfigCiclo,
  configCicloFabrica,
  normalizarConfigCiclo,
  type CompraCicloConfig,
  type CompraCicloConfigMap,
  type CompraCicloPreset,
} from "@/lib/config/compra-ciclo-tipos";

const ARQUIVO = path.join(process.cwd(), "data", "compra-ciclo.json");

/**
 * Janela de cache do runtime. Curta de propósito: depois de salvar na tela, as outras
 * instâncias/rotas pegam o número novo em no máximo 30s sem precisar de deploy nem
 * invalidação distribuída. O `salvar*` local zera o cache na hora.
 */
const TTL_MS = 30_000;

interface ArquivoCiclo {
  configs?: Record<string, unknown>;
  presets?: unknown[];
}

let tableChecked = false;
let ensurePromise: Promise<void> | null = null;
let cacheConfigs: CompraCicloConfigMap | null = null;
let cacheEm = 0;
let cargaEmVoo: Promise<CompraCicloConfigMap> | null = null;

/* ────────────────────────────── arquivo (dev) ────────────────────────────── */

function lerArquivo(): ArquivoCiclo {
  try {
    if (!fs.existsSync(ARQUIVO)) return {};
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf-8")) as ArquivoCiclo;
  } catch {
    return {};
  }
}

function escreverArquivo(dados: ArquivoCiclo) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2), "utf-8");
}

/* ────────────────────────────── tabelas (prod) ───────────────────────────── */

/**
 * `CREATE TABLE IF NOT EXISTS` NÃO é atômico contra criação concorrente: dois pedidos
 * simultâneos disparam o DDL ao mesmo tempo e um morre com unique violation em `pg_type`
 * (23505) ou "relation already exists" (42P07). Nos dois casos o objeto passou a existir.
 */
function objetoJaExiste(erro: unknown): boolean {
  const code = (erro as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710";
}

async function ddl(exec: () => Promise<unknown>): Promise<void> {
  try {
    await exec();
  } catch (erro) {
    if (!objetoJaExiste(erro)) throw erro;
  }
}

async function ensureTable(): Promise<void> {
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
  const sql = getNeonSql();
  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS compra_ciclo_config (
      company TEXT PRIMARY KEY,
      config JSONB NOT NULL,
      atualizado_por TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await ddl(() => sql`
    CREATE TABLE IF NOT EXISTS compra_ciclo_presets (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      config JSONB NOT NULL,
      criado_por TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/* ──────────────────────────────── configs ────────────────────────────────── */

/**
 * Mapa completo empresa → config efetiva. Empresa sem nada salvo entra com a de fábrica,
 * então o mapa sempre cobre todas — quem resolve nunca precisa tratar "faltando".
 */
export async function carregarConfigsCiclo(force = false): Promise<CompraCicloConfigMap> {
  if (!force && cacheConfigs && Date.now() - cacheEm < TTL_MS) return cacheConfigs;
  if (!force && cargaEmVoo) return cargaEmVoo;

  const carga = (async () => {
    const salvas: Record<string, unknown> = {};
    try {
      if (!hasPostgres()) {
        Object.assign(salvas, lerArquivo().configs ?? {});
      } else {
        await ensureTable();
        const sql = getNeonSql();
        const rows = (await sql`SELECT company, config FROM compra_ciclo_config`) as Array<{
          company: string;
          config: unknown;
        }>;
        for (const r of rows) salvas[String(r.company)] = r.config;
      }
    } catch (erro) {
      // Config é acessório do cálculo: se a leitura falhar, seguimos com a de fábrica em vez
      // de derrubar a tela de compra inteira. O log serve pra ninguém achar que salvou e sumiu.
      console.error("[compra-ciclo] falha ao carregar config; usando a de fábrica", erro);
    }

    const map: CompraCicloConfigMap = {};
    for (const company of Object.keys(CONFIG_CICLO_FABRICA)) {
      map[company] = salvas[company]
        ? normalizarConfigCiclo(salvas[company])
        : configCicloFabrica(company);
    }
    // Empresa salva que não existe mais no código: mantém, não custa nada e evita perder dado.
    for (const company of Object.keys(salvas)) {
      if (!map[company]) map[company] = normalizarConfigCiclo(salvas[company]);
    }

    cacheConfigs = map;
    cacheEm = Date.now();
    setCompraCicloRuntime(map);
    return map;
  })();

  cargaEmVoo = carga;
  try {
    return await carga;
  } finally {
    cargaEmVoo = null;
  }
}

/**
 * Garante que `resolveCicloCompra` (síncrono) já enxerga os prazos salvos. Chame UMA vez no
 * começo de qualquer rotina de backend que calcula Compra Ideal, antes do loop por item.
 */
export async function ensureCompraCicloRuntime(): Promise<void> {
  await carregarConfigsCiclo();
}

/** Config efetiva de uma empresa (salva ou de fábrica). */
export async function carregarConfigCiclo(company: string): Promise<CompraCicloConfig> {
  const map = await carregarConfigsCiclo();
  return clonarConfigCiclo(map[company] ?? configCicloFabrica(company));
}

/** Grava a config da empresa. Vale para todos os usuários e para todas as telas de compra. */
export async function salvarConfigCiclo(
  company: string,
  bruto: unknown,
  usuario: string
): Promise<CompraCicloConfig> {
  const config = normalizarConfigCiclo(bruto);

  if (!hasPostgres()) {
    const dados = lerArquivo();
    dados.configs = { ...(dados.configs ?? {}), [company]: config };
    escreverArquivo(dados);
  } else {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO compra_ciclo_config (company, config, atualizado_por, updated_at)
      VALUES (${company}, ${JSON.stringify(config)}::jsonb, ${usuario}, NOW())
      ON CONFLICT (company)
      DO UPDATE SET config = EXCLUDED.config,
                    atualizado_por = EXCLUDED.atualizado_por,
                    updated_at = EXCLUDED.updated_at
    `;
  }

  await carregarConfigsCiclo(true);
  return config;
}

/** Volta a empresa para a config de fábrica (apaga o registro salvo). */
export async function resetarConfigCiclo(company: string): Promise<CompraCicloConfig> {
  if (!hasPostgres()) {
    const dados = lerArquivo();
    if (dados.configs) delete dados.configs[company];
    escreverArquivo(dados);
  } else {
    await ensureTable();
    const sql = getNeonSql();
    await sql`DELETE FROM compra_ciclo_config WHERE company = ${company}`;
  }

  await carregarConfigsCiclo(true);
  return configCicloFabrica(company);
}

/* ──────────────────────────────── presets ────────────────────────────────── */

function normalizarPreset(bruto: unknown): CompraCicloPreset | null {
  if (!bruto || typeof bruto !== "object") return null;
  const p = bruto as Record<string, unknown>;
  const id = String(p.id ?? "").trim();
  const nome = String(p.nome ?? "").trim();
  if (!id || !nome) return null;
  return {
    id,
    nome,
    descricao: String(p.descricao ?? "").trim(),
    builtin: false,
    config: normalizarConfigCiclo(p.config),
    criadoPor: p.criadoPor ? String(p.criadoPor) : undefined,
    createdAt: p.createdAt ? String(p.createdAt) : undefined,
  };
}

/** Presets de fábrica primeiro, depois os criados na tela (mais novos por último). */
export async function listarPresetsCiclo(): Promise<CompraCicloPreset[]> {
  let salvos: CompraCicloPreset[] = [];
  try {
    if (!hasPostgres()) {
      salvos = (lerArquivo().presets ?? [])
        .map(normalizarPreset)
        .filter((p): p is CompraCicloPreset => p !== null);
    } else {
      await ensureTable();
      const sql = getNeonSql();
      const rows = (await sql`
        SELECT id, nome, descricao, config, criado_por, created_at
        FROM compra_ciclo_presets
        ORDER BY created_at ASC
      `) as Array<Record<string, unknown>>;
      salvos = rows
        .map((r) =>
          normalizarPreset({
            id: r.id,
            nome: r.nome,
            descricao: r.descricao,
            config: r.config,
            criadoPor: r.criado_por,
            createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
          })
        )
        .filter((p): p is CompraCicloPreset => p !== null);
    }
  } catch (erro) {
    console.error("[compra-ciclo] falha ao listar presets", erro);
  }

  return [...PRESETS_FABRICA.map((p) => ({ ...p, config: clonarConfigCiclo(p.config) })), ...salvos];
}

export async function salvarPresetCiclo(input: {
  nome: string;
  descricao?: string;
  config: unknown;
  usuario: string;
}): Promise<CompraCicloPreset> {
  const nome = input.nome.trim();
  if (!nome) throw new Error("Dê um nome ao preset.");
  if (PRESETS_FABRICA.some((p) => p.nome.toLowerCase() === nome.toLowerCase())) {
    throw new Error("Já existe um preset de fábrica com esse nome.");
  }

  const preset: CompraCicloPreset = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    nome,
    descricao: (input.descricao ?? "").trim(),
    builtin: false,
    config: normalizarConfigCiclo(input.config),
    criadoPor: input.usuario,
    createdAt: new Date().toISOString(),
  };

  if (!hasPostgres()) {
    const dados = lerArquivo();
    dados.presets = [...(dados.presets ?? []), preset];
    escreverArquivo(dados);
  } else {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO compra_ciclo_presets (id, nome, descricao, config, criado_por)
      VALUES (${preset.id}, ${preset.nome}, ${preset.descricao},
              ${JSON.stringify(preset.config)}::jsonb, ${preset.criadoPor ?? null})
    `;
  }

  return preset;
}

export async function excluirPresetCiclo(id: string): Promise<void> {
  if (PRESETS_FABRICA.some((p) => p.id === id)) {
    throw new Error("Preset de fábrica não pode ser excluído.");
  }

  if (!hasPostgres()) {
    const dados = lerArquivo();
    dados.presets = (dados.presets ?? []).filter((p) => (p as { id?: string })?.id !== id);
    escreverArquivo(dados);
  } else {
    await ensureTable();
    const sql = getNeonSql();
    await sql`DELETE FROM compra_ciclo_presets WHERE id = ${id}`;
  }
}
