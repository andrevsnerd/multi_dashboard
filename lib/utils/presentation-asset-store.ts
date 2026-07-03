import { promises as fs } from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";

/**
 * Persistência das imagens do Gerador de Apresentações (logo da rede + capas de
 * coleção). Mesmo padrão de `report-preset-store.ts`: Postgres/Neon quando
 * `DATABASE_URL` está configurado, arquivo JSON em `data/` como fallback local.
 *
 * As imagens são guardadas como data-URL base64 (`data:image/png;base64,...`),
 * exatamente o formato que o deck consome (`<img src=...>`), embutido no HTML na
 * hora do export PDF — sem depender de arquivos locais / CDN.
 *
 * Chave: (company_key, kind, ref)
 *  - kind = "logo"  → ref = "" (um logo por empresa, global)
 *  - kind = "cover" → ref = código da coleção (uma capa por coleção)
 *
 * Upload faz UPSERT: reenviar substitui a imagem anterior.
 */

export type PresentationAssetKind = "logo" | "cover";

export interface PresentationAsset {
  companyKey: string;
  kind: PresentationAssetKind;
  ref: string;
  dataUrl: string;
  updatedAt: string;
}

const FILE_PATH = path.join(process.cwd(), "data", "presentation-assets.json");

let tableChecked = false;

function normalizeRef(ref: string | null | undefined): string {
  return (ref ?? "").trim().toUpperCase();
}

async function ensureDataFile() {
  const dir = path.join(process.cwd(), "data");
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  try {
    await fs.access(FILE_PATH);
  } catch {
    await fs.writeFile(FILE_PATH, JSON.stringify([]), "utf-8");
  }
}

async function ensureTable() {
  if (tableChecked) return;
  const sql = getNeonSql();
  await sql`
    CREATE TABLE IF NOT EXISTS presentation_assets (
      company_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL DEFAULT '',
      data_url TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_key, kind, ref)
    )
  `;
  tableChecked = true;
}

function rowToAsset(row: {
  company_key: string;
  kind: string;
  ref: string;
  data_url: string;
  updated_at: Date | string;
}): PresentationAsset {
  return {
    companyKey: row.company_key,
    kind: row.kind as PresentationAssetKind,
    ref: row.ref,
    dataUrl: row.data_url,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readFileAll(): Promise<PresentationAsset[]> {
  await ensureDataFile();
  const raw = await fs.readFile(FILE_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw) as PresentationAsset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFileAll(rows: PresentationAsset[]) {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(rows, null, 2), "utf-8");
}

/** Busca um asset específico (ou null se não existe). */
export async function getPresentationAsset(
  companyKey: string,
  kind: PresentationAssetKind,
  ref?: string | null
): Promise<PresentationAsset | null> {
  const normalizedRef = kind === "logo" ? "" : normalizeRef(ref);

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT company_key, kind, ref, data_url, updated_at
      FROM presentation_assets
      WHERE company_key = ${companyKey} AND kind = ${kind} AND ref = ${normalizedRef}
      LIMIT 1
    `;
    const row = rows[0] as Parameters<typeof rowToAsset>[0] | undefined;
    return row ? rowToAsset(row) : null;
  }

  const all = await readFileAll();
  return (
    all.find(
      (a) => a.companyKey === companyKey && a.kind === kind && a.ref === normalizedRef
    ) ?? null
  );
}

/** Insere ou substitui (upsert) um asset. */
export async function upsertPresentationAsset(input: {
  companyKey: string;
  kind: PresentationAssetKind;
  ref?: string | null;
  dataUrl: string;
}): Promise<PresentationAsset> {
  const now = new Date().toISOString();
  const asset: PresentationAsset = {
    companyKey: input.companyKey,
    kind: input.kind,
    ref: input.kind === "logo" ? "" : normalizeRef(input.ref),
    dataUrl: input.dataUrl,
    updatedAt: now,
  };

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO presentation_assets (company_key, kind, ref, data_url, updated_at)
      VALUES (${asset.companyKey}, ${asset.kind}, ${asset.ref}, ${asset.dataUrl}, ${asset.updatedAt})
      ON CONFLICT (company_key, kind, ref)
      DO UPDATE SET data_url = EXCLUDED.data_url, updated_at = EXCLUDED.updated_at
    `;
    return asset;
  }

  const all = await readFileAll();
  const idx = all.findIndex(
    (a) => a.companyKey === asset.companyKey && a.kind === asset.kind && a.ref === asset.ref
  );
  if (idx === -1) {
    all.push(asset);
  } else {
    all[idx] = asset;
  }
  await writeFileAll(all);
  return asset;
}
