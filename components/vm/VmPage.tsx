"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import type { CompanyKey } from "@/lib/config/company";
import type { RoleKey } from "@/types/auth";
import { buildVmKey, type VmItem, type VmMovimento } from "@/lib/utils/vm";

import styles from "./VmPage.module.css";

interface FilialVm {
  cod: string;
  nome: string;
  display: string;
  apelido: string | null;
}

interface EscopoVm {
  username: string;
  role: RoleKey;
  todasFiliais: boolean;
  podeMutar: boolean;
}

interface EstadoVm {
  escopo: EscopoVm;
  /** Só filiais em uso da empresa — resolvido no servidor pelo escopo do usuário. */
  filiais: FilialVm[];
  items: VmItem[];
  movimentos: VmMovimento[];
}

interface ProductSearchResult {
  productId: string;
  productName: string;
}

interface CorDisponivel {
  cor: string;
  descCor: string;
  estoque: number;
}

/** Peça no rascunho, esperando o Salvar. */
interface PendenteEntrada {
  produto: string;
  cor: string;
  descricao: string;
  descCor: string;
  estoque: number;
}

interface PreviewLinha {
  direcao: "saida" | "entrada";
  produto: string;
  cor: string;
  descricao: string;
  descCor: string;
  estoqueAtual: number;
  estoqueDepois: number;
  bloqueio: string | null;
}

interface Preview {
  filial: string;
  filialNome: string;
  linhas: PreviewLinha[];
  executaveis: number;
  bloqueadas: number;
}

interface ResultadoDirecao {
  direcao: "saida" | "entrada";
  /** TIPO_ROMANEIO do Linx — sempre 'VM'. */
  tipo: string;
  /** "saída" ou "entrada" — a operação, não um tipo. */
  operacao: string;
  romaneio: string | null;
  itens: number;
  erro: string | null;
}

interface Resultado {
  filialNome: string;
  direcoes: ResultadoDirecao[];
  bloqueadas: PreviewLinha[];
}

interface VmPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

function corLabel(cor: string, descCor: string): string {
  const desc = (descCor || "").trim();
  return desc ? `${desc} (${cor})` : cor;
}

function dataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function VmPage({ companyKey, companyName }: VmPageProps) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [estado, setEstado] = useState<EstadoVm | null>(null);
  const [loading, setLoading] = useState(true);
  const [filialCod, setFilialCod] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProductSearchResult | null>(null);
  const [cores, setCores] = useState<CorDisponivel[]>([]);
  const [corSelecionada, setCorSelecionada] = useState("");
  const [carregandoCores, setCarregandoCores] = useState(false);

  const [entrando, setEntrando] = useState<PendenteEntrada[]>([]);
  const [saindo, setSaindo] = useState<string[]>([]); // chaves buildVmKey dos itens a remover

  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useMemo(
    () => (username ? { "x-auth-username": username } : undefined),
    [username]
  );

  const carregarEstado = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/vm?company=${encodeURIComponent(companyKey)}`, {
        cache: "no-store",
        headers: { "x-auth-username": username },
      });
      const json = (await response.json()) as (EstadoVm & { error?: string }) | { error: string };
      if (!response.ok) {
        throw new Error(("error" in json && json.error) || "Não foi possível carregar a lista de VM.");
      }
      setEstado(json as EstadoVm);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a lista de VM.");
      setEstado(null);
    } finally {
      setLoading(false);
    }
  }, [companyKey, username]);

  useEffect(() => {
    void carregarEstado();
  }, [carregarEstado]);

  const filiaisDisponiveis = useMemo(() => estado?.filiais ?? [], [estado]);

  // Gerente tem uma filial só: já entra selecionada.
  useEffect(() => {
    if (filialCod || filiaisDisponiveis.length === 0) return;
    if (filiaisDisponiveis.length === 1) setFilialCod(filiaisDisponiveis[0].cod);
  }, [filiaisDisponiveis, filialCod]);

  const filialAtual = filiaisDisponiveis.find((f) => f.cod === filialCod) ?? null;

  const itensDaFilial = useMemo(() => {
    if (!estado || !filialCod) return [] as VmItem[];
    return estado.items.filter((item) => item.filial.toUpperCase() === filialCod.toUpperCase());
  }, [estado, filialCod]);

  const chavesNaFilial = useMemo(
    () => new Set(itensDaFilial.map((item) => buildVmKey(item.filial, item.produto, item.cor))),
    [itensDaFilial]
  );

  const totalPendencias = entrando.length + saindo.length;

  // ─── Busca de produtos ───────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTerm.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/products/search?q=${encodeURIComponent(searchTerm.trim())}`, {
          cache: "no-store",
        });
        const json = (await response.json()) as { data?: ProductSearchResult[] };
        if (!cancelled) setSearchResults(json.data ?? []);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchTerm]);

  // ─── Cores com estoque do produto escolhido ──────────────────────────────────
  const selecionarProduto = useCallback(
    async (result: ProductSearchResult) => {
      setProdutoSelecionado(result);
      setCores([]);
      setCorSelecionada("");
      setFeedback(null);
      setError(null);
      if (!filialCod) {
        setError("Escolha a filial antes de selecionar o produto.");
        return;
      }
      setCarregandoCores(true);
      try {
        const params = new URLSearchParams({
          company: companyKey,
          filial: filialCod,
          produto: result.productId,
        });
        const response = await fetch(`/api/vm/cores?${params}`, {
          cache: "no-store",
          headers: authHeaders,
        });
        const json = (await response.json()) as { data?: CorDisponivel[]; error?: string };
        if (!response.ok) throw new Error(json.error || "Não foi possível carregar as cores.");
        const data = json.data ?? [];
        setCores(data);
        if (data.length === 1) setCorSelecionada(data[0].cor);
        if (data.length === 0) {
          setError(
            `${result.productName} não tem estoque em ${filialAtual?.nome ?? "nesta filial"} — não há peça para expor.`
          );
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar as cores.");
      } finally {
        setCarregandoCores(false);
      }
    },
    [authHeaders, companyKey, filialAtual?.nome, filialCod]
  );

  function adicionarAoRascunho() {
    if (!produtoSelecionado || !corSelecionada) return;
    const cor = cores.find((c) => c.cor === corSelecionada);
    const chave = buildVmKey(filialCod, produtoSelecionado.productId, corSelecionada);

    if (chavesNaFilial.has(chave)) {
      setError("Esse produto/cor já está em VM nesta filial.");
      return;
    }
    if (entrando.some((p) => buildVmKey(filialCod, p.produto, p.cor) === chave)) {
      setError("Esse produto/cor já está no rascunho.");
      return;
    }

    setEntrando((prev) => [
      ...prev,
      {
        produto: produtoSelecionado.productId,
        cor: corSelecionada,
        descricao: produtoSelecionado.productName,
        descCor: cor?.descCor ?? "",
        estoque: cor?.estoque ?? 0,
      },
    ]);
    setProdutoSelecionado(null);
    setCores([]);
    setCorSelecionada("");
    setSearchTerm("");
    setSearchResults([]);
    setError(null);
    setFeedback("Adicionado ao rascunho. Clique em Salvar para confirmar o movimento de estoque.");
  }

  function marcarParaRemover(item: VmItem) {
    const chave = buildVmKey(item.filial, item.produto, item.cor);
    setSaindo((prev) => (prev.includes(chave) ? prev : [...prev, chave]));
    setFeedback(null);
  }

  function desmarcarRemocao(chave: string) {
    setSaindo((prev) => prev.filter((k) => k !== chave));
  }

  function limparRascunho() {
    setEntrando([]);
    setSaindo([]);
    setFeedback(null);
  }

  // ─── Salvar → prévia → confirmação ───────────────────────────────────────────
  const skusSaindo = useMemo(
    () =>
      itensDaFilial
        .filter((item) => saindo.includes(buildVmKey(item.filial, item.produto, item.cor)))
        .map((item) => ({ produto: item.produto, cor: item.cor })),
    [itensDaFilial, saindo]
  );

  async function abrirPrevia() {
    setError(null);
    setFeedback(null);
    setResultado(null);
    try {
      const response = await fetch("/api/vm/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({
          company: companyKey,
          filial: filialCod,
          entrando: entrando.map((p) => ({ produto: p.produto, cor: p.cor })),
          saindo: skusSaindo,
        }),
      });
      const json = (await response.json()) as { data?: Preview; error?: string };
      if (!response.ok || !json.data) {
        throw new Error(json.error || "Não foi possível montar a prévia.");
      }
      setPreview(json.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível montar a prévia.");
    }
  }

  async function confirmar() {
    if (!preview) return;
    setConfirmando(true);
    setError(null);
    try {
      const response = await fetch("/api/vm/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({
          company: companyKey,
          filial: filialCod,
          entrando: entrando.map((p) => ({ produto: p.produto, cor: p.cor })),
          saindo: skusSaindo,
        }),
      });
      const json = (await response.json()) as { data?: Resultado; error?: string };
      if (!response.ok || !json.data) {
        throw new Error(json.error || "Não foi possível confirmar o movimento.");
      }
      setPreview(null);
      setResultado(json.data);
      limparRascunho();
      await carregarEstado();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o movimento.");
    } finally {
      setConfirmando(false);
    }
  }

  const podeMutar = estado?.escopo.podeMutar ?? false;
  const movimentosDaFilial = useMemo(() => {
    if (!estado) return [] as VmMovimento[];
    if (!filialCod) return estado.movimentos;
    return estado.movimentos.filter((m) => m.filial.toUpperCase() === filialCod.toUpperCase());
  }, [estado, filialCod]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.title}>VM — Visual Merchandising</h1>
          <p className={styles.subtitle}>
            Peças em exposição, por filial. Ao entrar na lista, a peça <strong>sai do estoque</strong> da
            loja por um romaneio de saída do tipo <strong>VM</strong>; ao sair da lista, volta por um
            romaneio de entrada do mesmo tipo. Por isso a Compra Ideal, o giro e o estoque disponível
            já enxergam a realidade — o VM não conta como peça à venda.
          </p>
        </div>
        <div className={styles.note}>
          <strong>Como funciona</strong>
          <span>
            VM é sempre <strong>1 unidade</strong> por produto/cor/filial. Escolha a filial, busque o
            produto, escolha a cor e clique em Salvar — o movimento de estoque só acontece depois da sua
            confirmação, e aparece no Extrato de Produto.
          </span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span className={styles.label}>Filial</span>
          <select
            className={styles.select}
            value={filialCod}
            onChange={(event) => {
              setFilialCod(event.target.value);
              limparRascunho();
              setProdutoSelecionado(null);
              setCores([]);
              setCorSelecionada("");
              setError(null);
            }}
            disabled={loading || filiaisDisponiveis.length <= 1}
          >
            <option value="">Selecione a filial…</option>
            {filiaisDisponiveis.map((f) => (
              <option key={f.cod} value={f.cod}>
                {f.nome}
                {f.apelido ? ` — ${f.apelido}` : ""}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            {estado?.escopo.todasFiliais
              ? "Você enxerga todas as filiais."
              : "Você opera apenas a sua filial atribuída."}
          </span>
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Empresa</span>
          <div className={styles.hint} style={{ paddingTop: 12 }}>
            {companyName}
            {!podeMutar && " · acesso somente leitura"}
          </div>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {feedback && <div className={styles.feedback}>{feedback}</div>}

      {totalPendencias > 0 && (
        <div className={styles.saveBar}>
          <div className={styles.saveBarText}>
            <span className={styles.saveBarTitle}>
              {totalPendencias} alteração(ões) no rascunho — nada saiu ou entrou no estoque ainda.
            </span>
            <span>
              {entrando.length} entrando em VM (saída de estoque) · {saindo.length} saindo de VM
              (entrada de estoque)
            </span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className={styles.undoButton} onClick={limparRascunho}>
              Descartar
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={abrirPrevia}
              disabled={!podeMutar || !filialCod}
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        <section className={styles.editorCard}>
          <div className={styles.cardHeader}>
            <h2>Adicionar peça ao VM</h2>
          </div>

          {!filialCod ? (
            <div className={styles.emptyState}>Escolha a filial para começar.</div>
          ) : (
            <>
              <label className={styles.field}>
                <span className={styles.label}>Buscar produto</span>
                <input
                  className={styles.input}
                  type="search"
                  placeholder="Busque por nome, código ou código de barras"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  disabled={!podeMutar}
                />
              </label>

              {!produtoSelecionado &&
                (searching || searchResults.length > 0 || searchTerm.trim().length >= 2) && (
                  <div className={styles.searchPanel}>
                    {searching ? (
                      <div className={styles.searchEmpty}>Buscando produtos…</div>
                    ) : searchResults.length === 0 ? (
                      <div className={styles.searchEmpty}>Nenhum produto encontrado.</div>
                    ) : (
                      searchResults.map((result) => (
                        <button
                          key={result.productId}
                          type="button"
                          className={styles.searchItem}
                          onClick={() => void selecionarProduto(result)}
                          disabled={!podeMutar}
                        >
                          <span className={styles.searchName}>{result.productName}</span>
                          <span className={styles.searchCode}>{result.productId}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}

              {produtoSelecionado && (
                <div className={`${styles.itemRow} ${styles.itemRowPendenteSaida}`}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                    <div>
                      <div className={styles.itemName}>{produtoSelecionado.productName}</div>
                      <div className={styles.itemCode}>{produtoSelecionado.productId}</div>
                    </div>
                    <label className={styles.field}>
                      <span className={styles.label}>Cor (obrigatória)</span>
                      <select
                        className={styles.select}
                        value={corSelecionada}
                        onChange={(event) => setCorSelecionada(event.target.value)}
                        disabled={carregandoCores || cores.length === 0}
                      >
                        <option value="">
                          {carregandoCores
                            ? "Carregando cores com estoque…"
                            : cores.length === 0
                              ? "Nenhuma cor com estoque nesta filial"
                              : "Selecione a cor…"}
                        </option>
                        {cores.map((c) => (
                          <option key={c.cor} value={c.cor}>
                            {corLabel(c.cor, c.descCor)} · estoque {c.estoque}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={adicionarAoRascunho}
                      disabled={!corSelecionada}
                    >
                      Adicionar
                    </button>
                    <button
                      type="button"
                      className={styles.undoButton}
                      onClick={() => {
                        setProdutoSelecionado(null);
                        setCores([]);
                        setCorSelecionada("");
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {entrando.length > 0 && (
                <>
                  <div className={styles.cardHeader}>
                    <h2>No rascunho ({entrando.length})</h2>
                  </div>
                  <div className={styles.itemList}>
                    {entrando.map((p) => (
                      <div
                        key={`${p.produto}|${p.cor}`}
                        className={`${styles.itemRow} ${styles.itemRowPendenteSaida}`}
                      >
                        <div>
                          <div className={styles.itemName}>
                            {p.descricao}
                            <span className={styles.pendenteBadge}>vai sair do estoque</span>
                          </div>
                          <div className={styles.itemCode}>
                            {p.produto} · {corLabel(p.cor, p.descCor)} · estoque atual {p.estoque}
                          </div>
                        </div>
                        <button
                          type="button"
                          className={styles.undoButton}
                          onClick={() =>
                            setEntrando((prev) =>
                              prev.filter((x) => !(x.produto === p.produto && x.cor === p.cor))
                            )
                          }
                        >
                          Tirar
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        <section className={styles.listCard}>
          <div className={styles.cardHeader}>
            <h2>Em VM {filialAtual ? `· ${filialAtual.nome}` : ""}</h2>
            <span>{itensDaFilial.length} peça(s)</span>
          </div>

          {loading ? (
            <div className={styles.emptyState}>Carregando…</div>
          ) : !filialCod ? (
            <div className={styles.emptyState}>Escolha a filial para ver as peças em VM.</div>
          ) : itensDaFilial.length === 0 ? (
            <div className={styles.emptyState}>Nenhuma peça em VM nesta filial.</div>
          ) : (
            <div className={styles.itemList}>
              {itensDaFilial.map((item) => {
                const chave = buildVmKey(item.filial, item.produto, item.cor);
                const marcado = saindo.includes(chave);
                return (
                  <div
                    key={chave}
                    className={`${styles.itemRow} ${marcado ? styles.itemRowPendenteEntrada : ""}`}
                  >
                    <div>
                      <div className={styles.itemName}>
                        {item.descricao}
                        <span className={styles.vmBadge}>VM 1</span>
                        {marcado && <span className={styles.pendenteBadge}>vai voltar ao estoque</span>}
                      </div>
                      <div className={styles.itemCode}>
                        {item.produto} · {corLabel(item.cor, item.descCor)}
                        {item.romaneio ? ` · romaneio ${item.romaneio}` : ""}
                      </div>
                    </div>
                    {marcado ? (
                      <button
                        type="button"
                        className={styles.undoButton}
                        onClick={() => desmarcarRemocao(chave)}
                      >
                        Manter
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => marcarParaRemover(item)}
                        disabled={!podeMutar}
                      >
                        Tirar do VM
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className={styles.listCard}>
        <div className={styles.cardHeader}>
          <h2>Movimentos recentes</h2>
          <span>{movimentosDaFilial.length} registro(s)</span>
        </div>
        {movimentosDaFilial.length === 0 ? (
          <div className={styles.emptyState}>Nenhum movimento de VM registrado ainda.</div>
        ) : (
          <div className={styles.movList}>
            {movimentosDaFilial.map((m) => (
              <div key={m.id} className={styles.movRow}>
                <div>
                  <span className={m.direcao === "saida" ? styles.tagSaida : styles.tagEntrada}>
                    VM
                  </span>{" "}
                  <span className={styles.movMeta}>
                    {m.direcao === "saida" ? "saída · foi para exposição" : "entrada · voltou ao estoque"}
                  </span>{" "}
                  <strong>{m.descricao}</strong>
                  <div className={styles.movMeta}>
                    {m.produto} · {corLabel(m.cor, m.descCor)} · {m.filial}
                    {m.romaneio ? ` · romaneio ${m.romaneio}` : ""}
                  </div>
                </div>
                <div className={styles.movMeta}>
                  {dataHora(m.criadoEm)}
                  {m.usuario ? ` · ${m.usuario}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {preview && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>Confirmar movimento de estoque</h2>
            <p className={styles.modalIntro}>
              Em <strong>{preview.filialNome}</strong>, estas peças vão se mover no estoque por
              romaneio do tipo <strong>VM</strong>. A operação fica registrada no Extrato de Produto.
            </p>

            <div className={styles.tableScroll}>
              <table className={styles.movTable}>
                <thead>
                  <tr>
                    <th>Movimento</th>
                    <th>Produto</th>
                    <th>Cor</th>
                    <th className={styles.num}>Estoque</th>
                    <th className={styles.num}>Depois</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.linhas.map((linha) => (
                    <tr
                      key={`${linha.direcao}|${linha.produto}|${linha.cor}`}
                      className={linha.bloqueio ? styles.rowBloqueada : undefined}
                    >
                      <td>
                        <span
                          className={linha.direcao === "saida" ? styles.tagSaida : styles.tagEntrada}
                        >
                          VM
                        </span>{" "}
                        <span className={styles.movMeta}>
                          {linha.direcao === "saida" ? "saída" : "entrada"}
                        </span>
                      </td>
                      <td>
                        {linha.descricao}
                        <span className={styles.movMeta}> · {linha.produto}</span>
                        {linha.bloqueio && (
                          <span className={styles.bloqueioMotivo}>{linha.bloqueio}</span>
                        )}
                      </td>
                      <td>{corLabel(linha.cor, linha.descCor)}</td>
                      <td className={styles.num}>{linha.estoqueAtual}</td>
                      <td className={styles.num}>{linha.bloqueio ? "—" : linha.estoqueDepois}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.bloqueadas > 0 && (
              <div className={styles.error}>
                {preview.bloqueadas} linha(s) não serão executadas — veja o motivo na tabela.
              </div>
            )}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.undoButton}
                onClick={() => setPreview(null)}
                disabled={confirmando}
              >
                Voltar
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => void confirmar()}
                disabled={confirmando || preview.executaveis === 0}
              >
                {confirmando
                  ? "Movimentando estoque…"
                  : `Confirmar ${preview.executaveis} movimento(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {resultado && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>Movimento concluído</h2>
            <p className={styles.modalIntro}>
              Em <strong>{resultado.filialNome}</strong>:
            </p>
            <div className={styles.movList}>
              {resultado.direcoes.map((d) => (
                <div key={d.direcao} className={styles.movRow}>
                  <div>
                    <span className={d.direcao === "saida" ? styles.tagSaida : styles.tagEntrada}>
                      {d.tipo}
                    </span>{" "}
                    <span className={styles.movMeta}>{d.operacao}</span>{" "}
                    {d.erro ? (
                      <strong style={{ color: "#b91c1c" }}>{d.erro}</strong>
                    ) : (
                      <>
                        <strong>{d.itens} peça(s)</strong>
                        <div className={styles.movMeta}>Romaneio no extrato: {d.romaneio}</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {resultado.bloqueadas.length > 0 && (
              <div className={styles.error}>
                {resultado.bloqueadas.length} linha(s) não foram executadas:{" "}
                {resultado.bloqueadas
                  .map((l) => `${l.produto}/${l.cor} — ${l.bloqueio ?? "motivo não informado"}`)
                  .join(" · ")}
              </div>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => setResultado(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
