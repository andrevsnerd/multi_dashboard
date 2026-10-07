/**
 * Snapshot dos KPIs de um ajuste de estoque (zerar / inventário), gravado na hora
 * em que o ajuste é executado.
 *
 * O Linx só guarda as linhas COM diferença (ESTOQUE_PROD_CTG_AJUSTE): saldo antes,
 * saldo final e quantos itens estavam no escopo se perdem depois. Este snapshot
 * guarda o que a tela de "Calcular diferenças" mostrou, para rever os quadros ao
 * abrir um ajuste recente. Chave = NOME_CONTAGEM (PK no Linx).
 *
 * Neon (Postgres) quando há DATABASE_URL; senão data/ajuste-estoque-kpis.json.
 */

import fs from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";

export interface AjusteKpisSnapshot {
  nomeContagem: string;
  filialNome: string;
  modo: "zerar" | "inventario";
  /** Itens no escopo (com e sem diferença). */
  itens: number;
  /** Soma dos saldos finais após o ajuste (= soma das contagens). */
  saldoFinalTotal: number;
  itensSaldoNegativo: number;
  naoEncontrados: number;
  ambiguos: number;
  invalidas: number;
  criadoEm: string;
}

const DATA_FILE = path.join(process.cwd(), "data", "ajuste-estoque-kpis.json");

function readFile(): AjusteKpisSnapshot[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeFile(records: AjusteKpisSnapshot[]) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), "utf-8");
}

// Promessa memoizada: dois requests paralelos não disputam o CREATE TABLE
// (e a corrida entre processos — 23505/42P07 — é tolerada).
let tablePromise: Promise<void> | null = null;

function ensureTable(sql: ReturnType<typeof getNeonSql>): Promise<void> {
  if (!tablePromise) {
    tablePromise = (async () => {
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS ajuste_estoque_kpis (
            nome_contagem TEXT PRIMARY KEY,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `;
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code !== "23505" && code !== "42P07") throw err;
      }
    })().catch((err) => {
      tablePromise = null;
      throw err;
    });
  }
  return tablePromise;
}

function chave(nome: string): string {
  return (nome || "").trim().toUpperCase();
}

export async function salvarKpisAjuste(snapshot: AjusteKpisSnapshot): Promise<void> {
  const nome = chave(snapshot.nomeContagem);
  if (!nome) return;
  const registro = { ...snapshot, nomeContagem: nome };

  if (!hasPostgres()) {
    const records = readFile().filter((r) => chave(r.nomeContagem) !== nome);
    records.push(registro);
    writeFile(records);
    return;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  await sql`
    INSERT INTO ajuste_estoque_kpis (nome_contagem, payload, created_at)
    VALUES (${nome}, ${JSON.stringify(registro)}::jsonb, NOW())
    ON CONFLICT (nome_contagem) DO UPDATE SET
      payload = EXCLUDED.payload,
      created_at = NOW()
  `;
}

export async function obterKpisAjuste(nomeContagem: string): Promise<AjusteKpisSnapshot | null> {
  const nome = chave(nomeContagem);
  if (!nome) return null;

  if (!hasPostgres()) {
    return readFile().find((r) => chave(r.nomeContagem) === nome) ?? null;
  }

  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = await sql`
    SELECT payload FROM ajuste_estoque_kpis WHERE nome_contagem = ${nome} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const payload = rows[0].payload;
  return (typeof payload === "string" ? JSON.parse(payload) : payload) as AjusteKpisSnapshot;
}
