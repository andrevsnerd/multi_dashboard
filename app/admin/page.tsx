"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthContext";
import {
  ALL_PERMISSION_KEYS,
  ROLE_LABELS,
  type RoleKey,
  type PermissionKey,
} from "@/types/auth";
import styles from "./page.module.css";

interface UserRow {
  id: string;
  username: string;
  role: RoleKey;
  permissions: PermissionKey[];
}

export default function AdminPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"none" | "add" | "edit">("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<RoleKey>("logistica");
  const [formPermissions, setFormPermissions] = useState<PermissionKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const authHeader = () =>
    currentUser ? { "X-Auth-Username": currentUser.username } : {};

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", { headers: authHeader() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erro ao carregar usuários");
      }
      const data = await res.json();
      setUsers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, [currentUser?.username]);

  function openAdd() {
    setEditingId(null);
    setFormUsername("");
    setFormPassword("");
    setFormRole("logistica");
    setFormPermissions(["controle-transferencias"]);
    setFormError("");
    setModal("add");
  }

  function openEdit(u: UserRow) {
    setEditingId(u.id);
    setFormUsername(u.username);
    setFormPassword("");
    setFormRole(u.role);
    setFormPermissions(u.permissions);
    setFormError("");
    setModal("edit");
  }

  function closeModal() {
    setModal("none");
    setEditingId(null);
  }

  function togglePermission(key: PermissionKey) {
    setFormPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      if (modal === "add") {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({
            username: formUsername,
            password: formPassword,
            role: formRole,
            permissions: formRole === "admin" ? [] : formPermissions,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro ao criar usuário");
        await loadUsers();
        closeModal();
      } else {
        const res = await fetch(`/api/admin/users/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({
            username: formUsername,
            ...(formPassword ? { password: formPassword } : {}),
            role: formRole,
            permissions: formRole === "admin" ? [] : formPermissions,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar usuário");
        await loadUsers();
        closeModal();
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, username: string) {
    if (!confirm(`Remover o usuário "${username}"?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
        headers: authHeader(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao remover");
      await loadUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao remover");
    }
  }

  if (!currentUser) return null;

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <Link href="/" className={styles.backLink}>
            ← Voltar à seleção
          </Link>
          <h1 className={styles.title}>Painel Admin – Usuários</h1>
          <p className={styles.subtitle}>
            Adicione, edite ou remova usuários e defina permissões por função.
          </p>
        </div>
        <button type="button" className={styles.addButton} onClick={openAdd}>
          Adicionar usuário
        </button>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <p className={styles.loading}>Carregando...</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Função</th>
                <th>Permissões</th>
                <th className={styles.actionsCol}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>
                    {u.role === "admin"
                      ? "Todas"
                      : u.permissions.length === 0
                        ? "Nenhuma"
                        : u.permissions.join(", ")}
                  </td>
                  <td className={styles.actionsCol}>
                    <button
                      type="button"
                      className={styles.editBtn}
                      onClick={() => openEdit(u)}
                    >
                      Editar
                    </button>
                    {u.username !== currentUser.username && (
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(u.id, u.username)}
                      >
                        Remover
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(modal === "add" || modal === "edit") && (
        <div className={styles.overlay} onClick={closeModal}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className={styles.modalTitle}>
              {modal === "add" ? "Adicionar usuário" : "Editar usuário"}
            </h2>
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                Usuário
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  className={styles.input}
                  required
                  disabled={saving}
                />
              </label>
              <label className={styles.label}>
                Senha {modal === "edit" && "(deixe em branco para não alterar)"}
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className={styles.input}
                  required={modal === "add"}
                  disabled={saving}
                  autoComplete={modal === "add" ? "new-password" : "new-password"}
                />
              </label>
              <label className={styles.label}>
                Função
                <select
                  value={formRole}
                  onChange={(e) =>
                    setFormRole(e.target.value as RoleKey)
                  }
                  className={styles.select}
                  disabled={saving}
                >
                  {(Object.keys(ROLE_LABELS) as RoleKey[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              {formRole !== "admin" && (
                <div className={styles.permissions}>
                  <span className={styles.permissionsLabel}>
                    O que esta função pode ver
                  </span>
                  <div className={styles.checkboxList}>
                    {ALL_PERMISSION_KEYS.map(({ key, label }) => (
                      <label key={key} className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={formPermissions.includes(key)}
                          onChange={() => togglePermission(key)}
                          disabled={saving}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {formError && <p className={styles.formError}>{formError}</p>}
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={styles.saveBtn}
                  disabled={saving}
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
