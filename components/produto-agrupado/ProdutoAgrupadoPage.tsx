"use client";

import { useEffect, useMemo, useState } from "react";

import type { CompanyKey } from "@/lib/config/company";
import type { ProdutoAgrupadoGroup, ProdutoAgrupadoMember } from "@/lib/utils/produtos-agrupados";

import styles from "./ProdutoAgrupadoPage.module.css";

type ProductSearchResult = {
  productId: string;
  productName: string;
  matchedColorCode?: string | null;
  matchedColorName?: string | null;
};

interface ProdutoAgrupadoPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

const EMPTY_FORM = {
  groupId: null as string | null,
  nome: "",
  members: [] as ProdutoAgrupadoMember[],
};

export default function ProdutoAgrupadoPage({
  companyKey,
  companyName,
}: ProdutoAgrupadoPageProps) {
  const [groups, setGroups] = useState<ProdutoAgrupadoGroup[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedMembers = useMemo(
    () =>
      [...form.members].sort(
        (a, b) => a.descricao.localeCompare(b.descricao, "pt-BR") || a.produto.localeCompare(b.produto, "pt-BR")
      ),
    [form.members]
  );

  async function loadGroups() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/produtos-agrupados?company=${encodeURIComponent(companyKey)}`, {
        cache: "no-store",
      });
      const json = (await response.json()) as { data?: ProdutoAgrupadoGroup[]; error?: string };

      if (!response.ok) {
        throw new Error(json.error || "Não foi possível carregar os grupos.");
      }

      setGroups(json.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os grupos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGroups();
  }, [companyKey]);

  useEffect(() => {
    if (searchTerm.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/products/search?q=${encodeURIComponent(searchTerm.trim())}`, {
          cache: "no-store",
        });
        const json = (await response.json()) as { data?: ProductSearchResult[] };
        if (!cancelled) {
          setSearchResults(json.data ?? []);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchTerm]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setSearchTerm("");
    setSearchResults([]);
    setFeedback(null);
    setError(null);
  }

  function addMember(result: ProductSearchResult) {
    setForm((current) => {
      if (current.members.some((member) => member.produto === result.productId)) {
        return current;
      }

      return {
        ...current,
        members: [
          ...current.members,
          {
            produto: result.productId,
            cor: "",
            descricao: result.productName,
            corDescricao: "",
          },
        ],
      };
    });

    setSearchTerm("");
    setSearchResults([]);
    setFeedback(null);
  }

  function removeMember(productId: string) {
    setForm((current) => ({
      ...current,
      members: current.members.filter((member) => member.produto !== productId),
    }));
  }

  function startEdit(group: ProdutoAgrupadoGroup) {
    setForm({
      groupId: group.id,
      nome: group.nome,
      members: group.members,
    });
    setSearchTerm("");
    setSearchResults([]);
    setFeedback(null);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch("/api/produtos-agrupados", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company: companyKey,
          groupId: form.groupId,
          nome: form.nome,
          members: form.members,
        }),
      });

      const json = (await response.json()) as { data?: ProdutoAgrupadoGroup; error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Não foi possível salvar o grupo.");
      }

      await loadGroups();
      resetForm();
      setFeedback(`Grupo salvo com sucesso em ${companyName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o grupo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(group: ProdutoAgrupadoGroup) {
    const confirmed = window.confirm(`Excluir o grupo "${group.nome}"?`);
    if (!confirmed) return;

    setError(null);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/produtos-agrupados?company=${encodeURIComponent(companyKey)}&groupId=${encodeURIComponent(group.id)}`,
        {
          method: "DELETE",
        }
      );
      const json = (await response.json()) as { removed?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Não foi possível excluir o grupo.");
      }

      if (form.groupId === group.id) {
        resetForm();
      }

      await loadGroups();
      setFeedback(`Grupo "${group.nome}" removido.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir o grupo.");
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.title}>Produto Agrupado</h1>
          <p className={styles.subtitle}>
            Crie um produto grupo para juntar cadastros diferentes do mesmo item e tratar vendas, estoque,
            faturamento e sugestão como uma única entidade de análise.
          </p>
        </div>
        <div className={styles.note}>
          <strong>Exemplo</strong>
          <span>`CAPA COURO P AZUL` + `CAPA COURO B AZUL` → `CAPA COURO AZUL`</span>
        </div>
      </div>

      <div className={styles.grid}>
        <section className={styles.editorCard}>
          <div className={styles.cardHeader}>
            <h2>{form.groupId ? "Editar grupo" : "Novo grupo"}</h2>
            {form.groupId && (
              <button type="button" className={styles.secondaryButton} onClick={resetForm}>
                Novo grupo
              </button>
            )}
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Nome do grupo</span>
            <input
              className={styles.input}
              type="text"
              placeholder="Ex.: CAPA COURO AZUL"
              value={form.nome}
              onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Adicionar produtos</span>
            <input
              className={styles.input}
              type="search"
              placeholder="Busque por nome, código ou código de barras"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>

          {(searching || searchResults.length > 0 || searchTerm.trim().length >= 2) && (
            <div className={styles.searchPanel}>
              {searching ? (
                <div className={styles.searchEmpty}>Buscando produtos...</div>
              ) : searchResults.length === 0 ? (
                <div className={styles.searchEmpty}>Nenhum produto encontrado.</div>
              ) : (
                searchResults.map((result) => (
                  <button
                    key={`${result.productId}-${result.matchedColorCode ?? "all"}`}
                    type="button"
                    className={styles.searchItem}
                    onClick={() => addMember(result)}
                  >
                    <span className={styles.searchName}>{result.productName}</span>
                    <span className={styles.searchCode}>{result.productId}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <div className={styles.membersHeader}>
            <h3>Produtos do grupo</h3>
            <span>{sortedMembers.length} item(ns)</span>
          </div>

          {sortedMembers.length === 0 ? (
            <div className={styles.emptyState}>Adicione ao menos 2 produtos para formar o grupo.</div>
          ) : (
            <div className={styles.membersList}>
              {sortedMembers.map((member) => (
                <div key={member.produto} className={styles.memberItem}>
                  <div>
                    <div className={styles.memberName}>{member.descricao || member.produto}</div>
                    <div className={styles.memberCode}>{member.produto}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeMember(member.produto)}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          )}

          {feedback && <div className={styles.feedback}>{feedback}</div>}
          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : form.groupId ? "Salvar alterações" : "Criar grupo"}
            </button>
          </div>
        </section>

        <section className={styles.listCard}>
          <div className={styles.cardHeader}>
            <h2>Grupos salvos</h2>
            <span>{groups.length} grupo(s)</span>
          </div>

          {loading ? (
            <div className={styles.emptyState}>Carregando grupos...</div>
          ) : groups.length === 0 ? (
            <div className={styles.emptyState}>Nenhum grupo cadastrado ainda.</div>
          ) : (
            <div className={styles.groupList}>
              {groups.map((group) => (
                <article key={group.id} className={styles.groupItem}>
                  <div className={styles.groupTop}>
                    <div>
                      <h3 className={styles.groupName}>{group.nome}</h3>
                      <div className={styles.groupMeta}>{group.members.length} item(ns) agrupados</div>
                    </div>
                    <div className={styles.groupActions}>
                      <button type="button" className={styles.secondaryButton} onClick={() => startEdit(group)}>
                        Editar
                      </button>
                      <button type="button" className={styles.deleteButton} onClick={() => handleDelete(group)}>
                        Excluir
                      </button>
                    </div>
                  </div>

                  <div className={styles.groupMembers}>
                    {group.members.map((member) => (
                      <div key={member.produto} className={styles.groupMemberChip}>
                        <span>{member.descricao || member.produto}</span>
                        <strong>{member.produto}</strong>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
