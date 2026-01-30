import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getNeonSql } from "@/lib/db/neon";
import type { PermissionKey, RoleKey, UserRecord } from "@/types/auth";

let tableChecked = false;

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS dashboard_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'logistica')),
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb
    )
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
}): UserRecord {
  const perms = Array.isArray(row.permissions) ? row.permissions : [];
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role as RoleKey,
    permissions: perms as PermissionKey[],
  };
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const sql = getNeonSql();
  await ensureTable(sql);
  const normalized = username.trim().toLowerCase();
  const rows = await sql`
    SELECT id, username, password_hash, role, permissions
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
    SELECT id, username, password_hash, role, permissions
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
  permissions: PermissionKey[]
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
  const perms = role === "admin" ? [] : permissions;
  await sql`
    INSERT INTO dashboard_users (id, username, password_hash, role, permissions)
    VALUES (${id}, ${normalized}, ${passwordHash}, ${role}, ${JSON.stringify(perms)}::jsonb)
  `;
  return {
    id,
    username: normalized,
    passwordHash,
    role,
    permissions: perms,
  };
}

export async function updateUser(
  id: string,
  updates: {
    username?: string;
    password?: string;
    role?: RoleKey;
    permissions?: PermissionKey[];
  }
): Promise<UserRecord> {
  const sql = getNeonSql();
  await ensureTable(sql);
  const rows = await sql`
    SELECT id, username, password_hash, role, permissions
    FROM dashboard_users WHERE id = ${id} LIMIT 1
  `;
  if (rows.length === 0) throw new Error("Usuário não encontrado");
  const current = rowToUser(rows[0] as Parameters<typeof rowToUser>[0]);
  let username = current.username;
  let passwordHash = current.passwordHash;
  let role = current.role;
  let permissions = current.permissions;
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
    permissions = role === "admin" ? [] : (updates.permissions ?? permissions);
  }
  if (updates.permissions !== undefined && role !== "admin") {
    permissions = updates.permissions;
  }
  await sql`
    UPDATE dashboard_users
    SET username = ${username}, password_hash = ${passwordHash}, role = ${role}, permissions = ${JSON.stringify(permissions)}::jsonb
    WHERE id = ${id}
  `;
  return { id: current.id, username, passwordHash, role, permissions };
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
    SELECT id, username, password_hash, role, permissions
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
      (${logisticaId}, 'logistica', ${hashPassword("logistica123")}, 'logistica', ${JSON.stringify(["controle-transferencias"])}::jsonb)
  `;
}
