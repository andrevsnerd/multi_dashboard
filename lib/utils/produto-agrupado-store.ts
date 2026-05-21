import "server-only";

import fs from "fs";
import path from "path";

import type { CompanyKey } from "@/lib/config/company";
import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import {
  buildProdutoAgrupadoLookup,
  buildProdutoAgrupadoProductKey,
  dedupeProdutoAgrupadoMembers,
  normalizeProdutoAgrupadoValue,
  type ProdutoAgrupadoGroup,
  type ProdutoAgrupadoMember,
} from "@/lib/utils/produtos-agrupados";

const PRODUTO_AGRUPADO_FILE = path.join(process.cwd(), "data", "produtos-agrupados.json");

let tableChecked = false;

function ensureDataDir() {
  const dir = path.dirname(PRODUTO_AGRUPADO_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readGroupsFile(): ProdutoAgrupadoGroup[] {
  ensureDataDir();

  if (!fs.existsSync(PRODUTO_AGRUPADO_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(PRODUTO_AGRUPADO_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGroupsFile(rows: ProdutoAgrupadoGroup[]) {
  ensureDataDir();
  fs.writeFileSync(PRODUTO_AGRUPADO_FILE, JSON.stringify(rows, null, 2), "utf-8");
}

function normalizeGroup(group: ProdutoAgrupadoGroup): ProdutoAgrupadoGroup {
  return {
    ...group,
    id: normalizeProdutoAgrupadoValue(group.id),
    nome: normalizeProdutoAgrupadoValue(group.nome),
    members: dedupeProdutoAgrupadoMembers(group.members),
  };
}

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;

  await sql`
    CREATE TABLE IF NOT EXISTS produto_agrupado_groups (
      company TEXT NOT NULL,
      group_id TEXT NOT NULL,
      nome TEXT NOT NULL,
      members_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company, group_id)
    )
  `;

  tableChecked = true;
}

function sortGroups(groups: ProdutoAgrupadoGroup[]): ProdutoAgrupadoGroup[] {
  return groups
    .map(normalizeGroup)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id, "pt-BR"));
}

export async function listProdutoAgrupadoGroups(company: CompanyKey): Promise<ProdutoAgrupadoGroup[]> {
  if (!hasPostgres()) {
    return sortGroups(readGroupsFile().filter((row) => row.company === company));
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const rows = await sql`
    SELECT company, group_id, nome, members_json, created_at, updated_at
    FROM produto_agrupado_groups
    WHERE company = ${company}
    ORDER BY nome, group_id
  `;

  return sortGroups(
    rows.map((row) => ({
      company: row.company as CompanyKey,
      id: String(row.group_id ?? "").trim(),
      nome: String(row.nome ?? "").trim(),
      members: dedupeProdutoAgrupadoMembers(Array.isArray(row.members_json) ? row.members_json : []),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }))
  );
}

function validateGroupInput(input: {
  company: CompanyKey;
  groupId?: string | null;
  nome: string;
  members: Array<Partial<ProdutoAgrupadoMember>>;
}) {
  const nome = normalizeProdutoAgrupadoValue(input.nome);
  if (!nome) {
    throw new Error("Informe o nome do produto agrupado.");
  }

  const members = dedupeProdutoAgrupadoMembers(input.members);
  if (members.length < 2) {
    throw new Error("Adicione pelo menos 2 produtos ao grupo.");
  }

  return {
    company: input.company,
    id: normalizeProdutoAgrupadoValue(input.groupId) || crypto.randomUUID(),
    nome,
    members,
  };
}

function assertGroupConflicts(
  groups: ProdutoAgrupadoGroup[],
  candidate: { id: string; nome: string; members: ProdutoAgrupadoMember[] }
) {
  const normalizedName = normalizeProdutoAgrupadoValue(candidate.nome).toUpperCase();
  const memberKeys = new Set(candidate.members.map((member) => buildProdutoAgrupadoProductKey(member.produto)));

  for (const group of groups) {
    if (group.id !== candidate.id && group.nome.trim().toUpperCase() === normalizedName) {
      throw new Error(`Já existe um grupo com o nome "${candidate.nome}".`);
    }
  }

  const lookup = buildProdutoAgrupadoLookup(groups.filter((group) => group.id !== candidate.id));
  for (const member of candidate.members) {
    const conflict = lookup.get(buildProdutoAgrupadoProductKey(member.produto));
    if (conflict) {
      throw new Error(
        `O produto ${member.produto} já está no grupo "${conflict.nome}". Remova-o de lá antes de salvar.`
      );
    }
  }

  if (memberKeys.size !== candidate.members.length) {
    throw new Error("Há produtos duplicados dentro do mesmo grupo.");
  }
}

export async function saveProdutoAgrupadoGroup(input: {
  company: CompanyKey;
  groupId?: string | null;
  nome: string;
  members: Array<Partial<ProdutoAgrupadoMember>>;
}): Promise<ProdutoAgrupadoGroup> {
  const candidate = validateGroupInput(input);
  const nowIso = new Date().toISOString();
  const existing = await listProdutoAgrupadoGroups(input.company);
  assertGroupConflicts(existing, candidate);

  const previous = existing.find((group) => group.id === candidate.id);
  const nextGroup: ProdutoAgrupadoGroup = {
    company: input.company,
    id: candidate.id,
    nome: candidate.nome,
    members: candidate.members,
    createdAt: previous?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  if (!hasPostgres()) {
    const nextGroups = [
      ...readGroupsFile().filter((row) => !(row.company === input.company && row.id === candidate.id)),
      nextGroup,
    ];
    writeGroupsFile(nextGroups);
    return nextGroup;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  await sql`
    INSERT INTO produto_agrupado_groups (company, group_id, nome, members_json, created_at, updated_at)
    VALUES (
      ${input.company},
      ${candidate.id},
      ${candidate.nome},
      ${JSON.stringify(candidate.members)}::jsonb,
      ${previous?.createdAt ? new Date(previous.createdAt) : new Date(nowIso)},
      ${new Date(nowIso)}
    )
    ON CONFLICT (company, group_id) DO UPDATE SET
      nome = EXCLUDED.nome,
      members_json = EXCLUDED.members_json,
      updated_at = EXCLUDED.updated_at
  `;

  return nextGroup;
}

export async function deleteProdutoAgrupadoGroup(
  company: CompanyKey,
  groupId: string
): Promise<boolean> {
  const normalizedId = normalizeProdutoAgrupadoValue(groupId);
  if (!normalizedId) return false;

  if (!hasPostgres()) {
    const rows = readGroupsFile();
    const remaining = rows.filter((row) => !(row.company === company && row.id === normalizedId));
    const removed = remaining.length !== rows.length;
    if (removed) {
      writeGroupsFile(remaining);
    }
    return removed;
  }

  const sql = getNeonSql();
  await ensureTable(sql);

  const result = await sql`
    DELETE FROM produto_agrupado_groups
    WHERE company = ${company}
      AND group_id = ${normalizedId}
    RETURNING group_id
  `;

  return Array.isArray(result) ? result.length > 0 : false;
}
