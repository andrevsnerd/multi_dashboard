"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthContext";
import {
  ALL_PERMISSION_KEYS,
  ROLE_LABELS,
  type CompanyKey,
  type RoleKey,
  type PermissionKey,
} from "@/types/auth";
import styles from "./page.module.css";
const _filialLabelOverrides: Record<string, string> = {
  'NERD MORUMBI RDRRRJ': 'NERD MORUMBI RDRRRJ',
  'NERD MORUMBI RDRX': 'NERD MORUMBI RDRRRJ',
  'NERD MORUMBI RDRRX': 'NERD MORUMBI 2 (RRX)',
};
function getFilialLabel(filial: string): string {
  return _filialLabelOverrides[filial] ?? filial;
}

/* ── Tipos ── */
interface UserRow {
  id: string;
  username: string;
  nomeExibicao?: string;
  role: RoleKey;
  permissions: PermissionKey[];
  allowedCompanies?: CompanyKey[];
}

interface TransfPerm {
  username: string;
  filiaisOrigem: string[];
  filiaisDestino: string[];
  filiaisDestinoControle?: string[];
  tiposRomaneioPermitidos: string[];
  responsavelPadrao?: string;
  tipoRomaneioPadrao?: string;
  responsavelFixo: boolean;
  tipoRomaneioFixo: boolean;
  podeVerOutrasFiliais?: boolean;
  filialAtribuida?: string | null;
}

interface Filial {
  codFilial: string;
  filial: string;
}

/* ── Página ── */
export default function AdminPage() {
  const { user: currentUser } = useAuth();

  // Dados
  const [users, setUsers] = useState<UserRow[]>([]);
  const [transfPerms, setTransfPerms] = useState<TransfPerm[]>([]);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [tiposRomaneio, setTiposRomaneio] = useState<string[]>([]);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal
  const [modal, setModal] = useState<"none" | "add" | "edit">("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Campos — dados básicos
  const [formNome, setFormNome] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<RoleKey>("gestor");
  const [formEmpresa, setFormEmpresa] = useState<"" | CompanyKey>("");

  // Campos — páginas
  const [formPermissions, setFormPermissions] = useState<PermissionKey[]>([]);

  // Campos — filial e transferências
  const [formFilialPrincipal, setFormFilialPrincipal] = useState("");
  const [formAdvancedFiliais, setFormAdvancedFiliais] = useState(false);
  const [formFiliaisOrigem, setFormFiliaisOrigem] = useState<string[]>([]);
  const [formFiliaisDestino, setFormFiliaisDestino] = useState<string[]>([]);
  const [formFiliaisDestinoControle, setFormFiliaisDestinoControle] = useState<string[]>([]);
  const [formTiposRomaneio, setFormTiposRomaneio] = useState<string[]>([]);
  const [formResponsavel, setFormResponsavel] = useState("");
  const [formTipoRomaneio, setFormTipoRomaneio] = useState("");
  const [formResponsavelFixo, setFormResponsavelFixo] = useState(false);
  const [formTipoRomaneioFixo, setFormTipoRomaneioFixo] = useState(false);
  const [formPodeVerOutras, setFormPodeVerOutras] = useState(false);

  const authHeader = useCallback(
    (): Record<string, string> =>
      currentUser ? { "X-Auth-Username": currentUser.username } : {},
    [currentUser]
  );

  /* ── Carregamento ── */
  const loadAll = useCallback(async () => {
    if (!currentUser?.username) return;
    setLoading(true);
    setError("");
    try {
      const [usersRes, permsRes, filiaisRes, tiposRes, responsRes] = await Promise.all([
        fetch("/api/admin/users", { headers: authHeader() }),
        fetch("/api/admin/transferencia-permissoes", { headers: authHeader(), cache: "no-store" }),
        fetch("/api/transferencia-produtos/filiais", { cache: "no-store" }),
        fetch("/api/transferencia-produtos/tipos-romaneio", { cache: "no-store" }),
        fetch("/api/transferencia-produtos/responsaveis", { cache: "no-store" }),
      ]);

      if (!usersRes.ok) throw new Error("Erro ao carregar usuários");
      setUsers(await usersRes.json());

      if (permsRes.ok) {
        const p = await permsRes.json();
        setTransfPerms(p.data || []);
      }
      if (filiaisRes.ok) {
        const f = await filiaisRes.json();
        setFiliais(f.data || []);
      }
      if (tiposRes.ok) {
        const t = await tiposRes.json();
        setTiposRomaneio(t.data || []);
      }
      if (responsRes.ok) {
        const r = await responsRes.json();
        setResponsaveis((r.data || []).map((x: { responsavel: string }) => x.responsavel));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.username, authHeader]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* ── Helpers modal ── */
  function resetForm() {
    setFormNome("");
    setFormUsername("");
    setFormPassword("");
    setFormRole("gestor");
    setFormEmpresa("");
    setFormPermissions([]);
    setFormFilialPrincipal("");
    setFormAdvancedFiliais(false);
    setFormFiliaisOrigem([]);
    setFormFiliaisDestino([]);
    setFormFiliaisDestinoControle([]);
    setFormTiposRomaneio([]);
    setFormResponsavel("");
    setFormTipoRomaneio("");
    setFormResponsavelFixo(false);
    setFormTipoRomaneioFixo(false);
    setFormPodeVerOutras(false);
    setFormError("");
  }

  function openAdd() {
    setEditingId(null);
    resetForm();
    setFormPermissions(["controle-transferencias"]);
    setModal("add");
  }

  function openEdit(u: UserRow) {
    setEditingId(u.id);
    setFormNome(u.nomeExibicao ?? "");
    setFormUsername(u.username);
    setFormPassword("");
    setFormRole(u.role);
    const ac = u.allowedCompanies;
    setFormEmpresa(!ac?.length || ac.length === 2 ? "" : (ac[0] as "" | CompanyKey));
    setFormPermissions(u.permissions ?? []);

    // Preencher dados de transferência se existir
    const tp = transfPerms.find((p) => p.username === u.username);
    if (tp) {
      setFormFilialPrincipal(tp.filialAtribuida ?? "");
      setFormFiliaisOrigem(tp.filiaisOrigem ?? []);
      setFormFiliaisDestino(tp.filiaisDestino ?? []);
      setFormFiliaisDestinoControle(tp.filiaisDestinoControle ?? []);
      setFormTiposRomaneio(tp.tiposRomaneioPermitidos ?? []);
      setFormResponsavel(tp.responsavelPadrao ?? "");
      setFormTipoRomaneio(tp.tipoRomaneioPadrao ?? "");
      setFormResponsavelFixo(tp.responsavelFixo ?? false);
      setFormTipoRomaneioFixo(tp.tipoRomaneioFixo ?? false);
      setFormPodeVerOutras(tp.podeVerOutrasFiliais ?? false);
      // Mostrar modo avançado se origem/destino difere da filial principal
      const mesmaOrigem =
        tp.filiaisOrigem.length === 1 && tp.filiaisOrigem[0] === tp.filialAtribuida;
      const mesmaDestino =
        tp.filiaisDestino.length === 1 && tp.filiaisDestino[0] === tp.filialAtribuida;
      setFormAdvancedFiliais(tp.filiaisOrigem.length > 0 && !(mesmaOrigem && mesmaDestino));
    } else {
      setFormFilialPrincipal("");
      setFormFiliaisOrigem([]);
      setFormFiliaisDestino([]);
      setFormFiliaisDestinoControle([]);
      setFormTiposRomaneio([]);
      setFormResponsavel("");
      setFormTipoRomaneio("");
      setFormResponsavelFixo(false);
      setFormTipoRomaneioFixo(false);
      setFormPodeVerOutras(false);
      setFormAdvancedFiliais(false);
    }

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

  function handleFilialPrincipalChange(cod: string) {
    setFormFilialPrincipal(cod);
    if (!formAdvancedFiliais) {
      // Em modo simples: sincroniza origem e destino
      setFormFiliaisOrigem(cod ? [cod] : []);
      setFormFiliaisDestino(cod ? [cod] : []);
    }
  }

  /* ── Submit ── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);

    try {
      // 1) Salvar dados do usuário
      const userPayload = {
        username: formUsername,
        role: formRole,
        permissions: formRole === "admin" ? [] : formPermissions,
        allowedCompanies: formEmpresa ? [formEmpresa] : [],
        nomeExibicao: formNome || null,
        ...(formPassword ? { password: formPassword } : {}),
      };

      let savedUsername = formUsername;

      if (modal === "add") {
        if (!formPassword) {
          setFormError("Senha é obrigatória para novos usuários");
          setSaving(false);
          return;
        }
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(userPayload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro ao criar usuário");
        savedUsername = data.username;
      } else {
        const res = await fetch(`/api/admin/users/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(userPayload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar usuário");
        savedUsername = data.username;
      }

      // 2) Salvar permissões de transferência (sempre que tiver dados de filial ou transferência)
      const temDadosTransf =
        formFilialPrincipal ||
        formFiliaisOrigem.length > 0 ||
        formFiliaisDestino.length > 0 ||
        formTiposRomaneio.length > 0 ||
        formResponsavel ||
        formTipoRomaneio;

      if (temDadosTransf || transfPerms.some((p) => p.username === savedUsername)) {
        const filiaisOrigem = formAdvancedFiliais
          ? formFiliaisOrigem
          : formFilialPrincipal
            ? [formFilialPrincipal]
            : [];
        const filiaisDestino = formAdvancedFiliais
          ? formFiliaisDestino
          : formFilialPrincipal
            ? [formFilialPrincipal]
            : [];

        const transfPayload: TransfPerm = {
          username: savedUsername,
          filiaisOrigem,
          filiaisDestino,
          filiaisDestinoControle: formFiliaisDestinoControle,
          tiposRomaneioPermitidos: formTiposRomaneio,
          responsavelPadrao: formResponsavel || undefined,
          tipoRomaneioPadrao: formTipoRomaneio || undefined,
          responsavelFixo: formResponsavelFixo,
          tipoRomaneioFixo: formTipoRomaneioFixo,
          podeVerOutrasFiliais: formPodeVerOutras,
          filialAtribuida: formFilialPrincipal || null,
        };

        const transfRes = await fetch("/api/admin/transferencia-permissoes", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(transfPayload),
        });
        if (!transfRes.ok) {
          const d = await transfRes.json().catch(() => ({}));
          throw new Error(d.error ?? "Erro ao salvar permissões de filial");
        }
      }

      await loadAll();
      closeModal();
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
      await loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao remover");
    }
  }

  /* ── Helpers de exibição ── */
  function getFilialNome(cod: string) {
    return filiais.find((f) => f.codFilial === cod)?.filial ?? cod;
  }

  function getUserFilial(u: UserRow) {
    const tp = transfPerms.find((p) => p.username === u.username);
    if (!tp?.filialAtribuida) return "—";
    return getFilialNome(tp.filialAtribuida);
  }

  if (!currentUser) return null;

  return (
    <main className={styles.container}>
      {/* ── Cabeçalho ── */}
      <header className={styles.header}>
        <div>
          <Link href="/" className={styles.backLink}>
            ← Voltar à seleção
          </Link>
          <h1 className={styles.title}>Painel Admin</h1>
          <p className={styles.subtitle}>
            Gerencie usuários, permissões de páginas e filiais em um só lugar.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link
            href="/admin/filial-grupos"
            style={{
              padding: "8px 14px",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              color: "#94a3b8",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Grupos de Filiais
          </Link>
          <Link
            href="/admin/extrato-produto"
            style={{
              padding: "8px 14px",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              color: "#94a3b8",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Extrato de Produto
          </Link>
          <button type="button" className={styles.addButton} onClick={openAdd}>
            + Adicionar usuário
          </button>
        </div>
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
                <th>Empresa</th>
                <th>Filial Atribuída</th>
                <th>Páginas</th>
                <th className={styles.actionsCol}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className={styles.userPrimary}>
                      {u.nomeExibicao || u.username}
                    </div>
                    {u.nomeExibicao && (
                      <div className={styles.userSecondary}>@{u.username}</div>
                    )}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${u.role === "admin" ? styles.badgeAdmin : styles.badgeGestor}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td>
                    {!u.allowedCompanies?.length || u.allowedCompanies.length === 2
                      ? "Ambas"
                      : u.allowedCompanies[0] === "nerd"
                        ? "NERD"
                        : "SCARF ME"}
                  </td>
                  <td>{getUserFilial(u)}</td>
                  <td className={styles.permCount}>
                    {u.role === "admin"
                      ? "Todas"
                      : u.permissions.length === 0
                        ? "Nenhuma"
                        : `${u.permissions.length} página${u.permissions.length !== 1 ? "s" : ""}`}
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

      {/* ── Modal ── */}
      {modal !== "none" && (
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

              {/* ── Seção: Dados básicos ── */}
              <div className={styles.section}>
                <p className={styles.sectionTitle}>Dados básicos</p>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>
                    Nome de exibição
                    <input
                      type="text"
                      value={formNome}
                      onChange={(e) => setFormNome(e.target.value)}
                      className={styles.input}
                      placeholder="Ex: Maria Logística (opcional)"
                      disabled={saving}
                    />
                    <span className={styles.hint}>
                      Aparece na tabela. Se vazio, usa o login.
                    </span>
                  </label>

                  <div className={styles.row2}>
                    <label className={styles.label}>
                      Login (username)
                      <input
                        type="text"
                        value={formUsername}
                        onChange={(e) => setFormUsername(e.target.value)}
                        className={styles.input}
                        required
                        disabled={saving}
                        autoComplete="off"
                      />
                    </label>
                    <label className={styles.label}>
                      Senha {modal === "edit" && <span className={styles.hint}>(vazio = não altera)</span>}
                      <input
                        type="password"
                        value={formPassword}
                        onChange={(e) => setFormPassword(e.target.value)}
                        className={styles.input}
                        required={modal === "add"}
                        disabled={saving}
                        autoComplete="new-password"
                      />
                    </label>
                  </div>

                  <div className={styles.row2}>
                    <label className={styles.label}>
                      Função
                      <select
                        value={formRole}
                        onChange={(e) => setFormRole(e.target.value as RoleKey)}
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
                    <label className={styles.label}>
                      Empresa
                      <select
                        value={formEmpresa}
                        onChange={(e) => setFormEmpresa(e.target.value as "" | CompanyKey)}
                        className={styles.select}
                        disabled={saving}
                      >
                        <option value="">Ambas (NERD e SCARF ME)</option>
                        <option value="nerd">Só NERD</option>
                        <option value="scarfme">Só SCARF ME</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              {/* ── Seção: Páginas ── */}
              {formRole !== "admin" && (
                <div className={styles.section}>
                  <p className={styles.sectionTitle}>Páginas que pode acessar</p>
                  <div className={styles.checkboxGrid}>
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

              {/* ── Seção: Filial e operações ── */}
              <div className={styles.section}>
                <p className={styles.sectionTitle}>Filial e operações</p>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>
                    Filial atribuída
                    <select
                      value={formFilialPrincipal}
                      onChange={(e) => handleFilialPrincipalChange(e.target.value)}
                      className={styles.select}
                      disabled={saving}
                    >
                      <option value="">Todas (sem restrição)</option>
                      {filiais.map((f) => (
                        <option key={f.codFilial} value={f.codFilial}>
                          {f.filial}
                        </option>
                      ))}
                    </select>
                    <span className={styles.hint}>
                      Define a filial padrão do usuário. Limita saídas/entradas e filtra romaneios.
                    </span>
                  </label>

                  {/* Toggle avançado */}
                  <button
                    type="button"
                    className={styles.advancedToggle}
                    onClick={() => {
                      setFormAdvancedFiliais(!formAdvancedFiliais);
                      if (!formAdvancedFiliais) {
                        // Ao abrir avançado: pré-preenche com a filial principal
                        if (formFilialPrincipal && formFiliaisOrigem.length === 0) {
                          setFormFiliaisOrigem([formFilialPrincipal]);
                          setFormFiliaisDestino([formFilialPrincipal]);
                        }
                      }
                    }}
                  >
                    {formAdvancedFiliais ? "▲" : "▼"}{" "}
                    Configuração avançada de filiais e romaneio
                  </button>

                  {formAdvancedFiliais && (
                    <>
                      {/* ── Bloco: Saídas e Entradas diretas ── */}
                      <p className={styles.subSectionTitle}>Saídas / Entradas diretas</p>

                      <label className={styles.label}>
                        Filiais de saída permitidas
                        <span className={styles.hint}>
                          Vazio = todas. O usuário só pode lançar saída dessas filiais.
                        </span>
                        <button
                          type="button"
                          className={styles.selectAll}
                          onClick={() => {
                            const all = filiais.length > 0 && formFiliaisOrigem.length === filiais.length;
                            setFormFiliaisOrigem(all ? [] : filiais.map((f) => f.codFilial));
                          }}
                        >
                          {filiais.length > 0 && formFiliaisOrigem.length === filiais.length
                            ? "Desmarcar tudo"
                            : "Selecionar tudo"}
                        </button>
                        <div className={styles.checkboxList}>
                          {filiais.map((f) => (
                            <label key={f.codFilial} className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={formFiliaisOrigem.includes(f.codFilial)}
                                onChange={() =>
                                  setFormFiliaisOrigem((prev) =>
                                    prev.includes(f.codFilial)
                                      ? prev.filter((x) => x !== f.codFilial)
                                      : [...prev, f.codFilial]
                                  )
                                }
                                disabled={saving}
                              />
                              {getFilialLabel(f.filial)}
                            </label>
                          ))}
                        </div>
                      </label>

                      <label className={styles.label}>
                        Filiais de entrada permitidas
                        <span className={styles.hint}>
                          Vazio = todas. O usuário só pode lançar entrada nessas filiais.
                        </span>
                        <div className={styles.checkboxList}>
                          {filiais.map((f) => (
                            <label key={f.codFilial} className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={formFiliaisDestino.includes(f.codFilial)}
                                onChange={() =>
                                  setFormFiliaisDestino((prev) =>
                                    prev.includes(f.codFilial)
                                      ? prev.filter((x) => x !== f.codFilial)
                                      : [...prev, f.codFilial]
                                  )
                                }
                                disabled={saving}
                              />
                              {getFilialLabel(f.filial)}
                            </label>
                          ))}
                        </div>
                      </label>

                      {/* ── Bloco: Controle de Transferências ── */}
                      <p className={styles.subSectionTitle}>Controle de Transferências</p>

                      <label className={styles.label}>
                        Filiais destino visíveis
                        <span className={styles.hint}>
                          Quais outras filiais da mesma empresa aparecem como destino sugerido.
                          Vazio = todas. Ex: Guarulhos vê todas as outras SCARF ME como destino possível.
                        </span>
                        <button
                          type="button"
                          className={styles.selectAll}
                          onClick={() => {
                            const all = filiais.length > 0 && formFiliaisDestinoControle.length === filiais.length;
                            setFormFiliaisDestinoControle(all ? [] : filiais.map((f) => f.codFilial));
                          }}
                        >
                          {filiais.length > 0 && formFiliaisDestinoControle.length === filiais.length
                            ? "Desmarcar tudo"
                            : "Selecionar tudo"}
                        </button>
                        <div className={styles.checkboxList}>
                          {filiais.map((f) => (
                            <label key={f.codFilial} className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={formFiliaisDestinoControle.includes(f.codFilial)}
                                onChange={() =>
                                  setFormFiliaisDestinoControle((prev) =>
                                    prev.includes(f.codFilial)
                                      ? prev.filter((x) => x !== f.codFilial)
                                      : [...prev, f.codFilial]
                                  )
                                }
                                disabled={saving}
                              />
                              {getFilialLabel(f.filial)}
                            </label>
                          ))}
                        </div>
                      </label>

                      <label className={styles.checkboxLabel} style={{ marginBottom: 8 }}>
                        <input
                          type="checkbox"
                          checked={formPodeVerOutras}
                          onChange={(e) => setFormPodeVerOutras(e.target.checked)}
                          disabled={saving}
                        />
                        Pode ver todas as filiais da empresa (ignora os filtros de visualização acima)
                      </label>

                      {/* ── Bloco: Romaneio ── */}
                      <p className={styles.subSectionTitle}>Romaneio</p>

                      <label className={styles.label}>
                        Tipos de romaneio permitidos
                        <span className={styles.hint}>Vazio = todos os tipos.</span>
                        <div className={styles.checkboxList}>
                          {tiposRomaneio.map((tipo) => (
                            <label key={tipo} className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={formTiposRomaneio.includes(tipo)}
                                onChange={() =>
                                  setFormTiposRomaneio((prev) =>
                                    prev.includes(tipo)
                                      ? prev.filter((t) => t !== tipo)
                                      : [...prev, tipo]
                                  )
                                }
                                disabled={saving}
                              />
                              {tipo}
                            </label>
                          ))}
                        </div>
                      </label>

                      <div className={styles.row2}>
                        <label className={styles.label}>
                          Responsável padrão
                          <input
                            type="text"
                            list="responsaveis-list"
                            className={styles.input}
                            value={formResponsavel}
                            onChange={(e) => setFormResponsavel(e.target.value.toUpperCase())}
                            placeholder="Ex: LOGISTICA"
                            disabled={saving}
                          />
                          <datalist id="responsaveis-list">
                            {responsaveis.map((r) => (
                              <option key={r} value={r} />
                            ))}
                          </datalist>
                        </label>
                        <label className={styles.label}>
                          Tipo de romaneio padrão
                          <input
                            type="text"
                            list="tipos-list"
                            className={styles.input}
                            value={formTipoRomaneio}
                            onChange={(e) => setFormTipoRomaneio(e.target.value.toUpperCase())}
                            placeholder="Ex: TRANSFERENCIA"
                            disabled={saving}
                          />
                          <datalist id="tipos-list">
                            {tiposRomaneio.map((t) => (
                              <option key={t} value={t} />
                            ))}
                          </datalist>
                        </label>
                      </div>

                      <div className={styles.fieldGroup} style={{ gap: 8 }}>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={formResponsavelFixo}
                            onChange={(e) => setFormResponsavelFixo(e.target.checked)}
                            disabled={saving}
                          />
                          Responsável fixo (não pode alterar)
                        </label>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={formTipoRomaneioFixo}
                            onChange={(e) => setFormTipoRomaneioFixo(e.target.checked)}
                            disabled={saving}
                          />
                          Tipo de romaneio fixo (não pode alterar)
                        </label>
                      </div>
                    </>
                  )}
                </div>
              </div>

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
