"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import { useAuth } from "@/components/auth/AuthContext";

import CadastroHistorico from "./CadastroHistorico";
import styles from "./AlterarCadastroPage.module.css";
import {
  separarCodigos,
  type CampoProdutoDef,
  type CompanyKey,
  type OpcoesDimensoes,
  type ProdutoCadastro,
  type ResultadoProdutos,
  type ValorCampo,
} from "./types";

interface Props {
  companyKey: CompanyKey;
}

type ModoSelecao = "filtros" | "codigos";

/** Linhas visíveis da lista detalhada antes de pedir "mostrar todos". */
const LIMITE_DETALHE = 300;
/** Valores mostrados na distribuição antes de expandir. */
const LIMITE_DISTRIBUICAO = 10;

export default function AlterarMultiplosProdutosPage({ companyKey }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [podeExecutar, setPodeExecutar] = useState(false);
  const [opcoes, setOpcoes] = useState<OpcoesDimensoes | null>(null);
  const [campos, setCampos] = useState<CampoProdutoDef[]>([]);
  const [erroOpcoes, setErroOpcoes] = useState<string | null>(null);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(true);

  // Filtros
  const [modoSelecao, setModoSelecao] = useState<ModoSelecao>("filtros");
  const [codigosTexto, setCodigosTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [grupos, setGrupos] = useState<string[]>([]);
  const [subgrupos, setSubgrupos] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<string[]>([]);
  const [colecoes, setColecoes] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [griffes, setGriffes] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [todoCadastro, setTodoCadastro] = useState(false);

  // Resultado da busca
  const [rows, setRows] = useState<ProdutoCadastro[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [naoEncontrados, setNaoEncontrados] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscouUmaVez, setBuscouUmaVez] = useState(false);

  // Alteração
  const [campoAlvo, setCampoAlvo] = useState("");
  const [novoValor, setNovoValor] = useState<ValorCampo>("");
  /** Subgrupo de destino — só usado ao mover o produto de grupo (o par é validado junto). */
  const [novoSubgrupo, setNovoSubgrupo] = useState("");
  /** O usuário já escolheu o subgrupo à mão? Se sim, o palpite automático não mexe mais. */
  const [subgrupoTocado, setSubgrupoTocado] = useState(false);
  const [valoresFiltro, setValoresFiltro] = useState<string[]>([]);
  const [distribuicaoExpandida, setDistribuicaoExpandida] = useState(false);
  const [verTodosDetalhes, setVerTodosDetalhes] = useState(false);
  /**
   * Produtos desmarcados na lista detalhada. Guardamos o que saiu, não o que ficou:
   * o padrão é TODOS marcados, então uma busca nova já vem inteira selecionada.
   */
  const [desmarcados, setDesmarcados] = useState<string[]>([]);

  // Execução
  const [revisando, setRevisando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [obs, setObs] = useState("");
  const [gravando, setGravando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoProdutos | null>(null);
  const [historicoVersao, setHistoricoVersao] = useState(0);

  // ───────── carga inicial ─────────

  useEffect(() => {
    if (!username) return;
    let cancelado = false;
    setCarregandoOpcoes(true);
    setErroOpcoes(null);
    (async () => {
      try {
        const params = new URLSearchParams({ company: companyKey });
        if (incluirInativos) params.set("incluirInativos", "1");
        const res = await fetch(`/api/cadastro/opcoes?${params}`, {
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
  }, [companyKey, username, incluirInativos]);

  const camposMassa = useMemo(() => campos.filter((c) => c.massa && !c.somenteLeitura), [campos]);

  const campoDef = useMemo(
    () => camposMassa.find((c) => c.campo === campoAlvo) ?? null,
    [camposMassa, campoAlvo]
  );

  /** Subgrupos do filtro: escopados aos grupos marcados, senão a lista inteira. */
  const subgruposDisponiveis = useMemo(() => {
    if (!opcoes) return [];
    if (grupos.length === 0) {
      return [...new Set(Object.values(opcoes.subgruposPorGrupo).flat())].sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      );
    }
    return [...new Set(grupos.flatMap((g) => opcoes.subgruposPorGrupo[g] ?? []))].sort((a, b) =>
      a.localeCompare(b, "pt-BR")
    );
  }, [opcoes, grupos]);

  // ───────── busca ─────────

  const buscar = useCallback(
    async (opts: { manterResultado?: boolean } = {}) => {
      if (!username) return;
      setCarregando(true);
      setErro(null);
      if (!opts.manterResultado) setResultado(null);

      const body =
        modoSelecao === "codigos"
          ? {
              company: companyKey,
              codigos: separarCodigos(codigosTexto),
              incluirInativos,
              todoCadastro,
            }
          : {
              company: companyKey,
              busca: busca.trim() || null,
              grupos,
              subgrupos,
              linhas,
              colecoes,
              tipos,
              griffes,
              grades,
              incluirInativos,
              todoCadastro,
            };

      try {
        const res = await fetch("/api/cadastro/produtos", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) {
          setErro(json?.error ?? "Erro ao buscar produtos.");
          return;
        }
        setRows((json.rows ?? []) as ProdutoCadastro[]);
        setTotal(json.total ?? 0);
        setTruncated(Boolean(json.truncated));
        setNaoEncontrados(json.naoEncontrados ?? []);
        setValoresFiltro([]);
        setDistribuicaoExpandida(false);
        setVerTodosDetalhes(false);
        setDesmarcados([]);
        setNovoValor(campoDef?.tipo === "bool" ? false : "");
        setBuscouUmaVez(true);
      } catch {
        setErro("Falha de conexão ao buscar produtos.");
      } finally {
        setCarregando(false);
      }
    },
    [
      username, modoSelecao, companyKey, codigosTexto, busca, grupos, subgrupos, linhas,
      colecoes, tipos, griffes, grades, incluirInativos, todoCadastro, campoDef,
    ]
  );

  // Trocar o campo alvo zera valor e filtro de valor — eles são do campo anterior.
  useEffect(() => {
    setNovoValor(campoDef?.tipo === "bool" ? false : "");
    setValoresFiltro([]);
    setDistribuicaoExpandida(false);
  }, [campoDef]);

  // ───────── distribuição de valores atuais ─────────

  const textoValor = useCallback(
    (valor: ValorCampo): string => {
      if (campoDef?.tipo === "bool") return valor ? "Sim" : "Não";
      const t = String(valor ?? "").trim();
      return t === "" ? "(vazio)" : t;
    },
    [campoDef]
  );

  const distribuicao = useMemo(() => {
    if (!campoDef) return [];
    const mapa = new Map<string, number>();
    for (const row of rows) {
      const chave = textoValor(row.valores[campoDef.campo] ?? null);
      mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
    }
    return [...mapa.entries()]
      .map(([valor, qtd]) => ({ valor, qtd }))
      .sort((a, b) => b.qtd - a.qtd || a.valor.localeCompare(b.valor, "pt-BR"));
  }, [campoDef, rows, textoValor]);

  const filtroValorAtivo = valoresFiltro.length > 0;

  /** Itens que passam pelo filtro de valor atual. Sem filtro, é a lista inteira. */
  const rowsFiltradas = useMemo(() => {
    if (!campoDef || !filtroValorAtivo) return rows;
    return rows.filter((row) => valoresFiltro.includes(textoValor(row.valores[campoDef.campo] ?? null)));
  }, [rows, campoDef, filtroValorAtivo, valoresFiltro, textoValor]);

  // ───────── camada de seleção (checkbox por produto) ─────────

  /** Set derivado: `includes` num array seria O(n²) com 3.000 linhas. */
  const desmarcadosSet = useMemo(() => new Set(desmarcados), [desmarcados]);

  /** O que realmente vai ser alterado: passou pelo filtro de valor E está marcado. */
  const selecionados = useMemo(
    () => rowsFiltradas.filter((r) => !desmarcadosSet.has(r.produto)),
    [rowsFiltradas, desmarcadosSet]
  );

  const todosMarcados = rowsFiltradas.length > 0 && selecionados.length === rowsFiltradas.length;

  const alternarProduto = useCallback((produto: string) => {
    setDesmarcados((prev) =>
      prev.includes(produto) ? prev.filter((p) => p !== produto) : [...prev, produto]
    );
  }, []);

  // ───────── opções do valor novo ─────────

  /**
   * Grupos distintos na seleção. Importa porque o par (grupo, subgrupo) é validado
   * junto pela FK: para alterar SUBGRUPO em massa, o subgrupo escolhido tem que
   * existir em TODOS os grupos presentes — daí a interseção. Sai dos SELECIONADOS:
   * desmarcar o único item de um grupo tem de liberar mais subgrupos na lista.
   */
  const gruposNaSelecao = useMemo(
    () => [...new Set(selecionados.map((r) => String(r.valores.GRUPO_PRODUTO ?? "")).filter(Boolean))],
    [selecionados]
  );

  const opcoesValorNovo = useMemo(() => {
    if (!campoDef || !opcoes || campoDef.tipo !== "dimensao") return [];
    const simples = (v: string[]) => v.map((x) => ({ value: x, label: x }));
    switch (campoDef.fonte) {
      case "grupo":
        return simples(opcoes.grupos);
      case "subgrupo": {
        if (gruposNaSelecao.length === 0) return [];
        const listas = gruposNaSelecao.map((g) => new Set(opcoes.subgruposPorGrupo[g] ?? []));
        const intersecao = [...(listas[0] ?? [])].filter((s) => listas.every((set) => set.has(s)));
        return simples(intersecao.sort((a, b) => a.localeCompare(b, "pt-BR")));
      }
      case "linha":
        return simples(opcoes.linhas);
      case "tipo":
        return simples(opcoes.tipos);
      case "griffe":
        return simples(opcoes.griffes);
      case "colecao":
        return opcoes.colecoes;
      case "unidade":
        return simples(opcoes.unidades);
      default:
        return [];
    }
  }, [campoDef, opcoes, gruposNaSelecao]);

  /**
   * Mover produto de grupo é a única alteração que mexe em DOIS campos: a FK
   * XFK12602 valida o PAR (grupo, subgrupo), então o subgrupo de destino faz parte
   * da operação. Sem isso a alteração é um beco sem saída — trocar só o grupo é
   * recusado pela FK, e trocar só o subgrupo antes também (o subgrupo de destino
   * não existe no grupo de origem).
   */
  const movendoGrupo = campoDef?.campo === "GRUPO_PRODUTO";
  const grupoDestino = movendoGrupo ? String(novoValor ?? "").trim() : "";

  const subgruposDoDestino = useMemo(
    () => (grupoDestino && opcoes ? opcoes.subgruposPorGrupo[grupoDestino] ?? [] : []),
    [grupoDestino, opcoes]
  );

  /**
   * Se TODOS os selecionados já têm um subgrupo com o mesmo nome no grupo destino,
   * pré-seleciona ele: o caso comum de reorganização mantém o subgrupo.
   *
   * `subgrupoTocado` existe para o palpite não atropelar a escolha do usuário —
   * sem ele, desmarcar um produto depois de escolher o subgrupo zerava o campo.
   */
  useEffect(() => {
    if (!movendoGrupo || !grupoDestino) {
      setNovoSubgrupo("");
      setSubgrupoTocado(false);
      return;
    }
    if (subgrupoTocado) return;
    const disponiveis = new Set(subgruposDoDestino);
    const atuais = [
      ...new Set(selecionados.map((r) => String(r.valores.SUBGRUPO_PRODUTO ?? "").trim())),
    ];
    setNovoSubgrupo(atuais.length === 1 && disponiveis.has(atuais[0]) ? atuais[0] : "");
  }, [movendoGrupo, grupoDestino, subgruposDoDestino, selecionados, subgrupoTocado]);

  // Trocar o grupo de destino devolve o palpite automático.
  useEffect(() => {
    setSubgrupoTocado(false);
  }, [grupoDestino]);

  // ───────── alterações pendentes ─────────

  const alteracoes = useMemo(() => {
    if (!campoDef) return [];
    const alvo = campoDef.tipo === "bool" ? Boolean(novoValor) : String(novoValor ?? "").trim();
    if (campoDef.tipo !== "bool" && alvo === "") return [];
    // Mover de grupo exige o subgrupo de destino escolhido.
    if (movendoGrupo && !novoSubgrupo) return [];

    return selecionados
      .map((row) => {
        const subgrupoAtual = String(row.valores.SUBGRUPO_PRODUTO ?? "").trim();
        return {
          produto: row.produto,
          atual: row.valores[campoDef.campo] ?? null,
          novo: alvo,
          subgrupoAtual: movendoGrupo ? subgrupoAtual : undefined,
          subgrupoNovo: movendoGrupo ? novoSubgrupo : undefined,
        };
      })
      .filter(({ atual, novo, subgrupoAtual, subgrupoNovo }) => {
        // No movimento de grupo, mudar só o subgrupo já é uma alteração válida.
        if (movendoGrupo && subgrupoAtual !== subgrupoNovo) return true;
        if (campoDef.tipo === "bool") return Boolean(atual) !== Boolean(novo);
        if (campoDef.tipo === "inteiro" || campoDef.tipo === "decimal") {
          const a = atual === null || atual === "" ? null : Number(atual);
          const b = Number(String(novo).replace(/\./g, "").replace(",", "."));
          return a !== b;
        }
        return String(atual ?? "").trim() !== String(novo).trim();
      });
  }, [campoDef, novoValor, selecionados, movendoGrupo, novoSubgrupo]);

  const gravar = useCallback(async () => {
    if (!username || !campoDef || alteracoes.length === 0) return;
    setGravando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cadastro/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          // Mover de grupo vira DUAS alterações por produto: grupo e subgrupo. O
          // backend valida o par resultante antes de tocar no banco.
          alteracoes: alteracoes.flatMap((a) => {
            const itens = [{ produto: a.produto, campo: campoDef.campo, valor: a.novo }];
            if (a.subgrupoNovo !== undefined && a.subgrupoNovo !== a.subgrupoAtual) {
              itens.push({
                produto: a.produto,
                campo: "SUBGRUPO_PRODUTO",
                valor: a.subgrupoNovo,
              });
            }
            return itens;
          }),
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
      setHistoricoVersao((v) => v + 1);
      await buscar({ manterResultado: true });
    } catch {
      setErro("Falha de conexão ao gravar as alterações.");
    } finally {
      setGravando(false);
    }
  }, [username, campoDef, alteracoes, companyKey, obs, buscar]);

  const totalCodigosColados = separarCodigos(codigosTexto).length;

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Alterar Múltiplos Produtos</h1>
        <p className={styles.subtitulo}>
          Filtros abertos ou lista de códigos, do mesmo jeito da tela de custo/preço — mas alterando
          campos do <strong>cadastro</strong>. Um campo por vez, com a distribuição dos valores atuais
          para você escolher exatamente quais itens mudam.
        </p>
        {!podeExecutar && !carregandoOpcoes && (
          <div className={styles.avisoTopo}>
            Seu perfil é somente leitura: dá para conferir, mas não para gravar.
          </div>
        )}
      </header>

      {erroOpcoes && <div className={styles.erroBox}>{erroOpcoes}</div>}

      {/* ─── ENTRADA ─── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Entrada de dados</h2>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${modoSelecao === "filtros" ? styles.tabAtiva : ""}`}
            onClick={() => setModoSelecao("filtros")}
          >
            Por filtros
          </button>
          <button
            type="button"
            className={`${styles.tab} ${modoSelecao === "codigos" ? styles.tabAtiva : ""}`}
            onClick={() => setModoSelecao("codigos")}
          >
            Por códigos
          </button>
        </div>

        {modoSelecao === "filtros" ? (
          <div className={styles.filtros}>
            <MultiSelectFilter
              label="Grupo"
              value={grupos}
              options={opcoes?.grupos ?? []}
              onChange={setGrupos}
            />
            <MultiSelectFilter
              label="Subgrupo"
              value={subgrupos}
              options={subgruposDisponiveis}
              onChange={setSubgrupos}
            />
            <MultiSelectFilter
              label="Linha"
              value={linhas}
              options={opcoes?.linhas ?? []}
              onChange={setLinhas}
            />
            <MultiSelectFilter
              label="Coleção"
              value={colecoes}
              options={opcoes?.colecoes ?? []}
              onChange={setColecoes}
            />
            <MultiSelectFilter
              label="Tipo"
              value={tipos}
              options={opcoes?.tipos ?? []}
              onChange={setTipos}
            />
            <MultiSelectFilter
              label="Griffe"
              value={griffes}
              options={opcoes?.griffes ?? []}
              onChange={setGriffes}
            />
            <MultiSelectFilter
              label="Grade"
              value={grades}
              options={opcoes?.grades ?? []}
              onChange={setGrades}
            />
            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Nome ou código contém</span>
              <input
                className={styles.input}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void buscar()}
                placeholder="ex.: CAPA IPHONE 17"
              />
            </label>
          </div>
        ) : (
          <div className={styles.codigosBox}>
            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>
                Código do produto ou código de barras — vírgula, espaço ou quebra de linha
              </span>
              <textarea
                className={styles.textarea}
                value={codigosTexto}
                onChange={(e) => setCodigosTexto(e.target.value)}
                rows={5}
                placeholder={"N4.7P.0100\n7891234567890\nG2.11.0017"}
              />
            </label>
            <p className={styles.dica}>
              {totalCodigosColados > 0
                ? `${totalCodigosColados} código(s) colado(s).`
                : "Cole quantos códigos quiser."}
            </p>
          </div>
        )}

        <div className={styles.acoes}>
          <div className={styles.toggles}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={incluirInativos}
                onChange={(e) => setIncluirInativos(e.target.checked)}
              />
              Incluir produtos inativos
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={todoCadastro}
                onChange={(e) => setTodoCadastro(e.target.checked)}
              />
              Todo o cadastro (ignorar empresa)
            </label>
          </div>
          <button
            type="button"
            className={styles.btnPrimario}
            onClick={() => void buscar()}
            disabled={carregando}
          >
            {carregando ? "Buscando…" : "Buscar"}
          </button>
        </div>
      </section>

      {erro && <div className={styles.erroBox}>{erro}</div>}

      {naoEncontrados.length > 0 && (
        <div className={styles.avisoBox}>
          Não encontrados ({naoEncontrados.length}): {naoEncontrados.slice(0, 12).join(", ")}
          {naoEncontrados.length > 12 && "…"}
        </div>
      )}

      {resultado && (
        <section className={`${styles.card} ${styles.cardResultado}`}>
          <h2 className={styles.cardTitle}>Resultado</h2>
          <div className={styles.resumoLinha}>
            <strong>{resultado.aplicados}</strong> produto(s) alterado(s)
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
              <span className={styles.dica}>desfazer fica no histórico, no fim da página</span>
            </div>
          )}
          {resultado.erros.length > 0 && (
            <ul className={styles.listaErros}>
              {resultado.erros.slice(0, 40).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ─── ALTERAÇÃO ─── */}
      {buscouUmaVez && rows.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Alteração em massa</h2>

          <div className={styles.resumoLinha}>
            <strong>{rows.length.toLocaleString("pt-BR")}</strong> item(ns) carregado(s)
            {truncated && (
              <> (de {total.toLocaleString("pt-BR")} — lista cortada, refine os filtros)</>
            )}
          </div>

          <div className={styles.filtros}>
            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Campo a alterar</span>
              <select
                className={styles.select}
                value={campoAlvo}
                onChange={(e) => setCampoAlvo(e.target.value)}
              >
                <option value="">Escolha o campo…</option>
                {camposMassa.map((c) => (
                  <option key={c.campo} value={c.campo}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            {campoDef && (
              <label className={styles.campoTexto}>
                <span className={styles.campoLabel}>Valor novo</span>
                {campoDef.tipo === "bool" ? (
                  <select
                    className={styles.select}
                    value={novoValor ? "1" : "0"}
                    onChange={(e) => setNovoValor(e.target.value === "1")}
                  >
                    <option value="0">Não</option>
                    <option value="1">Sim</option>
                  </select>
                ) : campoDef.tipo === "dimensao" ? (
                  <select
                    className={styles.select}
                    value={String(novoValor ?? "")}
                    onChange={(e) => setNovoValor(e.target.value)}
                  >
                    <option value="">—</option>
                    {opcoesValorNovo.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={styles.input}
                    value={String(novoValor ?? "")}
                    onChange={(e) => setNovoValor(e.target.value)}
                    maxLength={campoDef.max}
                    inputMode={campoDef.tipo === "texto" ? undefined : "decimal"}
                  />
                )}
                {campoDef.nota && <span className={styles.campoNota}>{campoDef.nota}</span>}
              </label>
            )}

            {/* Mover de grupo pede o subgrupo de destino: a FK valida o PAR. Sem texto
                explicativo — o botão fica travado até escolher, o que já é a explicação. */}
            {movendoGrupo && (
              <label className={styles.campoTexto}>
                <span className={styles.campoLabel}>Subgrupo de destino *</span>
                <select
                  className={styles.select}
                  value={novoSubgrupo}
                  onChange={(e) => {
                    setNovoSubgrupo(e.target.value);
                    setSubgrupoTocado(true);
                  }}
                  disabled={!grupoDestino}
                >
                  <option value="">
                    {grupoDestino ? "escolha o subgrupo…" : "escolha o grupo primeiro"}
                  </option>
                  {subgruposDoDestino.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {campoDef?.campo === "SUBGRUPO_PRODUTO" && gruposNaSelecao.length > 1 && (
            <div className={styles.avisoBox}>
              A seleção tem {gruposNaSelecao.length} grupos diferentes. Como o par grupo + subgrupo é
              validado junto no Linx, a lista acima mostra só os subgrupos que existem em{" "}
              <strong>todos</strong> eles ({opcoesValorNovo.length} opção(ões)). Para mais liberdade,
              filtre por um grupo só — ou use o campo <strong>Grupo</strong>, que move o par inteiro.
            </div>
          )}

          {movendoGrupo && grupoDestino && subgruposDoDestino.length === 0 && (
            <div className={styles.avisoBox}>
              O grupo <strong>{grupoDestino}</strong> não tem nenhum subgrupo cadastrado, então não há
              par de destino possível. Crie um subgrupo nesse grupo na aba <strong>Dimensões</strong> da
              tela Alterar Cadastro.
            </div>
          )}


          {/* ─── distribuição dos valores atuais ─── */}
          {campoDef && distribuicao.length > 0 && (
            <>
              <p className={styles.dica}>
                Valores que os itens têm hoje nesse campo. Marque um ou mais para alterar{" "}
                <strong>só</strong> aqueles itens.
              </p>
              <div className={styles.impacto}>
                {(distribuicaoExpandida ? distribuicao : distribuicao.slice(0, LIMITE_DISTRIBUICAO)).map(
                  (d) => {
                    const marcado = valoresFiltro.includes(d.valor);
                    return (
                      <label key={d.valor} className={styles.check}>
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => {
                            setValoresFiltro((prev) =>
                              prev.includes(d.valor)
                                ? prev.filter((v) => v !== d.valor)
                                : [...prev, d.valor]
                            );
                            setVerTodosDetalhes(false);
                          }}
                        />
                        <span className={styles.impactoNumero}>{d.qtd.toLocaleString("pt-BR")}</span>{" "}
                        item(ns): {d.valor}
                      </label>
                    );
                  }
                )}
                {distribuicao.length > LIMITE_DISTRIBUICAO && (
                  <button
                    type="button"
                    className={styles.btnTexto}
                    onClick={() => setDistribuicaoExpandida((v) => !v)}
                  >
                    {distribuicaoExpandida
                      ? `mostrar só os ${LIMITE_DISTRIBUICAO} maiores`
                      : `… mais ${distribuicao.length - LIMITE_DISTRIBUICAO} valor(es)`}
                  </button>
                )}
              </div>

              <div className={styles.resumoLinha}>
                <strong>{selecionados.length.toLocaleString("pt-BR")}</strong> de{" "}
                {rowsFiltradas.length.toLocaleString("pt-BR")} marcado(s) ·{" "}
                <strong>{alteracoes.length.toLocaleString("pt-BR")}</strong> vão mudar de valor
                {filtroValorAtivo && (
                  <>
                    {" "}
                    · filtro de valor ativo
                    <button type="button" className={styles.btnTexto} onClick={() => setValoresFiltro([])}>
                      limpar filtro
                    </button>
                  </>
                )}
                {alteracoes.length < selecionados.length && (
                  <span className={styles.dica}>
                    ({(selecionados.length - alteracoes.length).toLocaleString("pt-BR")} já estão no valor)
                  </span>
                )}
                {desmarcados.length > 0 && (
                  <button type="button" className={styles.btnTexto} onClick={() => setDesmarcados([])}>
                    marcar todos de novo
                  </button>
                )}
              </div>

              <p className={styles.dica}>
                Desmarque na lista os itens que não devem mudar. Só os marcados entram na alteração —
                e a contagem, os grupos ofertados e o preview acompanham a seleção.
              </p>

              <div className={styles.tabelaWrap}>
                <table className={styles.tabelaFicha}>
                  <thead>
                    <tr>
                      <th className={styles.thCheck}>
                        <input
                          type="checkbox"
                          checked={todosMarcados}
                          onChange={() =>
                            // Marcar/desmarcar vale para TODOS os filtrados, não só os visíveis.
                            setDesmarcados(todosMarcados ? rowsFiltradas.map((r) => r.produto) : [])
                          }
                          aria-label="Marcar todos os produtos"
                        />
                      </th>
                      <th className={styles.thFichaNum}>#</th>
                      <th>Produto</th>
                      <th>Descrição</th>
                      <th>Grupo</th>
                      <th>Subgrupo</th>
                      <th>{campoDef.label} atual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(verTodosDetalhes ? rowsFiltradas : rowsFiltradas.slice(0, LIMITE_DETALHE)).map(
                      (r, i) => {
                        const marcado = !desmarcadosSet.has(r.produto);
                        return (
                          <tr
                            key={r.produto}
                            className={marcado ? styles.trAlterada : ""}
                            onClick={() => alternarProduto(r.produto)}
                          >
                            <td className={styles.thCheck}>
                              <input
                                type="checkbox"
                                checked={marcado}
                                onChange={() => alternarProduto(r.produto)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Marcar ${r.produto}`}
                              />
                            </td>
                            <td className={styles.thFichaNum}>{i + 1}</td>
                            <td className={styles.tdCodigo}>{r.produto}</td>
                            <td className={styles.tdDesc}>{String(r.valores.DESC_PRODUTO ?? "")}</td>
                            <td className={styles.tdDesc}>{String(r.valores.GRUPO_PRODUTO ?? "")}</td>
                            <td className={styles.tdDesc}>
                              {String(r.valores.SUBGRUPO_PRODUTO ?? "")}
                            </td>
                            <td className={styles.tdDesc}>
                              {textoValor(r.valores[campoDef.campo] ?? null)}
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              </div>

              {rowsFiltradas.length > LIMITE_DETALHE && (
                <p className={styles.dica}>
                  {verTodosDetalhes
                    ? `Mostrando todos os ${rowsFiltradas.length.toLocaleString("pt-BR")} itens.`
                    : `Mostrando os ${LIMITE_DETALHE} primeiros de ${rowsFiltradas.length.toLocaleString("pt-BR")}.`}
                  <button
                    type="button"
                    className={styles.btnTexto}
                    onClick={() => setVerTodosDetalhes((v) => !v)}
                  >
                    {verTodosDetalhes ? "mostrar menos" : "mostrar todos"}
                  </button>
                  O &quot;marcar todos&quot; do cabeçalho vale para os{" "}
                  {rowsFiltradas.length.toLocaleString("pt-BR")} filtrados, não só para os visíveis —
                  e a alteração vale para os {alteracoes.length.toLocaleString("pt-BR")} marcados.
                </p>
              )}

              <div className={styles.aplicarBar}>
                <span className={styles.campoLabel}>
                  {campoDef.label} →{" "}
                  {campoDef.tipo === "bool"
                    ? novoValor
                      ? "Sim"
                      : "Não"
                    : String(novoValor ?? "") || "—"}
                  {movendoGrupo && <> / {novoSubgrupo || "—"}</>}
                  {" · "}
                  {selecionados.length.toLocaleString("pt-BR")} item(ns) marcado(s)
                </span>
                <button
                  type="button"
                  className={styles.btnPrimario}
                  disabled={alteracoes.length === 0 || !podeExecutar}
                  onClick={() => {
                    setConfirmado(false);
                    setRevisando(true);
                  }}
                >
                  Revisar {alteracoes.length.toLocaleString("pt-BR")} alteração(ões)
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {buscouUmaVez && rows.length === 0 && !carregando && (
        <section className={styles.card}>
          <p className={styles.dica}>Nenhum produto encontrado com esses filtros.</p>
        </section>
      )}

      <CadastroHistorico
        companyKey={companyKey}
        username={username}
        podeExecutar={podeExecutar}
        recarregarEm={historicoVersao}
        onEstornado={() => void buscar({ manterResultado: true })}
      />

      {/* ─── PREVIEW ─── */}
      {revisando && campoDef && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.cardTitle}>Preview das alterações</h2>
            <p className={styles.modalAviso}>
              {movendoGrupo ? (
                <>
                  <strong>{alteracoes.length.toLocaleString("pt-BR")}</strong> produto(s) vão para{" "}
                  <strong>
                    {String(novoValor ?? "")} / {novoSubgrupo}
                  </strong>{" "}
                  no cadastro do Linx. Grupo e subgrupo são gravados juntos — a FK do Linx valida o
                  par.
                </>
              ) : (
                <>
                  <strong>{alteracoes.length.toLocaleString("pt-BR")}</strong> produto(s) vão ter{" "}
                  <strong>{campoDef.label}</strong> gravado como{" "}
                  <strong>
                    {campoDef.tipo === "bool" ? (novoValor ? "Sim" : "Não") : String(novoValor ?? "")}
                  </strong>{" "}
                  no cadastro do Linx.
                </>
              )}
            </p>

            <table className={styles.tabelaFicha}>
              <thead>
                <tr>
                  <th className={styles.thFichaNum}>#</th>
                  <th>Produto</th>
                  <th>{movendoGrupo ? "Grupo / subgrupo atual" : "Valor atual"}</th>
                  <th>{movendoGrupo ? "Grupo / subgrupo novo" : "Valor novo"}</th>
                </tr>
              </thead>
              <tbody>
                {alteracoes.slice(0, 200).map((a, i) => (
                  <tr key={a.produto}>
                    <td className={styles.thFichaNum}>{i + 1}</td>
                    <td className={styles.tdCodigo}>{a.produto}</td>
                    <td className={styles.tdDesc}>
                      {textoValor(a.atual)}
                      {movendoGrupo && <> / {a.subgrupoAtual || "—"}</>}
                    </td>
                    <td className={styles.tdDesc}>
                      <strong>
                        {campoDef.tipo === "bool" ? (a.novo ? "Sim" : "Não") : String(a.novo)}
                        {movendoGrupo && <> / {a.subgrupoNovo}</>}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {alteracoes.length > 200 && (
              <p className={styles.dica}>Mostrando os 200 primeiros de {alteracoes.length}.</p>
            )}

            <label className={styles.campoTexto}>
              <span className={styles.campoLabel}>Observação (fica no histórico)</span>
              <input
                className={styles.input}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                maxLength={300}
                placeholder="ex.: padronizando subgrupo das capas iPhone 17"
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
                {gravando ? "Gravando…" : `Aplicar ${alteracoes.length.toLocaleString("pt-BR")} alteração(ões)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
