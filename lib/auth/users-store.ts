import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import type { PermissionKey, RoleKey, UserRecord } from "@/types/auth";

const USERS_FILE = path.join(process.cwd(), "data", "users.json");

function ensureDataDir() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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

function readUsers(): UserRecord[] {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(USERS_FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeUsers(users: UserRecord[]) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

export function findUserByUsername(username: string): UserRecord | null {
  const users = readUsers();
  const normalized = username.trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === normalized) ?? null;
}

export function findUserById(id: string): UserRecord | null {
  const users = readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export function authenticate(username: string, password: string): UserRecord | null {
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(user.passwordHash, password)) return null;
  return user;
}

export function createUser(
  username: string,
  password: string,
  role: RoleKey,
  permissions: PermissionKey[]
): UserRecord {
  const users = readUsers();
  const normalized = username.trim().toLowerCase();
  if (users.some((u) => u.username.toLowerCase() === normalized)) {
    throw new Error("Usuário já existe");
  }
  const id = createHash("sha256").update(`${normalized}-${Date.now()}`).digest("hex").slice(0, 12);
  const record: UserRecord = {
    id,
    username: normalized,
    passwordHash: hashPassword(password),
    role,
    permissions: role === "admin" ? [] : permissions,
  };
  users.push(record);
  writeUsers(users);
  return record;
}

export function updateUser(
  id: string,
  updates: { username?: string; password?: string; role?: RoleKey; permissions?: PermissionKey[] }
): UserRecord {
  const users = readUsers();
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
    current.permissions = updates.role === "admin" ? [] : (updates.permissions ?? current.permissions);
  }
  if (updates.permissions !== undefined && current.role !== "admin") {
    current.permissions = updates.permissions;
  }
  writeUsers(users);
  return { ...current };
}

export function deleteUser(id: string): void {
  const users = readUsers();
  const filtered = users.filter((u) => u.id !== id);
  if (filtered.length === users.length) throw new Error("Usuário não encontrado");
  writeUsers(filtered);
}

export function listUsers(): UserRecord[] {
  return readUsers();
}

export function seedInitialUsersIfEmpty(): void {
  const users = readUsers();
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
    role: "logistica",
    permissions: ["controle-transferencias"],
  };
  writeUsers([admin, logistica]);
}
