"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import styles from "../page.module.css";

interface FilialGrupo {
  id: string;
  label: string;
  company: string;
  members: string[];         // COD_FILIAL
  active: string;            // COD_FILIAL — canônica VIVA (detectada pela última venda)
  configuredActive?: string; // COD_FILIAL — ativa estática configurada (fallback)
  autoDetected?: boolean;    // true quando `active` veio da regra de última venda
}

interface FilialOption {
  id: string;        // COD_FILIAL
  company: string;
  display: string;   // nome curto de exibição
  dbName: string;    // nome vivo no banco
  ecommerce: boolean;
}

type ModalMode = "none" | "add" | "edit";

const COMPANY_LABELS: Record<string, string> = {
  nerd: "NERD",
  scarfme: "SCARF ME",
};

export default function FilialGruposPage() {
  const [grupos, setGrupos] = useState<FilialGrupo[]>([]);
  const [available, setAvailable] = useState<FilialOption[]>([]);
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
  const [formMemberIds, setFormMemberIds] = useState<string[]>([]);
  const [formActive, setFormActive] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [gruposRes, filiaisRes] = await Promise.all([
        fetch("/api/admin/filial-grupos"),
        fetch("/api/admin/filiais-disponiveis"),
      ]);
      const gruposData = await gruposRes.json();
      const filiaisData = await filiaisRes.json();
      if (!gruposRes.ok) throw new Error(gruposData.error ?? "Erro ao carregar grupos");
      if (!filiaisRes.ok) throw new Error(filiaisData.error ?? "Erro ao carregar filiais");
      setGrupos(gruposData.data ?? []);
      setAvailable(filiaisData.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // COD_FILIAL -> opção (para rotular membros pelo nome em vez do código)
  const optionById = useMemo(() => {
    const m = new Map<string, FilialOption>();
    for (const f of available) m.set(f.id, f);
    return m;
  }, [available]);

  const filialLabel = useCallback(
    (id: string): string => {
      const f = optionById.get(id);
      if (!f) return id;
      return f.display === f.dbName ? f.display : `${f.display} · ${f.dbName}`;
    },
    [optionById]
  );

  // Filiais disponíveis para a empresa do formulário
  const availableForForm = useMemo(
    () => available.filter((f) => f.company === formCompany),
    [available, formCompany]
  );

  function resetForm() {
    setFormLabel("");
    setFormCompany("nerd");
    setFormMemberIds([]);
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
    setFormMemberIds(g.members);
    // Edita a ativa CONFIGURADA (fallback estático), não a canônica detectada ao vivo —
    // do contrário salvaríamos a detecção do momento como fallback fixo.
    setFormActive(g.configuredActive ?? g.active);
    setFormError("");
    setModal("edit");
  }

  function closeModal() {
    setModal("none");
    setEditingId(null);
  }

  function toggleMember(id: string) {
    setFormMemberIds((prev) => {
      const next = prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id];
      if (!next.includes(formActive)) setFormActive("");
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (formMemberIds.length === 0) {
      setFormError("Selecione pelo menos uma filial membro.");
      return;
    }
    if (!formActive) {
      setFormError("Selecione a filial ativa.");
      return;
    }
    if (!formMemberIds.includes(formActive)) {
      setFormError("A filial ativa deve estar entre os membros.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        id: editingId ?? undefined,
        label: formLabel,
        company: formCompany,
        members: formMemberIds,
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

      await loadData();
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
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao remover");
    }
  }

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
            As filiais são identificadas pelo número (COD_FILIAL), então renomeá-las no ERP não quebra o grupo.
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
                              {m === g.active ? "✓ " : ""}{filialLabel(m)}
                              <span style={{ color: "#94a3b8", marginLeft: 4 }}>#{m}</span>
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
                          {filialLabel(g.active)}
                        </span>
                        {g.autoDetected && (
                          <div style={{ fontSize: 10, color: "#0284c7", marginTop: 4, fontWeight: 600 }}>
                            ⟳ detectada pela última venda
                          </div>
                        )}
                        {g.configuredActive && g.configuredActive !== g.active && (
                          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                            configurada: {filialLabel(g.configuredActive)}
                          </div>
                        )}
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
        As filiais são referenciadas pelo número (COD_FILIAL); o nome exibido vem do banco.
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
                        onChange={(e) => {
                          setFormCompany(e.target.value);
                          setFormMemberIds([]);
                          setFormActive("");
                        }}
                        className={styles.select}
                        disabled={saving || modal === "edit"}
                      >
                        <option value="nerd">NERD</option>
                        <option value="scarfme">SCARF ME</option>
                      </select>
                    </label>
                  </div>

                  <div className={styles.label}>
                    Filiais membros do grupo
                    <span className={styles.hint}>
                      Marque as filiais que compõem o grupo. Identificadas pelo número (COD_FILIAL).
                    </span>
                    <div style={{
                      maxHeight: 240,
                      overflowY: "auto",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      padding: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}>
                      {availableForForm.length === 0 ? (
                        <span style={{ fontSize: 12, color: "#94a3b8", padding: 6 }}>
                          Nenhuma filial disponível.
                        </span>
                      ) : (
                        availableForForm.map((f) => {
                          const checked = formMemberIds.includes(f.id);
                          return (
                            <label
                              key={f.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "5px 6px",
                                borderRadius: 4,
                                cursor: saving ? "default" : "pointer",
                                background: checked ? "#eff6ff" : "transparent",
                                fontSize: 13,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleMember(f.id)}
                                disabled={saving}
                              />
                              <span style={{ fontWeight: 600, color: "#0f172a" }}>{f.display}</span>
                              <span style={{ color: "#64748b" }}>{f.dbName}</span>
                              <span style={{ color: "#cbd5e1", marginLeft: "auto", fontSize: 11 }}>#{f.id}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                    {formMemberIds.length > 0 && (
                      <span className={styles.hint}>
                        {formMemberIds.length} filial{formMemberIds.length !== 1 ? "is" : ""} selecionada{formMemberIds.length !== 1 ? "s" : ""}.
                      </span>
                    )}
                  </div>

                  <label className={styles.label}>
                    Filial ativa (operacional)
                    <span className={styles.hint}>
                      Usada em saídas, entradas e transferências. Deve estar entre os membros.
                    </span>
                    <select
                      value={formActive}
                      onChange={(e) => setFormActive(e.target.value)}
                      className={styles.select}
                      required
                      disabled={saving || formMemberIds.length === 0}
                    >
                      <option value="">Selecione...</option>
                      {formMemberIds.map((id) => (
                        <option key={id} value={id}>
                          {filialLabel(id)}
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
