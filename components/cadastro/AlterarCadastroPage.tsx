"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";

import AbaDimensoes from "./AbaDimensoes";
import CadastroHistorico from "./CadastroHistorico";
import styles from "./AlterarCadastroPage.module.css";
import {
  opcoesDoCampo,
  type CampoProdutoDef,
  type CompanyKey,
  type DimensaoMeta,
  type OpcoesDimensoes,
  type ProdutoCadastro,
  type ResultadoProdutos,
  type ValorCampo,
} from "./types";

interface Props {
  companyKey: CompanyKey;
}

type Aba = "dimensoes" | "produto";

export default function AlterarCadastroPage({ companyKey }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [aba, setAba] = useState<Aba>("dimensoes");
  const [podeExecutar, setPodeExecutar] = useState(false);
  const [opcoes, setOpcoes] = useState<OpcoesDimensoes | null>(null);
  const [campos, setCampos] = useState<CampoProdutoDef[]>([]);
  const [metas, setMetas] = useState<DimensaoMeta[]>([]);
  const [erroOpcoes, setErroOpcoes] = useState<string | null>(null);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(true);
  const [historicoVersao, setHistoricoVersao] = useState(0);

  // ───────── carga inicial ─────────

  useEffect(() => {
    if (!username) return;
    let cancelado = false;
    setCarregandoOpcoes(true);
    setErroOpcoes(null);
    (async () => {
      try {
        const res = await fetch(`/api/cadastro/opcoes?company=${companyKey}`, {
          headers: { "x-auth-username": username },
          cache: "no-store",
        });
        const json = await res.json();
        if (cancelado) return;
        if (!res.ok) {
          setErroOpcoes(json?.error ?? "Erro ao carregar as opções do cadastro.");
          return;
        }
        setOpcoes(json.opcoes as OpcoesDimensoes);
        setCampos((json.campos ?? []) as CampoProdutoDef[]);
        setMetas((json.dimensoes ?? []) as DimensaoMeta[]);
        setPodeExecutar(Boolean(json.podeExecutar));
      } catch {
        if (!cancelado) setErroOpcoes("Não foi possível carregar as opções do cadastro.");
      } finally {
        if (!cancelado) setCarregandoOpcoes(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [companyKey, username, historicoVersao]);

  const avisarGravou = useCallback(() => setHistoricoVersao((v) => v + 1), []);

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Alterar Cadastro</h1>
        {!podeExecutar && !carregandoOpcoes && (
          <div className={styles.avisoTopo}>
            Seu perfil é somente leitura: dá para conferir o impacto, mas não para gravar.
          </div>
        )}
      </header>

      {erroOpcoes && <div className={styles.erroBox}>{erroOpcoes}</div>}

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${aba === "dimensoes" ? styles.tabAtiva : ""}`}
          onClick={() => setAba("dimensoes")}
        >
          Dimensões (grupo, subgrupo, linha…)
        </button>
        <button
          type="button"
          className={`${styles.tab} ${aba === "produto" ? styles.tabAtiva : ""}`}
          onClick={() => setAba("produto")}
        >
          Alterar Produto
        </button>
      </div>

      {aba === "dimensoes" ? (
        <AbaDimensoes
          companyKey={companyKey}
          username={username}
          podeExecutar={podeExecutar}
          metas={metas}
          onGravou={avisarGravou}
        />
      ) : (
        <AbaProduto
          companyKey={companyKey}
          username={username}
          podeExecutar={podeExecutar}
          campos={campos}
          opcoes={opcoes}
          onGravou={avisarGravou}
        />
      )}

      <CadastroHistorico
        companyKey={companyKey}
        username={username}
        podeExecutar={podeExecutar}
        recarregarEm={historicoVersao}
        onEstornado={avisarGravou}
      />
    </div>
  );
}

// ═══════════════════════════ ABA 2 — PRODUTO ═══════════════════════════

interface AbaProdutoProps {
  companyKey: CompanyKey;
  username: string;
  podeExecutar: boolean;
  campos: CampoProdutoDef[];
  opcoes: OpcoesDimensoes | null;
  onGravou: () => void;
}

function AbaProduto({ companyKey, username, podeExecutar, campos, opcoes, onGravou }: AbaProdutoProps) {
  const [codigo, setCodigo] = useState("");
  const [produto, setProduto] = useState<ProdutoCadastro | null>(null);
  const [edicao, setEdicao] = useState<Record<string, ValorCampo>>({});
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [obs, setObs] = useState("");
  const [gravando, setGravando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoProdutos | null>(null);

  const buscar = useCallback(async () => {
    if (!username || !codigo.trim()) return;
    setBuscando(true);
    setErro(null);
    setResultado(null);
    try {
      const res = await fetch("/api/cadastro/produtos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ company: companyKey, codigo: codigo.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao buscar o produto.");
        setProduto(null);
        return;
      }
      setProduto(json.produto as ProdutoCadastro);
      setEdicao({});
    } catch {
      setErro("Falha de conexão ao buscar o produto.");
    } finally {
      setBuscando(false);
    }
  }, [username, codigo, companyKey]);

  const valorDe = useCallback(
    (campo: string): ValorCampo => {
      if (campo in edicao) return edicao[campo];
      return produto?.valores[campo] ?? null;
    },
    [edicao, produto]
  );

  const grupoAtual = String(valorDe("GRUPO_PRODUTO") ?? "");

  /**
   * Trocar o grupo pode deixar o subgrupo órfão: o par (grupo, subgrupo) é
   * validado junto pela FK. Quando o subgrupo atual não existe no grupo novo,
   * limpamos o campo para o usuário escolher — em vez de deixar gravar e falhar.
   */
  const definir = useCallback(
    (campo: string, valor: ValorCampo) => {
      setEdicao((prev) => {
        const proximo = { ...prev, [campo]: valor };
        if (campo === "GRUPO_PRODUTO" && opcoes) {
          const disponiveis = opcoes.subgruposPorGrupo[String(valor ?? "")] ?? [];
          const subgrupoAtual = String(proximo.SUBGRUPO_PRODUTO ?? produto?.valores.SUBGRUPO_PRODUTO ?? "");
          if (!disponiveis.some((s) => s === subgrupoAtual)) {
            proximo.SUBGRUPO_PRODUTO = "";
          }
        }
        return proximo;
      });
    },
    [opcoes, produto]
  );

  const alteracoes = useMemo(() => {
    if (!produto) return [];
    return campos
      .filter((c) => !c.somenteLeitura)
      .map((c) => ({ campo: c, atual: produto.valores[c.campo] ?? null, novo: valorDe(c.campo) }))
      .filter(({ campo, atual, novo }) => {
        if (!(campo.campo in edicao)) return false;
        if (campo.tipo === "bool") return Boolean(atual) !== Boolean(novo);
        if (campo.tipo === "inteiro" || campo.tipo === "decimal") {
          const a = atual === null || atual === "" ? null : Number(atual);
          const b = novo === null || novo === "" ? null : Number(novo);
          return a !== b;
        }
        return String(atual ?? "").trim() !== String(novo ?? "").trim();
      });
  }, [produto, campos, edicao, valorDe]);

  const faltando = useMemo(
    () =>
      alteracoes.filter(
        ({ campo, novo }) => campo.obrigatorio && String(novo ?? "").trim() === "" && campo.tipo !== "bool"
      ),
    [alteracoes]
  );

  const gravar = useCallback(async () => {
    if (!username || !produto || alteracoes.length === 0) return;
    setGravando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cadastro/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          alteracoes: alteracoes.map(({ campo, novo }) => ({
            produto: produto.produto,
            campo: campo.campo,
            valor: novo,
          })),
          obs: obs.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao gravar as alterações.");
        return;
      }
      setResultado(json as ResultadoProdutos);
      setRevisando(false);
      setConfirmado(false);
      setObs("");
      setEdicao({});
      onGravou();
      await buscar();
    } catch {
      setErro("Falha de conexão ao gravar as alterações.");
    } finally {
      setGravando(false);
    }
  }, [username, produto, alteracoes, companyKey, obs, onGravou, buscar]);

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Localizar produto</h2>
        <div className={styles.acoes}>
          <label className={styles.campoTexto} style={{ flex: 1, minWidth: 260 }}>
            <span className={styles.campoLabel}>Código do produto ou código de barras</span>
            <input
              className={styles.input}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void buscar()}
              placeholder="ex.: N4.7P.0100 ou 7891234567890"
            />
          </label>
          <button
            type="button"
            className={styles.btnPrimario}
            onClick={() => void buscar()}
            disabled={buscando || !codigo.trim()}
          >
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </div>
      </section>

      {erro && <div className={styles.erroBox}>{erro}</div>}

      {resultado && (
        <section className={`${styles.card} ${styles.cardResultado}`}>
          <h2 className={styles.cardTitle}>Resultado</h2>
          <div className={styles.resumoLinha}>
            <strong>{resultado.aplicados}</strong> campo(s) alterado(s)
            {resultado.semMudanca > 0 && <> · {resultado.semMudanca} já estavam no valor</>}
            {resultado.invalidos > 0 && <> · {resultado.invalidos} inválido(s)</>}
            {resultado.naoConfirmados > 0 && (
              <>
                {" "}
                · <span className={styles.textoErro}>{resultado.naoConfirmados} não confirmado(s)</span>
              </>
            )}
          </div>
          {resultado.lote && (
            <div className={styles.resumoLinha}>
              Lote <code className={styles.lote}>{resultado.lote}</code>
            </div>
          )}
          {resultado.erros.length > 0 && (
            <ul className={styles.listaErros}>
              {resultado.erros.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {produto && (
        <section className={styles.card}>
          <div className={styles.fichaHead}>
            <span className={styles.fichaProduto}>{produto.produto}</span>
            <span className={styles.fichaDesc}>{String(produto.valores.DESC_PRODUTO ?? "")}</span>
            {produto.valores.INATIVO === true && <span className={styles.badgeInativa}>inativo</span>}
          </div>

          <div className={styles.fichaGrid}>
            {campos.map((campo) => {
              const valor = valorDe(campo.campo);
              const alterado = campo.campo in edicao;
              const listaOpcoes =
                campo.tipo === "dimensao" && opcoes ? opcoesDoCampo(campo, opcoes, grupoAtual) : [];

              return (
                <label
                  key={campo.campo}
                  className={`${styles.campoTexto} ${alterado ? styles.campoAlterado : ""}`}
                >
                  <span className={styles.campoLabel}>
                    {campo.label}
                    {campo.obrigatorio && " *"}
                  </span>

                  {campo.tipo === "bool" ? (
                    <select
                      className={styles.select}
                      value={valor ? "1" : "0"}
                      disabled={!podeExecutar || campo.somenteLeitura}
                      onChange={(e) => definir(campo.campo, e.target.value === "1")}
                    >
                      <option value="0">Não</option>
                      <option value="1">Sim</option>
                    </select>
                  ) : campo.tipo === "dimensao" ? (
                    <select
                      className={styles.select}
                      value={String(valor ?? "")}
                      disabled={!podeExecutar || campo.somenteLeitura}
                      onChange={(e) => definir(campo.campo, e.target.value)}
                    >
                      <option value="">
                        {campo.fonte === "subgrupo" && !grupoAtual ? "escolha o grupo primeiro" : "—"}
                      </option>
                      {/* O valor atual pode ser de um cadastro inativo: mantém na lista
                          para não sumir da ficha nem virar alteração acidental. */}
                      {!listaOpcoes.some((o) => o.value === String(valor ?? "")) && valor ? (
                        <option value={String(valor)}>{String(valor)}</option>
                      ) : null}
                      {listaOpcoes.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={styles.input}
                      value={valor === null ? "" : String(valor)}
                      disabled={!podeExecutar || campo.somenteLeitura}
                      maxLength={campo.max}
                      inputMode={campo.tipo === "texto" ? undefined : "decimal"}
                      onChange={(e) => definir(campo.campo, e.target.value)}
                    />
                  )}

                  {campo.somenteLeitura && campo.nota && (
                    <span className={styles.campoBloqueado}>🔒 {campo.nota}</span>
                  )}
                  {!campo.somenteLeitura && campo.nota && (
                    <span className={styles.campoNota}>{campo.nota}</span>
                  )}
                  {campo.max && campo.tipo === "texto" && (
                    <span className={styles.contador}>
                      {String(valor ?? "").length}/{campo.max}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <div className={styles.aplicarBar}>
            <span className={styles.campoLabel}>
              {alteracoes.length === 0
                ? "Nenhum campo alterado"
                : `${alteracoes.length} campo(s) alterado(s)`}
            </span>
            <button
              type="button"
              className={styles.btnSecundario}
              onClick={() => setEdicao({})}
              disabled={alteracoes.length === 0}
            >
              Descartar
            </button>
            <button
              type="button"
              className={styles.btnPrimario}
              disabled={alteracoes.length === 0 || faltando.length > 0 || !podeExecutar}
              onClick={() => {
                setConfirmado(false);
                setRevisando(true);
              }}
            >
              Revisar e gravar
            </button>
          </div>

          {faltando.length > 0 && (
            <div className={styles.erroBox}>
              Campo obrigatório vazio: {faltando.map((f) => f.campo.label).join(", ")}. No Linx essas
              colunas são NOT NULL.
            </div>
          )}
        </section>
      )}

      {revisando && produto && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.cardTitle}>Preview das alterações</h2>
            <p className={styles.modalAviso}>
              {alteracoes.length} campo(s) de <strong>{produto.produto}</strong> serão gravados no cadastro
              do Linx.
            </p>

            <table className={styles.tabelaFicha}>
              <thead>
                <tr>
                  <th>Campo</th>
                  <th>Valor atual</th>
                  <th>Valor novo</th>
                </tr>
              </thead>
              <tbody>
                {alteracoes.map(({ campo, atual, novo }) => (
                  <tr key={campo.campo}>
                    <td className={styles.tdDesc}>{campo.label}</td>
                    <td className={styles.tdDesc}>
                      {campo.tipo === "bool"
                        ? atual
                          ? "Sim"
                          : "Não"
                        : String(atual ?? "") || "—"}
                    </td>
                    <td className={styles.tdDesc}>
                      <strong>
                        {campo.tipo === "bool" ? (novo ? "Sim" : "Não") : String(novo ?? "") || "—"}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Observação (fica no histórico)</span>
              <input
                className={styles.input}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                maxLength={300}
              />
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={confirmado}
                onChange={(e) => setConfirmado(e.target.checked)}
              />
              Confirmo que revisei e quero gravar no Linx.
            </label>

            {erro && <div className={styles.erroBox}>{erro}</div>}

            <div className={styles.modalAcoes}>
              <button type="button" className={styles.btnTexto} onClick={() => setRevisando(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className={styles.btnPerigo}
                disabled={!confirmado || gravando || !podeExecutar}
                onClick={() => void gravar()}
              >
                {gravando ? "Gravando…" : `Gravar ${alteracoes.length} campo(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
