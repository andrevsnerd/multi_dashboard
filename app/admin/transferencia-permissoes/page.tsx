"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthContext";
import { resolveCompany } from "@/lib/config/company";
import styles from "../page.module.css";

type PerfilPreset = "" | "nerd" | "scarfme";

interface TransferenciaPermissao {
  username: string;
  filiaisOrigem: string[];
  filiaisDestino: string[];
  tiposRomaneioPermitidos: string[];
  responsavelPadrao?: string;
  tipoRomaneioPadrao?: string;
  responsavelFixo: boolean;
  tipoRomaneioFixo: boolean;
  podeVerOutrasFiliais?: boolean;
}

interface Filial {
  codFilial: string;
  filial: string;
}

export default function TransferenciaPermissoesAdminPage() {
  const { user: currentUser } = useAuth();
  const [permissoes, setPermissoes] = useState<TransferenciaPermissao[]>([]);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [tiposRomaneio, setTiposRomaneio] = useState<string[]>([]);
  const [responsaveis, setResponsaveis] = useState<Array<{ responsavel: string; qtd: number }>>([]);
  const [usuarios, setUsuarios] = useState<Array<{ id: string; username: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"none" | "add" | "edit">("none");
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [formUsername, setFormUsername] = useState("");
  const [formFiliaisOrigem, setFormFiliaisOrigem] = useState<string[]>([]);
  const [formFiliaisDestino, setFormFiliaisDestino] = useState<string[]>([]);
  const [formTiposRomaneioPermitidos, setFormTiposRomaneioPermitidos] = useState<string[]>([]);
  const [formResponsavelPadrao, setFormResponsavelPadrao] = useState("");
  const [formTipoRomaneioPadrao, setFormTipoRomaneioPadrao] = useState("");
  const [formResponsavelFixo, setFormResponsavelFixo] = useState(false);
  const [formTipoRomaneioFixo, setFormTipoRomaneioFixo] = useState(false);
  const [formPodeVerOutrasFiliais, setFormPodeVerOutrasFiliais] = useState(false);
  const [perfilPreset, setPerfilPreset] = useState<PerfilPreset>("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const authHeader = (): Record<string, string> =>
    currentUser ? { "X-Auth-Username": currentUser.username } : {};

  async function loadFiliais() {
    try {
      const response = await fetch("/api/transferencia-produtos/filiais", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Erro ao carregar filiais");
      }
      const json = (await response.json()) as { data: Filial[] };
      setFiliais(json.data || []);
    } catch (error) {
      console.error("Erro ao carregar filiais", error);
    }
  }

  async function loadUsuarios() {
    try {
      const res = await fetch("/api/admin/users", { headers: authHeader() });
      if (!res.ok) {
        throw new Error("Erro ao carregar usuários");
      }
      const data = await res.json();
      setUsuarios(data);
    } catch (error) {
      console.error("Erro ao carregar usuários", error);
    }
  }

  async function loadTiposRomaneio() {
    try {
      const response = await fetch("/api/transferencia-produtos/tipos-romaneio", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Erro ao carregar tipos de romaneio");
      }
      const json = (await response.json()) as { data: string[] };
      setTiposRomaneio(json.data || []);
    } catch (error) {
      console.error("Erro ao carregar tipos de romaneio", error);
    }
  }

  async function loadResponsaveis() {
    try {
      const response = await fetch("/api/transferencia-produtos/responsaveis", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Erro ao carregar responsáveis");
      }
      const json = (await response.json()) as { data: Array<{ responsavel: string; qtd: number }> };
      setResponsaveis(json.data || []);
    } catch (error) {
      console.error("Erro ao carregar responsáveis", error);
    }
  }

  async function loadPermissoes() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/transferencia-permissoes", {
        headers: authHeader(),
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erro ao carregar permissões");
      }
      const data = await res.json();
      setPermissoes(data.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentUser?.username) {
      loadFiliais();
      loadUsuarios();
      loadTiposRomaneio();
      loadResponsaveis();
      loadPermissoes();
    }
  }, [currentUser?.username]);

  function aplicarPerfilPreset(perfil: PerfilPreset) {
    setPerfilPreset(perfil);
    if (!perfil) {
      setFormFiliaisOrigem([]);
      setFormFiliaisDestino([]);
      return;
    }
    const company = resolveCompany(perfil);
    if (!company) return;
    const filiaisPermitidas = company.filialFilters.inventory ?? [];
    const cods = filiais
      .filter((f) => filiaisPermitidas.includes(f.filial))
      .map((f) => f.codFilial);
    setFormFiliaisOrigem(cods);
    setFormFiliaisDestino(cods);
  }

  function openAdd() {
    setEditingUsername(null);
    setPerfilPreset("");
    setFormUsername("");
    setFormFiliaisOrigem([]);
    setFormFiliaisDestino([]);
    setFormTiposRomaneioPermitidos([]);
    setFormResponsavelPadrao("");
    setFormTipoRomaneioPadrao("");
    setFormResponsavelFixo(false);
    setFormTipoRomaneioFixo(false);
    setFormPodeVerOutrasFiliais(false);
    setFormError("");
    setModal("add");
  }

  function openEdit(perm: TransferenciaPermissao) {
    setEditingUsername(perm.username);
    setPerfilPreset("");
    setFormUsername(perm.username);
    setFormFiliaisOrigem(perm.filiaisOrigem);
    setFormFiliaisDestino(perm.filiaisDestino);
    setFormTiposRomaneioPermitidos(perm.tiposRomaneioPermitidos || []);
    setFormResponsavelPadrao(perm.responsavelPadrao || "");
    setFormTipoRomaneioPadrao(perm.tipoRomaneioPadrao || "");
    setFormResponsavelFixo(perm.responsavelFixo);
    setFormTipoRomaneioFixo(perm.tipoRomaneioFixo);
    setFormPodeVerOutrasFiliais(perm.podeVerOutrasFiliais ?? false);
    setFormError("");
    setModal("edit");
  }

  function closeModal() {
    setModal("none");
    setEditingUsername(null);
  }

  function toggleFilialOrigem(codFilial: string) {
    setFormFiliaisOrigem((prev) =>
      prev.includes(codFilial)
        ? prev.filter((f) => f !== codFilial)
        : [...prev, codFilial]
    );
  }

  function toggleFilialDestino(codFilial: string) {
    setFormFiliaisDestino((prev) =>
      prev.includes(codFilial)
        ? prev.filter((f) => f !== codFilial)
        : [...prev, codFilial]
    );
  }

  function toggleTipoRomaneio(tipo: string) {
    setFormTiposRomaneioPermitidos((prev) =>
      prev.includes(tipo)
        ? prev.filter((t) => t !== tipo)
        : [...prev, tipo]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/transferencia-permissoes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader(),
        },
        body: JSON.stringify({
          username: formUsername,
          filiaisOrigem: formFiliaisOrigem,
          filiaisDestino: formFiliaisDestino,
          tiposRomaneioPermitidos: formTiposRomaneioPermitidos,
          responsavelPadrao: formResponsavelPadrao || undefined,
          tipoRomaneioPadrao: formTipoRomaneioPadrao || undefined,
          responsavelFixo: formResponsavelFixo,
          tipoRomaneioFixo: formTipoRomaneioFixo,
          podeVerOutrasFiliais: formPodeVerOutrasFiliais,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar permissão");
      await loadPermissoes();
      closeModal();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(username: string) {
    if (!confirm(`Remover as permissões do usuário "${username}"?`)) return;
    try {
      const res = await fetch(
        `/api/admin/transferencia-permissoes?username=${encodeURIComponent(username)}`,
        {
          method: "DELETE",
          headers: authHeader(),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erro ao remover permissão");
      }
      await loadPermissoes();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao remover");
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <Link href="/admin" className={styles.backLink}>
            ← Voltar para Admin
          </Link>
          <h1 className={styles.title}>Permissões de Transferência</h1>
          <p className={styles.subtitle}>
            Configure quais filiais cada usuário pode visualizar e usar
          </p>
        </div>
        <button className={styles.addButton} onClick={openAdd}>
          + Adicionar Permissão
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>Carregando...</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Filiais Origem</th>
                <th>Filiais Destino</th>
                <th>Tipos Romaneio</th>
                <th>Responsável Padrão</th>
                <th>Tipo Romaneio Padrão</th>
                <th>Fixo</th>
                <th>Ver outras</th>
                <th className={styles.actionsCol}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {permissoes.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: "32px" }}>
                    Nenhuma permissão configurada
                  </td>
                </tr>
              ) : (
                permissoes.map((perm) => (
                  <tr key={perm.username}>
                    <td>{perm.username}</td>
                    <td>
                      {perm.filiaisOrigem.length === 0
                        ? "Todas"
                        : perm.filiaisOrigem
                            .map(
                              (cod) =>
                                filiais.find((f) => f.codFilial === cod)?.filial || cod
                            )
                            .join(", ")}
                    </td>
                    <td>
                      {perm.filiaisDestino.length === 0
                        ? "Todas"
                        : perm.filiaisDestino
                            .map(
                              (cod) =>
                                filiais.find((f) => f.codFilial === cod)?.filial || cod
                            )
                            .join(", ")}
                    </td>
                    <td>
                      {perm.tiposRomaneioPermitidos?.length === 0
                        ? "Todos"
                        : perm.tiposRomaneioPermitidos?.join(", ") || "Todos"}
                    </td>
                    <td>{perm.responsavelPadrao || "—"}</td>
                    <td>{perm.tipoRomaneioPadrao || "—"}</td>
                    <td>
                      {perm.responsavelFixo && "Responsável"}
                      {perm.responsavelFixo && perm.tipoRomaneioFixo && " + "}
                      {perm.tipoRomaneioFixo && "Tipo"}
                      {!perm.responsavelFixo && !perm.tipoRomaneioFixo && "—"}
                    </td>
                    <td>{perm.podeVerOutrasFiliais ? "Sim" : "—"}</td>
                    <td className={styles.actionsCol}>
                      <button
                        className={styles.editBtn}
                        onClick={() => openEdit(perm)}
                      >
                        Editar
                      </button>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(perm.username)}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal !== "none" && (
        <div className={styles.overlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>
              {modal === "add" ? "Adicionar Permissão" : "Editar Permissão"}
            </h2>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.label}>
                <label>Usuário</label>
                {modal === "add" ? (
                  <select
                    className={styles.select}
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    required
                  >
                    <option value="">Selecione um usuário</option>
                    {usuarios
                      .filter((u) => !permissoes.some((p) => p.username === u.username))
                      .map((u) => (
                        <option key={u.id} value={u.username}>
                          {u.username}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className={styles.input}
                    value={formUsername}
                    disabled
                  />
                )}
              </div>

              <div className={styles.label}>
                <label>Perfil (pré-seleção rápida)</label>
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  Ao selecionar NERD ou SCARF ME, marca todas as filiais habilitadas no dashboard (incluindo matriz e e-commerce).
                  Você pode editar depois.
                </p>
                <select
                  className={styles.select}
                  value={perfilPreset}
                  onChange={(e) => aplicarPerfilPreset(e.target.value as PerfilPreset)}
                >
                  <option value="">Nenhum perfil</option>
                  <option value="nerd">NERD — todas as filiais</option>
                  <option value="scarfme">SCARF ME — todas as filiais</option>
                </select>
              </div>

              <div className={styles.label}>
                <label>Filiais de Origem Permitidas</label>
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  Deixe vazio para permitir todas. Selecione múltiplas filiais.
                </p>
                <div
                  className={styles.checkboxList}
                  style={{ maxHeight: "150px", overflowY: "auto" }}
                >
                  {filiais.map((f) => (
                    <label key={f.codFilial} className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={formFiliaisOrigem.includes(f.codFilial)}
                        onChange={() => toggleFilialOrigem(f.codFilial)}
                      />
                      <span>
                        {f.filial} ({f.codFilial})
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={styles.label}>
                <label>Filiais de Destino Permitidas</label>
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  Deixe vazio para permitir todas. Selecione múltiplas filiais.
                </p>
                <div
                  className={styles.checkboxList}
                  style={{ maxHeight: "150px", overflowY: "auto" }}
                >
                  {filiais.map((f) => (
                    <label key={f.codFilial} className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={formFiliaisDestino.includes(f.codFilial)}
                        onChange={() => toggleFilialDestino(f.codFilial)}
                      />
                      <span>
                        {f.filial} ({f.codFilial})
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={styles.label}>
                <label>Tipos de Romaneio Permitidos</label>
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  Deixe vazio para permitir todos. Selecione múltiplos tipos.
                </p>
                <div
                  className={styles.checkboxList}
                  style={{ maxHeight: "150px", overflowY: "auto" }}
                >
                  {tiposRomaneio.map((tipo) => (
                    <label key={tipo} className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={formTiposRomaneioPermitidos.includes(tipo)}
                        onChange={() => toggleTipoRomaneio(tipo)}
                      />
                      <span>{tipo}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={styles.label}>
                <label>Responsável Padrão</label>
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  Selecione um usuário cadastrado no banco (tabela USERS)
                </p>
                <input
                  type="text"
                  list="responsaveis-list"
                  className={styles.input}
                  value={formResponsavelPadrao}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    setFormResponsavelPadrao(value);
                  }}
                  onBlur={(e) => {
                    const value = e.target.value.trim().toUpperCase();
                    // Validar se o valor existe na lista
                    if (value && !responsaveis.some(r => r.responsavel.toUpperCase() === value)) {
                      setFormError("Responsável deve existir na lista de responsáveis disponíveis");
                      setFormResponsavelPadrao("");
                    } else {
                      setFormError("");
                    }
                  }}
                  placeholder="Ex: LOGISTICA"
                />
                <datalist id="responsaveis-list">
                  {responsaveis.map((resp) => (
                    <option key={resp.responsavel} value={resp.responsavel}>
                      {resp.responsavel}
                    </option>
                  ))}
                </datalist>
              </div>

              <div className={styles.label}>
                <label>Tipo de Romaneio Padrão</label>
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  Selecione ou digite um tipo existente
                </p>
                <input
                  type="text"
                  list="tipos-romaneio-list"
                  className={styles.input}
                  value={formTipoRomaneioPadrao}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    setFormTipoRomaneioPadrao(value);
                  }}
                  onBlur={(e) => {
                    const value = e.target.value.trim().toUpperCase();
                    // Validar se o valor existe na lista
                    if (value && !tiposRomaneio.some(t => t.toUpperCase() === value)) {
                      setFormError("Tipo de romaneio deve existir na lista de tipos disponíveis");
                      setFormTipoRomaneioPadrao("");
                    } else {
                      setFormError("");
                    }
                  }}
                  placeholder="Ex: TRANSFERENCIA ENTRE LOJAS"
                />
                <datalist id="tipos-romaneio-list">
                  {tiposRomaneio.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {tipo}
                    </option>
                  ))}
                </datalist>
              </div>

              <div className={styles.label}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={formResponsavelFixo}
                    onChange={(e) => setFormResponsavelFixo(e.target.checked)}
                  />
                  <span>Responsável fixo (não permite alterar)</span>
                </label>
              </div>

              <div className={styles.label}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={formTipoRomaneioFixo}
                    onChange={(e) => setFormTipoRomaneioFixo(e.target.checked)}
                  />
                  <span>Tipo de romaneio fixo (não permite alterar)</span>
                </label>
              </div>

              <div className={styles.label}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={formPodeVerOutrasFiliais}
                    onChange={(e) => setFormPodeVerOutrasFiliais(e.target.checked)}
                  />
                  <span>Permitir ver outras filiais (sem poder transferir)</span>
                </label>
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  Se marcado, o usuário vê todas as origens e destinos, mas só pode executar transferências nas filiais permitidas acima.
                </p>
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
    </div>
  );
}
