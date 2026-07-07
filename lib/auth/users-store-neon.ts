import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getNeonSql } from "@/lib/db/neon";
import { normalizePermissionKeys } from "./permission-normalizer";
import type { CompanyKey, PermissionKey, RoleKey, UserRecord } from "@/types/auth";

let tableChecked = false;

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS dashboard_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'gestor', 'logistica')),
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      allowed_companies JSONB
    )
  `;
  await sql`ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS allowed_companies JSONB`;
  await sql`ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS nome_exibicao TEXT`;
  await sql`ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS somente_varejo BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS cliente_codigo TEXT`;
  // Atualiza o CHECK constraint para incluir o role 'logistica'
  await sql`
    DO $$
    BEGIN
      ALTER TABLE dashboard_users DROP CONSTRAINT IF EXISTS dashboard_users_role_check;
      ALTER TABLE dashboard_users
        ADD CONSTRAINT dashboard_users_role_check CHECK (role IN ('admin', 'gestor', 'logistica'));
    EXCEPTION WHEN others THEN NULL;
    END$$
  `;
  tableChecked = true;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

export function verifyPassword(storedHash: string, password: string): boolean {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const derived = scryptSync(password, salt, 64);
  try {
    return timingSafeEqual(Buffer.from(key, "hex"), derived);
  } catch {
    return false;
  }
}

function rowToUser(row: {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  permissions: string[] | unknown;
  allowed_companies?: string[] | null;
  nome_exibicao?: string | null;
  somente_varejo?: boolean | null;
  cliente_codigo?: string | null;
}): UserRecord {
  const perms = normalizePermissionKeys(row.permissions);
  const raw = row.allowed_companies;
  const allowedCompanies =
    Array.isArray(raw) && raw.length > 0
      ? (raw as CompanyKey[])
      : undefined;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role as RoleKey,
    permissions: perms,
    allowedCompanies,
    nomeExibicao: row.nome_exibicao ?? undefined,
    somenteVarejo: row.somente_varejo === true ? true : undefined,
    clienteCodigo: row.cliente_codigo?.trim() || undefined,
  };
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const sql = getNeonSql();
  await ensureTable(sql);
  const normalized = username.trim().toLowerCase();
  const rows = await sql`
    SELECT id, username, password_hash, role, permissions, allowed_companies, nome_exibicao, somente_varejo, cliente_codigo
    FROM dashboard_users
    WHERE LOWER(username) = ${normalized}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rowToUser(rows[0] as Parameters<typeof rowToUser>[0]);
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = await sql`
    SELECT id, username, password_hash, role, permissions, allowed_companies, nome_exibicao, somente_varejo, cliente_codigo
    FROM dashboard_users
    WHERE id = ${id}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rowToUser(rows[0] as Parameters<typeof rowToUser>[0]);
}

export async function authenticate(
  username: string,
  password: string
): Promise<UserRecord | null> {
  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(user.passwordHash, password)) return null;
  return user;
}

export async function createUser(
  username: string,
  password: string,
  role: RoleKey,
  permissions: PermissionKey[],
  allowedCompanies?: CompanyKey[],
  nomeExibicao?: string,
  somenteVarejo?: boolean,
  clienteCodigo?: string
): Promise<UserRecord> {
  const sql = getNeonSql();
  await ensureTable(sql);
  const normalized = username.trim().toLowerCase();
  const existing = await sql`
    SELECT 1 FROM dashboard_users WHERE LOWER(username) = ${normalized} LIMIT 1
  `;
  if (existing.length > 0) throw new Error("Usuário já existe");
  const id = createHash("sha256")
    .update(`${normalized}-${Date.now()}`)
    .digest("hex")
    .slice(0, 12);
  const passwordHash = hashPassword(password);
  const perms = role === "admin" ? [] : normalizePermissionKeys(permissions ?? []);
  const allowedJson =
    allowedCompanies?.length ? JSON.stringify(allowedCompanies) : null;
  const nomeEx = nomeExibicao?.trim() || null;
  const somenteVarejoVal = somenteVarejo === true;
  const clienteCod = clienteCodigo?.trim() || null;
  await sql`
    INSERT INTO dashboard_users (id, username, password_hash, role, permissions, allowed_companies, nome_exibicao, somente_varejo, cliente_codigo)
    VALUES (${id}, ${normalized}, ${passwordHash}, ${role}, ${JSON.stringify(perms)}::jsonb, ${allowedJson}::jsonb, ${nomeEx}, ${somenteVarejoVal}, ${clienteCod})
  `;
  return {
    id,
    username: normalized,
    passwordHash,
    role,
    permissions: perms,
    allowedCompanies: allowedCompanies?.length ? allowedCompanies : undefined,
    nomeExibicao: nomeEx ?? undefined,
    somenteVarejo: somenteVarejoVal || undefined,
    clienteCodigo: clienteCod ?? undefined,
  };
}

export async function updateUser(
  id: string,
  updates: {
    username?: string;
    password?: string;
    role?: RoleKey;
    permissions?: PermissionKey[];
    allowedCompanies?: CompanyKey[] | null;
    nomeExibicao?: string | null;
    somenteVarejo?: boolean | null;
    clienteCodigo?: string | null;
  }
): Promise<UserRecord> {
  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = await sql`
    SELECT id, username, password_hash, role, permissions, allowed_companies, nome_exibicao, somente_varejo, cliente_codigo
    FROM dashboard_users WHERE id = ${id} LIMIT 1
  `;
  if (rows.length === 0) throw new Error("Usuário não encontrado");
  const current = rowToUser(rows[0] as Parameters<typeof rowToUser>[0]);
  let username = current.username;
  let passwordHash = current.passwordHash;
  let role = current.role;
  let permissions = current.permissions;
  let allowedCompanies = current.allowedCompanies;
  let nomeExibicao = current.nomeExibicao;
  let somenteVarejo = current.somenteVarejo;
  let clienteCodigo = current.clienteCodigo;
  if (updates.username !== undefined) {
    const normalized = updates.username.trim().toLowerCase();
    const existing = await sql`
      SELECT 1 FROM dashboard_users WHERE LOWER(username) = ${normalized} AND id != ${id} LIMIT 1
    `;
    if (existing.length > 0) throw new Error("Nome de usuário já existe");
    username = normalized;
  }
  if (updates.password !== undefined && updates.password.length > 0) {
    passwordHash = hashPassword(updates.password);
  }
  if (updates.role !== undefined) {
    role = updates.role;
    permissions =
      role === "admin" ? [] : normalizePermissionKeys(updates.permissions ?? permissions);
  }
  if (updates.permissions !== undefined && role !== "admin") {
    permissions = normalizePermissionKeys(updates.permissions);
  }
  if (updates.allowedCompanies !== undefined) {
    allowedCompanies =
      updates.allowedCompanies?.length ? updates.allowedCompanies : undefined;
  }
  if (updates.nomeExibicao !== undefined) {
    nomeExibicao = updates.nomeExibicao?.trim() || undefined;
  }
  if (updates.somenteVarejo !== undefined) {
    somenteVarejo = updates.somenteVarejo === true ? true : undefined;
  }
  if (updates.clienteCodigo !== undefined) {
    clienteCodigo = updates.clienteCodigo?.trim() || undefined;
  }
  const allowedJson =
    allowedCompanies?.length ? JSON.stringify(allowedCompanies) : null;
  const nomeEx = nomeExibicao?.trim() || null;
  const somenteVarejoVal = somenteVarejo === true;
  const clienteCod = clienteCodigo?.trim() || null;
  await sql`
    UPDATE dashboard_users
    SET username = ${username}, password_hash = ${passwordHash}, role = ${role},
        permissions = ${JSON.stringify(permissions)}::jsonb,
        allowed_companies = ${allowedJson}::jsonb,
        nome_exibicao = ${nomeEx},
        somente_varejo = ${somenteVarejoVal},
        cliente_codigo = ${clienteCod}
    WHERE id = ${id}
  `;
  return { id: current.id, username, passwordHash, role, permissions, allowedCompanies, nomeExibicao, somenteVarejo, clienteCodigo };
}

export async function deleteUser(id: string): Promise<void> {
  const sql = getNeonSql();
  await ensureTable(sql);
  const exists = await findUserById(id);
  if (!exists) throw new Error("Usuário não encontrado");
  await sql`DELETE FROM dashboard_users WHERE id = ${id}`;
}

export async function listUsers(): Promise<UserRecord[]> {
  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = await sql`
    SELECT id, username, password_hash, role, permissions, allowed_companies, nome_exibicao, somente_varejo, cliente_codigo
    FROM dashboard_users
    ORDER BY username
  `;
  return rows.map((r) => rowToUser(r as Parameters<typeof rowToUser>[0]));
}

export async function seedInitialUsersIfEmpty(): Promise<void> {
  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = await sql`SELECT 1 FROM dashboard_users LIMIT 1`;
  if (rows.length > 0) return;
  const adminId = "admin-initial";
  const logisticaId = "logistica-initial";
  await sql`
    INSERT INTO dashboard_users (id, username, password_hash, role, permissions)
    VALUES
      (${adminId}, 'andre.sabetta', ${hashPassword("asabetta")}, 'admin', '[]'::jsonb),
      (${logisticaId}, 'logistica', ${hashPassword("logistica123")}, 'gestor', ${JSON.stringify(["controle-transferencias"])}::jsonb)
  `;
}
