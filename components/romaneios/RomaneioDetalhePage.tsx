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

/** Registra entrada de estoque em lote (todos os itens no mesmo romaneio). */
async function executarEntradaEstoqueLote(
  username: string,
  filialCod: string,
  itens: Array<{ produto: string; corProduto: string | null; quantidade: number }>,
  responsavel: string
): Promise<boolean> {
  const res = await fetch("/api/saidas-entradas-produtos/executar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify({
      tipoOperacao: "entrada",
      filial: filialCod,
      itens,
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

  // --- dar saída (apenas entradas) ---
  const [darSaidaDestino, setDarSaidaDestino] = useState("");
  const [darSaidaExecutando, setDarSaidaExecutando] = useState(false);
  const [darSaidaErro, setDarSaidaErro] = useState<string | null>(null);
  const [darSaidaSucesso, setDarSaidaSucesso] = useState<string | null>(null);
  const [darSaidaModalAberto, setDarSaidaModalAberto] = useState(false);

  // --- confirmações ---
  // Map: "produto|cor" → qtde_confirmada
  const [confirmados, setConfirmados] = useState<Map<string, number>>(new Map());
  // Map: "produto|cor" → qtde editada pelo usuário (para confirmar tudo)
  const [quantidades, setQuantidades] = useState<Map<string, number>>(new Map());
  const [confirmandoTudo, setConfirmandoTudo] = useState(false);
  const [confirmandoKey, setConfirmandoKey] = useState<string | null>(null);
  const [erroConfirmacao, setErroConfirmacao] = useState<string | null>(null);

  // Inicializa quantidades quando itens carregam
  useEffect(() => {
    if (itens.length === 0) return;
    setQuantidades((prev) => {
      const next = new Map(prev);
      for (const item of itens) {
        const chave = `${item.produto}|${item.corProduto ?? ""}`;
        if (!next.has(chave)) {
          next.set(chave, confirmados.get(chave) ?? item.qtde);
        }
      }
      return next;
    });
  }, [itens, confirmados]);

  const updateQuantidade = useCallback((chave: string, valor: number) => {
    setQuantidades((prev) => {
      const next = new Map(prev);
      next.set(chave, Math.max(0, valor));
      return next;
    });
  }, []);

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
    } else {
      // Entradas também precisam das filiais (para o modal "Dar Saída")
      fetchFiliais().then(setFiliais);
    }
  }, [tipo, loadDestino]);

  useEffect(() => {
    if (tipo === "entrada" && filialDestino) {
      fetchConfirmados(companySlug, romaneioId, filialDestino).then(setConfirmados);
    }
  }, [tipo, companySlug, romaneioId, filialDestino]);

  useEffect(() => {
    if (tipo === "saida" && destinoSelected) {
      fetchConfirmados(companySlug, romaneioId, destinoSelected).then(setConfirmados);
    }
  }, [tipo, companySlug, romaneioId, destinoSelected]);

  // Confirmar tudo de uma vez
  const handleConfirmarTudo = useCallback(async () => {
    if (!user?.username) return;

    const filialRef = tipo === "saida" ? destinoSelected : filialDestino;

    if (tipo === "saida" && !destinoSelected) {
      setErroConfirmacao("Destino não definido. Peça ao administrador para definir a filial destino.");
      return;
    }

    const itensParaConfirmar = itens
      .map((item) => {
        const chave = `${item.produto}|${item.corProduto ?? ""}`;
        const qtde = quantidades.get(chave) ?? item.qtde;
        return { produto: item.produto, corProduto: item.corProduto, quantidade: qtde, chave };
      })
      .filter((i) => i.quantidade > 0);

    if (itensParaConfirmar.length === 0) return;

    setConfirmandoTudo(true);
    setErroConfirmacao(null);

    try {
      if (tipo === "saida") {
        // Registra entrada de estoque em lote (1 romaneio para todos)
        const ok = await executarEntradaEstoqueLote(
          user.username,
          destinoSelected,
          itensParaConfirmar.map((i) => ({
            produto: i.produto,
            corProduto: i.corProduto,
            quantidade: i.quantidade,
          })),
          responsavel
        );
        if (!ok) {
          setErroConfirmacao("Erro ao registrar entrada de estoque. Tente novamente.");
          return;
        }
      }

      // Marca confirmação no romaneio para cada item
      for (const item of itensParaConfirmar) {
        await postConfirmacao(
          user.username, companySlug, romaneioId, filialRef,
          item.produto, item.corProduto ?? "", item.quantidade, "confirmar"
        );
      }

      // Atualiza estado local
      setConfirmados((prev) => {
        const next = new Map(prev);
        for (const item of itensParaConfirmar) {
          next.set(item.chave, item.quantidade);
        }
        return next;
      });
    } catch {
      setErroConfirmacao("Erro inesperado. Tente novamente.");
    } finally {
      setConfirmandoTudo(false);
    }
  }, [user?.username, itens, quantidades, tipo, destinoSelected, filialDestino, companySlug, romaneioId, responsavel]);

  // Desconfirma item individualmente (sem reverter estoque)
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

  // Itens ainda não confirmados com qty > 0 (serão enviados no próximo "Confirmar Tudo")
  const itensParaConfirmar = itens.filter((item) => {
    const chave = `${item.produto}|${item.corProduto ?? ""}`;
    return !confirmados.has(chave) && (quantidades.get(chave) ?? item.qtde) > 0;
  });

  const todosConfirmados = itens.length > 0 && itens.every((item) =>
    confirmados.has(`${item.produto}|${item.corProduto ?? ""}`)
  );

  const podeConfirmar =
    !!user &&
    !todosConfirmados &&
    itensParaConfirmar.length > 0 &&
    !confirmandoTudo &&
    (tipo !== "saida" || !!destinoSelected);

  async function handleDarSaidaTodos() {
    if (!darSaidaDestino || !user?.username) return;
    setDarSaidaExecutando(true);
    setDarSaidaErro(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-auth-username": user.username,
      };
      const res = await fetch("/api/saidas-entradas-produtos/executar", {
        method: "POST",
        headers,
        body: JSON.stringify({
          tipoOperacao: "saida",
          filial: filialDestino,
          itens: itens.map((item) => ({
            produto: item.produto,
            corProduto: item.corProduto,
            quantidade: item.qtde,
          })),
          tipoRomaneio: "TRANSFERENCIA ENTRE LOJAS",
          responsavel: responsavel || user.username || "LOGISTICA",
        }),
      });
      const json = (await res.json()) as { success?: boolean; romaneio?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "Erro ao executar saída");

      // Salva o destino no romaneio de saída gerado
      if (json.romaneio) {
        try {
          await fetch("/api/destino-romaneio", {
            method: "PUT",
            headers: { "Content-Type": "application/json", "x-auth-username": user.username },
            body: JSON.stringify({
              companyKey: companySlug,
              romaneioId: json.romaneio,
              filialOrigem: filialDestino,
              filialDestino: darSaidaDestino,
            }),
          });
        } catch {
          // não bloquear se falhar ao salvar destino
        }
      }

      setDarSaidaSucesso(`Saída gerada! Romaneio: ${json.romaneio}`);
    } catch (err: unknown) {
      setDarSaidaErro(err instanceof Error ? err.message : "Erro ao executar saída");
    } finally {
      setDarSaidaExecutando(false);
    }
  }

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

      {/* Barra de ações */}
      {user && (
        <div className={styles.confirmarTudoBar}>
          {tipo === "saida" && !todosConfirmados && (
            <button
              type="button"
              className={styles.confirmarTudoBtn}
              onClick={handleConfirmarTudo}
              disabled={!podeConfirmar}
            >
              {confirmandoTudo
                ? "Confirmando…"
                : `Confirmar Tudo (${itensParaConfirmar.length} produto${itensParaConfirmar.length !== 1 ? "s" : ""})`}
            </button>
          )}
          {tipo === "entrada" && itens.length > 0 && (
            <button
              type="button"
              className={styles.darSaidaTodosBtn}
              onClick={() => {
                setDarSaidaErro(null);
                setDarSaidaSucesso(null);
                setDarSaidaDestino("");
                setDarSaidaModalAberto(true);
              }}
            >
              Dar Saída Todos
            </button>
          )}
        </div>
      )}

      {/* Modal Dar Saída Todos */}
      {darSaidaModalAberto && (
        <div
          className={styles.modalOverlay}
          onClick={() => { if (!darSaidaExecutando) setDarSaidaModalAberto(false); }}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Dar Saída — Romaneio #{romaneioId}</h2>
            <p className={styles.modalOrigem}>
              Origem: <strong>{filialDestino}</strong>
            </p>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Destino</label>
              <select
                className={styles.modalSelect}
                value={darSaidaDestino}
                onChange={(e) => setDarSaidaDestino(e.target.value)}
                disabled={darSaidaExecutando || !!darSaidaSucesso}
              >
                <option value="">Selecione o destino...</option>
                {filiais
                  .filter((f) => f.codFilial !== filialDestino && f.filial !== filialDestino)
                  .map((f) => (
                    <option key={f.codFilial} value={f.codFilial}>
                      {f.filial}
                    </option>
                  ))}
              </select>
            </div>

            <div className={styles.modalItensResumo}>
              {itens.length} produto(s) • {itens.reduce((s, i) => s + i.qtde, 0)} unidades no total
            </div>

            {darSaidaErro && <p className={styles.modalErro}>{darSaidaErro}</p>}
            {darSaidaSucesso && <p className={styles.modalSucesso}>{darSaidaSucesso}</p>}

            <div className={styles.modalActions}>
              {!darSaidaSucesso ? (
                <>
                  <button
                    type="button"
                    className={styles.modalBtnCancelar}
                    onClick={() => setDarSaidaModalAberto(false)}
                    disabled={darSaidaExecutando}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className={styles.modalBtnConfirmar}
                    onClick={handleDarSaidaTodos}
                    disabled={!darSaidaDestino || darSaidaExecutando}
                  >
                    {darSaidaExecutando ? "Executando..." : "Confirmar Saída"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.modalBtnCancelar}
                  onClick={() => setDarSaidaModalAberto(false)}
                >
                  Fechar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
              const isZerando = confirmandoKey === chave;
              const qtdeAtual = quantidades.get(chave) ?? item.qtde;
              const temDivergencia = isConfirmado && qtdeConfirmada !== item.qtde;
              const temDivergenciaInput = qtdeAtual !== item.qtde;

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

                  {/* QTD do romaneio original */}
                  <td>
                    <div className={styles.qtdCell}>
                      <span className={styles.qtdValue}>{item.qtde}</span>
                    </div>
                  </td>

                  {/* Estoque destino (saídas) */}
                  {tipo === "saida" && (
                    <td>
                      <span className={item.estoqueDestino === 0 ? styles.estoqueZero : styles.estoqueValor}>
                        {destinoSelected ? item.estoqueDestino : "—"}
                      </span>
                    </td>
                  )}

                  {/* Coluna de confirmação — apenas saídas */}
                  {tipo === "saida" && (
                    <td className={styles.recebidoCell}>
                      {isZerando || confirmandoTudo ? (
                        <span className={styles.loadingDots}>...</span>
                      ) : isConfirmado ? (
                        <div className={styles.confirmadoWrap}>
                          <span className={temDivergencia ? styles.confirmadoBadgeDivergente : styles.confirmadoBadge}>
                            ✓ {qtdeConfirmada} confirmado{qtdeConfirmada !== 1 ? "s" : ""}
                          </span>
                          {temDivergencia && (
                            <span className={styles.originalBadge}>
                              {qtdeConfirmada < item.qtde
                                ? `▼ faltou ${item.qtde - qtdeConfirmada}`
                                : `▲ excesso ${qtdeConfirmada - item.qtde}`}
                            </span>
                          )}
                          {user?.role === "admin" && (
                            <button
                              type="button"
                              className={styles.desfazerBtn}
                              onClick={() => handleDesconfirmar(item.produto, item.corProduto)}
                            >
                              Zerar
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className={styles.qtdeInputWrap}>
                          <div className={styles.qtdeInputRow}>
                            <button
                              type="button"
                              className={styles.qtdeSpinBtn}
                              onClick={() => updateQuantidade(chave, qtdeAtual - 1)}
                            >−</button>
                            <input
                              type="number"
                              min={0}
                              className={styles.qtdeInput}
                              value={qtdeAtual}
                              onChange={(e) => updateQuantidade(chave, parseInt(e.target.value, 10) || 0)}
                            />
                            <button
                              type="button"
                              className={styles.qtdeSpinBtn}
                              onClick={() => updateQuantidade(chave, qtdeAtual + 1)}
                            >+</button>
                          </div>
                          {temDivergenciaInput && qtdeAtual > 0 && (
                            <div className={styles.divergenciaAviso}>
                              {qtdeAtual < item.qtde
                                ? `⚠ Faltam ${item.qtde - qtdeAtual} un. (romaneio: ${item.qtde})`
                                : `⚠ Excesso de ${qtdeAtual - item.qtde} un. (romaneio: ${item.qtde})`}
                            </div>
                          )}
                          {qtdeAtual === 0 && (
                            <div className={styles.divergenciaAviso}>⚠ Item será ignorado</div>
                          )}
                        </div>
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
