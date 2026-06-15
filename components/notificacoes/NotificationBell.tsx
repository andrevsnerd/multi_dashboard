"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatRomaneioDateTimeBrasilia } from "@/lib/utils/romaneios-date";
import type { Notificacao } from "@/lib/types/notificacao";
import { useNotificacoes } from "./useNotificacoes";
import styles from "./NotificationBell.module.css";

function tituloNotificacao(n: Notificacao): string {
  return `Nova saída #${n.romaneio} com destino à sua filial`;
}

function subtituloNotificacao(n: Notificacao): string {
  const itens = `${n.qtdProdutos} produtos • ${n.qtdItens} itens`;
  return `${itens} — confirme a entrada`;
}

export function NotificationBell() {
  const { company, notificacoes, naoLidas, marcarLida, marcarTodas } = useNotificacoes();
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return;
    function onClickFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", onClickFora);
    return () => document.removeEventListener("mousedown", onClickFora);
  }, [aberto]);

  // Sino só aparece quando há empresa no contexto (não em /login, /admin, seleção).
  if (!company) return null;

  function handleAbrir(n: Notificacao) {
    setAberto(false);
    if (!n.lida) void marcarLida(n.key);
    router.push(n.href);
  }

  const recentes = notificacoes.slice(0, 6);

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={styles.bellBtn}
        onClick={() => setAberto((v) => !v)}
        aria-label="Notificações"
        aria-expanded={aberto}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {naoLidas > 0 && (
          <span className={styles.badge}>{naoLidas > 9 ? "9+" : naoLidas}</span>
        )}
      </button>

      {aberto && (
        <div className={styles.panel} role="dialog" aria-label="Notificações">
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              {naoLidas > 0 ? `${naoLidas} ${naoLidas === 1 ? "atualização" : "atualizações"}` : "Notificações"}
            </span>
            {naoLidas > 0 && (
              <button type="button" className={styles.markAll} onClick={() => void marcarTodas()}>
                Marcar todas como lidas
              </button>
            )}
          </div>

          <div className={styles.list}>
            {recentes.length === 0 ? (
              <div className={styles.empty}>Nenhuma notificação no momento.</div>
            ) : (
              recentes.map((n) => (
                <button
                  type="button"
                  key={n.key}
                  className={`${styles.item} ${n.lida ? styles.itemLido : ""}`}
                  onClick={() => handleAbrir(n)}
                >
                  {!n.lida && <span className={styles.dot} aria-hidden="true" />}
                  <span className={styles.itemBody}>
                    <span className={styles.itemTitle}>{tituloNotificacao(n)}</span>
                    <span className={styles.itemSub}>{subtituloNotificacao(n)}</span>
                    <span className={styles.itemMeta}>
                      Origem: {n.filialOrigem || "-"} • {formatRomaneioDateTimeBrasilia(n.dataEmissao)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <Link href={`/${company}/notificacoes`} className={styles.verTodas} onClick={() => setAberto(false)}>
            Ver todas as notificações
          </Link>
        </div>
      )}
    </div>
  );
}
