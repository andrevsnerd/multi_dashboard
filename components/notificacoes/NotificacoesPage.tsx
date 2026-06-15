"use client";

import { useRouter } from "next/navigation";
import { formatRomaneioDateTimeBrasilia } from "@/lib/utils/romaneios-date";
import type { Notificacao } from "@/lib/types/notificacao";
import { useNotificacoes } from "./useNotificacoes";
import styles from "./NotificacoesPage.module.css";

export default function NotificacoesPage() {
  const { notificacoes, naoLidas, loading, marcarLida, marcarTodas } = useNotificacoes();
  const router = useRouter();

  function abrir(n: Notificacao) {
    if (!n.lida) void marcarLida(n.key);
    router.push(n.href);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Notificações</h1>
          <p className={styles.subtitle}>
            {loading
              ? "Carregando..."
              : notificacoes.length === 0
              ? "Nenhuma notificação"
              : `${notificacoes.length} ${notificacoes.length === 1 ? "notificação" : "notificações"}` +
                (naoLidas > 0 ? ` • ${naoLidas} não ${naoLidas === 1 ? "lida" : "lidas"}` : "")}
          </p>
        </div>
        {naoLidas > 0 && (
          <button type="button" className={styles.markAll} onClick={() => void marcarTodas()}>
            Marcar todas como lidas
          </button>
        )}
      </div>

      {!loading && notificacoes.length === 0 ? (
        <div className={styles.empty}>
          <div>Você está em dia.</div>
          <div className={styles.emptyHint}>
            Quando uma nova saída tiver destino à sua filial, ela aparece aqui para você confirmar a entrada.
          </div>
        </div>
      ) : (
        <div className={styles.list}>
          {notificacoes.map((n) => (
            <button
              type="button"
              key={n.key}
              className={`${styles.card} ${n.lida ? styles.cardLido : ""}`}
              onClick={() => abrir(n)}
            >
              {!n.lida && <span className={styles.dot} aria-hidden="true" />}
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}>Nova saída #{n.romaneio} com destino à sua filial</div>
                <div className={styles.cardSub}>
                  {n.qtdProdutos} produtos • {n.qtdItens} itens
                  {n.qtdConfirmados > 0 && (
                    <span className={styles.parcial}> — {n.qtdConfirmados}/{n.qtdProdutos} confirmados</span>
                  )}
                </div>
                <div className={styles.cardMeta}>
                  Origem: {n.filialOrigem || "-"}
                  {n.tipoRomaneio ? ` • ${n.tipoRomaneio}` : ""} • {formatRomaneioDateTimeBrasilia(n.dataEmissao)}
                </div>
              </div>
              <span className={styles.acao}>Confirmar entrada ›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
