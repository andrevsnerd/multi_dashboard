"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import styles from "../loja-admin.module.css";

interface CatalogoItem {
  produto: string;
  precoAtacado: number;
  subgrupo: string;
  ativo: boolean;
  ordem: number;
  descProduto: string;
  ean: string;
}
interface BuscaResult {
  produto: string;
  descProduto: string;
  subgrupo: string;
  ean: string;
}
interface ProdutoImagem {
  produto: string;
  cor: string;
  posicao: number;
  dataUrl: string;
}

export default function CatalogoAdminPage() {
  const { user } = useAuth();
  const authHeader = useCallback(
    (): Record<string, string> => (user ? { "X-Auth-Username": user.username } : {}),
    [user]
  );

  const [items, setItems] = useState<CatalogoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Busca de produtos para incluir
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<BuscaResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingFor, setAddingFor] = useState<BuscaResult | null>(null);
  const [novoPreco, setNovoPreco] = useState("");

  // Gerenciador de imagens
  const [imgProduto, setImgProduto] = useState<CatalogoItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/corporativo/catalogo", { headers: authHeader() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar.");
      setItems(json.data as CatalogoItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [authHeader]);

  useEffect(() => {
    load();
  }, [load]);

  async function buscar() {
    const t = term.trim();
    if (t.length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/corporativo/catalogo/buscar?term=${encodeURIComponent(t)}`, {
        headers: authHeader(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro na busca.");
      setResults(json.data as BuscaResult[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro na busca.");
    } finally {
      setSearching(false);
    }
  }

  async function salvar(produto: string, patch: Partial<CatalogoItem>, snapshot?: BuscaResult) {
    const res = await fetch("/api/corporativo/catalogo", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({
        produto,
        ...patch,
        ...(snapshot ? { descProduto: snapshot.descProduto, ean: snapshot.ean } : {}),
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Erro ao salvar.");
    return json.data as CatalogoItem;
  }

  async function confirmarAdicao() {
    if (!addingFor) return;
    try {
      await salvar(
        addingFor.produto,
        {
          precoAtacado: Number(novoPreco.replace(",", ".")) || 0,
          ativo: true,
        },
        addingFor
      );
      setAddingFor(null);
      setNovoPreco("");
      setResults([]);
      setTerm("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao adicionar.");
    }
  }

  async function atualizarPreco(item: CatalogoItem, valor: string) {
    const preco = Number(valor.replace(",", ".")) || 0;
    setItems((prev) => prev.map((i) => (i.produto === item.produto ? { ...i, precoAtacado: preco } : i)));
    try {
      await salvar(item.produto, { precoAtacado: preco, ativo: item.ativo });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar preço.");
    }
  }

  async function toggleAtivo(item: CatalogoItem) {
    const ativo = !item.ativo;
    setItems((prev) => prev.map((i) => (i.produto === item.produto ? { ...i, ativo } : i)));
    try {
      await salvar(item.produto, { precoAtacado: item.precoAtacado, ativo });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  }

  async function remover(item: CatalogoItem) {
    if (!confirm(`Remover "${item.descProduto || item.produto}" da loja?`)) return;
    try {
      const res = await fetch(`/api/corporativo/catalogo?produto=${encodeURIComponent(item.produto)}`, {
        method: "DELETE",
        headers: authHeader(),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Erro ao remover.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao remover.");
    }
  }

  const jaNoCatalogo = new Set(items.map((i) => i.produto));

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topbar}>
          <div>
            <div className={styles.eyebrow}>Corporativo · Loja</div>
            <h1 className={styles.title}>Catálogo da loja</h1>
            <p className={styles.subtitle}>
              Defina quais produtos aparecem na loja do cliente corporativo e o preço de atacado.
              A categoria é sempre o subgrupo do produto no Linx (não é editável aqui).
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/corporativo/loja" className={styles.backLink}>← Voltar à loja</Link>
            <Link href="/corporativo/pedidos" className={styles.navTab}>Pedidos</Link>
          </div>
        </div>

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

        {/* Adicionar produtos */}
        <div className={styles.card}>
          <p className={styles.sectionTitle}>Adicionar produto ao catálogo</p>
          <div className={styles.searchRow}>
            <input
              className={styles.input}
              placeholder="Buscar por descrição, código do produto ou EAN…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buscar()}
            />
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={buscar} disabled={searching}>
              {searching ? "Buscando…" : "Buscar"}
            </button>
          </div>

          {results.length > 0 && (
            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th>Subgrupo</th>
                    <th>EAN</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.produto}>
                      <td className={styles.codeCell}>{r.produto}</td>
                      <td>{r.descProduto}</td>
                      <td>{r.subgrupo}</td>
                      <td>{r.ean}</td>
                      <td>
                        {jaNoCatalogo.has(r.produto) ? (
                          <span className={styles.tag}>no catálogo</span>
                        ) : (
                          <button
                            className={`${styles.btn} ${styles.btnSmall}`}
                            onClick={() => {
                              setAddingFor(r);
                              setNovoPreco("");
                            }}
                          >
                            + Adicionar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Catálogo atual */}
        <div className={styles.card}>
          <p className={styles.sectionTitle}>Produtos na loja ({items.length})</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>EAN</th>
                  <th>Categoria (subgrupo)</th>
                  <th>Preço atacado</th>
                  <th>Ativo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className={styles.center}><span className={styles.muted}>Carregando…</span></td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={7} className={styles.center}><span className={styles.muted}>Nenhum produto no catálogo ainda.</span></td></tr>
                ) : (
                  items.map((i) => (
                    <tr key={i.produto}>
                      <td className={styles.codeCell}>{i.produto}</td>
                      <td>{i.descProduto}</td>
                      <td>{i.ean}</td>
                      <td>{i.subgrupo || "—"}</td>
                      <td>
                        <input
                          className={styles.input}
                          style={{ height: 32, maxWidth: 120 }}
                          defaultValue={i.precoAtacado ? String(i.precoAtacado) : ""}
                          placeholder="0,00"
                          onBlur={(e) => atualizarPreco(i, e.target.value)}
                        />
                      </td>
                      <td>
                        <label className={styles.checkboxRow}>
                          <input type="checkbox" checked={i.ativo} onChange={() => toggleAtivo(i)} />
                        </label>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className={`${styles.btn} ${styles.btnSmall}`} onClick={() => setImgProduto(i)}>
                          Imagens
                        </button>{" "}
                        <button
                          className={`${styles.btn} ${styles.btnSmall}`}
                          style={{ color: "var(--la-red)" }}
                          onClick={() => remover(i)}
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
        </div>
      </div>

      {/* Modal: adicionar produto (preço) */}
      {addingFor && (
        <Overlay onClose={() => setAddingFor(null)}>
          <h2 className={styles.title} style={{ fontSize: 20 }}>Adicionar ao catálogo</h2>
          <p className={styles.subtitle} style={{ marginBottom: 16 }}>
            {addingFor.produto} — {addingFor.descProduto}
            {addingFor.subgrupo ? ` · ${addingFor.subgrupo}` : ""}
          </p>
          <div className={styles.grid}>
            <div className={`${styles.field} ${styles.col12}`}>
              <label className={styles.label}>Preço de atacado (R$)</label>
              <input
                className={styles.input}
                autoFocus
                placeholder="0,00"
                value={novoPreco}
                onChange={(e) => setNovoPreco(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.footerBar} style={{ marginTop: 18, position: "static" }}>
            <button className={styles.btn} onClick={() => setAddingFor(null)}>Cancelar</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={confirmarAdicao}>
              Adicionar à loja
            </button>
          </div>
        </Overlay>
      )}

      {/* Modal: imagens do produto */}
      {imgProduto && (
        <ImagensManager
          produto={imgProduto}
          authHeader={authHeader}
          onClose={() => setImgProduto(null)}
        />
      )}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--la-bg)",
          borderRadius: 6,
          padding: 24,
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid var(--la-line)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ImagensManager({
  produto,
  authHeader,
  onClose,
}: {
  produto: CatalogoItem;
  authHeader: () => Record<string, string>;
  onClose: () => void;
}) {
  const [imagens, setImagens] = useState<ProdutoImagem[]>([]);
  const [cor, setCor] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/corporativo/imagens?produto=${encodeURIComponent(produto.produto)}`);
    const json = await res.json();
    if (res.ok) setImagens(json.data as ProdutoImagem[]);
  }, [produto.produto]);

  useEffect(() => {
    load();
  }, [load]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const jaNaCor = imagens.filter((im) => im.cor === cor.trim());
      const posicao = jaNaCor.length; // próxima posição livre para essa cor
      const res = await fetch("/api/corporativo/imagens", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ produto: produto.produto, cor: cor.trim(), posicao, dataUrl }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Erro ao enviar.");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao enviar imagem.");
    } finally {
      setBusy(false);
    }
  }

  async function excluir(im: ProdutoImagem) {
    const res = await fetch(
      `/api/corporativo/imagens?produto=${encodeURIComponent(im.produto)}&cor=${encodeURIComponent(im.cor)}&posicao=${im.posicao}`,
      { method: "DELETE", headers: authHeader() }
    );
    if (res.ok) await load();
  }

  return (
    <Overlay onClose={onClose}>
      <h2 className={styles.title} style={{ fontSize: 20 }}>Imagens do produto</h2>
      <p className={styles.subtitle} style={{ marginBottom: 6 }}>
        {produto.produto} — {produto.descProduto}
      </p>
      <p className={styles.viewHint} style={{ marginBottom: 16 }}>
        Imagens são globais do sistema (produto × cor). Deixe a cor em branco para a imagem geral.
      </p>

      {err && <div className={`${styles.alert} ${styles.alertError}`}>{err}</div>}

      <div className={styles.grid} style={{ alignItems: "end" }}>
        <div className={`${styles.field} ${styles.col6}`}>
          <label className={styles.label}>Cor (código, opcional)</label>
          <input className={styles.input} value={cor} onChange={(e) => setCor(e.target.value)} placeholder="Ex: 06 (vazio = geral)" />
        </div>
        <div className={`${styles.field} ${styles.col6}`}>
          <label className={styles.label}>Enviar imagem</label>
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} disabled={busy} />
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
        {imagens.length === 0 ? (
          <span className={styles.muted}>Nenhuma imagem cadastrada.</span>
        ) : (
          imagens.map((im) => (
            <div
              key={`${im.cor}-${im.posicao}`}
              style={{ width: 92, textAlign: "center", fontSize: 11, color: "var(--la-muted)" }}
            >
              <div
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: 4,
                  overflow: "hidden",
                  border: "1px solid var(--la-line)",
                  background: "var(--la-surface)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div style={{ marginTop: 3 }}>{im.cor ? `cor ${im.cor}` : "geral"}</div>
              <button className={styles.removeBtn} onClick={() => excluir(im)}>
                excluir
              </button>
            </div>
          ))
        )}
      </div>

      <div className={styles.footerBar} style={{ marginTop: 20, position: "static" }}>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onClose}>Concluir</button>
      </div>
    </Overlay>
  );
}
