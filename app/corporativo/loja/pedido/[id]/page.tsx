"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatBRL } from "../../CartContext";
import styles from "../../loja.module.css";

interface PedidoItem {
  produto: string;
  descProduto: string;
  corNome: string;
  tamanho: string;
  grade: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
}
interface Pedido {
  id: string;
  clienteNome: string;
  status: string;
  subtotal: number;
  frete: number;
  total: number;
  itens: PedidoItem[];
  createdAt: string;
}

export default function PedidoConfirmadoPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/corporativo/pedidos/${id}`);
        const json = await res.json();
        if (alive && res.ok) setPedido(json.data as Pedido);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div className={styles.confirmBox}>
      {loading ? (
        <div className={styles.loadingRow}>Carregando pedido…</div>
      ) : !pedido ? (
        <>
          <div className={styles.confirmIcon}>⚠️</div>
          <h1 className={styles.confirmTitle}>Pedido não encontrado</h1>
          <Link href="/corporativo/loja" className={styles.btn} style={{ marginTop: 16 }}>
            Voltar à loja
          </Link>
        </>
      ) : (
        <>
          <div className={styles.confirmIcon}>✅</div>
          <h1 className={styles.confirmTitle}>Pedido recebido!</h1>
          <div className={styles.confirmNum}>
            Pedido #{pedido.id.slice(0, 8).toUpperCase()} ·{" "}
            {new Date(pedido.createdAt).toLocaleString("pt-BR")}
          </div>
          <p className={styles.pageSub} style={{ marginTop: 10 }}>
            Recebemos seu pedido{pedido.clienteNome ? ` — ${pedido.clienteNome}` : ""}. Nossa equipe
            vai processá-lo em breve.
          </p>

          <div className={styles.confirmSummary}>
            {pedido.itens.map((i, idx) => (
              <div key={idx} className={styles.summaryRow} style={{ padding: "6px 0" }}>
                <span>
                  {i.quantidade}× {i.descProduto || i.produto}
                  {i.grade ? <span className={styles.gradeNote}> ({i.grade})</span> : null}
                  {i.corNome || i.tamanho
                    ? ` (${[i.corNome, i.tamanho].filter(Boolean).join(" - ")})`
                    : ""}
                </span>
                <span>{formatBRL(i.subtotal)}</span>
              </div>
            ))}
            <div className={styles.summaryRow} style={{ paddingTop: 8 }}>
              <span>Frete</span>
              <span>{formatBRL(pedido.frete)}</span>
            </div>
            <div className={styles.summaryTotal}>
              <span>Total</span>
              <span>{formatBRL(pedido.total)}</span>
            </div>
          </div>

          <Link
            href="/corporativo/loja"
            className={`${styles.btn} ${styles.btnPrimary}`}
            style={{ marginTop: 20 }}
          >
            Voltar à loja
          </Link>
        </>
      )}
    </div>
  );
}
