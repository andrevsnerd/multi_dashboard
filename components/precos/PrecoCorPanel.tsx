"use client";

import { useCallback, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/AuthContext";

import styles from "./AlterarPrecosPage.module.css";

/**
 * Aba "Por cor" do Alterar Custo / Preço: um produto por vez, liga o modo cor
 * (VARIA_PRECO_COR) e altera o Preço Líquido (1) de cada cor na tabela escolhida.
 * Regras e efeitos no Linx: lib/repositories/precosCor.ts.
 */

type CompanyKey = "nerd" | "scarfme";

interface CorPreco {
  cor: string;
  descricao: string;
  preco1: number | null;
  liquido1: number | null;
}

interface ProdutoCor {
  produto: string;
  descricao: string;
  variaPrecoCor: boolean;
  tabela: string;
  tabelas: Array<{ codigo: string; descricao: string; inativa: boolean }>;
  cores: CorPreco[];
}

interface ResultadoAlterar {
  lote: string;
  aplicados: number;
  semMudanca: number;
  naoConfirmados: number;
  erros: string[];
}

interface Props {
  companyKey: CompanyKey;
  abas?: ReactNode;
}

function brl(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "298", "298,00", "1.298,50" → número; vazio → null; lixo → NaN. */
function parseValor(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}

export default function PrecoCorPanel({ companyKey, abas }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [codigo, setCodigo] = useState("");
  const [produto, setProduto] = useState<ProdutoCor | null>(null);
  const [podeExecutar, setPodeExecutar] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [novos, setNovos] = useState<Record<string, string>>({});
  const [confirmandoLigar, setConfirmandoLigar] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAlterar | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(
    async (cod: string, tabela?: string) => {
      const c = cod.trim();
      if (!c || !username) return;
      setCarregando(true);
      setErro(null);
      try {
        const params = new URLSearchParams({ codigo: c });
        if (tabela) params.set("tabela", tabela);
        const res = await fetch(`/api/precos/cor?${params}`, {
          headers: { "x-auth-username": username },
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao buscar o produto.");
        setProduto(json.produto as ProdutoCor);
        setPodeExecutar(Boolean(json.podeExecutar));
        setNovos({});
      } catch (e) {
        setProduto(null);
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setCarregando(false);
      }
    },
    [username]
  );

  const buscar = () => {
    setResultado(null);
    setAviso(null);
    void carregar(codigo);
  };

  const postar = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/precos/cor", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-auth-username": username },
      body: JSON.stringify({ company: companyKey, ...body }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Erro ao gravar.");
    return json;
  };

  const ligar = async () => {
    if (!produto) return;
    setGravando(true);
    setErro(null);
    try {
      const r = (await postar({ acao: "ligar", produto: produto.produto })) as { lote: string; linhasCriadas: number };
      setConfirmandoLigar(false);
      setAviso(`Modo cor ligado (lote ${r.lote}). Agora o PDV lê o preço de cada cor.`);
      await carregar(produto.produto, produto.tabela);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGravando(false);
    }
  };

  // Alterações válidas e diferentes do líquido atual.
  const alteracoes = (produto?.cores ?? []).flatMap((c) => {
    const v = parseValor(novos[c.cor] ?? "");
    if (v === null || Number.isNaN(v) || v < 0) return [];
    const valor = Math.round(v * 100) / 100;
    if (c.liquido1 !== null && Math.abs(c.liquido1 - valor) < 0.005) return [];
    return [{ cor: c.cor, descricao: c.descricao, preco1: c.preco1, atual: c.liquido1, valor }];
  });
  const invalidos = (produto?.cores ?? []).filter((c) => {
    const v = parseValor(novos[c.cor] ?? "");
    return v !== null && (Number.isNaN(v) || v < 0);
  });

  const aplicar = async () => {
    if (!produto || alteracoes.length === 0) return;
    setGravando(true);
    setErro(null);
    try {
      const r = (await postar({
        acao: "alterar",
        produto: produto.produto,
        tabela: produto.tabela,
        alteracoes: alteracoes.map((a) => ({ cor: a.cor, valor: a.valor })),
      })) as ResultadoAlterar;
      setResultado(r);
      setRevisando(false);
      await carregar(produto.produto, produto.tabela);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGravando(false);
    }
  };

  const tabelaAtual = produto?.tabelas.find((t) => t.codigo === produto.tabela);
  const podeEditar = Boolean(produto?.variaPrecoCor && podeExecutar);

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Alterar Custo / Preço</h1>
        {abas}
      </header>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Produto</h2>
        <form
          className={styles.acoes}
          onSubmit={(e) => {
            e.preventDefault();
            buscar();
          }}
        >
          <label className={styles.campoTexto} style={{ flex: 1, minWidth: 220 }}>
            <span className={styles.campoLabel}>Código do produto ou código de barras</span>
            <input
              className={styles.input}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="ex.: 07.A1.00B3 ou 042396"
            />
          </label>
          <button type="submit" className={styles.btnPrimario} disabled={!codigo.trim() || carregando}>
            {carregando ? "Buscando…" : "Buscar"}
          </button>
        </form>
      </section>

      {erro && <div className={styles.erroBox}>{erro}</div>}
      {aviso && <div className={styles.avisoBox}>{aviso}</div>}

      {produto && (
        <section className={styles.card}>
          <div className={styles.fichaHead}>
            <span className={styles.fichaProduto}>{produto.produto}</span>
            <span className={styles.fichaDesc}>{produto.descricao}</span>
            <span className={styles.lote}>Modo cor: {produto.variaPrecoCor ? "LIGADO" : "desligado"}</span>
          </div>

          {!produto.variaPrecoCor ? (
            <div className={styles.avisoBox}>
              Este produto tem o mesmo preço em todas as cores. Para alterar o preço de uma cor, ligue o modo
              cor: o preço atual é copiado para cada cor (nada muda no caixa) e, a partir daí, o PDV passa a
              ler o preço de cada cor.
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className={styles.btnPrimario}
                  disabled={!podeExecutar || gravando}
                  onClick={() => setConfirmandoLigar(true)}
                >
                  Ligar modo cor
                </button>
              </div>
            </div>
          ) : (
            <p className={styles.dica}>
              Com o modo cor ligado, alterações por produto (aba Por produto, Programar Preços, Black) não
              chegam ao caixa deste produto: o PDV lê o preço de cada cor.
            </p>
          )}

          {produto.tabelas.length > 0 && (
            <label className={styles.campoTexto} style={{ maxWidth: 360 }}>
              <span className={styles.campoLabel}>Tabela de preço</span>
              <select
                className={styles.input}
                value={produto.tabela}
                onChange={(e) => void carregar(produto.produto, e.target.value)}
                disabled={carregando}
              >
                {produto.tabelas.map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.codigo} — {t.descricao}
                    {t.inativa ? " (inativa)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={styles.tabelaWrap}>
            <table className={styles.tabelaFicha}>
              <thead>
                <tr>
                  <th className={styles.thFichaNum}>#</th>
                  <th>Cor</th>
                  <th>Descrição da cor</th>
                  <th className={styles.thNum}>Preço (1)</th>
                  <th className={styles.thNum}>Preço Líquido (1)</th>
                  <th className={styles.thNum}>Novo Preço Líquido (1)</th>
                </tr>
              </thead>
              <tbody>
                {produto.cores.map((c, i) => {
                  const alterada = alteracoes.some((a) => a.cor === c.cor);
                  return (
                    <tr key={c.cor} className={alterada ? styles.trAlterada : undefined}>
                      <td className={styles.thNum}>{i + 1}</td>
                      <td className={styles.tdCodigo}>{c.cor}</td>
                      <td>{c.descricao}</td>
                      <td className={styles.thNum}>{brl(c.preco1)}</td>
                      <td className={styles.thNum}>{brl(c.liquido1)}</td>
                      <td className={styles.thNum}>
                        <input
                          className={styles.inputValor}
                          inputMode="decimal"
                          value={novos[c.cor] ?? ""}
                          disabled={!podeEditar}
                          placeholder={podeEditar ? brl(c.liquido1) : ""}
                          onChange={(e) => setNovos((prev) => ({ ...prev, [c.cor]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {invalidos.length > 0 && (
            <p className={styles.textoErro}>Valor inválido em: {invalidos.map((c) => c.cor).join(", ")}.</p>
          )}

          {produto.variaPrecoCor && (
            <div className={styles.acoes}>
              <span className={styles.dica}>
                {alteracoes.length} cor(es) com Preço Líquido (1) novo na tabela {produto.tabela}
                {tabelaAtual ? ` — ${tabelaAtual.descricao}` : ""}. O Preço (1) não muda.
              </span>
              <button
                type="button"
                className={styles.btnPrimario}
                disabled={alteracoes.length === 0 || invalidos.length > 0 || !podeExecutar || gravando}
                onClick={() => setRevisando(true)}
              >
                Revisar e aplicar
              </button>
            </div>
          )}
          {!podeExecutar && <p className={styles.dica}>Seu perfil é somente leitura: dá para conferir, mas não para gravar.</p>}
        </section>
      )}

      {resultado && (
        <section className={`${styles.card} ${styles.cardResultado}`}>
          <h2 className={styles.cardTitle}>Resultado</h2>
          <div className={styles.resumoLinha}>
            <strong>{resultado.aplicados}</strong> cor(es) confirmada(s)
            {resultado.semMudanca > 0 && <> · {resultado.semMudanca} já estavam no valor</>}
            {resultado.naoConfirmados > 0 && (
              <> · <span className={styles.textoErro}>{resultado.naoConfirmados} não confirmada(s)</span></>
            )}
          </div>
          {resultado.lote && (
            <div className={styles.resumoLinha}>
              Lote <code className={styles.lote}>{resultado.lote}</code>
            </div>
          )}
          {resultado.erros.length > 0 && (
            <ul className={styles.listaErros}>
              {resultado.erros.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {confirmandoLigar && produto && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.cardTitle}>Ligar modo cor</h2>
            <p className={styles.modalAviso}>
              {produto.produto} — {produto.descricao}: o preço atual de todas as tabelas é copiado para as{" "}
              {produto.cores.length} cor(es) e o PDV passa a ler o preço por cor. Nenhum preço muda no caixa
              agora. A partir daí, mudanças feitas por produto (aba Por produto, Programar Preços, Black) não
              chegam ao caixa deste produto.
            </p>
            <div className={styles.modalAcoes}>
              <button type="button" className={styles.btnTexto} onClick={() => setConfirmandoLigar(false)}>
                Cancelar
              </button>
              <button type="button" className={styles.btnPerigo} disabled={gravando} onClick={() => void ligar()}>
                {gravando ? "Ligando…" : "Ligar modo cor"}
              </button>
            </div>
          </div>
        </div>
      )}

      {revisando && produto && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.cardTitle}>Preview das alterações</h2>
            <p className={styles.modalAviso}>
              {produto.produto} — tabela {produto.tabela}: só o Preço Líquido (1) das cores abaixo muda. As
              tabelas derivadas e o preço por loja dessas cores acompanham (regra do Linx).
            </p>
            <table className={styles.tabelaFicha}>
              <thead>
                <tr>
                  <th>Cor</th>
                  <th>Descrição</th>
                  <th className={styles.thNum}>Preço (1)</th>
                  <th className={styles.thNum}>Líquido atual</th>
                  <th className={styles.thNum}>Líquido novo</th>
                </tr>
              </thead>
              <tbody>
                {alteracoes.map((a) => (
                  <tr key={a.cor}>
                    <td className={styles.tdCodigo}>{a.cor}</td>
                    <td>{a.descricao}</td>
                    <td className={styles.thNum}>{brl(a.preco1)}</td>
                    <td className={styles.thNum}>{brl(a.atual)}</td>
                    <td className={styles.thNum}>
                      <strong>{brl(a.valor)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.modalAcoes}>
              <button type="button" className={styles.btnTexto} onClick={() => setRevisando(false)}>
                Cancelar
              </button>
              <button type="button" className={styles.btnPerigo} disabled={gravando} onClick={() => void aplicar()}>
                {gravando ? "Aplicando…" : `Aplicar ${alteracoes.length} cor(es)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
