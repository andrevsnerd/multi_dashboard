"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import { TECIDO_APROVEITAMENTO } from "@/lib/config/aproveitamentos-matriz";

import styles from "./AproveitamentosMatrizPage.module.css";

/**
 * Tela "Aproveitamentos Matriz": estoque OFFLINE, contado à mão, dos lenços 50x50 e twillys
 * 8x130 de aproveitamento que já existem na matriz mas ainda não entraram no Linx.
 *
 * Não é o estoque oficial da matriz e não escreve nada no Linx. Do Linx vem só o cadastro
 * do produto vinculado a cada item: descrição, custo e preço sugerido.
 *
 * Diferente de Embalagens e Aviamentos, aqui NÃO grava sozinho: a pessoa altera o que
 * precisar e confirma em "Salvar alterações" (ou descarta).
 */

type Formato = "50x50" | "8x130";

interface Item {
  id: string;
  formato: Formato;
  nome: string;
  produto: string | null;
  cor: string | null;
  estoque: number;
  nota?: string | null;
}

interface Cadastro {
  produto: string;
  descricao: string;
  grade: string;
  tecido: string;
  linha: string;
  custo: number | null;
  precoSugerido: number | null;
  cores: { cor: string; descricao: string }[];
}

interface Resposta {
  itens: Item[];
  atualizadoPor: string | null;
  atualizadoEm: string | null;
  cadastro: Record<string, Cadastro>;
  cadastroErro: string | null;
  podeEditar: boolean;
  podeVerCusto: boolean;
  error?: string;
}

const FORMATOS: { key: Formato; titulo: string }[] = [
  { key: "50x50", titulo: "Aproveitamento 50x50cm" },
  { key: "8x130", titulo: "Aproveitamento 8x130cm" },
];

const fmtInt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/** COR_PRODUTO vem '06' ou '6' conforme a fonte — ver [[cor-produto-formato-duas-fontes]]. */
function mesmaCor(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toUpperCase();
  const y = (b ?? "").trim().toUpperCase();
  if (!x || !y) return false;
  if (x === y) return true;
  return /^\d+$/.test(x) && /^\d+$/.test(y) && Number(x) === Number(y);
}

/** Esta tela é só de poliéster: produto de outro tecido é vínculo errado. */
function foraDoTecido(cad: Cadastro | undefined): boolean {
  if (!cad) return false;
  const tecido = cad.tecido.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return !tecido.includes(TECIDO_APROVEITAMENTO);
}

function novoId(formato: Formato): string {
  return `${formato === "50x50" ? "50" : "8"}-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function mesmoItem(a: Item | undefined, b: Item | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.nome === b.nome &&
    a.produto === b.produto &&
    a.cor === b.cor &&
    a.estoque === b.estoque &&
    (a.nota ?? null) === (b.nota ?? null) &&
    a.formato === b.formato
  );
}

function formatarData(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function AproveitamentosMatrizPage() {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [salvo, setSalvo] = useState<Resposta | null>(null);
  /** Cópia de trabalho: é o que a tela mostra e o que o "Salvar" manda. */
  const [itens, setItens] = useState<Item[]>([]);
  /** Cadastro do Linx por código — o do GET mais o que se consultou ao trocar vínculo. */
  const [cadastro, setCadastro] = useState<Record<string, Cadastro>>({});
  /** Texto cru das células sendo digitadas (id|campo → string). */
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [buscando, setBuscando] = useState<Record<string, boolean>>({});
  const [erroBusca, setErroBusca] = useState<Record<string, string>>({});
  const [editandoItens, setEditandoItens] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  const podeEditar = !!salvo?.podeEditar;
  const podeVerCusto = !!salvo?.podeVerCusto;

  const aplicarResposta = useCallback((json: Resposta) => {
    setSalvo(json);
    setItens(json.itens.map((i) => ({ ...i })));
    setCadastro(json.cadastro ?? {});
    setRascunho({});
    setErroBusca({});
  }, []);

  // ── Consulta ──
  useEffect(() => {
    if (!username) return;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    fetch("/api/aproveitamentos-matriz", {
      headers: { "x-auth-username": username },
      cache: "no-store",
    })
      .then(async (r) => {
        const json = (await r.json()) as Resposta;
        if (!r.ok) throw new Error(json?.error || "Erro ao carregar os aproveitamentos");
        return json;
      })
      .then((json) => {
        if (!cancelado) aplicarResposta(json);
      })
      .catch((e: Error) => {
        if (!cancelado) setErro(e.message || "Erro ao carregar os aproveitamentos");
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [username, versao, aplicarResposta]);

  const salvoPorId = useMemo(
    () => new Map((salvo?.itens ?? []).map((i) => [i.id, i] as const)),
    [salvo]
  );

  const alterado = useMemo(() => {
    const base = salvo?.itens ?? [];
    if (base.length !== itens.length) return true;
    return itens.some((i, idx) => base[idx]?.id !== i.id || !mesmoItem(i, base[idx]));
  }, [itens, salvo]);

  // Sair da tela com alteração não salva pede confirmação do navegador.
  useEffect(() => {
    if (!alterado) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [alterado]);

  const atualizarItem = useCallback((id: string, patch: Partial<Item>) => {
    setAviso(null);
    setItens((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const removerItem = useCallback((id: string) => {
    setAviso(null);
    setItens((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const adicionarItem = useCallback((formato: Formato) => {
    setAviso(null);
    setItens((prev) => [
      ...prev,
      { id: novoId(formato), formato, nome: "", produto: null, cor: null, estoque: 0, nota: null },
    ]);
  }, []);

  /** Troca o código do produto vinculado e busca o cadastro dele, se ainda não tem. */
  const vincularProduto = useCallback(
    async (id: string, codigoDigitado: string) => {
      const codigo = codigoDigitado.trim().toUpperCase() || null;
      const atual = itens.find((i) => i.id === id);
      if (!atual || atual.produto === codigo) return;
      // Vínculo novo: a cor e a nota de conferência eram do produto anterior.
      atualizarItem(id, { produto: codigo, cor: null, nota: null });
      setErroBusca((prev) => {
        const proximo = { ...prev };
        delete proximo[id];
        return proximo;
      });
      if (!codigo || cadastro[codigo]) return;

      setBuscando((prev) => ({ ...prev, [id]: true }));
      try {
        const res = await fetch(`/api/aproveitamentos-matriz?produto=${encodeURIComponent(codigo)}`, {
          headers: { "x-auth-username": username },
          cache: "no-store",
        });
        const json = (await res.json()) as { cadastro?: Cadastro; error?: string };
        if (!res.ok || !json.cadastro) throw new Error(json?.error || "Produto não encontrado.");
        const c = json.cadastro;
        setCadastro((prev) => ({ ...prev, [c.produto]: c }));
        // Produto de uma cor só já sai com a cor escolhida.
        if (c.cores.length === 1) atualizarItem(id, { cor: c.cores[0].cor });
      } catch (e) {
        setErroBusca((prev) => ({
          ...prev,
          [id]: e instanceof Error ? e.message : "Produto não encontrado.",
        }));
      } finally {
        setBuscando((prev) => ({ ...prev, [id]: false }));
      }
    },
    [itens, cadastro, username, atualizarItem]
  );

  const salvar = useCallback(async () => {
    const semNome = itens.filter((i) => !i.nome.trim()).length;
    if (semNome > 0) {
      setAviso(null);
      setErro(
        semNome === 1
          ? "Há 1 item sem nome. Preencha ou remova antes de salvar."
          : `Há ${semNome} itens sem nome. Preencha ou remova antes de salvar.`
      );
      return;
    }
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const res = await fetch("/api/aproveitamentos-matriz", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ itens }),
      });
      const json = (await res.json()) as Resposta;
      if (!res.ok) throw new Error(json?.error || "Erro ao salvar");
      aplicarResposta(json);
      setEditandoItens(false);
      setAviso("Alterações salvas.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }, [itens, username, aplicarResposta]);

  const descartar = useCallback(() => {
    if (!salvo) return;
    setItens(salvo.itens.map((i) => ({ ...i })));
    setRascunho({});
    setErroBusca({});
    setErro(null);
    setAviso("Alterações descartadas.");
  }, [salvo]);

  // ── Linhas e totais ──
  const secoes = useMemo(
    () =>
      FORMATOS.map((f) => {
        const linhas = itens
          .filter((i) => i.formato === f.key)
          .map((item) => {
            const cad = item.produto ? cadastro[item.produto] : undefined;
            const cor = cad?.cores.find((c) => mesmaCor(c.cor, item.cor));
            const custo = cad?.custo ?? null;
            const preco = cad?.precoSugerido ?? null;
            return { item, cad, cor, custo, preco, tecidoErrado: foraDoTecido(cad) };
          });
        const pecas = linhas.reduce((s, l) => s + l.item.estoque, 0);
        const custoTotal = linhas.reduce((s, l) => s + l.item.estoque * (l.custo ?? 0), 0);
        const valorTotal = linhas.reduce((s, l) => s + l.item.estoque * (l.preco ?? 0), 0);
        const semPreco = linhas.filter((l) => l.preco == null).length;
        return { ...f, linhas, pecas, custoTotal, valorTotal, semPreco };
      }),
    [itens, cadastro]
  );

  const total = useMemo(
    () => ({
      pecas: secoes.reduce((s, x) => s + x.pecas, 0),
      custo: secoes.reduce((s, x) => s + x.custoTotal, 0),
      valor: secoes.reduce((s, x) => s + x.valorTotal, 0),
      conferir: secoes.reduce(
        (s, x) =>
          s + x.linhas.filter((l) => !!l.item.nota || !l.item.produto || l.tecidoErrado).length,
        0
      ),
    }),
    [secoes]
  );

  const status = salvando
    ? "Salvando…"
    : aviso ||
      (alterado
        ? "Há alterações não salvas."
        : salvo?.atualizadoEm
          ? `Última alteração: ${salvo.atualizadoPor ?? "—"} em ${formatarData(salvo.atualizadoEm)}`
          : salvo
            ? "Lista inicial da planilha — ainda não foi salva."
            : "");

  const colunas = podeVerCusto ? 4 : 3;

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.titulo}>Aproveitamentos Matriz</h1>
          <p className={styles.subtitulo}>
            Lenços 50x50 e twillys 8x130 de aproveitamento que já estão na matriz mas{" "}
            <strong>ainda não entraram no sistema</strong>. O estoque aqui é contado à mão e{" "}
            <strong>não é o estoque da matriz no Linx</strong>. Custo e preço sugerido vêm do
            cadastro do produto vinculado.
          </p>
        </div>
        <div className={styles.acoes}>
          <span className={`${styles.status} ${alterado && !aviso ? styles.statusPendente : ""}`}>
            {status}
          </span>
          {podeEditar && (
            <>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setEditandoItens((v) => !v)}
                disabled={carregando || salvando}
              >
                {editandoItens ? "Concluir edição de itens" : "Editar itens"}
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={descartar}
                disabled={!alterado || salvando}
              >
                Descartar
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => void salvar()}
                disabled={!alterado || salvando}
              >
                {salvando ? "Salvando…" : "Salvar alterações"}
              </button>
            </>
          )}
          {!podeEditar && salvo && <span className={styles.status}>Somente leitura.</span>}
          {!alterado && (
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setVersao((v) => v + 1)}
              disabled={carregando}
            >
              {carregando ? "Atualizando…" : "Atualizar"}
            </button>
          )}
        </div>
      </header>

      {erro && <div className={styles.faixaErro}>{erro}</div>}
      {salvo?.cadastroErro && <div className={styles.faixaAviso}>{salvo.cadastroErro}</div>}

      <div className={styles.resumo}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Peças em estoque</span>
          <span className={styles.kpiValor}>{fmtInt(total.pecas)}</span>
        </div>
        {podeVerCusto && (
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Custo total</span>
            <span className={styles.kpiValor}>{fmtBRL(total.custo)}</span>
          </div>
        )}
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Valor a preço sugerido</span>
          <span className={styles.kpiValor}>{fmtBRL(total.valor)}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Itens a conferir</span>
          <span className={`${styles.kpiValor} ${total.conferir > 0 ? styles.kpiAlerta : ""}`}>
            {fmtInt(total.conferir)}
          </span>
        </div>
      </div>

      <div className={styles.grid}>
        {secoes.map((secao) => (
          <section key={secao.key} className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitulo}>{secao.titulo}</h2>
              <span className={styles.cardResumo}>
                {fmtInt(secao.linhas.length)} itens · {fmtInt(secao.pecas)} peças
              </span>
            </div>
            <div className={styles.tabelaScroll}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Item</th>
                    {podeVerCusto && <th className={styles.colValor}>Custo</th>}
                    <th className={styles.colValor}>Preço sug.</th>
                    <th className={styles.colNum}>Estoque</th>
                  </tr>
                </thead>
                <tbody>
                  {secao.linhas.length === 0 ? (
                    <tr>
                      <td colSpan={colunas} className={styles.vazio}>
                        {carregando ? "Carregando…" : "Sem itens."}
                      </td>
                    </tr>
                  ) : (
                    secao.linhas.map(({ item, cad, cor, custo, preco, tecidoErrado }) => {
                      const original = salvoPorId.get(item.id);
                      const linhaAlterada = !original || !mesmoItem(item, original);
                      const chaveEstoque = `${item.id}|estoque`;
                      const chaveProduto = `${item.id}|produto`;
                      const corNaoCadastrada = !!cad && !!item.cor && !cor;
                      return (
                        <tr key={item.id} className={linhaAlterada ? styles.linhaAlterada : ""}>
                          <td className={styles.colItem}>
                            {editandoItens ? (
                              <div className={styles.edicao}>
                                <input
                                  type="text"
                                  className={styles.inputTexto}
                                  placeholder="Nome do item"
                                  aria-label="Nome do item"
                                  value={item.nome}
                                  maxLength={120}
                                  onChange={(e) => atualizarItem(item.id, { nome: e.target.value })}
                                />
                                <div className={styles.edicaoLinha}>
                                  <input
                                    type="text"
                                    className={`${styles.inputTexto} ${styles.inputCodigo}`}
                                    placeholder="Código Linx"
                                    aria-label={`Código do produto de ${item.nome}`}
                                    value={rascunho[chaveProduto] ?? item.produto ?? ""}
                                    onChange={(e) =>
                                      setRascunho((prev) => ({ ...prev, [chaveProduto]: e.target.value }))
                                    }
                                    onBlur={(e) => {
                                      const valor = e.target.value;
                                      setRascunho((prev) => {
                                        const proximo = { ...prev };
                                        delete proximo[chaveProduto];
                                        return proximo;
                                      });
                                      void vincularProduto(item.id, valor);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    }}
                                  />
                                  <select
                                    className={styles.select}
                                    aria-label={`Cor de ${item.nome}`}
                                    value={cor?.cor ?? item.cor ?? ""}
                                    disabled={!cad}
                                    onChange={(e) =>
                                      atualizarItem(item.id, { cor: e.target.value || null })
                                    }
                                  >
                                    <option value="">Sem cor definida</option>
                                    {corNaoCadastrada && item.cor && (
                                      <option value={item.cor}>{item.cor} (fora do cadastro)</option>
                                    )}
                                    {(cad?.cores ?? []).map((c) => (
                                      <option key={c.cor} value={c.cor}>
                                        {c.cor} · {c.descricao}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className={styles.btnRemover}
                                    onClick={() => removerItem(item.id)}
                                    title="Remover item"
                                  >
                                    Remover
                                  </button>
                                </div>
                                {buscando[item.id] && (
                                  <span className={styles.sub}>Buscando no Linx…</span>
                                )}
                                {erroBusca[item.id] && (
                                  <span className={styles.subErro}>{erroBusca[item.id]}</span>
                                )}
                                {cad && (
                                  <span className={styles.sub}>
                                    {cad.descricao} · {cad.grade}
                                  </span>
                                )}
                                {tecidoErrado && (
                                  <span className={styles.subErro}>
                                    Este produto é {cad?.tecido.toLowerCase()}: aqui é só poliéster.
                                    Use o código do twilly/lenço de poliéster.
                                  </span>
                                )}
                                {item.nota && (
                                  <div className={styles.nota}>
                                    <span>{item.nota}</span>
                                    <button
                                      type="button"
                                      className={styles.btnLink}
                                      onClick={() => atualizarItem(item.id, { nota: null })}
                                    >
                                      Conferido
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <>
                                <div className={styles.nome}>
                                  {item.nome}
                                  {(item.nota || !item.produto || tecidoErrado) && (
                                    <span
                                      className={styles.badge}
                                      title={
                                        tecidoErrado
                                          ? `Vinculado a produto de ${cad?.tecido.toLowerCase()}: esta página é só poliéster.`
                                          : item.nota ?? "Sem produto vinculado no Linx."
                                      }
                                    >
                                      conferir
                                    </span>
                                  )}
                                </div>
                                {item.produto ? (
                                  <>
                                    <span className={styles.sub}>
                                      {item.produto}
                                      {cad ? ` · ${cad.descricao}` : ""}
                                      {cor ? ` · ${cor.descricao}` : item.cor ? ` · cor ${item.cor}` : ""}
                                    </span>
                                    {tecidoErrado && (
                                      <span className={styles.subErro}>
                                        Não é poliéster — vínculo errado nesta página.
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className={styles.subAlerta}>Sem produto vinculado no Linx</span>
                                )}
                              </>
                            )}
                          </td>
                          {podeVerCusto && (
                            <td className={styles.colValor}>{custo != null ? fmtBRL(custo) : "—"}</td>
                          )}
                          <td className={styles.colValor}>{preco != null ? fmtBRL(preco) : "—"}</td>
                          <td className={styles.colNum}>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              aria-label={`Estoque de ${item.nome}`}
                              className={`${styles.inputNum} ${
                                original && original.estoque !== item.estoque ? styles.inputEditado : ""
                              } ${item.estoque === 0 ? styles.inputZero : ""}`}
                              value={rascunho[chaveEstoque] ?? String(item.estoque)}
                              disabled={!podeEditar}
                              onChange={(e) => {
                                const texto = e.target.value;
                                // Campo vazio não vira 0 na hora: só o número digitado conta.
                                setRascunho((prev) => ({ ...prev, [chaveEstoque]: texto }));
                                if (texto.trim() === "") return;
                                atualizarItem(item.id, {
                                  estoque: Math.max(0, Math.round(Number(texto) || 0)),
                                });
                              }}
                              onBlur={() =>
                                setRascunho((prev) => {
                                  const proximo = { ...prev };
                                  delete proximo[chaveEstoque];
                                  return proximo;
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {secao.linhas.length > 0 && (
                  <tfoot>
                    <tr>
                      <td>
                        Total
                        {secao.semPreco > 0 && (
                          <span className={styles.subRodape}>
                            {" "}
                            · {fmtInt(secao.semPreco)} sem preço fora da soma
                          </span>
                        )}
                      </td>
                      {podeVerCusto && <td className={styles.colValor}>{fmtBRL(secao.custoTotal)}</td>}
                      <td className={styles.colValor}>{fmtBRL(secao.valorTotal)}</td>
                      <td className={styles.colNum}>{fmtInt(secao.pecas)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {editandoItens && (
              <button
                type="button"
                className={styles.btnAdicionar}
                onClick={() => adicionarItem(secao.key)}
              >
                + Adicionar item {secao.key}
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
