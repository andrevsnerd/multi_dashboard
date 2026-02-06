import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { hasPostgres } from "@/lib/db/neon";
import * as neonStore from "./users-store-neon";
import type { CompanyKey, PermissionKey, RoleKey, UserRecord } from "@/types/auth";

const USERS_FILE = path.join(process.cwd(), "data", "users.json");

// ---------- Helpers (hash/verify) - usados em ambos os stores ----------
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

// ---------- Store em arquivo (local, sem DATABASE_URL) ----------
function ensureDataDir() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readUsersFile(): UserRecord[] {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeUsersFile(users: UserRecord[]) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

// ---------- API unificada: usa Neon se POSTGRES_URL/DATABASE_URL existir, senão arquivo ----------
export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  if (hasPostgres()) return neonStore.findUserByUsername(username);
  const users = readUsersFile();
  const normalized = username.trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === normalized) ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  if (hasPostgres()) return neonStore.findUserById(id);
  const users = readUsersFile();
  return users.find((u) => u.id === id) ?? null;
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
  allowedCompanies?: CompanyKey[]
): Promise<UserRecord> {
  if (hasPostgres())
    return neonStore.createUser(username, password, role, permissions, allowedCompanies);
  const users = readUsersFile();
  const normalized = username.trim().toLowerCase();
  if (users.some((u) => u.username.toLowerCase() === normalized)) {
    throw new Error("Usuário já existe");
  }
  const id = createHash("sha256")
    .update(`${normalized}-${Date.now()}`)
    .digest("hex")
    .slice(0, 12);
  const record: UserRecord = {
    id,
    username: normalized,
    passwordHash: hashPassword(password),
    role,
    permissions: role === "admin" ? [] : (permissions ?? []),
    allowedCompanies:
      allowedCompanies?.length ? allowedCompanies : undefined,
  };
  users.push(record);
  writeUsersFile(users);
  return record;
}

export async function updateUser(
  id: string,
  updates: {
    username?: string;
    password?: string;
    role?: RoleKey;
    permissions?: PermissionKey[];
    allowedCompanies?: CompanyKey[] | null;
  }
): Promise<UserRecord> {
  if (hasPostgres()) return neonStore.updateUser(id, updates);
  const users = readUsersFile();
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) throw new Error("Usuário não encontrado");
  const current = users[index];
  if (updates.username !== undefined) {
    const normalized = updates.username.trim().toLowerCase();
    if (users.some((u) => u.id !== id && u.username.toLowerCase() === normalized)) {
      throw new Error("Nome de usuário já existe");
    }
    current.username = normalized;
  }
  if (updates.password !== undefined && updates.password.length > 0) {
    current.passwordHash = hashPassword(updates.password);
  }
  if (updates.role !== undefined) {
    current.role = updates.role;
    current.permissions =
      updates.role === "admin" ? [] : (updates.permissions ?? current.permissions);
  }
  if (updates.permissions !== undefined && current.role !== "admin") {
    current.permissions = updates.permissions;
  }
  if (updates.allowedCompanies !== undefined) {
    current.allowedCompanies =
      updates.allowedCompanies?.length ? updates.allowedCompanies : undefined;
  }
  writeUsersFile(users);
  return { ...current };
}

export async function deleteUser(id: string): Promise<void> {
  if (hasPostgres()) return neonStore.deleteUser(id);
  const users = readUsersFile();
  const filtered = users.filter((u) => u.id !== id);
  if (filtered.length === users.length) throw new Error("Usuário não encontrado");
  writeUsersFile(filtered);
}

export async function listUsers(): Promise<UserRecord[]> {
  if (hasPostgres()) return neonStore.listUsers();
  return readUsersFile();
}

export async function seedInitialUsersIfEmpty(): Promise<void> {
  if (hasPostgres()) return neonStore.seedInitialUsersIfEmpty();
  const users = readUsersFile();
  if (users.length > 0) return;
  const admin: UserRecord = {
    id: "admin-initial",
    username: "andre.sabetta",
    passwordHash: hashPassword("asabetta"),
    role: "admin",
    permissions: [],
  };
  const logistica: UserRecord = {
    id: "logistica-initial",
    username: "logistica",
    passwordHash: hashPassword("logistica123"),
    role: "gestor",
    permissions: ["controle-transferencias"],
  };
  writeUsersFile([admin, logistica]);
}
