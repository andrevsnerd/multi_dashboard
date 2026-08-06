import 'server-only';

/**
 * Configuração da etiqueta por empresa (modelo, dimensões, fontes, impressora).
 *
 * Arquivo JSON local em dev, tabela Postgres em produção — mesmo padrão de
 * `fornecedores-store.ts`. Cada empresa guarda a sua; quem nunca salvou usa
 * `CONFIG_PADRAO`, que reproduz a etiqueta 27x15 de 3 colunas do Linx.
 */

import fs from 'fs';
import path from 'path';

import { getNeonSql, hasPostgres } from '@/lib/db/neon';
import {
  CONFIG_PADRAO,
  clonarConfig,
  normalizarConfig,
  type EtiquetaCompany,
  type EtiquetaConfig,
} from '@/lib/etiquetas/tipos';

const ARQUIVO = path.join(process.cwd(), 'data', 'etiquetas-config.json');

let tabelaChecada = false;
const cache = new Map<EtiquetaCompany, EtiquetaConfig>();

type ArquivoConfig = Partial<Record<EtiquetaCompany, unknown>>;

function lerArquivo(): ArquivoConfig {
  try {
    if (!fs.existsSync(ARQUIVO)) return {};
    return JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8')) as ArquivoConfig;
  } catch {
    return {};
  }
}

function escreverArquivo(dados: ArquivoConfig) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2), 'utf-8');
}

async function garantirTabela(sql: ReturnType<typeof getNeonSql>) {
  if (tabelaChecada) return;
  await sql`
    CREATE TABLE IF NOT EXISTS etiquetas_config (
      company TEXT PRIMARY KEY,
      config JSONB NOT NULL,
      atualizado_por TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  tabelaChecada = true;
}

/** Config salva da empresa, ou a padrão quando ainda não houve nenhuma. */
export async function carregarConfigEtiqueta(company: EtiquetaCompany): Promise<EtiquetaConfig> {
  const emCache = cache.get(company);
  if (emCache) return clonarConfig(emCache);

  let bruto: unknown = null;
  if (!hasPostgres()) {
    bruto = lerArquivo()[company] ?? null;
  } else {
    const sql = getNeonSql();
    await garantirTabela(sql);
    const rows = await sql`SELECT config FROM etiquetas_config WHERE company = ${company}`;
    bruto = rows[0]?.config ?? null;
  }

  const config = bruto ? normalizarConfig(bruto) : clonarConfig(CONFIG_PADRAO);
  cache.set(company, config);
  return clonarConfig(config);
}

export async function salvarConfigEtiqueta(
  company: EtiquetaCompany,
  bruto: unknown,
  usuario: string
): Promise<EtiquetaConfig> {
  const config = normalizarConfig(bruto);

  if (!hasPostgres()) {
    const dados = lerArquivo();
    dados[company] = config;
    escreverArquivo(dados);
  } else {
    const sql = getNeonSql();
    await garantirTabela(sql);
    await sql`
      INSERT INTO etiquetas_config (company, config, atualizado_por, updated_at)
      VALUES (${company}, ${JSON.stringify(config)}::jsonb, ${usuario}, NOW())
      ON CONFLICT (company) DO UPDATE
        SET config = EXCLUDED.config,
            atualizado_por = EXCLUDED.atualizado_por,
            updated_at = NOW()
    `;
  }

  cache.set(company, config);
  return clonarConfig(config);
}

/** Volta a empresa para a configuração padrão de fábrica. */
export async function resetarConfigEtiqueta(
  company: EtiquetaCompany,
  usuario: string
): Promise<EtiquetaConfig> {
  return salvarConfigEtiqueta(company, clonarConfig(CONFIG_PADRAO), usuario);
}
