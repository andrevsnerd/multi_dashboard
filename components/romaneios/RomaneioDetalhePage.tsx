"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/AuthContext";
import styles from "./RomaneioDetalhePage.module.css";

// ---------- helpers de API ----------

async function fetchConfirmados(
  companyKey: string,
  romaneioId: string,
  filialDestino: string
): Promise<Map<string, number>> {
  const params = new URLSearchParams({ company: companyKey, romaneio: romaneioId, filialDestino });
  const res = await fetch(`/api/romaneio-confirmar-entrada?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) return new Map();
  const json = (await res.json()) as { data: Record<string, number> };
  return new Map(Object.entries(json.data || {}));
}

async function postConfirmacao(
  username: string,
  companyKey: string,
  romaneioId: string,
  filialDestino: string,
  produto: string,
  corProduto: string,
  qtdeConfirmada: number,
  acao: "confirmar" | "desconfirmar"
): Promise<boolean> {
  const res = await fetch("/api/romaneio-confirmar-entrada", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify({
      companyKey,
      romaneioId,
      filialDestino,
      produto,
      corProduto: corProduto ?? "",
      qtdeConfirmada,
      acao,
    }),
  });
  return res.ok;
}

/** Registra efetivamente a entrada de estoque na filial destino (igual SaidasEntradasProdutosPage). */
async function executarEntradaEstoque(
  username: string,
  filialCod: string,
  produto: string,
  corProduto: string | null,
  quantidade: number,
  responsavel: string
): Promise<boolean> {
  const res = await fetch("/api/saidas-entradas-produtos/executar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify({
      tipoOperacao: "entrada",
      filial: filialCod,
      itens: [{ produto, corProduto: corProduto ?? null, quantidade }],
      tipoRomaneio: "TRANSFERENCIA ENTRE LOJAS",
      responsavel: responsavel || "LOGISTICA",
      observacao: null,
    }),
  });
  return res.ok;
}

// ---------- tipos ----------

export interface RomaneioDetalheItem {
  produto: string;
  corProduto: string | null;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  subgrupo: string;
  grade: string;
  qtde: number;
  estoqueOrigem: number;
  estoqueDestino: number;
  filialOrigem?: string;
  filialDestino?: string;
  destino?: string;
}

interface FilialOption {
  codFilial: string;
  filial: string;
}

interface RomaneioDetalhePageProps {
  companySlug: string;
  companyName: string;
  romaneioId: string;
  tipo: "saida" | "entrada";
  filialOrigem: string;
  filialDestino: string;
  dataEmissao?: string;
  responsavel?: string;
}

// ---------- fetch helpers ----------

async function fetchDetalhes(
  tipo: "saida" | "entrada",
  romaneio: string,
  filialOrigem: string,
  filialDestino: string
): Promise<RomaneioDetalheItem[]> {
  const params = new URLSearchParams({ tipo, romaneio, filialOrigem, filialDestino });
  const response = await fetch(`/api/transferencia-produtos/log-detalhes?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: RomaneioDetalheItem[] };
  return json.data || [];
}

async function fetchFiliais(): Promise<FilialOption[]> {
  const response = await fetch("/api/transferencia-produtos/filiais", { cache: "no-store" });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: FilialOption[] };
  return json.data || [];
}

async function fetchDestinoRomaneio(
  companyKey: string,
  romaneioId: string,
  filialOrigem: string
): Promise<string | null> {
  const res = await fetch(
    `/api/destino-romaneio?company=${encodeURIComponent(companyKey)}&romaneio=${encodeURIComponent(romaneioId)}&filialOrigem=${encodeURIComponent(filialOrigem)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { filialDestino?: string | null };
  return json.filialDestino ?? null;
}

async function saveDestinoRomaneio(
  username: string,
  companyKey: string,
  romaneioId: string,
  filialOrigem: string,
  filialDestino: string
): Promise<boolean> {
  const res = await fetch("/api/destino-romaneio", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify({ companyKey, romaneioId, filialOrigem, filialDestino }),
  });
  return res.ok;
}

// ---------- componente ----------

export default function RomaneioDetalhePage({
  companySlug,
  romaneioId,
  tipo,
  filialOrigem,
  filialDestino,
  dataEmissao: dataEmissaoProp = "",
  responsavel: responsavelProp = "",
}: RomaneioDetalhePageProps) {
  const { user } = useAuth();
  const [itens, setItens] = useState<RomaneioDetalheItem[]>([]);
  const [loading, setLoading] = useState(true);

  const dataEmissao = dataEmissaoProp
    ? (() => {
        try { return new Date(dataEmissaoProp).toLocaleString("pt-BR"); }
        catch { return dataEmissaoProp; }
      })()
    : "";
  const responsavel = responsavelProp || "";

  // --- destino (apenas saídas) ---
  const [filiais, setFiliais] = useState<FilialOption[]>([]);
  const [destinoSelected, setDestinoSelected] = useState<string>("");
  const [loadingDestino, setLoadingDestino] = useState(false);
  const canSetDestino =
    !!user &&
    (user.role === "admin" || (user.permissions ?? []).includes("destino-romaneio"));

  // --- confirmações ---
  // Map: "produto|cor" → qtde_confirmada
  const [confirmados, setConfirmados] = useState<Map<string, number>>(new Map());
  const [confirmandoKey, setConfirmandoKey] = useState<string | null>(null);
  const [editandoKey, setEditandoKey] = useState<string | null>(null);
  const [editQtde, setEditQtde] = useState<number>(0);
  const [erroConfirmacao, setErroConfirmacao] = useState<string | null>(null);

  // --- load destino ---
  const loadDestino = useCallback(() => {
    if (tipo !== "saida") return;
    setLoadingDestino(true);
    fetchDestinoRomaneio(companySlug, romaneioId, filialOrigem)
      .then((val) => setDestinoSelected(val ?? ""))
      .finally(() => setLoadingDestino(false));
  }, [companySlug, romaneioId, filialOrigem, tipo]);

  useEffect(() => {
    let cancelled = false;
    // Para saídas: usar destinoSelected como filialDestino (para popular estoqueDestino corretamente)
    const fd = tipo === "saida" ? destinoSelected : filialDestino;
    setLoading(true);
    fetchDetalhes(tipo, romaneioId, filialOrigem, fd).then((data) => {
      if (!cancelled) { setItens(data); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [tipo, romaneioId, filialOrigem, filialDestino, destinoSelected]);

  useEffect(() => {
    if (tipo === "saida") {
      fetchFiliais().then(setFiliais);
      loadDestino();
    }
  }, [tipo, loadDestino]);

  // Carrega confirmados para entradas (usando filialDestino)
  useEffect(() => {
    if (tipo === "entrada" && filialDestino) {
      fetchConfirmados(companySlug, romaneioId, filialDestino).then(setConfirmados);
    }
  }, [tipo, companySlug, romaneioId, filialDestino]);

  // Carrega confirmados para saídas (usando destinoSelected — disponível após loadDestino)
  useEffect(() => {
    if (tipo === "saida" && destinoSelected) {
      fetchConfirmados(companySlug, romaneioId, destinoSelected).then(setConfirmados);
    }
  }, [tipo, companySlug, romaneioId, destinoSelected]);

  // Abre o input de quantidade para um item
  const handleAbrirInput = useCallback((produto: string, corProduto: string | null, qtdeOriginal: number) => {
    const chave = `${produto}|${corProduto ?? ""}`;
    setEditandoKey(chave);
    setErroConfirmacao(null);
    setEditQtde(confirmados.get(chave) ?? qtdeOriginal);
  }, [confirmados]);

  // Confirma com a qtde digitada
  const handleConfirmar = useCallback(async (produto: string, corProduto: string | null) => {
    if (!user?.username) return;
    const cor = corProduto ?? "";
    const chave = `${produto}|${cor}`;
    if (editQtde <= 0) return;
    setConfirmandoKey(chave);
    setEditandoKey(null);
    setErroConfirmacao(null);

    if (tipo === "saida") {
      // Saída: registra efetivamente a entrada de estoque na filial destino
      if (!destinoSelected) {
        setErroConfirmacao("Destino não definido. Peça ao administrador para definir a filial destino.");
        setConfirmandoKey(null);
        return;
      }
      const entradaOk = await executarEntradaEstoque(
        user.username,
        destinoSelected,
        produto,
        corProduto,
        editQtde,
        responsavel
      );
      if (!entradaOk) {
        setErroConfirmacao(`Erro ao registrar entrada de ${produto}. Tente novamente.`);
        setConfirmandoKey(null);
        return;
      }
      // Registra confirmação no romaneio (usando destinoSelected como chave)
      const ok = await postConfirmacao(
        user.username, companySlug, romaneioId, destinoSelected,
        produto, cor, editQtde, "confirmar"
      );
      if (ok) {
        setConfirmados((prev) => {
          const next = new Map(prev);
          next.set(chave, editQtde);
          return next;
        });
      }
    } else {
      // Entrada: só marca no romaneio (sem lançar estoque de novo)
      const ok = await postConfirmacao(
        user.username, companySlug, romaneioId, filialDestino,
        produto, cor, editQtde, "confirmar"
      );
      if (ok) {
        setConfirmados((prev) => {
          const next = new Map(prev);
          next.set(chave, editQtde);
          return next;
        });
      }
    }

    setConfirmandoKey(null);
  }, [user?.username, companySlug, romaneioId, filialDestino, destinoSelected, tipo, responsavel, editQtde]);

  // Desconfirma (remove marcação — sem reverter estoque)
  const handleDesconfirmar = useCallback(async (produto: string, corProduto: string | null) => {
    if (!user?.username) return;
    const cor = corProduto ?? "";
    const chave = `${produto}|${cor}`;
    setConfirmandoKey(chave);
    const filialRef = tipo === "saida" ? destinoSelected : filialDestino;
    const ok = await postConfirmacao(
      user.username, companySlug, romaneioId, filialRef,
      produto, cor, 0, "desconfirmar"
    );
    if (ok) {
      setConfirmados((prev) => {
        const next = new Map(prev);
        next.delete(chave);
        return next;
      });
    }
    setConfirmandoKey(null);
  }, [user?.username, companySlug, romaneioId, filialDestino, destinoSelected, tipo]);

  const handleDestinoChange = useCallback(async (codFilial: string) => {
    setDestinoSelected(codFilial);
    if (!user?.username) return;
    await saveDestinoRomaneio(user.username, companySlug, romaneioId, filialOrigem, codFilial);
  }, [user?.username, companySlug, romaneioId, filialOrigem]);

  const destinoDisplay =
    destinoSelected && filiais.length > 0
      ? filiais.find((f) => f.codFilial === destinoSelected)?.filial || destinoSelected
      : null;

  const qtdProdutos = itens.length;
  const qtdItens = itens.reduce((s, i) => s + i.qtde, 0);
  const backHref = `/${companySlug}/romaneios`;

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando detalhes do romaneio...</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <Link href={backHref} className={styles.backLink}>← Voltar</Link>
        <h1 className={styles.title}>Romaneio #{romaneioId}</h1>
        <p className={styles.meta}>{responsavel || "—"} • {dataEmissao || "—"}</p>
      </header>

      {tipo === "saida" && canSetDestino && (
        <div className={styles.destinoSection}>
          <label htmlFor="destino-romaneio-detalhe" className={styles.destinoLabel}>
            Filial destino
          </label>
          <select
            id="destino-romaneio-detalhe"
            className={styles.destinoSelect}
            value={destinoSelected}
            onChange={(e) => handleDestinoChange(e.target.value)}
            disabled={loadingDestino}
          >
            <option value="">Nenhum destino definido</option>
            {filiais.map((f) => (
              <option key={f.codFilial} value={f.codFilial}>
                {f.filial} ({f.codFilial})
              </option>
            ))}
          </select>
        </div>
      )}

      {tipo === "saida" && !canSetDestino && destinoDisplay && (
        <p className={styles.destinoReadOnly}>Destino: {destinoDisplay}</p>
      )}

      {erroConfirmacao && (
        <div className={styles.erroConfirmacao}>{erroConfirmacao}</div>
      )}

      <div className={styles.cards}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryIcon}>📦</span>
          <div>
            <span className={styles.summaryValue}>Produtos</span>
            <span className={styles.summaryNumber}>{qtdProdutos}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryIcon}>📦</span>
          <div>
            <span className={styles.summaryValue}>Itens</span>
            <span className={styles.summaryNumber}>{qtdItens}</span>
          </div>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>PRODUTO</th>
              <th>CÓD. BARRAS</th>
              <th>SUBGRUPO</th>
              <th>GRADE</th>
              <th>DESCRIÇÃO</th>
              <th>COR</th>
              <th>DESTINO</th>
              <th>QTD ROMANEIO</th>
              {tipo === "saida" && <th>ESTOQUE DESTINO</th>}
              {tipo === "saida" && <th>CONFIRMAR ENTRADA</th>}
              {tipo === "entrada" && <th>RECEBIDO</th>}
            </tr>
          </thead>
          <tbody>
            {itens.map((item, idx) => {
              const destinoCell =
                tipo === "saida"
                  ? destinoDisplay || "—"
                  : (item.destino && item.destino.trim()) || "—";

              const chave = `${item.produto}|${item.corProduto ?? ""}`;
              const isConfirmado = confirmados.has(chave);
              const qtdeConfirmada = confirmados.get(chave) ?? 0;
              const isConfirmando = confirmandoKey === chave;
              const isEditando = editandoKey === chave;
              const temDivergencia = isConfirmado && qtdeConfirmada !== item.qtde;

              return (
                <tr
                  key={`${item.produto}-${item.corProduto ?? ""}-${idx}`}
                  className={isConfirmado ? styles.rowConfirmada : ""}
                >
                  <td>{item.produto}</td>
                  <td>{item.codigoBarra ?? "—"}</td>
                  <td>{item.subgrupo || "—"}</td>
                  <td>{item.grade || "—"}</td>
                  <td>{item.descProduto || "—"}</td>
                  <td>{item.descCor || item.corProduto || "—"}</td>
                  <td>
                    <span className={styles.destinoTag}>{destinoCell}</span>
                  </td>

                  {/* Coluna QTD — sempre mostra o original do romaneio */}
                  <td>
                    <div className={styles.qtdCell}>
                      <span className={styles.qtdValue}>{item.qtde}</span>
                    </div>
                  </td>

                  {/* Coluna ESTOQUE DESTINO (saídas) */}
                  {tipo === "saida" && (
                    <td>
                      <span className={
                        item.estoqueDestino === 0
                          ? styles.estoqueZero
                          : styles.estoqueValor
                      }>
                        {destinoSelected ? item.estoqueDestino : "—"}
                      </span>
                    </td>
                  )}

                  {/* Coluna CONFIRMAR ENTRADA (saídas) */}
                  {tipo === "saida" && (
                    <td className={styles.recebidoCell}>
                      {isConfirmando ? (
                        <span className={styles.loadingDots}>...</span>
                      ) : isEditando ? (
                        <div className={styles.qtdeInputWrap}>
                          <div className={styles.qtdeInputRow}>
                            <span className={styles.qtdeInputLabel}>Qtde recebida:</span>
                            <button
                              type="button"
                              className={styles.qtdeSpinBtn}
                              onClick={() => setEditQtde((v) => Math.max(0, v - 1))}
                            >−</button>
                            <input
                              type="number"
                              min={0}
                              className={styles.qtdeInput}
                              value={editQtde}
                              onChange={(e) => setEditQtde(Math.max(0, parseInt(e.target.value, 10) || 0))}
                              autoFocus
                            />
                            <button
                              type="button"
                              className={styles.qtdeSpinBtn}
                              onClick={() => setEditQtde((v) => v + 1)}
                            >+</button>
                          </div>
                          {editQtde !== item.qtde && editQtde > 0 && (
                            <div className={styles.divergenciaAviso}>
                              {editQtde < item.qtde
                                ? `⚠ Faltam ${item.qtde - editQtde} un. (romaneio: ${item.qtde})`
                                : `⚠ Excesso de ${editQtde - item.qtde} un. (romaneio: ${item.qtde})`}
                            </div>
                          )}
                          <div className={styles.qtdeInputActions}>
                            <button
                              type="button"
                              className={styles.confirmarQtdeBtn}
                              disabled={editQtde <= 0}
                              onClick={() => handleConfirmar(item.produto, item.corProduto)}
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              className={styles.cancelarQtdeBtn}
                              onClick={() => setEditandoKey(null)}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : isConfirmado ? (
                        /* Saída confirmada — entrada de estoque já foi registrada */
                        <div className={styles.confirmadoWrap}>
                          <span
                            className={
                              temDivergencia ? styles.confirmadoBadgeDivergente : styles.confirmadoBadge
                            }
                          >
                            ✓ {qtdeConfirmada} recebido{qtdeConfirmada !== 1 ? "s" : ""}
                          </span>
                          {temDivergencia && (
                            <span className={styles.originalBadge}>
                              {qtdeConfirmada < item.qtde
                                ? `▼ faltou ${item.qtde - qtdeConfirmada}`
                                : `▲ excesso ${qtdeConfirmada - item.qtde}`}
                            </span>
                          )}
                          {user?.role === "admin" && (
                            <div className={styles.confirmadoActions}>
                              <button
                                type="button"
                                className={styles.desfazerBtn}
                                onClick={() => handleDesconfirmar(item.produto, item.corProduto)}
                              >
                                Zerar confirmação
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.receberBtn}
                          disabled={!user || (!destinoSelected && !canSetDestino)}
                          onClick={() => handleAbrirInput(item.produto, item.corProduto, item.qtde)}
                        >
                          DAR ENTRADA
                        </button>
                      )}
                    </td>
                  )}

                  {/* Coluna RECEBIDO (entradas) */}
                  {tipo === "entrada" && (
                    <td className={styles.recebidoCell}>
                      {isConfirmando ? (
                        <span className={styles.loadingDots}>...</span>
                      ) : isEditando ? (
                        <div className={styles.qtdeInputWrap}>
                          <div className={styles.qtdeInputRow}>
                            <span className={styles.qtdeInputLabel}>Qtde recebida:</span>
                            <button
                              type="button"
                              className={styles.qtdeSpinBtn}
                              onClick={() => setEditQtde((v) => Math.max(0, v - 1))}
                            >−</button>
                            <input
                              type="number"
                              min={0}
                              className={styles.qtdeInput}
                              value={editQtde}
                              onChange={(e) => setEditQtde(Math.max(0, parseInt(e.target.value, 10) || 0))}
                              autoFocus
                            />
                            <button
                              type="button"
                              className={styles.qtdeSpinBtn}
                              onClick={() => setEditQtde((v) => v + 1)}
                            >+</button>
                          </div>
                          {editQtde !== item.qtde && editQtde > 0 && (
                            <div className={styles.divergenciaAviso}>
                              {editQtde < item.qtde
                                ? `⚠ Faltam ${item.qtde - editQtde} un. (romaneio: ${item.qtde})`
                                : `⚠ Excesso de ${editQtde - item.qtde} un. (romaneio: ${item.qtde})`}
                            </div>
                          )}
                          <div className={styles.qtdeInputActions}>
                            <button
                              type="button"
                              className={styles.confirmarQtdeBtn}
                              disabled={editQtde <= 0}
                              onClick={() => handleConfirmar(item.produto, item.corProduto)}
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              className={styles.cancelarQtdeBtn}
                              onClick={() => setEditandoKey(null)}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : isConfirmado ? (
                        <div className={styles.confirmadoWrap}>
                          <span
                            className={
                              temDivergencia ? styles.confirmadoBadgeDivergente : styles.confirmadoBadge
                            }
                          >
                            ✓ {qtdeConfirmada} recebido{qtdeConfirmada !== 1 ? "s" : ""}
                          </span>
                          {temDivergencia && (
                            <span className={styles.originalBadge}>
                              {qtdeConfirmada < item.qtde
                                ? `▼ faltou ${item.qtde - qtdeConfirmada}`
                                : `▲ excesso ${qtdeConfirmada - item.qtde}`}
                            </span>
                          )}
                          <div className={styles.confirmadoActions}>
                            <button
                              type="button"
                              className={styles.editarQtdeBtn}
                              onClick={() => handleAbrirInput(item.produto, item.corProduto, item.qtde)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className={styles.desfazerBtn}
                              onClick={() => handleDesconfirmar(item.produto, item.corProduto)}
                            >
                              Desfazer
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.receberBtn}
                          disabled={!user}
                          onClick={() => handleAbrirInput(item.produto, item.corProduto, item.qtde)}
                        >
                          DAR ENTRADA
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {itens.length === 0 && (
        <div className={styles.emptyState}>
          Nenhum item encontrado neste romaneio.
        </div>
      )}
    </div>
  );
}
