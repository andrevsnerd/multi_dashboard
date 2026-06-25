"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanyKey } from "@/lib/config/company";
import type { Fornecedor, FornecedorItem, FornecedorModo } from "@/lib/utils/fornecedor-matcher";
import styles from "./page.module.css";

interface Props {
  companyKey: CompanyKey;
}

interface SearchResult {
  productId: string;
  productName: string;
  matchedColorCode: string | null;
  matchedColorName: string | null;
}

const EMPTY_FORM: Fornecedor = {
  id: "",
  company: "nerd",
  nome: "",
  modo: "explicito",
  termosDescricao: [],
  itens: [],
  ignorarFornecedorIds: [],
  createdAt: "",
  updatedAt: "",
};

export default function FornecedoresPage({ companyKey }: Props) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal
  const [modal, setModal] = useState<"none" | "add" | "edit">("none");
  const [form, setForm] = useState<Fornecedor>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Editor de termos
  const [termoInput, setTermoInput] = useState("");

  // Busca de produto (itens específicos)
  const [produtoQuery, setProdutoQuery] = useState("");
  const [produtoResults, setProdutoResults] = useState<SearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/fornecedores?company=${companyKey}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Erro ao carregar fornecedores");
      const json = await res.json();
      setFornecedores(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [companyKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Modal helpers ── */
  function openAdd() {
    setForm({ ...EMPTY_FORM, company: companyKey });
    setTermoInput("");
    clearProduto();
    setFormError("");
    setModal("add");
  }

  function openEdit(f: Fornecedor) {
    setForm({ ...f });
    setTermoInput("");
    clearProduto();
    setFormError("");
    setModal("edit");
  }

  function closeModal() {
    setModal("none");
  }

  /* ── Termos de descrição ── */
  function addTermo() {
    const t = termoInput.trim();
    if (!t) return;
    setForm((prev) =>
      prev.termosDescricao.some((x) => x.toUpperCase() === t.toUpperCase())
        ? prev
        : { ...prev, termosDescricao: [...prev.termosDescricao, t] }
    );
    setTermoInput("");
  }

  function removeTermo(termo: string) {
    setForm((prev) => ({ ...prev, termosDescricao: prev.termosDescricao.filter((t) => t !== termo) }));
  }

  /* ── Itens específicos ── */
  const runSearch = useCallback(
    async (term: string) => {
      if (!term || term.trim().length < 2) {
        setProdutoResults([]);
        return;
      }
      try {
        const res = await fetch(
          `/api/products/search?company=${encodeURIComponent(companyKey)}&q=${encodeURIComponent(term)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          setProdutoResults([]);
          return;
        }
        const json = (await res.json()) as { data: SearchResult[] };
        setProdutoResults(json.data ?? []);
      } catch {
        setProdutoResults([]);
      }
    },
    [companyKey]
  );

  function onProdutoQueryChange(value: string) {
    setProdutoQuery(value);
    setDropdownOpen(true);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => void runSearch(value), 300);
  }

  function addItem(r: SearchResult) {
    const novo: FornecedorItem = { produto: r.productId, cor: r.matchedColorCode ?? null };
    setForm((prev) => {
      const exists = prev.itens.some(
        (i) => i.produto === novo.produto && (i.cor ?? "") === (novo.cor ?? "")
      );
      if (exists) return prev;
      return { ...prev, itens: [...prev.itens, novo] };
    });
    clearProduto();
  }

  function removeItem(idx: number) {
    setForm((prev) => ({ ...prev, itens: prev.itens.filter((_, i) => i !== idx) }));
  }

  function clearProduto() {
    setProdutoQuery("");
    setProdutoResults([]);
    setDropdownOpen(false);
  }

  // Fecha dropdown ao clicar fora / Esc
  useEffect(() => {
    if (!dropdownOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dropdownOpen]);

  /* ── Ignorar fornecedores (complemento) ── */
  function toggleIgnorar(id: string) {
    setForm((prev) => ({
      ...prev,
      ignorarFornecedorIds: prev.ignorarFornecedorIds.includes(id)
        ? prev.ignorarFornecedorIds.filter((x) => x !== id)
        : [...prev.ignorarFornecedorIds, id],
    }));
  }

  /* ── Submit ── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.nome.trim()) {
      setFormError("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      const isEdit = modal === "edit" && form.id;
      const url = isEdit ? `/api/fornecedores/${encodeURIComponent(form.id)}` : "/api/fornecedores";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");
      await load();
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(f: Fornecedor) {
    if (!confirm(`Remover o fornecedor "${f.nome}"?`)) return;
    try {
      const res = await fetch(`/api/fornecedores/${encodeURIComponent(f.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Erro ao remover");
      }
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao remover");
    }
  }

  const outrosFornecedores = fornecedores.filter((f) => f.id !== form.id);

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Grupos de Fornecedores</h1>
          <p className={styles.subtitle}>
            Classifique os produtos NERD por fornecedor (Externo / Centro) e use como filtro na Curva
            ABC, Lista Loja e Gerador de Relatórios.
          </p>
        </div>
        <button type="button" className={styles.addButton} onClick={openAdd}>
          + Adicionar fornecedor
        </button>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p className={styles.loading}>Carregando...</p>
      ) : (
        <div className={styles.cards}>
          {fornecedores.map((f) => (
            <div key={f.id} className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <span className={styles.cardName}>{f.nome}</span>
                  <span className={`${styles.badge} ${f.modo === "complemento" ? styles.badgeCentro : styles.badgeExterno}`}>
                    {f.modo === "complemento" ? "Centro (complemento)" : "Externo (explícito)"}
                  </span>
                </div>
                <div className={styles.cardActions}>
                  <button type="button" className={styles.editBtn} onClick={() => openEdit(f)}>
                    Editar
                  </button>
                  <button type="button" className={styles.deleteBtn} onClick={() => handleDelete(f)}>
                    Remover
                  </button>
                </div>
              </div>
              <div className={styles.cardBody}>
                {f.modo === "explicito" ? (
                  <>
                    <div className={styles.cardRow}>
                      <span className={styles.cardLabel}>Marcas ({f.termosDescricao.length}):</span>{" "}
                      <span className={styles.cardValue}>
                        {f.termosDescricao.length ? f.termosDescricao.join(", ") : "—"}
                      </span>
                    </div>
                    <div className={styles.cardRow}>
                      <span className={styles.cardLabel}>Itens específicos:</span>{" "}
                      <span className={styles.cardValue}>{f.itens.length}</span>
                    </div>
                  </>
                ) : (
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>Ignora:</span>{" "}
                    <span className={styles.cardValue}>
                      {f.ignorarFornecedorIds.length
                        ? f.ignorarFornecedorIds
                            .map((id) => fornecedores.find((x) => x.id === id)?.nome ?? id)
                            .join(", ")
                        : "nenhum (captura tudo)"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal ── */}
      {modal !== "none" && (
        <div className={styles.overlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className={styles.modalTitle}>
              {modal === "add" ? "Adicionar fornecedor" : "Editar fornecedor"}
            </h2>
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                Nome
                <input
                  type="text"
                  className={styles.input}
                  value={form.nome}
                  onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
                  placeholder="Ex: Fornecedor Externo"
                  disabled={saving}
                />
              </label>

              <label className={styles.label}>
                Tipo
                <select
                  className={styles.select}
                  value={form.modo}
                  onChange={(e) => setForm((p) => ({ ...p, modo: e.target.value as FornecedorModo }))}
                  disabled={saving}
                >
                  <option value="explicito">Externo — captura por marcas / itens</option>
                  <option value="complemento">Centro — complemento (tudo menos outros)</option>
                </select>
              </label>

              {form.modo === "explicito" ? (
                <>
                  {/* Marcas */}
                  <div className={styles.section}>
                    <p className={styles.sectionTitle}>Marcas na descrição</p>
                    <span className={styles.hint}>
                      Casa qualquer produto cuja descrição contenha o termo (ex.: GEONAV).
                    </span>
                    <div className={styles.termoInputRow}>
                      <input
                        type="text"
                        className={styles.input}
                        value={termoInput}
                        onChange={(e) => setTermoInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addTermo();
                          }
                        }}
                        placeholder="Digite uma marca e Enter"
                        disabled={saving}
                      />
                      <button type="button" className={styles.smallBtn} onClick={addTermo} disabled={saving}>
                        Adicionar
                      </button>
                    </div>
                    <div className={styles.chips}>
                      {form.termosDescricao.map((t) => (
                        <span key={t} className={styles.chip}>
                          {t}
                          <button type="button" onClick={() => removeTermo(t)} className={styles.chipX}>
                            ×
                          </button>
                        </span>
                      ))}
                      {form.termosDescricao.length === 0 && (
                        <span className={styles.empty}>Nenhuma marca.</span>
                      )}
                    </div>
                  </div>

                  {/* Itens específicos */}
                  <div className={styles.section}>
                    <p className={styles.sectionTitle}>Itens específicos</p>
                    <span className={styles.hint}>
                      Busque por código, código de barras (EAN) ou nome. Sem cor = todas as cores.
                    </span>
                    <div className={styles.searchWrap} ref={searchWrapRef}>
                      <input
                        type="text"
                        className={styles.input}
                        value={produtoQuery}
                        onChange={(e) => onProdutoQueryChange(e.target.value)}
                        onFocus={() => produtoResults.length > 0 && setDropdownOpen(true)}
                        placeholder="Buscar produto..."
                        disabled={saving}
                      />
                      {dropdownOpen && produtoResults.length > 0 && (
                        <div className={styles.dropdown}>
                          {produtoResults.map((r) => (
                            <button
                              type="button"
                              key={`${r.productId}-${r.matchedColorCode ?? ""}`}
                              className={styles.dropdownItem}
                              onClick={() => addItem(r)}
                            >
                              <strong>{r.productName}</strong> ({r.productId})
                              {r.matchedColorCode ? ` — cor ${r.matchedColorName ?? r.matchedColorCode}` : ""}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className={styles.itemList}>
                      {form.itens.map((i, idx) => (
                        <div key={`${i.produto}-${i.cor ?? ""}-${idx}`} className={styles.itemRow}>
                          <span>
                            {i.produto}
                            {i.cor ? ` — cor ${i.cor}` : " — todas as cores"}
                          </span>
                          <button type="button" onClick={() => removeItem(idx)} className={styles.chipX}>
                            ×
                          </button>
                        </div>
                      ))}
                      {form.itens.length === 0 && <span className={styles.empty}>Nenhum item específico.</span>}
                    </div>
                  </div>
                </>
              ) : (
                <div className={styles.section}>
                  <p className={styles.sectionTitle}>Ignorar estes fornecedores</p>
                  <span className={styles.hint}>
                    O complemento captura tudo que NÃO for capturado pelos fornecedores marcados.
                  </span>
                  <div className={styles.checkboxList}>
                    {outrosFornecedores.map((f) => (
                      <label key={f.id} className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={form.ignorarFornecedorIds.includes(f.id)}
                          onChange={() => toggleIgnorar(f.id)}
                          disabled={saving}
                        />
                        {f.nome}
                      </label>
                    ))}
                    {outrosFornecedores.length === 0 && (
                      <span className={styles.empty}>Nenhum outro fornecedor cadastrado.</span>
                    )}
                  </div>
                </div>
              )}

              {formError && <p className={styles.formError}>{formError}</p>}

              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={closeModal} disabled={saving}>
                  Cancelar
                </button>
                <button type="submit" className={styles.saveBtn} disabled={saving}>
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
