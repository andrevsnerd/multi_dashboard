"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import styles from "../loja-admin.module.css";

interface PedidoItem {
  produto: string;
  descProduto: string;
  ean: string;
  corNome: string;
  tamanho: string;
  grade: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
}
interface Endereco {
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}
interface Pedido {
  id: string;
  clienteCodigo: string;
  clienteNome: string;
  userNome: string;
  status: string;
  subtotal: number;
  frete: number;
  total: number;
  endereco: Endereco | null;
  itens: PedidoItem[];
  observacao: string;
  createdAt: string;
  pedidoLinx: string;
  linxEfetivadoPor: string;
  linxEfetivadoEm: string | null;
}

const STATUS = ["pendente", "em_separacao", "confirmado", "efetivado", "cancelado"];
const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  em_separacao: "Em separação",
  confirmado: "Confirmado",
  efetivado: "Efetivado no Linx",
  cancelado: "Cancelado",
};
/** Funções que podem efetivar pedidos no Linx (exceção ao read-only geral). */
const APPROVE_ROLES = ["admin", "diretor", "supervisor"];
const brl = (n: number) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PedidosAdminPage() {
  const { user } = useAuth();
  const authHeader = useCallback(
    (): Record<string, string> => (user ? { "X-Auth-Username": user.username } : {}),
    [user]
  );

  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Pedido | null>(null);
  const [efetivando, setEfetivando] = useState(false);
  const [editItens, setEditItens] = useState<PedidoItem[]>([]);
  const [editObs, setEditObs] = useState("");
  const canEfetivar = !!user && APPROVE_ROLES.includes(user.role);
  // Editável só enquanto não efetivado e para quem pode aprovar.
  const editavel = !!aberto && canEfetivar && !aberto.pedidoLinx;
  const editSubtotal = editItens.reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.precoUnitario) || 0), 0);
  const editTotal = editSubtotal + (aberto?.frete ?? 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/corporativo/pedidos", { headers: authHeader() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar.");
      setPedidos(json.data as Pedido[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [authHeader]);

  useEffect(() => {
    load();
  }, [load]);

  // Sincroniza o rascunho de edição ao abrir um pedido (por id, para não perder
  // edições quando `aberto` é mesclado após efetivar).
  useEffect(() => {
    if (aberto) {
      setEditItens(aberto.itens.map((i) => ({ ...i })));
      setEditObs(aberto.observacao ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto?.id]);

  function setItemCampo(idx: number, campo: "quantidade" | "precoUnitario", valor: number) {
    setEditItens((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, [campo]: Number.isFinite(valor) && valor >= 0 ? valor : 0 } : it
      )
    );
  }
  function removerItem(idx: number) {
    setEditItens((prev) => prev.filter((_, i) => i !== idx));
  }

  async function mudarStatus(pedido: Pedido, status: string) {
    setPedidos((prev) => prev.map((p) => (p.id === pedido.id ? { ...p, status } : p)));
    try {
      const res = await fetch(`/api/corporativo/pedidos/${pedido.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Erro ao atualizar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao atualizar status.");
      load();
    }
  }

  async function efetivarPedido(pedido: Pedido) {
    if (efetivando) return;
    const itens = editItens.filter((i) => (Number(i.quantidade) || 0) > 0);
    if (itens.length === 0) {
      setError("O pedido precisa de ao menos um item com quantidade.");
      return;
    }
    const ok = window.confirm(
      `Efetivar o pedido de ${pedido.clienteNome || "cliente"} como Pedido de Venda Atacado no Linx?\n\n` +
        `Isso cria o pedido real (aberto) no Linx. A separação/faturamento continua sendo feita no Linx.`
    );
    if (!ok) return;
    setEfetivando(true);
    setError(null);
    try {
      const res = await fetch(`/api/corporativo/pedidos/${pedido.id}/efetivar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ itens, observacao: editObs }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao efetivar.");
      const numero = String(json.data?.pedido ?? "");
      const atualizado: Partial<Pedido> = { status: "efetivado", pedidoLinx: numero };
      setPedidos((prev) => prev.map((p) => (p.id === pedido.id ? { ...p, ...atualizado } : p)));
      setAberto((prev) => (prev && prev.id === pedido.id ? { ...prev, ...atualizado } : prev));
      window.alert(`Pedido efetivado no Linx com o número ${numero}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao efetivar pedido no Linx.");
    } finally {
      setEfetivando(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topbar}>
          <div>
            <div className={styles.eyebrow}>Corporativo · Loja</div>
            <h1 className={styles.title}>Pedidos</h1>
            <p className={styles.subtitle}>Pedidos finalizados pelos clientes na loja corporativa.</p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/corporativo/loja" className={styles.backLink}>← Voltar à loja</Link>
            <Link href="/corporativo/catalogo" className={styles.navTab}>Catálogo</Link>
          </div>
        </div>

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Data</th>
                <th>Cliente</th>
                <th>Itens</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className={styles.center}><span className={styles.muted}>Carregando…</span></td></tr>
              ) : pedidos.length === 0 ? (
                <tr><td colSpan={7} className={styles.center}><span className={styles.muted}>Nenhum pedido recebido ainda.</span></td></tr>
              ) : (
                pedidos.map((p) => (
                  <tr key={p.id}>
                    <td className={styles.codeCell}>#{p.id.slice(0, 8).toUpperCase()}</td>
                    <td>{new Date(p.createdAt).toLocaleString("pt-BR")}</td>
                    <td>{p.clienteNome || "—"}{p.userNome ? <div className={styles.muted} style={{ fontSize: 11 }}>por {p.userNome}</div> : null}</td>
                    <td>{p.itens.reduce((s, i) => s + i.quantidade, 0)}</td>
                    <td>{brl(p.total)}</td>
                    <td>
                      <select
                        className={styles.select}
                        style={{ height: 32, maxWidth: 150 }}
                        value={p.status}
                        onChange={(e) => mudarStatus(p, e.target.value)}
                      >
                        {STATUS.map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>
                        ))}
                      </select>
                      {p.pedidoLinx ? (
                        <div className={styles.muted} style={{ fontSize: 11 }}>Linx nº {p.pedidoLinx}</div>
                      ) : null}
                    </td>
                    <td>
                      <button className={`${styles.btn} ${styles.btnSmall}`} onClick={() => setAberto(p)}>
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {aberto && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 100, padding: 20 }}
          onClick={() => setAberto(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--la-bg)", borderRadius: 6, padding: 24, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--la-line)" }}
          >
            <h2 className={styles.title} style={{ fontSize: 20 }}>
              Pedido #{aberto.id.slice(0, 8).toUpperCase()}
            </h2>
            <p className={styles.subtitle}>
              {new Date(aberto.createdAt).toLocaleString("pt-BR")} · {STATUS_LABEL[aberto.status] ?? aberto.status}
            </p>

            <div className={styles.statGrid} style={{ margin: "16px 0" }}>
              <div className={styles.statBox}>
                <div className={styles.statLabel}>Cliente</div>
                <div className={styles.statValue} style={{ fontSize: 14 }}>{aberto.clienteNome || "—"}</div>
              </div>
              <div className={styles.statBox}>
                <div className={styles.statLabel}>Código</div>
                <div className={styles.statValue} style={{ fontSize: 14 }}>{aberto.clienteCodigo || "—"}</div>
              </div>
              <div className={styles.statBox}>
                <div className={styles.statLabel}>Subtotal</div>
                <div className={styles.statValue} style={{ fontSize: 14 }}>{brl(editSubtotal)}</div>
              </div>
              <div className={styles.statBox}>
                <div className={styles.statLabel}>Frete</div>
                <div className={styles.statValue} style={{ fontSize: 14 }}>{brl(aberto.frete)}</div>
              </div>
            </div>

            {aberto.endereco && (
              <p className={styles.viewValue} style={{ borderBottom: "none" }}>
                <strong style={{ marginRight: 6 }}>Entrega:</strong>
                {[aberto.endereco.endereco, aberto.endereco.numero, aberto.endereco.bairro, [aberto.endereco.cidade, aberto.endereco.uf].filter(Boolean).join("/"), aberto.endereco.cep]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}

            {editavel ? (
              <label style={{ display: "block", marginTop: 8 }}>
                <span className={styles.statLabel}>Observação</span>
                <textarea
                  className={styles.input}
                  style={{ width: "100%", minHeight: 56, resize: "vertical" }}
                  value={editObs}
                  onChange={(e) => setEditObs(e.target.value)}
                  placeholder="Observação do pedido (vai para o Linx)"
                />
              </label>
            ) : (
              aberto.observacao && (
                <p className={styles.viewValue} style={{ borderBottom: "none" }}>
                  <strong style={{ marginRight: 6 }}>Obs.:</strong> {aberto.observacao}
                </p>
              )
            )}

            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Produto</th><th>Cor</th><th>Tamanho</th><th>Qtd</th><th>Unit.</th><th>Total</th>
                    {editavel ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {editItens.map((i, idx) => {
                    const linhaTotal = (Number(i.quantidade) || 0) * (Number(i.precoUnitario) || 0);
                    return (
                      <tr key={idx}>
                        <td>
                          {i.descProduto || i.produto}
                          {i.grade ? <span className={styles.gradeNote}> ({i.grade})</span> : null}
                          {i.ean ? <div className={styles.muted} style={{ fontSize: 11 }}>EAN {i.ean}</div> : null}
                        </td>
                        <td>{i.corNome || "—"}</td>
                        <td>{i.tamanho || "—"}</td>
                        <td>
                          {editavel ? (
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className={styles.input}
                              style={{ width: 70, height: 32 }}
                              value={i.quantidade}
                              onChange={(e) => setItemCampo(idx, "quantidade", Math.round(Number(e.target.value)))}
                            />
                          ) : (
                            i.quantidade
                          )}
                        </td>
                        <td>
                          {editavel ? (
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              className={styles.input}
                              style={{ width: 90, height: 32 }}
                              value={i.precoUnitario}
                              onChange={(e) => setItemCampo(idx, "precoUnitario", Number(e.target.value))}
                            />
                          ) : (
                            brl(i.precoUnitario)
                          )}
                        </td>
                        <td>{brl(linhaTotal)}</td>
                        {editavel ? (
                          <td>
                            <button
                              className={`${styles.btn} ${styles.btnSmall}`}
                              onClick={() => removerItem(idx)}
                              title="Remover item"
                            >
                              ✕
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                  {editItens.length === 0 && (
                    <tr><td colSpan={editavel ? 7 : 6} className={styles.center}><span className={styles.muted}>Sem itens.</span></td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className={styles.footerBar} style={{ marginTop: 18, position: "static", flexWrap: "wrap", gap: 10 }}>
              <span className={styles.statValue}>Total: {brl(editavel ? editTotal : aberto.total)}</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {aberto.pedidoLinx ? (
                  <span className={styles.statValue} style={{ fontSize: 14, color: "var(--ok, #15803d)" }}>
                    ✔ Efetivado no Linx: nº {aberto.pedidoLinx}
                  </span>
                ) : canEfetivar ? (
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={() => efetivarPedido(aberto)}
                    disabled={efetivando}
                  >
                    {efetivando ? "Efetivando…" : "Aprovar e efetivar no Linx"}
                  </button>
                ) : null}
                <button className={styles.btn} onClick={() => setAberto(null)}>Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
