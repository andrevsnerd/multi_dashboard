"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import styles from "../page.module.css";

interface FilialGrupo {
  id: string;
  label: string;
  company: string;
  members: string[];
  active: string;
}

type ModalMode = "none" | "add" | "edit";

const COMPANY_LABELS: Record<string, string> = {
  nerd: "NERD",
  scarfme: "SCARF ME",
};

export default function FilialGruposPage() {
  const [grupos, setGrupos] = useState<FilialGrupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal
  const [modal, setModal] = useState<ModalMode>("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Campos do formulário
  const [formLabel, setFormLabel] = useState("");
  const [formCompany, setFormCompany] = useState("nerd");
  const [formMembersRaw, setFormMembersRaw] = useState("");
  const [formActive, setFormActive] = useState("");

  const loadGrupos = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/filial-grupos");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao carregar grupos");
      setGrupos(data.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGrupos();
  }, [loadGrupos]);

  function parsedMembers(raw: string): string[] {
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function resetForm() {
    setFormLabel("");
    setFormCompany("nerd");
    setFormMembersRaw("");
    setFormActive("");
    setFormError("");
  }

  function openAdd() {
    resetForm();
    setEditingId(null);
    setModal("add");
  }

  function openEdit(g: FilialGrupo) {
    setEditingId(g.id);
    setFormLabel(g.label);
    setFormCompany(g.company);
    setFormMembersRaw(g.members.join("\n"));
    setFormActive(g.active);
    setFormError("");
    setModal("edit");
  }

  function closeModal() {
    setModal("none");
    setEditingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);

    const members = parsedMembers(formMembersRaw);
    if (members.length === 0) {
      setFormError("Adicione pelo menos uma filial membro.");
      setSaving(false);
      return;
    }
    if (!formActive) {
      setFormError("Selecione a filial ativa.");
      setSaving(false);
      return;
    }
    if (!members.includes(formActive)) {
      setFormError("A filial ativa deve estar na lista de membros.");
      setSaving(false);
      return;
    }

    try {
      const payload = {
        id: editingId ?? undefined,
        label: formLabel,
        company: formCompany,
        members,
        active: formActive,
      };

      const url = modal === "edit" && editingId
        ? `/api/admin/filial-grupos/${editingId}`
        : "/api/admin/filial-grupos";
      const method = modal === "edit" ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");

      await loadGrupos();
      closeModal();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Remover o grupo "${label}"?`)) return;
    try {
      const res = await fetch(`/api/admin/filial-grupos/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao remover");
      await loadGrupos();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao remover");
    }
  }

  // Filiais derivadas do campo de texto para o select de ativa
  const membersForSelect = parsedMembers(formMembersRaw);

  // Agrupar por empresa para exibição
  const gruposPorEmpresa: Record<string, FilialGrupo[]> = {};
  for (const g of grupos) {
    if (!gruposPorEmpresa[g.company]) gruposPorEmpresa[g.company] = [];
    gruposPorEmpresa[g.company].push(g);
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <Link href="/admin" className={styles.backLink}>
            ← Voltar ao Painel Admin
          </Link>
          <h1 className={styles.title}>Grupos de Filiais</h1>
          <p className={styles.subtitle}>
            Defina quais filiais formam um grupo lógico e qual é a filial ativa para operações.
          </p>
        </div>
        <button type="button" className={styles.addButton} onClick={openAdd}>
          + Novo grupo
        </button>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p className={styles.loading}>Carregando...</p>
      ) : (
        Object.entries(gruposPorEmpresa).map(([company, gs]) => (
          <div key={company} style={{ marginBottom: 32 }}>
            <h2 style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              padding: "6px 12px",
              background: "#e2e8f0",
              borderRadius: 6,
              display: "inline-block",
            }}>
              {COMPANY_LABELS[company] ?? company.toUpperCase()}
            </h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th>Filiais Membros</th>
                    <th>Filial Ativa</th>
                    <th className={styles.actionsCol}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {gs.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <strong style={{ color: "#0f172a" }}>{g.label}</strong>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                          id: {g.id}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {g.members.map((m) => (
                            <span
                              key={m}
                              style={{
                                fontSize: 12,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: m === g.active ? "#dcfce7" : "#f1f5f9",
                                color: m === g.active ? "#166534" : "#475569",
                                fontWeight: m === g.active ? 600 : 400,
                                border: m === g.active ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                              }}
                            >
                              {m === g.active ? "✓ " : ""}{m}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#166534",
                          background: "#dcfce7",
                          padding: "4px 10px",
                          borderRadius: 20,
                          border: "1px solid #bbf7d0",
                        }}>
                          {g.active}
                        </span>
                      </td>
                      <td className={styles.actionsCol}>
                        <button
                          type="button"
                          className={styles.editBtn}
                          onClick={() => openEdit(g)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => handleDelete(g.id, g.label)}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {/* Nota informativa */}
      <div style={{
        marginTop: 24,
        padding: "14px 18px",
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: 8,
        fontSize: 13,
        color: "#1e40af",
        lineHeight: 1.6,
      }}>
        <strong>Como funciona:</strong> Filiais do mesmo grupo são somadas em vendas e estoque.
        Em operações (saída, entrada, transferência), apenas a filial ativa é usada.
        Permissões salvas com filiais históricas do grupo são automaticamente resolvidas para a ativa.
      </div>

      {/* Modal */}
      {modal !== "none" && (
        <div className={styles.overlay} onClick={closeModal}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className={styles.modalTitle}>
              {modal === "add" ? "Novo grupo" : "Editar grupo"}
            </h2>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.section}>
                <div className={styles.fieldGroup}>
                  <div className={styles.row2}>
                    <label className={styles.label}>
                      Nome do grupo
                      <input
                        type="text"
                        value={formLabel}
                        onChange={(e) => setFormLabel(e.target.value.toUpperCase())}
                        className={styles.input}
                        placeholder="Ex: MORUMBI 1"
                        required
                        disabled={saving}
                      />
                    </label>

                    <label className={styles.label}>
                      Empresa
                      <select
                        value={formCompany}
                        onChange={(e) => setFormCompany(e.target.value)}
                        className={styles.select}
                        disabled={saving}
                      >
                        <option value="nerd">NERD</option>
                        <option value="scarfme">SCARF ME</option>
                      </select>
                    </label>
                  </div>

                  <label className={styles.label}>
                    Filiais membros do grupo
                    <span className={styles.hint}>
                      Uma filial por linha. Copie o nome exato como aparece no ERP.
                    </span>
                    <textarea
                      value={formMembersRaw}
                      onChange={(e) => {
                        setFormMembersRaw(e.target.value);
                        // Se a ativa atual não está mais na lista, limpa
                        const parsed = e.target.value
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean);
                        if (formActive && !parsed.includes(formActive)) {
                          setFormActive("");
                        }
                      }}
                      className={styles.input}
                      rows={5}
                      placeholder={"NERD MORUMBI RDRRRJ\nNERD MORUMBI RDRX"}
                      required
                      disabled={saving}
                      style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                    />
                    {membersForSelect.length > 0 && (
                      <span className={styles.hint}>
                        {membersForSelect.length} filial{membersForSelect.length !== 1 ? "is" : ""} detectada{membersForSelect.length !== 1 ? "s" : ""}.
                      </span>
                    )}
                  </label>

                  <label className={styles.label}>
                    Filial ativa (operacional)
                    <span className={styles.hint}>
                      Usada em saídas, entradas e transferências. Deve estar na lista acima.
                    </span>
                    <select
                      value={formActive}
                      onChange={(e) => setFormActive(e.target.value)}
                      className={styles.select}
                      required
                      disabled={saving || membersForSelect.length === 0}
                    >
                      <option value="">Selecione...</option>
                      {membersForSelect.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
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
