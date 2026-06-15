"use client";

import { useRouter } from "next/navigation";
import { formatRomaneioDateTimeBrasilia } from "@/lib/utils/romaneios-date";
import { useNotificacoes } from "./useNotificacoes";
import styles from "./NotificationGate.module.css";

/**
 * Trava de bloqueio: popup persistente que impede o uso do app enquanto houver
 * saídas destinadas à filial, antigas (>= cutoff e com 3+ dias) e ainda não
 * confirmadas.
 *
 * Fica DORMENTE nas telas de romaneios — é lá que o usuário confirma a entrada;
 * cobrir essa tela impediria a própria resolução do bloqueio. Some sozinha
 * assim que `bloqueios` zera (após a confirmação + revalidação).
 */
export function NotificationGate() {
  const { bloqueios, pathname, marcarLida } = useNotificacoes();
  const router = useRouter();

  const emRomaneios = (pathname ?? "").includes("/romaneios");
  if (emRomaneios || bloqueios.length === 0) return null;

  function confirmar(href: string, key: string) {
    void marcarLida(key);
    router.push(href);
  }

  return (
    <div className={styles.overlay} role="alertdialog" aria-modal="true" aria-label="Confirmação obrigatória">
      <div className={styles.card}>
        <div className={styles.iconWrap} aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <h2 className={styles.title}>Confirmação de entradas pendente</h2>
        <p className={styles.subtitle}>
          {bloqueios.length === 1
            ? "Há 1 entrada com destino à sua filial aguardando confirmação há mais de 3 dias."
            : `Há ${bloqueios.length} entradas com destino à sua filial aguardando confirmação há mais de 3 dias.`}{" "}
          Confirme o recebimento para liberar o acesso ao sistema.
        </p>

        <div className={styles.list}>
          {bloqueios.map((n) => (
            <div className={styles.item} key={n.key}>
              <div className={styles.itemBody}>
                <div className={styles.itemTitle}>Saída #{n.romaneio}</div>
                <div className={styles.itemMeta}>
                  Origem: {n.filialOrigem || "-"} • {n.qtdProdutos} produtos • {n.qtdItens} itens
                </div>
                <div className={styles.itemDate}>Emitida em {formatRomaneioDateTimeBrasilia(n.dataEmissao)}</div>
              </div>
              <button type="button" className={styles.confirmBtn} onClick={() => confirmar(n.href, n.key)}>
                Confirmar entrada
              </button>
            </div>
          ))}
        </div>

        <p className={styles.footer}>
          Esta confirmação é obrigatória. O sistema permanece bloqueado até que todas as entradas acima sejam confirmadas.
        </p>
      </div>
    </div>
  );
}
