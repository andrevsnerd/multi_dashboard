"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "./AlterarCadastroPage.module.css";
import { ACAO_LABEL, dataCurta, type CompanyKey, type HistoricoLote } from "./types";

interface Props {
  companyKey: CompanyKey;
  username: string;
  podeExecutar: boolean;
  /** Muda de valor a cada gravação para o histórico se recarregar. */
  recarregarEm: number;
  /** Chamado depois de um estorno, para a tela pai atualizar a lista. */
  onEstornado?: (mensagem: string) => void;
}

/**
 * Histórico compartilhado pelas duas telas de cadastro: lotes recentes com
 * "desfazer". O estorno é um lote NOVO (nada é apagado) — por isso um lote já
 * desfeito mostra apenas o rótulo, sem botão.
 */
export default function CadastroHistorico({
  companyKey,
  username,
  podeExecutar,
  recarregarEm,
  onEstornado,
}: Props) {
  const [lotes, setLotes] = useState<HistoricoLote[]>([]);
  const [aberto, setAberto] = useState(false);
  const [revertendo, setRevertendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!username) return;
    try {
      const res = await fetch(`/api/cadastro/historico?company=${companyKey}`, {
        headers: { "x-auth-username": username },
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = await res.json();
      setLotes(Array.isArray(json?.lotes) ? json.lotes : []);
    } catch {
      /* histórico é acessório: falhar aqui não bloqueia a tela */
    }
  }, [companyKey, username]);

  useEffect(() => {
    void carregar();
  }, [carregar, recarregarEm]);

  const reverter = useCallback(
    async (lote: HistoricoLote) => {
      if (!username) return;
      const confirmacao = window.confirm(
        `Desfazer o lote ${lote.lote}?\n\n` +
          (lote.escopo === "DIMENSAO"
            ? "O valor anterior volta na tabela mestre e o Linx cascateia de novo para os produtos."
            : "Cada campo volta ao valor anterior.")
      );
      if (!confirmacao) return;

      setRevertendo(lote.lote);
      setErro(null);
      try {
        const res = await fetch("/api/cadastro/reverter", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ company: companyKey, lote: lote.lote }),
        });
        const json = await res.json();
        if (!res.ok) {
          setErro(json?.error ?? "Erro ao desfazer o lote.");
          return;
        }
        await carregar();
        onEstornado?.(json?.mensagem ?? "Lote desfeito.");
      } catch {
        setErro("Falha de conexão ao desfazer o lote.");
      } finally {
        setRevertendo(null);
      }
    },
    [companyKey, username, carregar, onEstornado]
  );

  return (
    <section className={styles.card}>
      <button type="button" className={styles.historicoToggle} onClick={() => setAberto((v) => !v)}>
        {aberto ? "▾" : "▸"} Histórico de alterações ({lotes.length})
      </button>

      {erro && <div className={styles.erroBox}>{erro}</div>}

      {aberto && (
        <div className={styles.tabelaWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Ação</th>
                <th>Alvo</th>
                <th>O que mudou</th>
                <th>Observação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lotes.map((lote) => (
                <tr key={lote.lote}>
                  <td className={styles.tdMeta}>
                    {dataCurta(lote.data)}
                    <span className={styles.tdMetaSub}>{lote.lote}</span>
                  </td>
                  <td>{lote.usuario}</td>
                  <td>
                    {ACAO_LABEL[lote.acao]}
                    <span className={styles.tdMetaSub}>
                      {lote.escopo === "DIMENSAO" ? "dimensão" : "produto"}
                    </span>
                  </td>
                  <td className={styles.tdMeta}>
                    {lote.alvos === 1 ? "1 alvo" : `${lote.alvos} alvos`}
                    {lote.produtos ? (
                      <span className={styles.tdMetaSub}>
                        {lote.produtos.toLocaleString("pt-BR")} produto(s) na cascata
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.tdDesc}>{lote.resumo || "—"}</td>
                  <td className={styles.tdDesc}>
                    {lote.reverteLote ? `Estorno de ${lote.reverteLote}` : lote.obs ?? "—"}
                  </td>
                  <td className={styles.acoesLinha}>
                    {lote.revertidoPor ? (
                      <span className={styles.dica}>desfeito</span>
                    ) : !lote.reversivel ? (
                      <span className={styles.dica} title="Criação não tem estorno: inative em vez de apagar.">
                        sem estorno
                      </span>
                    ) : (
                      podeExecutar && (
                        <button
                          type="button"
                          className={styles.btnTexto}
                          onClick={() => void reverter(lote)}
                          disabled={revertendo === lote.lote}
                        >
                          {revertendo === lote.lote ? "Desfazendo…" : "Desfazer"}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {lotes.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.dica}>
                    Nenhuma alteração de cadastro registrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
