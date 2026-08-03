"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import { useAuth } from "@/components/auth/AuthContext";

import styles from "./AlterarPrecosPage.module.css";

type CompanyKey = "nerd" | "scarfme";

interface CampoAlvo {
  key: string;
  origem: "PRODUTOS" | "PRODUTOS_PRECOS";
  campo: string;
  codigoTabela: string | null;
  label: string;
  espelho: string | null;
  avancado: boolean;
}

interface TabelaSelecionada {
  codigo: string;
  descricao: string;
  inativa: boolean;
  comRegistro: number;
}

interface Opcoes {
  filtros: {
    grupos: string[];
    subgrupos: string[];
    linhas: string[];
    colecoes: MultiSelectOption[];
    grades: string[];
    tipos: string[];
  };
  podeExecutar: boolean;
}

interface ProdutoRow {
  produto: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  colecao: string;
  grade: string;
  tipo: string;
  inativo: boolean;
  v: Array<number | null>;
  sr: number[];
}

interface Resposta {
  rows: ProdutoRow[];
  campos: CampoAlvo[];
  tabelas: TabelaSelecionada[];
  total: number;
  truncated: boolean;
  naoEncontrados: string[];
}

interface ResumoCampoExec {
  campoKey: string;
  label: string;
  codTabela: string | null;
  campo: string;
  aplicados: number;
  semMudanca: number;
  semRegistro: number;
  naoConfirmados: number;
}

interface Resultado {
  lote: string;
  aplicados: number;
  semMudanca: number;
  semRegistro: number;
  naoConfirmados: number;
  porCampo: ResumoCampoExec[];
  erros: string[];
}

interface HistoricoLote {
  lote: string;
  data: string;
  usuario: string;
  alteracoes: number;
  produtos: number;
  campos: string[];
  obs: string | null;
  reverteLote: string | null;
  revertidoPor: string | null;
}

type ModoSelecao = "filtros" | "codigos";

interface Props {
  companyKey: CompanyKey;
}

/** Linha da lista de tabelas de preço do produto — uma por slot (PRECO1..4). */
interface LinhaCusto {
  /** chave de ordenação do script: '00', '01', '01-P1', '01-P2', '02', … */
  ordem: string;
  cod: string;
  desc: string;
  /** coluna gravável do valor principal (Preço (1)) */
  campoKey: string;
  valor: number | null;
  /** coluna do Preço Líquido; ausente no cadastro, que não tem essa coluna no Linx */
  liquidoKey: string | null;
  liquido: number | null;
}

/** Linha da lista "TABELAS DISPONÍVEIS" do modo massa. */
interface LinhaTabela {
  campoKey: string;
  desc: string;
  tipo: string;
  cod: string;
  itens: number;
  media: number;
}

// ───────────────────────── helpers ─────────────────────────

function parseValor(texto: string): number | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  const normalizado = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function fmt(valor: number | null | undefined): string {
  const n = valor ?? 0;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mesmoValor(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.005;
}

function separarCodigos(texto: string): string[] {
  return texto
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// ───────────────────────── componente ─────────────────────────

export default function AlterarPrecosPage({ companyKey }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(true);
  const [erroOpcoes, setErroOpcoes] = useState<string | null>(null);

  // Filtros
  const [modoSelecao, setModoSelecao] = useState<ModoSelecao>("filtros");
  const [codigosTexto, setCodigosTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [grupos, setGrupos] = useState<string[]>([]);
  const [subgrupos, setSubgrupos] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<string[]>([]);
  const [colecoes, setColecoes] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [todoCadastro, setTodoCadastro] = useState(false);

  // Resultado
  const [rows, setRows] = useState<ProdutoRow[]>([]);
  const [campos, setCampos] = useState<CampoAlvo[]>([]);
  const [tabelas, setTabelas] = useState<TabelaSelecionada[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [naoEncontrados, setNaoEncontrados] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscouUmaVez, setBuscouUmaVez] = useState(false);

  // Modo individual (1 produto): linhas selecionadas + novo valor
  const [linhasSelecionadas, setLinhasSelecionadas] = useState<string[]>([]);
  const [novoValor, setNovoValor] = useState("");

  // Modo massa (vários produtos): tabelas escolhidas + novo valor.
  // O script só aceitava UMA tabela por vez; aqui dá para marcar quantas quiser.
  const [tabelasEscolhidas, setTabelasEscolhidas] = useState<string[]>([]);
  const [novoValorMassa, setNovoValorMassa] = useState("");
  const [detalhar, setDetalhar] = useState(false);

  /**
   * Por padrão a lista mostra o mesmo que a aba "Tabela de Preços" do Linx: só tabelas
   * ATIVAS e com valor. As inativas (09, 12, 14, 66, 98, 99…) e os slots zerados
   * (PRECO2..4) ficam escondidos até marcar esta opção.
   */
  const [mostrarZerados, setMostrarZerados] = useState(false);

  // Execução
  const [revisando, setRevisando] = useState(false);
  const [obs, setObs] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // Histórico
  const [historico, setHistorico] = useState<HistoricoLote[]>([]);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [revertendo, setRevertendo] = useState<string | null>(null);

  const podeExecutar = opcoes?.podeExecutar ?? false;
  const modoMassa = rows.length > 1;

  // ───────── opções ─────────

  useEffect(() => {
    if (!username) return;
    let cancelado = false;
    setCarregandoOpcoes(true);
    setErroOpcoes(null);
    (async () => {
      try {
        const params = new URLSearchParams({ company: companyKey });
        if (todoCadastro) params.set("todoCadastro", "1");
        if (incluirInativos) params.set("incluirInativos", "1");
        const res = await fetch(`/api/precos/opcoes?${params}`, {
          headers: { "x-auth-username": username },
          cache: "no-store",
        });
        const json = await res.json();
        if (cancelado) return;
        if (!res.ok) {
          setErroOpcoes(json?.error ?? "Erro ao carregar opções.");
          setOpcoes(null);
          return;
        }
        setOpcoes(json as Opcoes);
      } catch {
        if (!cancelado) setErroOpcoes("Não foi possível carregar as opções do cadastro.");
      } finally {
        if (!cancelado) setCarregandoOpcoes(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [companyKey, username, todoCadastro, incluirInativos]);

  const carregarHistorico = useCallback(async () => {
    if (!username) return;
    try {
      const res = await fetch(`/api/precos/historico?company=${companyKey}`, {
        headers: { "x-auth-username": username },
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = await res.json();
      setHistorico(Array.isArray(json?.lotes) ? json.lotes : []);
    } catch {
      /* histórico é acessório */
    }
  }, [companyKey, username]);

  useEffect(() => {
    void carregarHistorico();
  }, [carregarHistorico]);

  useEffect(() => {
    setRows([]);
    setCampos([]);
    setTabelas([]);
    setResultado(null);
    setBuscouUmaVez(false);
  }, [companyKey]);

  // ───────── busca ─────────

  const buscar = useCallback(
    async (opts: { manterResultado?: boolean } = {}) => {
      if (!username) return;
      setCarregando(true);
      setErro(null);
      if (!opts.manterResultado) setResultado(null);

      const montarBody = (avancados: boolean) =>
        modoSelecao === "codigos"
          ? {
              company: companyKey,
              codigos: separarCodigos(codigosTexto),
              incluirInativos,
              todoCadastro,
              incluirAvancados: avancados,
            }
          : {
              company: companyKey,
              busca: busca.trim() || null,
              grupos,
              subgrupos,
              linhas,
              colecoes,
              grades,
              tipos,
              incluirInativos,
              todoCadastro,
              incluirAvancados: avancados,
            };

      const pedir = async (avancados: boolean) => {
        const res = await fetch("/api/precos/produtos", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify(montarBody(avancados)),
        });
        const json = (await res.json()) as Resposta & { error?: string };
        return { ok: res.ok, json };
      };

      try {
        // Primeira passada leve. Se cair em UM produto, repete trazendo os slots 2–4
        // (é a lista completa que o script mostra); em lote eles não são usados.
        const primeira = await pedir(false);
        const { ok } = primeira;
        let json = primeira.json;
        if (ok && (json.rows ?? []).length === 1) {
          const completo = await pedir(true);
          if (completo.ok) json = completo.json;
        }
        if (!ok) {
          setErro(json?.error ?? "Erro ao buscar produtos.");
          return;
        }

        setRows(json.rows ?? []);
        setCampos(json.campos ?? []);
        setTabelas(json.tabelas ?? []);
        setTotal(json.total ?? 0);
        setTruncated(Boolean(json.truncated));
        setNaoEncontrados(json.naoEncontrados ?? []);
        setLinhasSelecionadas([]);
        setNovoValor("");
        setTabelasEscolhidas([]);
        setNovoValorMassa("");
        setDetalhar(false);
        setBuscouUmaVez(true);
      } catch {
        setErro("Falha de conexão ao buscar produtos.");
      } finally {
        setCarregando(false);
      }
    },
    [
      username, modoSelecao, companyKey, codigosTexto, busca, grupos, subgrupos,
      linhas, colecoes, grades, tipos, incluirInativos, todoCadastro,
    ]
  );

  // ───────── índices auxiliares ─────────

  const indicePorCampo = useMemo(() => {
    const mapa = new Map<string, number>();
    campos.forEach((c, i) => mapa.set(c.key, i));
    return mapa;
  }, [campos]);

  const valorDe = useCallback(
    (row: ProdutoRow, campoKey: string): number | null => {
      const i = indicePorCampo.get(campoKey);
      if (i === undefined || row.sr.includes(i)) return null;
      return row.v[i] ?? null;
    },
    [indicePorCampo]
  );

  const temRegistro = useCallback(
    (row: ProdutoRow, campoKey: string): boolean => {
      const i = indicePorCampo.get(campoKey);
      return i !== undefined && !row.sr.includes(i);
    },
    [indicePorCampo]
  );

  // ───────── lista "CUSTOS DISPONÍVEIS" (1 produto) ─────────

  const produtoUnico = rows.length === 1 ? rows[0] : null;

  const linhasCusto = useMemo<LinhaCusto[]>(() => {
    if (!produtoUnico) return [];
    const out: LinhaCusto[] = [];

    // Só tabelas de preço reais (PRODUTOS_PRECOS), um registro por slot PRECO1..4,
    // e apenas onde o produto realmente tem linha.
    for (const tabela of tabelas) {
      if (!mostrarZerados && tabela.inativa) continue;
      for (let n = 1; n <= 4; n += 1) {
        const campoKey = `T::${tabela.codigo}::PRECO${n}`;
        const liquidoKey = `T::${tabela.codigo}::PRECO_LIQUIDO${n}`;
        if (!indicePorCampo.has(campoKey)) continue;
        if (!temRegistro(produtoUnico, campoKey)) continue;
        const valor = valorDe(produtoUnico, campoKey);
        if (!mostrarZerados && (valor ?? 0) === 0) continue;
        out.push({
          ordem: `${tabela.codigo}-P${n}`,
          cod: tabela.codigo,
          desc: tabela.descricao,
          campoKey,
          valor,
          liquidoKey: indicePorCampo.has(liquidoKey) ? liquidoKey : null,
          liquido: valorDe(produtoUnico, liquidoKey),
        });
      }
    }

    out.sort((a, b) => a.ordem.localeCompare(b.ordem));
    return out;
  }, [produtoUnico, tabelas, indicePorCampo, valorDe, temRegistro, mostrarZerados]);

  const somaCustos = useMemo(
    () => linhasCusto.reduce((acc, l) => acc + (l.valor ?? 0), 0),
    [linhasCusto]
  );

  // ───────── lista "TABELAS DISPONÍVEIS" (vários produtos) ─────────

  const linhasTabela = useMemo<LinhaTabela[]>(() => {
    if (!modoMassa) return [];
    const out: LinhaTabela[] = [];

    const resumir = (campoKey: string) => {
      let itens = 0;
      let comValor = 0;
      let soma = 0;
      for (const row of rows) {
        if (!temRegistro(row, campoKey)) continue;
        itens += 1;
        const v = valorDe(row, campoKey) ?? 0;
        if (v !== 0) comValor += 1;
        soma += v;
      }
      return { itens, comValor, media: itens > 0 ? soma / itens : 0 };
    };

    for (const tabela of tabelas) {
      if (!mostrarZerados && tabela.inativa) continue;
      const campoKey = `T::${tabela.codigo}::PRECO1`;
      if (!indicePorCampo.has(campoKey)) continue;
      const { itens, comValor, media } = resumir(campoKey);
      if (itens === 0) continue;
      if (!mostrarZerados && comValor === 0) continue;
      out.push({ campoKey, desc: tabela.descricao, tipo: "PRECO1", cod: tabela.codigo, itens, media });
    }

    return out;
  }, [modoMassa, rows, tabelas, indicePorCampo, temRegistro, valorDe, mostrarZerados]);

  const tabelasAtuais = useMemo(
    () => linhasTabela.filter((t) => tabelasEscolhidas.includes(t.campoKey)),
    [linhasTabela, tabelasEscolhidas]
  );

  /** Distribuição de valores de cada tabela marcada (ex.: "80 itens: R$ 198,00"). */
  const distribuicoes = useMemo(() => {
    return tabelasAtuais.map((tabela) => {
      const mapa = new Map<number, number>();
      for (const row of rows) {
        if (!temRegistro(row, tabela.campoKey)) continue;
        const v = Math.round((valorDe(row, tabela.campoKey) ?? 0) * 100) / 100;
        mapa.set(v, (mapa.get(v) ?? 0) + 1);
      }
      const valores = [...mapa.entries()]
        .map(([valor, qtd]) => ({ valor, qtd }))
        .sort((a, b) => b.valor - a.valor);
      return { tabela, valores };
    });
  }, [tabelasAtuais, rows, temRegistro, valorDe]);

  // ───────── alterações pendentes ─────────

  const alteracoes = useMemo(() => {
    const lista: Array<{
      produto: string;
      campoKey: string;
      cod: string;
      desc: string;
      atual: number | null;
      novo: number;
    }> = [];

    if (produtoUnico) {
      const valor = parseValor(novoValor);
      if (valor === null) return lista;
      for (const linha of linhasCusto) {
        if (!linhasSelecionadas.includes(linha.ordem)) continue;
        const precisaLiquido =
          linha.liquidoKey !== null && !mesmoValor(linha.liquido, valor);
        if (mesmoValor(linha.valor, valor) && !precisaLiquido) continue;
        lista.push({
          produto: produtoUnico.produto,
          campoKey: linha.campoKey,
          cod: linha.cod,
          desc: linha.desc,
          atual: linha.valor,
          novo: valor,
        });
      }
      return lista;
    }

    const valor = parseValor(novoValorMassa);
    if (valor === null) return lista;
    for (const tabela of tabelasAtuais) {
      for (const row of rows) {
        if (!temRegistro(row, tabela.campoKey)) continue;
        const atual = valorDe(row, tabela.campoKey);
        if (mesmoValor(atual, valor)) continue;
        lista.push({
          produto: row.produto,
          campoKey: tabela.campoKey,
          cod: tabela.cod,
          desc: tabela.desc,
          atual,
          novo: valor,
        });
      }
    }
    return lista;
  }, [
    produtoUnico, novoValor, linhasCusto, linhasSelecionadas,
    tabelasAtuais, novoValorMassa, rows, temRegistro, valorDe,
  ]);

  // ───────── execução ─────────

  const executar = useCallback(async () => {
    if (!username || alteracoes.length === 0) return;
    setExecutando(true);
    setErro(null);
    try {
      const res = await fetch("/api/precos/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          company: companyKey,
          alteracoes: alteracoes.map((a) => ({ produto: a.produto, campoKey: a.campoKey, valor: a.novo })),
          // O script sempre gravava o Preço Líquido junto com o Preço; o cadastro não
          // tem coluna à vista equivalente, então esse espelho fica desligado.
          sincronizarPrecoLiquido: true,
          sincronizarPrecoAVista: false,
          obs: obs.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json?.error ?? "Erro ao aplicar as alterações.");
        return;
      }
      setResultado(json as Resultado);
      setRevisando(false);
      setConfirmado(false);
      setObs("");
      setNovoValor("");
      setNovoValorMassa("");
      setLinhasSelecionadas([]);
      void carregarHistorico();
      void buscar({ manterResultado: true });
    } catch {
      setErro("Falha de conexão ao aplicar as alterações.");
    } finally {
      setExecutando(false);
    }
  }, [username, alteracoes, companyKey, obs, carregarHistorico, buscar]);

  const reverter = useCallback(
    async (lote: string) => {
      if (!username) return;
      if (!window.confirm(`Desfazer o lote ${lote}? Os valores anteriores serão reaplicados.`)) return;
      setRevertendo(lote);
      setErro(null);
      try {
        const res = await fetch("/api/precos/reverter", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ company: companyKey, lote }),
        });
        const json = await res.json();
        if (!res.ok) {
          setErro(json?.error ?? "Erro ao desfazer o lote.");
          return;
        }
        setResultado(json as Resultado);
        void carregarHistorico();
        if (buscouUmaVez) void buscar({ manterResultado: true });
      } catch {
        setErro("Falha de conexão ao desfazer o lote.");
      } finally {
        setRevertendo(null);
      }
    },
    [username, companyKey, carregarHistorico, buscar, buscouUmaVez]
  );

  // ───────── render ─────────

  const totalCodigosColados = separarCodigos(codigosTexto).length;
  const todasLinhasMarcadas =
    linhasCusto.length > 0 && linhasCusto.every((l) => linhasSelecionadas.includes(l.ordem));
  const todasTabelasMarcadas =
    linhasTabela.length > 0 && linhasTabela.every((t) => tabelasEscolhidas.includes(t.campoKey));

  const alternarTabela = (campoKey: string) => {
    setTabelasEscolhidas((prev) =>
      prev.includes(campoKey) ? prev.filter((k) => k !== campoKey) : [...prev, campoKey]
    );
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Alterar Custo / Preço</h1>
        {/* Sem texto explicativo fixo. O aviso só aparece para quem não pode gravar,
            senão os botões desabilitados ficariam sem explicação. */}
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
          <>
            <div className={styles.filtros}>
              {(opcoes?.filtros.grupos.length ?? 0) > 0 && (
                <MultiSelectFilter label="Grupo" value={grupos} options={opcoes!.filtros.grupos} onChange={setGrupos} />
              )}
              {(opcoes?.filtros.subgrupos.length ?? 0) > 0 && (
                <MultiSelectFilter label="Subgrupo" value={subgrupos} options={opcoes!.filtros.subgrupos} onChange={setSubgrupos} />
              )}
              {(opcoes?.filtros.linhas.length ?? 0) > 0 && (
                <MultiSelectFilter label="Linha" value={linhas} options={opcoes!.filtros.linhas} onChange={setLinhas} />
              )}
              {(opcoes?.filtros.colecoes.length ?? 0) > 0 && (
                <MultiSelectFilter label="Coleção" value={colecoes} options={opcoes!.filtros.colecoes} onChange={setColecoes} />
              )}
              {(opcoes?.filtros.grades.length ?? 0) > 0 && (
                <MultiSelectFilter label="Grade" value={grades} options={opcoes!.filtros.grades} onChange={setGrades} />
              )}
              {(opcoes?.filtros.tipos.length ?? 0) > 0 && (
                <MultiSelectFilter label="Tipo" value={tipos} options={opcoes!.filtros.tipos} onChange={setTipos} />
              )}
              <label className={styles.campoTexto}>
                <span className={styles.campoLabel}>Nome ou código contém</span>
                <input
                  className={styles.input}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void buscar()}
                  placeholder="ex.: CAPA IPHONE 15"
                />
              </label>
            </div>
            {carregandoOpcoes && <p className={styles.dica}>Carregando dimensões do cadastro…</p>}
          </>
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
                placeholder={"N1.3.0018\n7891234567890\nG2.11.0017"}
              />
            </label>
            <p className={styles.dica}>
              {totalCodigosColados > 0
                ? `${totalCodigosColados} código(s). Um só abre a lista de custos; vários abrem o modo em massa.`
                : "Um código abre a lista de custos do produto; vários abrem o modo em massa."}
            </p>
          </div>
        )}

        <div className={styles.acoes}>
          <div className={styles.toggles}>
            <label className={styles.check}>
              <input type="checkbox" checked={incluirInativos} onChange={(e) => setIncluirInativos(e.target.checked)} />
              Incluir produtos inativos
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={todoCadastro} onChange={(e) => setTodoCadastro(e.target.checked)} />
              Todo o cadastro (ignorar empresa)
            </label>
          </div>
          <button type="button" className={styles.btnPrimario} onClick={() => void buscar()} disabled={carregando}>
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

      {/* ─── CUSTOS DISPONÍVEIS (1 produto) ─── */}
      {buscouUmaVez && produtoUnico && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Custos disponíveis</h2>
          <div className={styles.fichaHead}>
            <span className={styles.fichaProduto}>{produtoUnico.produto}</span>
            <span className={styles.fichaDesc}>{produtoUnico.descricao}</span>
            {produtoUnico.inativo && <span className={styles.badgeInativa}>inativo</span>}
          </div>
          <div className={styles.resumoLinha}>
            Total de registros: <strong>{linhasCusto.length}</strong> · Soma dos preços:{" "}
            <strong>R$ {fmt(somaCustos)}</strong>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={mostrarZerados}
                onChange={(e) => setMostrarZerados(e.target.checked)}
              />
              Mostrar tabelas inativas e zeradas
            </label>
          </div>

          <table className={styles.tabelaFicha}>
            <thead>
              <tr>
                <th className={styles.thCheck}>
                  <input
                    type="checkbox"
                    checked={todasLinhasMarcadas}
                    onChange={() =>
                      setLinhasSelecionadas(todasLinhasMarcadas ? [] : linhasCusto.map((l) => l.ordem))
                    }
                    aria-label="Selecionar todos os registros"
                  />
                </th>
                <th className={styles.thFichaNum}>#</th>
                <th>Cod.Tabela</th>
                <th>Descrição da Tabela</th>
                <th className={styles.thNum}>Preço (1)</th>
                <th className={styles.thNum}>Preço Líquido (1)</th>
              </tr>
            </thead>
            <tbody>
              {linhasCusto.map((linha, i) => {
                const marcada = linhasSelecionadas.includes(linha.ordem);
                return (
                  <tr key={linha.ordem} className={marcada ? styles.trAlterada : ""}>
                    <td className={styles.thCheck}>
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() =>
                          setLinhasSelecionadas((prev) =>
                            prev.includes(linha.ordem)
                              ? prev.filter((o) => o !== linha.ordem)
                              : [...prev, linha.ordem]
                          )
                        }
                        aria-label={`Selecionar registro ${i + 1}`}
                      />
                    </td>
                    <td className={styles.thFichaNum}>{i + 1}</td>
                    <td className={styles.tdCodigo}>{linha.cod}</td>
                    <td className={styles.tdDesc}>{linha.desc}</td>
                    <td className={styles.thNum}>{fmt(linha.valor)}</td>
                    <td className={styles.thNum}>{fmt(linha.liquido)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className={styles.aplicarBar}>
            <span className={styles.campoLabel}>
              Novo valor para os {linhasSelecionadas.length} registro(s) selecionado(s)
            </span>
            <input
              className={styles.inputValor}
              value={novoValor}
              onChange={(e) => setNovoValor(e.target.value)}
              placeholder="ex.: 148,00"
              inputMode="decimal"
            />
            <button
              type="button"
              className={styles.btnPrimario}
              disabled={alteracoes.length === 0 || !podeExecutar}
              onClick={() => {
                setConfirmado(false);
                setRevisando(true);
              }}
            >
              Revisar {alteracoes.length} alteração(ões)
            </button>
          </div>
        </section>
      )}

      {/* ─── MODO EM MASSA (vários produtos) ─── */}
      {buscouUmaVez && modoMassa && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Alteração em massa</h2>
          <div className={styles.resumoLinha}>
            <strong>{rows.length.toLocaleString("pt-BR")}</strong> itens carregados
            {truncated && ` (de ${total.toLocaleString("pt-BR")} — lista cortada, refine os filtros)`}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={mostrarZerados}
                onChange={(e) => setMostrarZerados(e.target.checked)}
              />
              Mostrar tabelas inativas e zeradas
            </label>
          </div>

          <p className={styles.dica}>
            Marque uma, várias ou todas as tabelas. O mesmo valor vai para todas as marcadas.
          </p>

          <table className={styles.tabelaFicha}>
            <thead>
              <tr>
                <th className={styles.thCheck}>
                  <input
                    type="checkbox"
                    checked={todasTabelasMarcadas}
                    onChange={() =>
                      setTabelasEscolhidas(todasTabelasMarcadas ? [] : linhasTabela.map((t) => t.campoKey))
                    }
                    aria-label="Marcar todas as tabelas"
                  />
                </th>
                <th className={styles.thFichaNum}>#</th>
                <th>Cod.Tabela</th>
                <th>Descrição da Tabela</th>
                <th>Campo</th>
                <th className={styles.thNum}>Itens</th>
                <th className={styles.thNum}>Média</th>
              </tr>
            </thead>
            <tbody>
              {linhasTabela.map((linha, i) => {
                const escolhida = tabelasEscolhidas.includes(linha.campoKey);
                return (
                  <tr
                    key={linha.campoKey}
                    className={escolhida ? styles.trAlterada : ""}
                    onClick={() => alternarTabela(linha.campoKey)}
                  >
                    <td className={styles.thCheck}>
                      <input
                        type="checkbox"
                        checked={escolhida}
                        onChange={() => alternarTabela(linha.campoKey)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Marcar ${linha.desc}`}
                      />
                    </td>
                    <td className={styles.thFichaNum}>{i + 1}</td>
                    <td className={styles.tdCodigo}>{linha.cod}</td>
                    <td className={styles.tdDesc}>{linha.desc}</td>
                    <td className={styles.tdCodigo}>{linha.tipo}</td>
                    <td className={styles.thNum}>{linha.itens.toLocaleString("pt-BR")}</td>
                    <td className={styles.thNum}>R$ {fmt(linha.media)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {tabelasAtuais.length > 0 && (
            <>
              {distribuicoes.map(({ tabela, valores }) => (
                <div key={tabela.campoKey} className={styles.distribuicao}>
                  <div className={styles.distribuicaoTitulo}>
                    TABELA: {tabela.desc} ({tabela.cod}) · {tabela.tipo}
                  </div>
                  {valores.slice(0, 8).map((d) => (
                    <div key={d.valor} className={styles.distribuicaoLinha}>
                      {d.qtd.toLocaleString("pt-BR")} itens: R$ {fmt(d.valor)}
                    </div>
                  ))}
                  {valores.length > 8 && (
                    <div className={styles.distribuicaoLinha}>… mais {valores.length - 8} valor(es)</div>
                  )}
                  <div className={styles.distribuicaoTotal}>
                    Total: {tabela.itens.toLocaleString("pt-BR")} itens
                  </div>
                </div>
              ))}

              <button type="button" className={styles.btnTexto} onClick={() => setDetalhar((v) => !v)}>
                {detalhar ? "ocultar lista detalhada" : "detalhar"}
              </button>

              {detalhar && (
                <div className={styles.tabelaWrap}>
                  <table className={styles.tabelaFicha}>
                    <thead>
                      <tr>
                        <th className={styles.thFichaNum}>#</th>
                        <th>Produto</th>
                        <th>Descrição</th>
                        {tabelasAtuais.map((t) => (
                          <th key={t.campoKey} className={styles.thNum}>
                            {t.cod} · {t.tipo}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.produto}>
                          <td className={styles.thFichaNum}>{i + 1}</td>
                          <td className={styles.tdCodigo}>{r.produto}</td>
                          <td className={styles.tdDesc}>{r.descricao}</td>
                          {tabelasAtuais.map((t) => (
                            <td key={t.campoKey} className={styles.thNum}>
                              {temRegistro(r, t.campoKey) ? `R$ ${fmt(valorDe(r, t.campoKey))}` : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className={styles.aplicarBar}>
                <span className={styles.campoLabel}>
                  Novo valor para {tabelasAtuais.length === 1 ? "a tabela marcada" : `as ${tabelasAtuais.length} tabelas marcadas`}
                </span>
                <input
                  className={styles.inputValor}
                  value={novoValorMassa}
                  onChange={(e) => setNovoValorMassa(e.target.value)}
                  placeholder="ex.: 868,00"
                  inputMode="decimal"
                />
                <button
                  type="button"
                  className={styles.btnPrimario}
                  disabled={alteracoes.length === 0 || !podeExecutar}
                  onClick={() => {
                    setConfirmado(false);
                    setRevisando(true);
                  }}
                >
                  Revisar {alteracoes.length} alteração(ões)
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {buscouUmaVez && rows.length === 0 && (
        <section className={styles.card}>
          <p className={styles.dica}>Nenhum produto encontrado com esses filtros.</p>
        </section>
      )}

      {/* ─── RESULTADO ─── */}
      {resultado && (
        <section className={`${styles.card} ${styles.cardResultado}`}>
          <h2 className={styles.cardTitle}>Resultado</h2>
          <div className={styles.resumoLinha}>
            <strong>{resultado.aplicados}</strong> alteração(ões) confirmada(s)
            {resultado.semMudanca > 0 && <> · {resultado.semMudanca} já estavam no valor</>}
            {resultado.semRegistro > 0 && <> · {resultado.semRegistro} sem registro</>}
            {resultado.naoConfirmados > 0 && (
              <> · <span className={styles.textoErro}>{resultado.naoConfirmados} não confirmada(s)</span></>
            )}
          </div>
          {resultado.lote && (
            <div className={styles.resumoLinha}>
              Lote <code className={styles.lote}>{resultado.lote}</code>
              {podeExecutar && (
                <button
                  type="button"
                  className={styles.btnTexto}
                  onClick={() => void reverter(resultado.lote)}
                  disabled={revertendo === resultado.lote}
                >
                  {revertendo === resultado.lote ? "Desfazendo…" : "Desfazer este lote"}
                </button>
              )}
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

      {/* ─── HISTÓRICO ─── */}
      <section className={styles.card}>
        <button type="button" className={styles.historicoToggle} onClick={() => setMostrarHistorico((v) => !v)}>
          {mostrarHistorico ? "▾" : "▸"} Histórico de alterações ({historico.length})
        </button>
        {mostrarHistorico && (
          <div className={styles.tabelaWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Alterações</th>
                  <th>Colunas</th>
                  <th>Observação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {historico.map((lote) => (
                  <tr key={lote.lote}>
                    <td className={styles.tdMeta}>
                      {dataCurta(lote.data)}
                      <span className={styles.tdMetaSub}>{lote.lote}</span>
                    </td>
                    <td>{lote.usuario}</td>
                    <td>
                      {lote.alteracoes} em {lote.produtos} produto(s)
                    </td>
                    <td className={styles.tdDesc}>{lote.campos.join(", ")}</td>
                    <td className={styles.tdDesc}>
                      {lote.reverteLote ? `Estorno de ${lote.reverteLote}` : lote.obs ?? "—"}
                    </td>
                    <td>
                      {lote.revertidoPor ? (
                        <span className={styles.dica}>desfeito</span>
                      ) : (
                        podeExecutar && (
                          <button
                            type="button"
                            className={styles.btnTexto}
                            onClick={() => void reverter(lote.lote)}
                            disabled={revertendo === lote.lote}
                          >
                            {revertendo === lote.lote ? "Desfazendo…" : "Desfazer"}
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
                {historico.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.dica}>
                      Nenhuma alteração registrada ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── PREVIEW ─── */}
      {revisando && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.cardTitle}>Preview das alterações</h2>
            <p className={styles.modalAviso}>
              {alteracoes.length} registro(s) serão alterados no cadastro do Linx. O Preço Líquido é gravado
              junto com o Preço, como no script.
            </p>

            <table className={styles.tabelaFicha}>
              <thead>
                <tr>
                  <th className={styles.thFichaNum}>#</th>
                  <th>Produto</th>
                  <th>Cod.Tabela</th>
                  <th>Descrição da Tabela</th>
                  <th className={styles.thNum}>Valor atual</th>
                  <th className={styles.thNum}>Valor novo</th>
                  <th className={styles.thNum}>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {alteracoes.slice(0, 200).map((a, i) => {
                  const dif = a.atual === null ? null : a.novo - a.atual;
                  return (
                    <tr key={`${a.produto}||${a.campoKey}`}>
                      <td className={styles.thFichaNum}>{i + 1}</td>
                      <td className={styles.tdCodigo}>{a.produto}</td>
                      <td className={styles.tdCodigo}>{a.cod}</td>
                      <td className={styles.tdDesc}>{a.desc}</td>
                      <td className={styles.thNum}>R$ {fmt(a.atual)}</td>
                      <td className={styles.thNum}>R$ {fmt(a.novo)}</td>
                      <td className={`${styles.thNum} ${dif !== null && dif < 0 ? styles.textoErro : ""}`}>
                        {dif === null ? "—" : `${dif > 0 ? "+" : "-"}R$ ${fmt(Math.abs(dif))}`}
                      </td>
                    </tr>
                  );
                })}
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
                placeholder="ex.: reajuste tabela ND fornecedor X"
                maxLength={300}
              />
            </label>

            <label className={styles.check}>
              <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
              Confirmo que revisei e quero gravar no Linx.
            </label>

            <div className={styles.modalAcoes}>
              <button type="button" className={styles.btnTexto} onClick={() => setRevisando(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className={styles.btnPerigo}
                disabled={!confirmado || executando || !podeExecutar}
                onClick={() => void executar()}
              >
                {executando ? "Aplicando…" : `Aplicar ${alteracoes.length} alteração(ões)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
