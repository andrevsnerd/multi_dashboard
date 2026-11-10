"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import type { CompanyKey } from "@/lib/config/company";
import type { MapaProdutoView, MapaResumo, MapaStatus, MapaVarianteView } from "@/lib/shopify/catalog-store";

import styles from "./ShopifyMapaLinx.module.css";

/**
 * Mapeamento variante Shopify → produto/cor do Linx. O vínculo fica numa tabela do
 * dashboard (não altera o Shopify). Automático por código; o que vem por nome é só
 * sugestão e precisa de confirmação; manual nunca é sobrescrito pelo automático.
 */

interface Props {
  companyKey: CompanyKey;
}

interface MapaData {
  resumo: MapaResumo;
  total: number;
  produtos: MapaProdutoView[];
  catalogo: { ultimaCompleta: string | null; emAndamento: boolean; erro: string | null };
  podeEditar: boolean;
}

interface LinxProduto {
  produto: string;
  descProduto: string;
  linha: string;
  inativo: boolean;
  cores: Array<{ cor: string; descCor: string; codigoBarra: string; estoque: number }>;
}

const STATUS_LABEL: Record<MapaStatus, string> = {
  vinculado: "Vinculado",
  sugerido: "A confirmar",
  nao_linx: "Não é do Linx",
  pendente: "Sem vínculo",
};

const FILTROS: Array<[string, string]> = [
  ["revisar", "A revisar"],
  ["sugerido", "A confirmar"],
  ["pendente", "Sem vínculo"],
  ["vinculado", "Vinculados"],
  ["nao_linx", "Não é do Linx"],
  ["todos", "Todos"],
];

const STATUS_SHOPIFY: Array<[string, string]> = [
  ["ACTIVE", "Ativos"],
  ["DRAFT", "Rascunhos"],
  ["ARCHIVED", "Arquivados"],
  ["todos", "Todos"],
];

const PER_PAGE = 40;

function opcoesTexto(v: MapaVarianteView) {
  const ops = v.options.filter((o) => o.value !== "Default Title");
  return ops.length ? ops.map((o) => o.value).join(" / ") : "Única";
}

export default function ShopifyMapaLinx({ companyKey }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";
  const [status, setStatus] = useState("revisar");
  const [statusShopify, setStatusShopify] = useState("ACTIVE");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [pagina, setPagina] = useState(1);
  const [data, setData] = useState<MapaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [alvo, setAlvo] = useState<{ titulo: string; variantIds: string[] } | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    if (!username) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        company: companyKey,
        status,
        statusShopify,
        busca: buscaAplicada,
        pagina: String(pagina),
      });
      const res = await fetch(`/api/shopify/mapa?${params}`, { cache: "no-store", headers: { "x-auth-username": username } });
      const json = (await res.json()) as { data?: MapaData; error?: string };
      if (!res.ok || !json.data) throw new Error(json.error || "Não foi possível carregar o mapeamento.");
      if (id === reqId.current) {
        setData(json.data);
        setError(null);
      }
    } catch (cause) {
      if (id === reqId.current) setError(cause instanceof Error ? cause.message : "Erro ao carregar.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [companyKey, status, statusShopify, buscaAplicada, pagina, username]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/shopify/mapa", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-auth-username": username },
      body: JSON.stringify({ company: companyKey, ...body }),
    });
    const json = (await res.json()) as { data?: Record<string, unknown>; error?: string };
    if (!res.ok) throw new Error(json.error || "Falha ao gravar.");
    return json.data ?? {};
  }

  async function acao(rotulo: string, body: Record<string, unknown>, sucesso: string) {
    setOcupado(rotulo);
    setAviso(null);
    setError(null);
    try {
      const r = (await post(body)) as { aviso?: string | null; outraLoja?: { repassadas?: number } | null };
      const repassadas = r.outraLoja?.repassadas ?? 0;
      if (r.aviso) setError(r.aviso);
      setAviso(
        repassadas > 0
          ? `${sucesso} Também aplicado a ${repassadas} variante${repassadas === 1 ? "" : "s"} equivalente${repassadas === 1 ? "" : "s"} na outra loja.`
          : sucesso,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao gravar.");
    } finally {
      setOcupado(null);
    }
  }

  async function sincronizarCatalogo() {
    setOcupado("catalogo");
    setAviso(null);
    setError(null);
    try {
      // Retomável: repete até a varredura completar (a Scarf Me tem ~15 mil variantes).
      for (let i = 0; i < 10; i += 1) {
        const r = (await post({ acao: "sincronizar" })) as { sync?: { complete?: boolean; error?: string } };
        if (r.sync?.error) throw new Error(r.sync.error);
        if (r.sync?.complete) break;
      }
      setAviso("Catálogo atualizado e vínculo automático recalculado.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar o catálogo.");
    } finally {
      setOcupado(null);
    }
  }

  const toggle = (id: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const resumo = data?.resumo;
  const podeEditar = !!data?.podeEditar;
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / PER_PAGE)) : 1;
  const pctAtivos = resumo && resumo.ativos.variantes > 0 ? (resumo.ativos.vinculadas / resumo.ativos.variantes) * 100 : 0;

  return (
    <div className={`${styles.wrapper} ${companyKey === "scarfme" ? styles.brandScarfme : ""}`}>
      <section className={styles.intro}>
        <div>
          <h2>Mapeamento Shopify → Linx</h2>
          <p>
            Cada variante do Shopify aponta para o produto, a cor e (quando dá) o tamanho do Linx. O vínculo fica no
            dashboard — nada é alterado no Shopify. Por código é automático; por nome é só sugestão e precisa de
            confirmação. O que você decide aqui nunca é sobrescrito pelo automático — e vale também na
            outra loja para a mesma capa/produto (mesma estampa e modelo), marcado &quot;igual à outra loja&quot;.
          </p>
        </div>
        {podeEditar && (
          <div className={styles.introActions}>
            <button type="button" className={styles.secondary} disabled={!!ocupado} onClick={() => void sincronizarCatalogo()}>
              {ocupado === "catalogo" ? "Atualizando catálogo…" : "Atualizar catálogo do Shopify"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={!!ocupado}
              onClick={() => void acao("remapear", { acao: "remapear" }, "Vínculo automático recalculado.")}
            >
              {ocupado === "remapear" ? "Recalculando…" : "Recalcular automático"}
            </button>
          </div>
        )}
      </section>

      {resumo && (
        <section className={styles.cards}>
          <div className={styles.cardProgress}>
            <span>Variantes ativas resolvidas</span>
            <strong>
              {resumo.ativos.vinculadas.toLocaleString("pt-BR")} / {resumo.ativos.variantes.toLocaleString("pt-BR")}
            </strong>
            <div className={styles.track}>
              <div className={styles.fill} style={{ width: `${pctAtivos}%` }} />
            </div>
          </div>
          {(Object.keys(STATUS_LABEL) as MapaStatus[]).map((s) => (
            <button
              type="button"
              key={s}
              className={`${styles.card} ${styles[`tone_${s}`]} ${status === s ? styles.cardActive : ""}`}
              onClick={() => {
                setStatus(s);
                setPagina(1);
              }}
            >
              <span>{STATUS_LABEL[s]}</span>
              <strong>{resumo.porStatus[s].toLocaleString("pt-BR")}</strong>
              <small>variantes (todas)</small>
            </button>
          ))}
        </section>
      )}

      <div className={styles.toolbar}>
        <div className={styles.chips}>
          {FILTROS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`${styles.chip} ${status === value ? styles.chipActive : ""}`}
              onClick={() => {
                setStatus(value);
                setPagina(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.toolbarRight}>
          <select
            className={styles.select}
            value={statusShopify}
            onChange={(e) => {
              setStatusShopify(e.target.value);
              setPagina(1);
            }}
          >
            {STATUS_SHOPIFY.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBuscaAplicada(busca);
              setPagina(1);
            }}
          >
            <input
              className={styles.search}
              placeholder="Buscar produto, SKU ou código Linx"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </form>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {aviso && <div className={styles.ok}>{aviso}</div>}
      {data?.catalogo.erro && <div className={styles.error}>Última atualização do catálogo falhou: {data.catalogo.erro}</div>}

      <div className={styles.list}>
        {loading && !data && <div className={styles.empty}>Carregando…</div>}
        {data && data.produtos.length === 0 && <div className={styles.empty}>Nada neste filtro.</div>}
        {data?.produtos.map((p) => {
          const aberto = abertos.has(p.productId) || p.variantes.length <= 3;
          const sugeridas = p.variantes.filter((v) => v.status === "sugerido");
          const resolvidas = p.contagem.vinculado + p.contagem.nao_linx;
          return (
            <article key={p.productId} className={styles.produto}>
              <header className={styles.produtoHeader}>
                <button type="button" className={styles.produtoTitle} onClick={() => toggle(p.productId)}>
                  <span className={styles.caret}>{aberto ? "▾" : "▸"}</span>
                  <span>{p.titulo}</span>
                  <small>
                    {p.statusShopify === "ACTIVE" ? "ativo" : p.statusShopify === "DRAFT" ? "rascunho" : "arquivado"} ·{" "}
                    {resolvidas}/{p.variantes.length} resolvidas
                  </small>
                </button>
                <div className={styles.counts}>
                  {(Object.keys(STATUS_LABEL) as MapaStatus[])
                    .filter((s) => p.contagem[s] > 0)
                    .map((s) => (
                      <span key={s} className={`${styles.badge} ${styles[`tone_${s}`]}`}>
                        {p.contagem[s]} {STATUS_LABEL[s].toLowerCase()}
                      </span>
                    ))}
                </div>
                {podeEditar && (
                  <div className={styles.produtoActions}>
                    {sugeridas.length > 0 && (
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={!!ocupado}
                        onClick={() =>
                          void acao(
                            `conf-${p.productId}`,
                            { acao: "confirmar", variantIds: sugeridas.map((v) => v.variantId) },
                            `${sugeridas.length} sugestões confirmadas em "${p.titulo}".`,
                          )
                        }
                      >
                        Confirmar {sugeridas.length} sugest{sugeridas.length === 1 ? "ão" : "ões"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={!!ocupado}
                      onClick={() => setAlvo({ titulo: p.titulo, variantIds: p.variantes.map((v) => v.variantId) })}
                    >
                      Vincular produto inteiro…
                    </button>
                  </div>
                )}
              </header>

              {aberto && (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Variante</th>
                      <th>SKU / código</th>
                      <th>Linx</th>
                      <th>Como</th>
                      {podeEditar && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {p.variantes.map((v) => (
                      <tr key={v.variantId}>
                        <td>
                          {opcoesTexto(v)}
                          {v.estoque != null && <small className={styles.muted}> · estoque {v.estoque}</small>}
                        </td>
                        <td className={styles.mono}>{[v.sku, v.barcode && v.barcode !== v.sku ? v.barcode : null].filter(Boolean).join(" · ") || "—"}</td>
                        <td>
                          {v.componentes?.length ? (
                            <div className={styles.linx}>
                              {v.componentes.map((c) => (
                                <span key={c.codigo}>
                                  <b>{c.produto}</b> {c.descProduto ?? ""} {c.cor ? `· cor ${c.cor}` : ""}
                                </span>
                              ))}
                            </div>
                          ) : v.produto ? (
                            <div className={styles.linx}>
                              <span>
                                <b>{v.produto}</b> {v.descProduto}
                              </span>
                              <small>
                                {v.cor ? `cor ${v.cor}${v.descCor ? ` ${v.descCor}` : ""}` : "cor a definir"}
                                {v.tamanho != null ? ` · tam. ${v.tamanho}` : ""}
                              </small>
                            </div>
                          ) : (
                            <span className={styles.muted}>{v.status === "nao_linx" ? "não é produto do Linx" : "—"}</span>
                          )}
                        </td>
                        <td>
                          <span className={`${styles.badge} ${styles[`tone_${v.status}`]}`}>{STATUS_LABEL[v.status]}</span>
                          <small className={styles.metodo}>
                            {v.metodo?.startsWith("igual à outra loja")
                              ? `${v.metodo}${v.atualizadoPor ? ` · ${v.atualizadoPor}` : ""}`
                              : v.origem === "manual"
                                ? `manual${v.atualizadoPor ? ` · ${v.atualizadoPor}` : ""}`
                                : v.metodo ?? ""}
                          </small>
                        </td>
                        {podeEditar && (
                          <td className={styles.rowActions}>
                            {v.status === "sugerido" && v.produto && (
                              <button
                                type="button"
                                className={styles.link}
                                disabled={!!ocupado}
                                onClick={() => void acao(`c-${v.variantId}`, { acao: "confirmar", variantIds: [v.variantId] }, "Sugestão confirmada.")}
                              >
                                Confirmar
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.link}
                              disabled={!!ocupado}
                              onClick={() => setAlvo({ titulo: `${p.titulo} — ${opcoesTexto(v)}`, variantIds: [v.variantId] })}
                            >
                              {v.produto ? "Trocar" : "Vincular"}
                            </button>
                            {v.status !== "nao_linx" && (
                              <button
                                type="button"
                                className={styles.link}
                                disabled={!!ocupado}
                                onClick={() => void acao(`n-${v.variantId}`, { acao: "nao_linx", variantIds: [v.variantId] }, "Marcado como não é do Linx.")}
                              >
                                Não é do Linx
                              </button>
                            )}
                            {v.origem === "manual" && !v.metodo?.startsWith("igual à outra loja") && (
                              <button
                                type="button"
                                className={styles.link}
                                disabled={!!ocupado}
                                onClick={() => void acao(`l-${v.variantId}`, { acao: "limpar", variantIds: [v.variantId] }, "Voltou para o automático.")}
                              >
                                Desfazer
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          );
        })}
      </div>

      {data && data.total > PER_PAGE && (
        <div className={styles.pager}>
          <button type="button" className={styles.secondary} disabled={pagina <= 1 || loading} onClick={() => setPagina((n) => n - 1)}>
            Anterior
          </button>
          <span>
            Página {pagina} de {totalPaginas} · {data.total.toLocaleString("pt-BR")} produtos
          </span>
          <button type="button" className={styles.secondary} disabled={pagina >= totalPaginas || loading} onClick={() => setPagina((n) => n + 1)}>
            Próxima
          </button>
        </div>
      )}

      {alvo && (
        <VincularPainel
          companyKey={companyKey}
          username={username}
          alvo={alvo}
          onClose={() => setAlvo(null)}
          onAplicar={async (produto, cor) => {
            const n = alvo.variantIds.length;
            setAlvo(null);
            await acao("vincular", { acao: "vincular", variantIds: alvo.variantIds, produto, cor }, `${n} variante${n === 1 ? "" : "s"} vinculada${n === 1 ? "" : "s"} a ${produto}.`);
          }}
        />
      )}
    </div>
  );
}

function VincularPainel({
  companyKey,
  username,
  alvo,
  onClose,
  onAplicar,
}: {
  companyKey: CompanyKey;
  username: string;
  alvo: { titulo: string; variantIds: string[] };
  onClose: () => void;
  onAplicar: (produto: string, cor: string | "auto" | null) => Promise<void>;
}) {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<LinxProduto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<LinxProduto | null>(null);
  const [cor, setCor] = useState<string>("auto");

  async function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    if (termo.trim().length < 2) return;
    setBuscando(true);
    setErro(null);
    try {
      const res = await fetch("/api/shopify/mapa/linx", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, termo }),
      });
      const json = (await res.json()) as { data?: LinxProduto[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Falha na busca.");
      setResultados(json.data ?? []);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : "Falha na busca.");
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <header className={styles.panelHeader}>
          <div>
            <h3>Vincular ao Linx</h3>
            <p>
              {alvo.titulo} · {alvo.variantIds.length} variante{alvo.variantIds.length === 1 ? "" : "s"}
            </p>
          </div>
          <button type="button" className={styles.link} onClick={onClose}>
            Fechar
          </button>
        </header>

        <form className={styles.panelSearch} onSubmit={buscar}>
          <input
            autoFocus
            className={styles.search}
            placeholder="Nome, código do produto ou código de barras do Linx"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </form>
        {erro && <div className={styles.error}>{erro}</div>}

        <div className={styles.results}>
          {resultados.map((r) => (
            <button
              type="button"
              key={r.produto}
              className={`${styles.result} ${escolhido?.produto === r.produto ? styles.resultActive : ""}`}
              onClick={() => {
                setEscolhido(r);
                setCor(r.cores.length === 1 ? r.cores[0].cor : "auto");
              }}
            >
              <b>{r.produto}</b> {r.descProduto}
              <small>
                {r.linha} · {r.cores.length} cor{r.cores.length === 1 ? "" : "es"}
                {r.inativo ? " · inativo" : ""}
              </small>
            </button>
          ))}
          {!buscando && resultados.length === 0 && termo.length >= 2 && <div className={styles.empty}>Busque e escolha o produto.</div>}
        </div>

        {escolhido && (
          <footer className={styles.panelFooter}>
            <label>
              Cor
              <select className={styles.select} value={cor} onChange={(e) => setCor(e.target.value)}>
                <option value="auto">Automática (pela opção &quot;Cor&quot; de cada variante)</option>
                {escolhido.cores.map((c) => (
                  <option key={c.cor} value={c.cor}>
                    {c.cor} {c.descCor} {c.estoque > 0 ? `· estoque ${c.estoque}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={styles.primary} onClick={() => void onAplicar(escolhido.produto, cor)}>
              Vincular a {escolhido.produto}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
