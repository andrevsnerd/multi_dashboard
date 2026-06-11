"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import styles from "./RomaneioDeleteModal.module.css";

type Tipo = "saida" | "entrada";
type Modo = "apenas" | "retornar";

interface PreviewItem {
  produto: string;
  cor: string;
  qtde: number;
  estoqueAtual: number;
  estoqueFinal: number;
}

interface PreviewResponse {
  totalProdutos: number;
  totalItens: number;
  itens: PreviewItem[];
}

interface RomaneioDeleteModalProps {
  /** "saida" | "entrada" — trânsito não é suportado. */
  tipo: Tipo;
  romaneio: string;
  /** Filial dona do romaneio: origem para saída, destino para entrada. */
  filial: string;
  onClose: () => void;
  onDeleted: () => void;
}

function buildUrl(tipo: Tipo, romaneio: string, filial: string, modo?: Modo): string {
  const base = `/api/saidas-entradas-produtos/log/${encodeURIComponent(tipo)}/${encodeURIComponent(
    romaneio
  )}/${encodeURIComponent(filial)}`;
  return modo ? `${base}?modo=${modo}` : base;
}

export default function RomaneioDeleteModal({
  tipo,
  romaneio,
  filial,
  onClose,
  onDeleted,
}: RomaneioDeleteModalProps) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [modo, setModo] = useState<Modo | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregarPreview = useCallback(async () => {
    setLoadingPreview(true);
    setErro(null);
    try {
      const res = await fetch(buildUrl(tipo, romaneio, filial), {
        headers: { "x-auth-username": username },
        cache: "no-store",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Falha ao carregar dados do romaneio");
      }
      setPreview((await res.json()) as PreviewResponse);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar dados");
    } finally {
      setLoadingPreview(false);
    }
  }, [tipo, romaneio, filial, username]);

  // Ao escolher um modo, carrega o preview (itens + estoque) para a confirmação.
  useEffect(() => {
    if (modo) carregarPreview();
  }, [modo, carregarPreview]);

  const fechar = () => {
    if (executing) return;
    onClose();
  };

  const confirmar = async () => {
    if (!modo) return;
    setExecuting(true);
    setErro(null);
    try {
      const res = await fetch(buildUrl(tipo, romaneio, filial, modo), {
        method: "DELETE",
        headers: { "x-auth-username": username },
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Falha ao excluir romaneio");
      }
      onDeleted();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao excluir romaneio");
      setExecuting(false);
    }
  };

  const totalItens = preview?.totalItens ?? 0;
  const totalProdutos = preview?.totalProdutos ?? 0;

  return (
    <div className={styles.overlay} onClick={fechar}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Excluir romaneio #{romaneio}</h2>

        {/* Passo 1: escolha do modo */}
        {!modo && (
          <>
            <p className={styles.subtitle}>O que você deseja fazer?</p>
            <div className={styles.choices}>
              <button
                type="button"
                className={styles.choiceBtn}
                onClick={() => setModo("apenas")}
              >
                <span className={styles.choiceTitle}>Deletar apenas o romaneio</span>
                <span className={styles.choiceDesc}>Remove o romaneio. O estoque NÃO é alterado.</span>
              </button>
              <button
                type="button"
                className={`${styles.choiceBtn} ${styles.choiceBtnReturn}`}
                onClick={() => setModo("retornar")}
              >
                <span className={styles.choiceTitle}>Deletar e retornar os itens à origem</span>
                <span className={styles.choiceDesc}>
                  {tipo === "saida"
                    ? "Devolve os itens à filial de origem (estoque volta a subir)."
                    : "Remove os itens da filial de destino (estoque volta a baixar)."}
                </span>
              </button>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.btnCancel} onClick={fechar}>
                Cancelar
              </button>
            </div>
          </>
        )}

        {/* Passo 2: confirmação */}
        {modo && (
          <>
            {loadingPreview ? (
              <p className={styles.subtitle}>Carregando dados...</p>
            ) : erro && !preview ? (
              <p className={styles.erro}>{erro}</p>
            ) : (
              <>
                {modo === "apenas" ? (
                  <p className={styles.confirmText}>
                    Você está deletando o romaneio <strong>#{romaneio}</strong> ({totalProdutos}{" "}
                    produto(s) • {totalItens} item(ns)). O estoque <strong>NÃO</strong> será alterado.
                  </p>
                ) : (
                  <>
                    <p className={styles.confirmText}>
                      Retornando <strong>{totalItens} item(ns)</strong> ({totalProdutos} produto(s)) à
                      origem. O estoque ficará:
                    </p>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Produto</th>
                            <th>Cor</th>
                            <th className={styles.num}>Qtd</th>
                            <th className={styles.num}>Atual</th>
                            <th className={styles.num}>Ficará</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(preview?.itens ?? []).map((it, i) => (
                            <tr key={`${it.produto}-${it.cor}-${i}`}>
                              <td>{it.produto}</td>
                              <td>{it.cor || "-"}</td>
                              <td className={styles.num}>{it.qtde}</td>
                              <td className={styles.num}>{it.estoqueAtual}</td>
                              <td className={styles.num}>
                                <strong>{it.estoqueFinal}</strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {erro && <p className={styles.erro}>{erro}</p>}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.btnCancel}
                    onClick={() => {
                      if (executing) return;
                      setModo(null);
                      setPreview(null);
                      setErro(null);
                    }}
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    className={styles.btnDanger}
                    onClick={confirmar}
                    disabled={executing}
                  >
                    {executing
                      ? "Excluindo..."
                      : modo === "retornar"
                      ? "Confirmar exclusão e retorno"
                      : "Confirmar exclusão"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
