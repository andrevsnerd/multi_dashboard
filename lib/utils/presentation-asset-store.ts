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
 *
 * `sourceRef` = PROCEDÊNCIA da capa, e existe só por causa dos agregados do
 * Painel de Coleções (ex.: "Coleções Galisteu" = T6+Y3+U5). Subir a foto no card
 * do agregado a espalha para os códigos membros para eles não ficarem sem imagem
 * no Gerador — mas isso NÃO é um vínculo fixo: é só um preenchimento.
 *  - sourceRef = null  → capa PRÓPRIA daquele código (alguém subiu direto nela).
 *  - sourceRef = "X"   → veio espalhada do agregado X; pode ser atualizada por ele.
 * Subir uma foto direto num código zera o sourceRef → aquele código descola do
 * agregado e passa a mudar só por upload próprio.
 */

export type PresentationAssetKind = "logo" | "cover";

export interface PresentationAsset {
  companyKey: string;
  kind: PresentationAssetKind;
  ref: string;
  dataUrl: string;
  updatedAt: string;
  /** null = capa própria; preenchido = herdada do agregado de mesmo nome. */
  sourceRef: string | null;
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
  // Linhas antigas ficam com source_ref NULL = capa própria, que é o correto:
  // foram enviadas uma a uma antes de existir espalhamento por agregado.
  await sql`ALTER TABLE presentation_assets ADD COLUMN IF NOT EXISTS source_ref TEXT`;
  tableChecked = true;
}

function rowToAsset(row: {
  company_key: string;
  kind: string;
  ref: string;
  data_url: string;
  updated_at: Date | string;
  source_ref?: string | null;
}): PresentationAsset {
  return {
    companyKey: row.company_key,
    kind: row.kind as PresentationAssetKind,
    ref: row.ref,
    dataUrl: row.data_url,
    updatedAt: new Date(row.updated_at).toISOString(),
    sourceRef: row.source_ref ?? null,
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
      SELECT company_key, kind, ref, data_url, updated_at, source_ref
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

/**
 * Refs das capas já enviadas de uma empresa (só os códigos, sem a imagem).
 *
 * Serve ao Gerador quando o deck NÃO é de uma coleção específica (ex.: Top
 * Produtos): a página lista as capas disponíveis, sorteia uma como padrão e
 * deixa o usuário escolher outra — sem baixar todos os base64.
 */
export async function listPresentationCoverRefs(companyKey: string): Promise<string[]> {
  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT ref
      FROM presentation_assets
      WHERE company_key = ${companyKey} AND kind = 'cover' AND ref <> ''
      ORDER BY ref
    `;
    return (rows as Array<{ ref: string }>).map((r) => r.ref);
  }

  const all = await readFileAll();
  return all
    .filter((a) => a.companyKey === companyKey && a.kind === "cover" && a.ref)
    .map((a) => a.ref)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Insere ou substitui (upsert) um asset.
 *
 * `sourceRef` omitido = capa própria (null). Passe o ref do agregado só quando a
 * imagem está sendo ESPALHADA por ele — assim dá para saber depois quem herdou.
 */
export async function upsertPresentationAsset(input: {
  companyKey: string;
  kind: PresentationAssetKind;
  ref?: string | null;
  dataUrl: string;
  sourceRef?: string | null;
}): Promise<PresentationAsset> {
  const now = new Date().toISOString();
  const asset: PresentationAsset = {
    companyKey: input.companyKey,
    kind: input.kind,
    ref: input.kind === "logo" ? "" : normalizeRef(input.ref),
    dataUrl: input.dataUrl,
    updatedAt: now,
    sourceRef: normalizeRef(input.sourceRef) || null,
  };

  if (hasPostgres()) {
    await ensureTable();
    const sql = getNeonSql();
    await sql`
      INSERT INTO presentation_assets (company_key, kind, ref, data_url, updated_at, source_ref)
      VALUES (${asset.companyKey}, ${asset.kind}, ${asset.ref}, ${asset.dataUrl}, ${asset.updatedAt}, ${asset.sourceRef})
      ON CONFLICT (company_key, kind, ref)
      DO UPDATE SET data_url = EXCLUDED.data_url,
                    updated_at = EXCLUDED.updated_at,
                    source_ref = EXCLUDED.source_ref
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

export interface SpreadCoverResult {
  /** Códigos que receberam a imagem. */
  applied: string[];
  /** Códigos pulados porque têm capa própria (upload direto neles). */
  skipped: string[];
}

/**
 * Espalha a capa de um agregado (ex.: "GALISTEU") para os códigos que o compõem
 * (T6, Y3, U5), para eles não ficarem sem imagem no Gerador de Apresentações.
 *
 * NÃO cria vínculo permanente — é só preenchimento:
 *  - código SEM capa            → recebe (marcado como herdado de `sourceRef`).
 *  - código com capa HERDADA    → é atualizado (o agregado ainda manda nele).
 *  - código com capa PRÓPRIA    → é PULADO; quem subiu foto direto nele mandou,
 *                                 e trocar a foto do agregado não desfaz isso.
 */
export async function spreadCoverToCodes(input: {
  companyKey: string;
  sourceRef: string;
  codes: string[];
  dataUrl: string;
}): Promise<SpreadCoverResult> {
  const sourceRef = normalizeRef(input.sourceRef);
  const codes = Array.from(
    new Set(input.codes.map(normalizeRef).filter((c) => c && c !== sourceRef))
  );

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const code of codes) {
    const existing = await getPresentationAsset(input.companyKey, "cover", code);
    if (existing && existing.sourceRef !== sourceRef) {
      skipped.push(code);
      continue;
    }
    await upsertPresentationAsset({
      companyKey: input.companyKey,
      kind: "cover",
      ref: code,
      dataUrl: input.dataUrl,
      sourceRef,
    });
    applied.push(code);
  }

  return { applied, skipped };
}
