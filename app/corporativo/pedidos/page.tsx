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
}

const STATUS = ["pendente", "em_separacao", "confirmado", "cancelado"];
const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  em_separacao: "Em separação",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
};
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
                <div className={styles.statValue} style={{ fontSize: 14 }}>{brl(aberto.subtotal)}</div>
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
            {aberto.observacao && (
              <p className={styles.viewValue} style={{ borderBottom: "none" }}>
                <strong style={{ marginRight: 6 }}>Obs.:</strong> {aberto.observacao}
              </p>
            )}

            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Produto</th><th>Cor</th><th>Tamanho</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {aberto.itens.map((i, idx) => (
                    <tr key={idx}>
                      <td>{i.descProduto || i.produto}{i.ean ? <div className={styles.muted} style={{ fontSize: 11 }}>EAN {i.ean}</div> : null}</td>
                      <td>{i.corNome || "—"}</td>
                      <td>{i.tamanho || "—"}</td>
                      <td>{i.quantidade}</td>
                      <td>{brl(i.precoUnitario)}</td>
                      <td>{brl(i.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.footerBar} style={{ marginTop: 18, position: "static" }}>
              <span className={styles.statValue}>Total: {brl(aberto.total)}</span>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setAberto(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
