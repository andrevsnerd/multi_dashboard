"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatDateForQuery } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProjecaoCompraPage.module.css";

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Opção de um select de dimensão. */
interface Opcao {
  value: string;
  label: string;
}

/**
 * Produto escolhido na busca (chip). O escopo desta tela é por PRODUTO — todas as cores
 * entram e quem recorta cor é o filtro Cor —, então o chip guarda só código + descrição.
 */
interface ProdutoChip {
  id: string;
  name: string;
}

interface ProjecaoItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  codigoBarra: string;
  grade: string;
  subgrupo: string;
  colecao: string;
  janelas: Record<string, number>;
}

interface MensalItem {
  /** 'yyyy-MM' */
  mes: string;
  qtde: number;
  qtdeAnoAnterior: number;
  /** Mês em curso (fechado só até a data base) — não serve de base de crescimento. */
  parcial: boolean;
  futuro: boolean;
}

interface ProjecaoResponse {
  dataBase: string;
  windows: number[];
  metrica: Metrica;
  itens: ProjecaoItem[];
  /** Total do escopo por janela de dias, já com piso 0 (vale para as duas métricas). */
  totaisJanela: Record<string, number>;
  mensal: MensalItem[];
  /** Estoque atual do MESMO recorte (só saldos positivos) — vem do servidor, não das vendas. */
  estoqueTotal?: number;
  /** Itens (produto × cor) com estoque no recorte — usado como contagem do escopo. */
  estoqueItens?: number;
}

/**
 * O que a análise mede. `produtos` = unidades vendidas (visão de compra, com estoque,
 * sugestão e cobertura). `tickets` = contagem de vendas (visão de fluxo): as contas de
 * estoque não se aplicam, só ritmo e crescimento.
 */
type Metrica = "produtos" | "tickets";
const METRICAS: { key: Metrica; label: string }[] = [
  { key: "produtos", label: "Produtos" },
  { key: "tickets", label: "Tickets" },
];

/**
 * Regra que projeta os meses que ainda não aconteceram.
 *
 * `yoy` (padrão) = regra comparativa: mede quanto cada mês FECHADO cresceu contra o mesmo mês
 * do ano anterior, tira a média desses percentuais e aplica essa média sobre o valor do ano
 * anterior de cada mês futuro. As outras regras extrapolam o ritmo de uma janela de dias.
 */
type RegraProjecao = "yoy" | "30" | "60" | "90" | "120" | "365";
/** Ordem do select — YoY primeiro (padrão), depois as janelas de dias. */
const REGRAS: RegraProjecao[] = ["yoy", "60", "365", "120", "90", "30"];
const REGRA_LABEL: Record<RegraProjecao, string> = {
  yoy: "Crescimento YoY",
  "60": "Ritmo 60 dias",
  "365": "Ritmo 12 meses",
  "120": "Ritmo 120 dias",
  "90": "Ritmo 90 dias",
  "30": "Ritmo 30 dias",
};

/**
 * Escopo JÁ APLICADO (o que gerou os números na tela). A projeção não roda a cada clique de
 * filtro: o usuário monta o recorte e manda gerar. Isso evita disparar consulta pesada a cada
 * item marcado — e "Selecionar tudo" marca centenas de uma vez.
 */
interface PedidoProjecao {
  dataBase: string;
  metrica: Metrica;
  dims: DimState;
  produtos: string[];
}

/**
 * Teto de itens no recorte. Cada produto/valor de filtro viaja na URL e vira um parâmetro no
 * SQL Server; passando disso a requisição nem chega ao servidor (HTTP 431).
 */
const MAX_RECORTES = 600;

/** Janelas de ritmo que a API mede (as mesmas que o select oferece). */
const WINDOWS_DIAS = [30, 60, 90, 120, 365] as const;

// ── Filtros de cadastro: um select por dimensão, como no Gerador de Relatórios.
//    O nome da chave é também o nome do parâmetro da API (?grupo=&subgrupo=…).
type DimKey = "grupo" | "linha" | "subgrupo" | "grade" | "colecao" | "cor" | "tipo";
const DIM_KEYS: DimKey[] = ["grupo", "linha", "subgrupo", "grade", "colecao", "cor", "tipo"];
const DIM_LABEL: Record<DimKey, string> = {
  grupo: "Grupo",
  linha: "Linha",
  subgrupo: "Subgrupo",
  grade: "Grade",
  colecao: "Coleção",
  cor: "Cor",
  tipo: "Tipo",
};
/** Endpoint de opções de cada dimensão (os mesmos que o Gerador de Relatórios usa). */
const DIM_ENDPOINT: Record<DimKey, string> = {
  grupo: "grupos",
  linha: "linhas",
  subgrupo: "subgrupos",
  grade: "grades",
  colecao: "colecoes",
  cor: "cores",
  tipo: "tipos",
};
type DimState = Record<DimKey, string[]>;
const EMPTY_DIMS: DimState = {
  grupo: [],
  linha: [],
  subgrupo: [],
  grade: [],
  colecao: [],
  cor: [],
  tipo: [],
};
const EMPTY_DIM_OPTIONS: Record<DimKey, Opcao[]> = {
  grupo: [],
  linha: [],
  subgrupo: [],
  grade: [],
  colecao: [],
  cor: [],
  tipo: [],
};

// ─── Formatação ──────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function fmtDec(n: number, dec = 2): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function rowKey(produto: string, cor: string | null | undefined): string {
  return `${produto}||${(cor ?? "").trim()}`;
}
/** Hoje no calendário local, como 'yyyy-MM-dd'. */
function todayYmd(): string {
  return formatDateForQuery(new Date());
}
/** 31 de dezembro do ano da data base. */
function endOfYearYmd(baseYmd: string): string {
  const year = Number(baseYmd.slice(0, 4)) || new Date().getFullYear();
  return `${year}-12-31`;
}
/** Diferença em dias entre duas datas 'yyyy-MM-dd' (b − a). */
function diffDays(aYmd: string, bYmd: string): number {
  const [ay, am, ad] = aYmd.split("-").map(Number);
  const [by, bm, bd] = bYmd.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}
/** Data base + N dias, formatada dd/MM/yyyy. */
function addDaysFormatted(baseYmd: string, days: number): string {
  const [y, m, d] = baseYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getUTCFullYear()}`;
}
function ymdToBr(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
/** Quantos dias tem o mês (1-12) daquele ano. */
function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}
const MES_NOME = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];
function fmtPct(v: number | null, dec = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
}

/** Janela de 12 meses até hoje — o universo desta tela (opções e picker). */
function janela12Meses(): { start: string; end: string } {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 365);
  return { start: formatDateForQuery(start), end: formatDateForQuery(today) };
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface Props {
  companyKey: CompanyKey;
}

export default function ProjecaoCompraPage({ companyKey }: Props) {
  const [dataBase, setDataBase] = useState<string>(todayYmd);
  const [venderAte, setVenderAte] = useState<string>(() => endOfYearYmd(todayYmd()));

  const [dims, setDims] = useState<DimState>(EMPTY_DIMS);
  const [dimOptions, setDimOptions] = useState<Record<DimKey, Opcao[]>>(EMPTY_DIM_OPTIONS);
  // Já nasce carregando: o efeito abaixo dispara na montagem e só desliga por dimensão.
  const [dimLoading, setDimLoading] = useState<Partial<Record<DimKey, boolean>>>(() =>
    Object.fromEntries(DIM_KEYS.map((dim) => [dim, true]))
  );
  /**
   * Seleção manual = códigos de PRODUTO (todas as cores; quem recorta cor é o filtro Cor).
   * Busca sob demanda, igual ao Gerador de Relatórios: nada de baixar o catálogo inteiro
   * para filtrar no cliente — o usuário digita, o servidor devolve, o item vira chip.
   */
  const [produtoChips, setProdutoChips] = useState<ProdutoChip[]>([]);
  const [produtoQuery, setProdutoQuery] = useState("");
  const [produtoResults, setProdutoResults] = useState<ProdutoChip[]>([]);
  const [produtoBuscando, setProdutoBuscando] = useState(false);
  const [produtoOpen, setProdutoOpen] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Colar lista de códigos (código de barra interno ou código do produto) — mesmo campo do
  // Gerador de Relatórios, resolvido em lote numa requisição só.
  const [codigosColados, setCodigosColados] = useState("");
  const [resolvendoCodigos, setResolvendoCodigos] = useState(false);
  const [avisoCodigos, setAvisoCodigos] = useState<string | null>(null);

  // Projeção (unidades vendidas por janela) — vem do endpoint dedicado.
  const [metrica, setMetrica] = useState<Metrica>("produtos");
  const [pedido, setPedido] = useState<PedidoProjecao | null>(null);
  const [projItens, setProjItens] = useState<Record<string, ProjecaoItem>>({});
  const [totaisJanela, setTotaisJanela] = useState<Record<string, number>>({});
  /** Estoque do escopo APLICADO, como o servidor mediu (total + nº de itens produto × cor). */
  const [estoqueEscopo, setEstoqueEscopo] = useState<{ total: number; itens: number }>({
    total: 0,
    itens: 0,
  });
  const [mensal, setMensal] = useState<MensalItem[]>([]);
  const [projLoading, setProjLoading] = useState(false);
  const [projErro, setProjErro] = useState<string | null>(null);
  const [regra, setRegra] = useState<RegraProjecao>("yoy");

  // Overrides editáveis (amarelos da planilha).
  const [estoqueOverride, setEstoqueOverride] = useState<number | null>(null);
  const [qtdOverride, setQtdOverride] = useState<Record<string, number | null>>({});

  // ── Opções dos selects: um por dimensão, carregadas de uma vez (mesmos endpoints do
  //    Gerador de Relatórios), na janela de 12 meses que é o universo desta tela. Ficam
  //    prontas na hora, sem depender do dataset pesado do picker.
  useEffect(() => {
    let cancelled = false;
    const { start, end } = janela12Meses();

    DIM_KEYS.forEach((dim) => {
      const params = new URLSearchParams({ company: companyKey });
      // Cor sai do estoque/cadastro e não aceita período (ver /api/products/cores).
      if (dim !== "cor") {
        params.set("start", start);
        params.set("end", end);
      }
      // Coleção: rótulo "DESCRIÇÃO (CÓDIGO)" com o value sendo o código.
      if (dim === "colecao") params.set("includeDescriptions", "1");

      fetch(`/api/products/${DIM_ENDPOINT[dim]}?${params.toString()}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { data?: Array<string | Opcao> }) => {
          if (cancelled) return;
          const options = (json.data ?? [])
            .map((item) =>
              typeof item === "string" ? { value: item, label: item } : { value: item.value, label: item.label }
            )
            .filter((opt) => opt.value);
          setDimOptions((prev) => ({ ...prev, [dim]: options }));
        })
        .catch(() => {
          if (!cancelled) setDimOptions((prev) => ({ ...prev, [dim]: [] }));
        })
        .finally(() => {
          if (!cancelled) setDimLoading((prev) => ({ ...prev, [dim]: false }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [companyKey]);

  // ── Busca de produto (mesma do Gerador de Relatórios): consulta o cadastro por nome,
  //    código do produto ou código de barra, com debounce. Sem catálogo pré-carregado.
  const runSearch = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setProdutoResults([]);
      setProdutoBuscando(false);
      return;
    }
    setProdutoBuscando(true);
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(term.trim())}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setProdutoResults([]);
        return;
      }
      const json = (await res.json()) as {
        data?: Array<{ productId: string; productName: string }>;
      };
      // PRODUTO/DESC_PRODUTO são CHAR no Linx: chegam com espaço à direita.
      setProdutoResults(
        (json.data ?? [])
          .map((p) => ({ id: (p.productId ?? "").trim(), name: (p.productName ?? "").trim() }))
          .filter((p) => p.id)
      );
    } catch {
      setProdutoResults([]);
    } finally {
      setProdutoBuscando(false);
    }
  }, []);

  const onProdutoQueryChange = (value: string) => {
    setProdutoQuery(value);
    setProdutoOpen(true);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (value.trim().length < 2) {
      setProdutoResults([]);
      setProdutoBuscando(false);
      return;
    }
    setProdutoBuscando(true);
    searchDebounce.current = setTimeout(() => void runSearch(value), 300);
  };

  useEffect(() => () => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
  }, []);

  /** Escolher um resultado ACUMULA como chip e deixa a busca livre para o próximo item. */
  const addProdutoChip = (p: ProdutoChip) => {
    setProdutoChips((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setProdutoQuery("");
    setProdutoResults([]);
  };

  const removeProdutoChip = (id: string) =>
    setProdutoChips((prev) => prev.filter((x) => x.id !== id));

  /**
   * Resolve em LOTE os códigos colados (código de barra interno OU código do produto) e
   * adiciona como chips. Código que não casou é mostrado na tela — colar 11 códigos e
   * receber 9 itens sem aviso seria pior que o erro.
   */
  const adicionarCodigosColados = useCallback(async () => {
    const codigos = codigosColados
      .split(/[\s,;]+/g)
      .map((c) => c.trim())
      .filter(Boolean);
    if (codigos.length === 0) {
      setAvisoCodigos("Cole pelo menos um código.");
      return;
    }
    setResolvendoCodigos(true);
    setAvisoCodigos(null);
    try {
      const res = await fetch("/api/relatorios/resolver-produtos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigos }),
      });
      const json = (await res.json()) as {
        itens?: Array<{ produto: string; descricao: string }>;
        naoEncontrados?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(json?.error || "Erro ao resolver os códigos");

      const itens = json.itens ?? [];
      // O escopo é por PRODUTO: dois códigos de barra do mesmo produto viram um chip só.
      let adicionados = 0;
      setProdutoChips((prev) => {
        const existentes = new Set(prev.map((c) => c.id));
        const novos: ProdutoChip[] = [];
        for (const it of itens) {
          const id = String(it.produto ?? "").trim();
          if (!id || existentes.has(id)) continue;
          existentes.add(id);
          novos.push({ id, name: String(it.descricao ?? "").trim() || id });
        }
        adicionados = novos.length;
        return novos.length > 0 ? [...prev, ...novos] : prev;
      });

      const naoEncontrados = json.naoEncontrados ?? [];
      const partes: string[] = [];
      if (adicionados > 0) partes.push(`${adicionados} produto(s) adicionado(s)`);
      if (naoEncontrados.length > 0) {
        const lista = naoEncontrados.slice(0, 10).join(", ");
        partes.push(
          `${naoEncontrados.length} não reconhecido(s): ${lista}${naoEncontrados.length > 10 ? "…" : ""}`
        );
      }
      setAvisoCodigos(partes.join(" · ") || "Nenhum código novo.");
      if (naoEncontrados.length === 0) setCodigosColados("");
    } catch (e) {
      setAvisoCodigos(e instanceof Error ? e.message : "Erro ao resolver os códigos");
    } finally {
      setResolvendoCodigos(false);
    }
  }, [codigosColados]);

  // Fecha o dropdown de busca ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!produtoOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setProdutoOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProdutoOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [produtoOpen]);

  /** Rótulo bonito da coleção ("DESCRIÇÃO (CÓDIGO)") para os chips. */
  const colecaoLabels = useMemo(() => {
    const map = new Map<string, string>();
    dimOptions.colecao.forEach((opt) => map.set(opt.value, opt.label));
    return map;
  }, [dimOptions.colecao]);

  const dimChipLabel = (dim: DimKey, value: string) =>
    dim === "colecao" ? colecaoLabels.get(value) ?? value : value;

  // ── Escopo ────────────────────────────────────────────────────────────────
  const dimFiltradas = useMemo(() => DIM_KEYS.filter((dim) => dims[dim].length > 0), [dims]);
  const temDimensao = dimFiltradas.length > 0;
  const temSelecao = produtoChips.length > 0;
  /**
   * Há recorte montado na barra de filtros (ainda não necessariamente gerado). Sem recorte a
   * projeção continua valendo: é o TOTAL DA REDE, o número contra o qual se compara o recorte.
   */
  const temEscopo = temSelecao || temDimensao;
  /** Já existe projeção na tela. */
  const gerado = pedido !== null;

  const produtosSelecionados = useMemo(
    () => produtoChips.map((c) => c.id).sort(),
    [produtoChips]
  );
  const totalRecortes =
    produtosSelecionados.length + DIM_KEYS.reduce((soma, dim) => soma + dims[dim].length, 0);

  /** Assinatura do recorte, para saber se mudou algo desde a última geração. */
  const assinaturaAtual = useMemo(
    () => JSON.stringify({ dataBase, metrica, dims, produtos: produtosSelecionados }),
    [dataBase, metrica, dims, produtosSelecionados]
  );
  const assinaturaGerada = useMemo(
    () =>
      pedido
        ? JSON.stringify({
            dataBase: pedido.dataBase,
            metrica: pedido.metrica,
            dims: pedido.dims,
            produtos: pedido.produtos,
          })
        : null,
    [pedido]
  );
  const pendente = assinaturaAtual !== assinaturaGerada;

  const gerarProjecao = () => {
    setPedido({ dataBase, metrica, dims, produtos: produtosSelecionados });
  };

  // ── Busca a projeção do escopo APLICADO (só roda quando o usuário manda gerar).
  //    venderAte, Qtd Compra e a regra são puro cálculo no cliente (não vão ao servidor).
  useEffect(() => {
    if (!pedido) return;
    const recortes =
      pedido.produtos.length + DIM_KEYS.reduce((soma, dim) => soma + pedido.dims[dim].length, 0);
    if (recortes > MAX_RECORTES) {
      setProjItens({});
      setTotaisJanela({});
      setMensal([]);
      setEstoqueEscopo({ total: 0, itens: 0 });
      setProjErro(
        `Escopo muito amplo: ${fmt(recortes)} itens no recorte (limite ${fmt(MAX_RECORTES)}). ` +
          `Selecionar tudo de uma dimensão equivale a não filtrar por ela — deixe o filtro em "Todos".`
      );
      return;
    }
    // Filtros de cadastro e seleção de produto se SOMAM no SQL: o produto restringe os
    // códigos, o filtro Cor (quando marcado) restringe as cores. Sem filtro de Cor, o
    // servidor devolve todas as cores do produto e a tela soma.
    const params = new URLSearchParams({
      company: companyKey,
      base: pedido.dataBase,
      metrica: pedido.metrica,
    });
    DIM_KEYS.forEach((dim) => pedido.dims[dim].forEach((v) => params.append(dim, v)));
    pedido.produtos.forEach((produto) => params.append("produto", produto));

    let cancelled = false;
    setProjLoading(true);
    setProjErro(null);
    fetch(`/api/projecao-compra?${params.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json()) as ProjecaoResponse & { error?: string };
        if (!r.ok) throw new Error(json?.error || "Erro ao calcular a projeção");
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        const next: Record<string, ProjecaoItem> = {};
        (json.itens ?? []).forEach((it) => {
          next[rowKey(it.produto, it.cor)] = it;
        });
        setProjItens(next);
        setTotaisJanela(json.totaisJanela ?? {});
        setMensal(Array.isArray(json.mensal) ? json.mensal : []);
        setEstoqueEscopo({
          total: Math.max(0, Number(json.estoqueTotal ?? 0) || 0),
          itens: Math.max(0, Number(json.estoqueItens ?? 0) || 0),
        });
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setProjItens({});
        setTotaisJanela({});
        setMensal([]);
        setEstoqueEscopo({ total: 0, itens: 0 });
        setProjErro(error.message || "Erro ao calcular a projeção");
      })
      .finally(() => {
        if (!cancelled) setProjLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey, pedido]);

  // Gerar de novo zera os ajustes manuais (a base de cálculo mudou).
  useEffect(() => {
    setEstoqueOverride(null);
    setQtdOverride({});
  }, [pedido]);

  // ── Produtos do escopo APLICADO: descrição, código e nº de cores. Sai das linhas que o
  //    servidor devolveu (produto × cor), que já são exatamente o recorte gerado.
  const selectedItems = useMemo(() => {
    const porProduto = new Map<
      string,
      { produto: string; descricao: string; codigoBarra: string; grade: string; cores: number }
    >();
    Object.values(projItens).forEach((it) => {
      const atual = porProduto.get(it.produto);
      if (atual) {
        atual.cores += 1;
        if (!atual.codigoBarra && it.codigoBarra) atual.codigoBarra = it.codigoBarra;
        if (!atual.grade && it.grade) atual.grade = it.grade;
        return;
      }
      porProduto.set(it.produto, {
        produto: it.produto,
        descricao: it.descricao || it.produto,
        codigoBarra: it.codigoBarra ?? "",
        grade: it.grade ?? "",
        cores: 1,
      });
    });
    return Array.from(porProduto.values()).sort((a, b) =>
      a.descricao.localeCompare(b.descricao, "pt-BR")
    );
  }, [projItens]);

  // ── Agregado do escopo: estoque somado + unidades vendidas somadas por janela.
  //    O servidor já devolve exatamente o escopo (produtos × filtros), então soma-se TUDO.
  const agregado = useMemo(() => {
    // O total por janela vem pronto do servidor (já com piso 0 no TOTAL, não por item — ver
    // [[vendas-nunca-filtrar-linhas-da-regra-global]]) e serve às duas métricas.
    const unidades: Record<number, number> = {};
    WINDOWS_DIAS.forEach((dias) => {
      unidades[dias] = Number(totaisJanela[String(dias)] ?? 0) || 0;
    });
    // Estoque do MESMO recorte, medido no servidor (só saldos positivos — negativo nunca
    // conta). A contagem de itens usa o maior entre quem tem estoque e quem teve venda.
    const estoqueSomado = estoqueEscopo.total;
    const itens = Math.max(estoqueEscopo.itens, Object.keys(projItens).length);
    return { estoqueSomado, unidades, itens };
  }, [totaisJanela, projItens, estoqueEscopo]);

  const estoqueAtual = estoqueOverride ?? agregado.estoqueSomado;
  const diasHorizonte = Math.max(0, diffDays(dataBase, venderAte));
  const anoBase = Number(dataBase.slice(0, 4));

  // ── Regra comparativa (crescimento YoY) ───────────────────────────────────
  // Quanto cada mês FECHADO deste ano cresceu contra o mesmo mês do ano anterior; a média
  // desses percentuais é o crescimento provável aplicado aos meses que faltam.
  // Ficam fora: mês em curso (parcial, comparação injusta) e mês sem base no ano anterior.
  const crescimento = useMemo(() => {
    const comparaveis = mensal.filter((m) => !m.futuro && !m.parcial && m.qtdeAnoAnterior > 0);
    if (comparaveis.length === 0) return { media: null as number | null, meses: [] as string[] };
    const taxas = comparaveis.map((m) => m.qtde / m.qtdeAnoAnterior - 1);
    return {
      media: taxas.reduce((a, b) => a + b, 0) / taxas.length,
      meses: comparaveis.map((m) => m.mes),
    };
  }, [mensal]);

  /** Ritmo diário de uma janela de dias (para as regras que não são YoY). */
  const ritmoDiaJanela = useCallback(
    (dias: number) => (dias > 0 ? (agregado.unidades[dias] ?? 0) / dias : 0),
    [agregado.unidades]
  );

  // Valor de cada mês do ano da data base: realizado (mês fechado) e projetado pela regra.
  const serieMes = useMemo(() => {
    const g = crescimento.media;
    const map = new Map<string, { realizado: number | null; projetado: number | null }>();
    mensal.forEach((m) => {
      const mesNum = Number(m.mes.slice(5, 7));
      const projetado =
        regra === "yoy"
          ? g == null
            ? null
            : m.qtdeAnoAnterior * (1 + g)
          : ritmoDiaJanela(Number(regra)) * diasNoMes(anoBase, mesNum);
      map.set(m.mes, { realizado: m.futuro ? null : m.qtde, projetado });
    });
    return map;
  }, [mensal, crescimento.media, regra, ritmoDiaJanela, anoBase]);

  /**
   * Valor CHEIO de um mês pela regra YoY, para acumular o horizonte. Um mês do ano seguinte
   * usa o mês correspondente do ano da base (realizado ou projetado) e aplica o crescimento
   * outra vez — é a mesma regra, só encadeada.
   */
  const valorMesYoY = useCallback(
    (ano: number, mes: number): number => {
      const g = crescimento.media;
      if (g == null) return 0;
      let ciclos = ano - anoBase;
      if (ciclos < 0) return 0;
      const info = mensal.find((m) => m.mes === `${anoBase}-${String(mes).padStart(2, "0")}`);
      if (!info) return 0;
      const projetadoAnoBase = info.qtdeAnoAnterior * (1 + g);
      // Mês fechado vale o realizado; mês em curso vale o maior entre o já vendido e a
      // projeção do mês cheio; mês futuro vale a projeção.
      let valor = info.futuro
        ? projetadoAnoBase
        : info.parcial
        ? Math.max(info.qtde, projetadoAnoBase)
        : info.qtde;
      while (ciclos > 0) {
        valor *= 1 + g;
        ciclos -= 1;
      }
      return valor;
    },
    [crescimento.media, mensal, anoBase]
  );

  /** Unidades projetadas pela regra YoY entre a data base e "Vender até" (pro-rata no mês). */
  const projecaoHorizonte = useMemo(() => {
    if (diasHorizonte <= 0 || crescimento.media == null) return 0;
    let total = 0;
    let ano = anoBase;
    let mes = Number(dataBase.slice(5, 7));
    let dia = Number(dataBase.slice(8, 10));
    let restantes = diasHorizonte;
    for (let guard = 0; restantes > 0 && guard < 48; guard += 1) {
      const dm = diasNoMes(ano, mes);
      const usados = Math.min(restantes, dm - dia + 1);
      total += valorMesYoY(ano, mes) * (usados / dm);
      restantes -= usados;
      dia = 1;
      if (mes === 12) {
        ano += 1;
        mes = 1;
      } else {
        mes += 1;
      }
    }
    return total;
  }, [diasHorizonte, crescimento.media, anoBase, dataBase, valorMesYoY]);

  // ── A ÚNICA linha da tabela de giro: a regra escolhida no select.
  //    YoY mede o horizonte inteiro pela regra comparativa; as outras extrapolam a janela.
  const linhaAtiva = useMemo(() => {
    const yoy = regra === "yoy";
    const disponivel = yoy ? crescimento.media != null && diasHorizonte > 0 : true;
    const dias = yoy ? diasHorizonte : Number(regra);
    const un = yoy ? (disponivel ? projecaoHorizonte : 0) : agregado.unidades[dias] ?? 0;
    const ritmoDia = dias > 0 ? un / dias : 0;
    const sugestao = disponivel ? Math.max(0, Math.ceil(ritmoDia * diasHorizonte - estoqueAtual)) : 0;
    const qtd = qtdOverride[regra] ?? sugestao;
    const cobertura = ritmoDia > 0 ? (estoqueAtual + qtd) / ritmoDia : null;
    const duraAte = cobertura !== null ? addDaysFormatted(dataBase, Math.round(cobertura)) : null;
    return {
      yoy,
      disponivel,
      dias,
      un: Math.round(un),
      ritmoDia,
      ritmoMes: ritmoDia * 30,
      sugestao,
      qtd,
      cobertura,
      duraAte,
      editado: qtdOverride[regra] != null && qtdOverride[regra] !== sugestao,
    };
  }, [
    regra,
    crescimento.media,
    diasHorizonte,
    projecaoHorizonte,
    agregado.unidades,
    estoqueAtual,
    qtdOverride,
    dataBase,
  ]);

  // ── Tabela de vendas por mês (ano todo: realizado + projeção) ─────────────
  const mensalRows = useMemo(
    () =>
      mensal.map((m) => {
        const projetado = serieMes.get(m.mes)?.projetado ?? null;
        const valorAno = m.futuro
          ? projetado ?? 0
          : m.parcial
          ? Math.max(m.qtde, projetado ?? 0)
          : m.qtde;
        // Célula: mês fechado mostra o realizado; mês futuro e o mês EM CURSO mostram a
        // projeção do mês cheio (comparar 2 dias corridos com um mês inteiro do ano anterior
        // não diz nada). No mês em curso o valor é `valorAno`, o mesmo que entra no total, para
        // a linha fechar com a coluna Total.
        const valorCelula = m.futuro ? projetado : m.parcial ? valorAno : m.qtde;
        const pctSobreAnoAnterior =
          m.qtdeAnoAnterior > 0 && valorCelula != null ? valorCelula / m.qtdeAnoAnterior - 1 : null;
        return {
          ...m,
          projetado,
          valorAno,
          pctSobreAnoAnterior,
          usadoNaMedia: !m.futuro && !m.parcial && m.qtdeAnoAnterior > 0,
        };
      }),
    [mensal, serieMes]
  );

  const mensalTotais = useMemo(() => {
    const anoAnterior = mensalRows.reduce((s, r) => s + r.qtdeAnoAnterior, 0);
    const realizado = mensalRows.reduce((s, r) => s + (r.futuro ? 0 : r.qtde), 0);
    const ano = mensalRows.reduce((s, r) => s + r.valorAno, 0);
    return {
      anoAnterior,
      realizado,
      ano,
      variacao: anoAnterior > 0 ? ano / anoAnterior - 1 : null,
    };
  }, [mensalRows]);

  /** Chips da barra de filtros: refletem a seleção ao vivo, não o que já foi gerado. */
  const chipsProdutos = useMemo(
    () => [...produtoChips].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [produtoChips]
  );

  /** Resultados da busca sem os que já viraram chip. */
  const resultadosDisponiveis = useMemo(() => {
    const escolhidos = new Set(produtoChips.map((c) => c.id));
    return produtoResults.filter((p) => !escolhidos.has(p.id));
  }, [produtoResults, produtoChips]);

  const limparTudo = () => {
    setProdutoChips([]);
    setDims(EMPTY_DIMS);
    setAvisoCodigos(null);
  };

  /** O que está na tela é a rede inteira (geraram sem nenhum recorte). */
  const escopoRede =
    pedido !== null &&
    pedido.produtos.length === 0 &&
    DIM_KEYS.every((dim) => pedido.dims[dim].length === 0);

  /** Métrica dos números NA TELA (o toggle ao vivo só vale depois de gerar). */
  const metricaAplicada: Metrica = pedido?.metrica ?? metrica;
  const ehTickets = metricaAplicada === "tickets";
  const unidadeLabel = ehTickets ? "tickets" : "un";
  const soUm = selectedItems.length === 1 ? selectedItems[0] : null;

  return (
    <div className={styles.wrapper}>
      {/* ── Parâmetros + filtros (uma só superfície) ─────────────────────── */}
      <div className={styles.headerCard}>
        <div className={styles.topBar}>
          <div className={styles.topFields}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Análise por</span>
              <div className={styles.segmented}>
                {METRICAS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`${styles.segment} ${metrica === m.key ? styles.segmentActive : ""}`}
                    onClick={() => setMetrica(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Data base</span>
              <input
                type="date"
                className={styles.input}
                value={dataBase}
                onChange={(e) => e.target.value && setDataBase(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Vender até</span>
              <input
                type="date"
                className={styles.input}
                value={venderAte}
                min={dataBase}
                onChange={(e) => e.target.value && setVenderAte(e.target.value)}
              />
            </label>
            {metrica === "produtos" && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Estoque atual
                {estoqueOverride !== null && gerado && (
                  <button
                    type="button"
                    className={styles.resetLink}
                    title={`Voltar ao estoque real (${fmt(agregado.estoqueSomado)} un)`}
                    onClick={() => setEstoqueOverride(null)}
                  >
                    ↺
                  </button>
                )}
              </span>
              <input
                type="number"
                className={`${styles.input} ${styles.inputNum}`}
                value={estoqueAtual}
                min={0}
                disabled={!gerado}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value)));
                  setEstoqueOverride(Number.isNaN(v as number) ? null : v);
                }}
              />
            </label>
            )}
            {metrica === "produtos" && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Qtd compra</span>
              <input
                type="number"
                className={`${styles.input} ${styles.inputNum} ${
                  linhaAtiva.editado ? styles.inputEdited : ""
                }`}
                value={linhaAtiva.qtd}
                min={0}
                disabled={!gerado || !linhaAtiva.disponivel}
                onChange={(e) => {
                  const raw = e.target.value;
                  setQtdOverride((prev) => ({
                    ...prev,
                    [regra]: raw === "" ? 0 : Math.max(0, Math.round(Number(raw))),
                  }));
                }}
              />
            </label>
            )}
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Horizonte</span>
              <span className={styles.pill}>{fmt(diasHorizonte)} dias</span>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Regra de cálculo</span>
              <select
                className={styles.select}
                value={regra}
                onChange={(e) => setRegra(e.target.value as RegraProjecao)}
              >
                {REGRAS.map((key) => (
                  <option key={key} value={key}>
                    {REGRA_LABEL[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Produto: busca no cadastro (mesma do Gerador de Relatórios). Cada escolha vira
              chip e o escopo é por PRODUTO — todas as cores entram. */}
          <div className={styles.field} ref={searchWrapRef}>
            <span className={styles.fieldLabel}>
              Produto
              {produtoChips.length > 0 && (
                <span className={styles.fieldCount}>
                  {fmt(produtoChips.length)} selecionado{produtoChips.length === 1 ? "" : "s"}
                </span>
              )}
            </span>
            <div className={styles.produtoWrap}>
              <div className={styles.searchBox}>
                <input
                  ref={searchInputRef}
                  className={styles.produtoInput}
                  type="text"
                  value={produtoQuery}
                  placeholder={
                    produtoChips.length > 0 ? "Adicionar outro produto…" : "Buscar produto, código…"
                  }
                  onChange={(e) => onProdutoQueryChange(e.target.value)}
                  onFocus={() => setProdutoOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                />
                {produtoQuery && (
                  <button
                    type="button"
                    className={styles.searchClear}
                    onClick={() => {
                      setProdutoQuery("");
                      setProdutoResults([]);
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Limpar busca"
                  >
                    ×
                  </button>
                )}
              </div>

              {produtoOpen && (
                <div className={styles.dropdown}>
                  <div className={styles.optionList}>
                    {produtoQuery.trim().length < 2 ? (
                      <div className={styles.optionEmpty}>
                        Digite ao menos 2 letras — nome, código do produto ou código de barra.
                      </div>
                    ) : produtoBuscando ? (
                      <div className={styles.optionEmpty}>Buscando…</div>
                    ) : resultadosDisponiveis.length === 0 ? (
                      <div className={styles.optionEmpty}>Nenhum resultado encontrado</div>
                    ) : (
                      resultadosDisponiveis.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={styles.optionRow}
                          onClick={() => addProdutoChip(p)}
                        >
                          <span className={styles.optionInfo}>
                            <span className={styles.optionName}>{p.name}</span>
                            <span className={styles.optionMeta}>
                              <span>{p.id}</span>
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Colar lista de códigos: resolve em lote e vira chips (um por produto). */}
                  <div className={styles.pasteBox}>
                    <textarea
                      className={styles.pasteArea}
                      value={codigosColados}
                      placeholder={"Colar lista de códigos (um por linha)\n050341\n050340"}
                      onChange={(e) => setCodigosColados(e.target.value)}
                      rows={2}
                    />
                    <div className={styles.pasteActions}>
                      <button
                        type="button"
                        className={styles.pasteBtn}
                        onClick={() => void adicionarCodigosColados()}
                        disabled={resolvendoCodigos || codigosColados.trim() === ""}
                      >
                        {resolvendoCodigos ? "Buscando…" : "Adicionar códigos"}
                      </button>
                      {avisoCodigos && <span className={styles.pasteAviso}>{avisoCodigos}</span>}
                    </div>
                  </div>

                  <div className={styles.dropdownFoot}>
                    <span>
                      {produtoChips.length > 0
                        ? `${fmt(produtoChips.length)} produto${produtoChips.length === 1 ? "" : "s"} no escopo`
                        : "Sem seleção = todos os produtos do filtro"}
                    </span>
                    {produtoChips.length > 0 && (
                      <button
                        type="button"
                        className={styles.linkAction}
                        onClick={() => setProdutoChips([])}
                      >
                        Limpar tudo
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Filtros de cadastro (pílulas) ──────────────────────────────── */}
        <div className={styles.filterBar}>
          {DIM_KEYS.map((dim) => (
            <MultiSelect
              key={dim}
              variant="pill"
              label={DIM_LABEL[dim]}
              options={dimOptions[dim]}
              value={dims[dim]}
              loading={!!dimLoading[dim]}
              onChange={(values) => setDims((prev) => ({ ...prev, [dim]: values }))}
              searchPlaceholder={`Buscar ${DIM_LABEL[dim].toLowerCase()}…`}
              vazioLabel="Todos"
            />
          ))}

          {dimFiltradas.flatMap((dim) =>
            dims[dim].map((value) => (
              <button
                key={`${dim}:${value}`}
                type="button"
                className={styles.chip}
                title={`Remover ${DIM_LABEL[dim]}`}
                onClick={() => setDims((prev) => ({ ...prev, [dim]: prev[dim].filter((v) => v !== value) }))}
              >
                {dimChipLabel(dim, value)}
                <span className={styles.chipX}>×</span>
              </button>
            ))
          )}
          {chipsProdutos.map((it) => (
            <button
              key={it.id}
              type="button"
              className={styles.chip}
              title={`${it.name} (${it.id}) — remover da seleção`}
              onClick={() => removeProdutoChip(it.id)}
            >
              {it.name}
              <span className={styles.chipX}>×</span>
            </button>
          ))}
          {temEscopo && (
            <button type="button" className={styles.linkAction} onClick={limparTudo}>
              Limpar
            </button>
          )}

          <button
            type="button"
            className={styles.btnGerar}
            onClick={gerarProjecao}
            disabled={projLoading || (gerado && !pendente)}
            title={
              gerado && !pendente
                ? "Nada mudou desde a última projeção"
                : !temEscopo
                ? "Gerar projeção da rede inteira (sem filtro)"
                : `Gerar projeção (${fmt(totalRecortes)} ${totalRecortes === 1 ? "item" : "itens"} no recorte)`
            }
          >
            {projLoading ? "Gerando…" : temEscopo ? "Gerar projeção" : "Gerar total da rede"}
          </button>
        </div>
      </div>

      {/* ── Título + escopo ──────────────────────────────────────────────── */}
      <div className={styles.titleBar}>
        <h1 className={styles.title}>Projeção Compra</h1>
        {gerado && (
          <span className={styles.scopeText}>
            {soUm ? (
              <>
                {soUm.descricao}
                {soUm.codigoBarra && <> · cód. {soUm.codigoBarra}</>}
                {soUm.grade && <> · {soUm.grade}</>}
                {soUm.cores > 0 && (
                  <>
                    {" · "}
                    {soUm.cores} {soUm.cores === 1 ? "cor" : "cores"}
                  </>
                )}
                {!ehTickets && <> · estoque {fmt(estoqueAtual)} un</>}
              </>
            ) : (
              <>
                {escopoRede && <>Rede inteira · </>}
                {fmt(agregado.itens)} itens
                {!ehTickets && <> · estoque {fmt(estoqueAtual)} un</>}
              </>
            )}
          </span>
        )}
        {/* Só a projeção acende o "calculando". A busca de produto é sob demanda e mostra o
            próprio "Buscando…" dentro do dropdown. */}
        <span
          className={`${styles.loadingCue} ${projLoading ? styles.loadingCueActive : ""}`}
          role="status"
        >
          <span className={styles.spinner} aria-hidden="true" />
          calculando
        </span>
      </div>

      {!gerado ? (
        <div className={styles.emptyPanel}>
          <div className={styles.emptyTitle}>Gere a projeção</div>
          <div className={styles.emptyText}>
            Filtre por cadastro ou selecione produtos — ou deixe tudo em <strong>Todos</strong> para
            o total da rede.
          </div>
        </div>
      ) : (
        <>
          {projErro && <div className={styles.erro}>{projErro}</div>}

          {/* ── KPIs ──────────────────────────────────────────────────────── */}
          <div className={`${styles.kpiStrip} ${ehTickets ? styles.kpiStripTickets : ""}`}>
            {!ehTickets && (
              <div className={styles.kpi}>
                <span className={styles.kpiLabel}>Sugestão de compra</span>
                <span className={styles.kpiValue}>
                  {linhaAtiva.disponivel ? fmt(linhaAtiva.sugestao) : "—"}
                </span>
                <span className={styles.kpiHint}>un para durar o horizonte</span>
              </div>
            )}
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>
                {linhaAtiva.yoy
                  ? "Projeção que falta"
                  : ehTickets
                  ? "Tickets da janela"
                  : "Unidades da janela"}
              </span>
              <span className={styles.kpiValue}>{linhaAtiva.disponivel ? fmt(linhaAtiva.un) : "—"}</span>
              <span className={styles.kpiHint}>
                {linhaAtiva.yoy
                  ? `${unidadeLabel} no horizonte`
                  : `${unidadeLabel} em ${fmt(linhaAtiva.dias)} dias`}
              </span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Ritmo</span>
              <span className={styles.kpiValue}>
                {linhaAtiva.disponivel ? fmtDec(linhaAtiva.ritmoDia) : "—"}
                <span className={styles.kpiUnit}>{unidadeLabel}/dia</span>
              </span>
              <span className={styles.kpiHint}>
                {linhaAtiva.disponivel
                  ? `${fmtDec(linhaAtiva.ritmoMes, 1)} ${unidadeLabel}/mês`
                  : "—"}
              </span>
            </div>
            {!ehTickets && (
              <>
                <div className={styles.kpi}>
                  <span className={styles.kpiLabel}>Cobertura</span>
                  <span className={styles.kpiValue}>
                    {linhaAtiva.cobertura !== null ? fmt(linhaAtiva.cobertura) : "—"}
                    {linhaAtiva.cobertura !== null && <span className={styles.kpiUnit}>dias</span>}
                  </span>
                </div>
                <div className={styles.kpi}>
                  <span className={styles.kpiLabel}>Dura até</span>
                  <span className={styles.kpiValue}>{linhaAtiva.duraAte ?? "—"}</span>
                </div>
              </>
            )}
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Crescimento médio</span>
              <span
                className={`${styles.kpiValue} ${
                  crescimento.media == null ? "" : crescimento.media >= 0 ? styles.varUp : styles.varDown
                }`}
              >
                {fmtPct(crescimento.media)}
              </span>
              <span className={styles.kpiHint}>
                {crescimento.meses.length > 0
                  ? `${fmt(crescimento.meses.length)} ${
                      crescimento.meses.length === 1 ? "mês fechado" : "meses fechados"
                    }`
                  : "sem base comparável"}
              </span>
            </div>
          </div>

          {/* ── Vendas por mês (meses em colunas) ───────────────────────── */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardTitle}>
                {ehTickets ? "Tickets por mês" : "Vendas por mês"}
              </span>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={`${styles.dot} ${styles.dotReal}`} />
                  realizado
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.dot} ${styles.dotParcial}`} />
                  mês em curso
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.dot} ${styles.dotProj}`} />
                  projetado
                </span>
              </div>
            </div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.mensalTable}`}>
                <thead>
                  <tr>
                    <th className={`${styles.thLeft} ${styles.stickyCol}`}>Série</th>
                    {mensalRows.map((m) => (
                      <th key={m.mes}>{MES_NOME[Number(m.mes.slice(5, 7)) - 1]}</th>
                    ))}
                    <th className={styles.colTotal}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {mensalRows.length === 0 ? (
                    <tr>
                      <td className={`${styles.tdLeft} ${styles.stickyCol}`} colSpan={14}>
                        <span className={styles.muted}>
                          {projLoading ? "Carregando…" : "Sem série mensal para o escopo."}
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td className={`${styles.tdLeft} ${styles.stickyCol}`}>{anoBase}</td>
                      {mensalRows.map((m) => {
                        const valor = m.futuro ? m.projetado : m.parcial ? m.valorAno : m.qtde;
                        const pct = m.pctSobreAnoAnterior;
                        return (
                          <td
                            key={m.mes}
                            className={`${styles.num} ${styles.cellMes} ${
                              m.futuro ? styles.cellProj : m.parcial ? styles.cellParcial : ""
                            }`}
                            title={
                              m.futuro
                                ? `Projeção por ${REGRA_LABEL[regra]}`
                                : m.parcial
                                ? `Mês em curso: projeção do mês cheio por ${REGRA_LABEL[regra]} · já vendeu ${fmt(m.qtde)} un até ${ymdToBr(dataBase)} · fora da média de crescimento`
                                : "Realizado"
                            }
                          >
                            <span className={styles.cellQtd}>
                              {valor == null ? "—" : fmt(Math.round(valor))}
                            </span>
                            <span
                              className={`${styles.cellPct} ${
                                pct == null ? styles.muted : pct >= 0 ? styles.varUp : styles.varDown
                              }`}
                            >
                              {fmtPct(pct)}
                            </span>
                            {(m.parcial || m.futuro) && (
                              <span className={styles.cellFlag}>proj.</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={`${styles.num} ${styles.colTotal}`}>
                        <span className={styles.cellQtd}>{fmt(Math.round(mensalTotais.ano))}</span>
                        <span
                          className={`${styles.cellPct} ${
                            mensalTotais.variacao == null
                              ? styles.muted
                              : mensalTotais.variacao >= 0
                              ? styles.varUp
                              : styles.varDown
                          }`}
                        >
                          {fmtPct(mensalTotais.variacao)}
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Multi-select (mesma lógica do MultiSelectFilter do Gerador de Relatórios) ──
//
// O que vem de lá, de propósito: "(Selecionar tudo)" age sobre o que está FILTRADO — então
// digitar um termo e clicar seleciona todos os itens daquela busca de uma vez; "Limpar tudo"
// zera; e o que já está selecionado sobe para o topo da lista, separado do resto.

interface MultiSelectOpcao {
  value: string;
  label: string;
  /** Texto extra considerado na busca (código de barra, subgrupo, coleção…). */
  busca?: string;
  /** Linha de metadados abaixo do nome. */
  meta?: string[];
}

interface MultiSelectProps {
  label: string;
  options: MultiSelectOpcao[];
  value: string[];
  onChange: (values: string[]) => void;
  loading?: boolean;
  searchPlaceholder: string;
  vazioLabel: string;
  /** "pill" = filtro compacto; "field" = campo com rótulo em cima. */
  variant: "pill" | "field";
  unidade?: string;
  unidadePlural?: string;
  largura?: "sm" | "lg";
}

/** Quantas linhas o painel desenha (a seleção em massa continua valendo para tudo). */
const MULTI_SELECT_RENDER_MAX = 200;

function MultiSelect({
  label,
  options,
  value,
  onChange,
  loading = false,
  searchPlaceholder,
  vazioLabel,
  variant,
  unidade = "item",
  unidadePlural = "itens",
  largura = "sm",
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setBusca("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(termo) ||
        o.value.toLowerCase().includes(termo) ||
        (o.busca ?? "").toLowerCase().includes(termo)
    );
  }, [options, busca]);

  const { selecionadas, naoSelecionadas } = useMemo(() => {
    const sel: MultiSelectOpcao[] = [];
    const nao: MultiSelectOpcao[] = [];
    filtradas.forEach((o) => (value.includes(o.value) ? sel.push(o) : nao.push(o)));
    return { selecionadas: sel, naoSelecionadas: nao };
  }, [filtradas, value]);

  const todasFiltradasSelecionadas = filtradas.length > 0 && naoSelecionadas.length === 0;
  const algumaFiltradaSelecionada = selecionadas.length > 0;

  // Age sobre o FILTRADO: é o que faz "digitar e selecionar todos" funcionar.
  const alternarTodas = () => {
    if (todasFiltradasSelecionadas) {
      const doFiltro = new Set(filtradas.map((o) => o.value));
      onChange(value.filter((v) => !doFiltro.has(v)));
      return;
    }
    onChange(Array.from(new Set([...value, ...filtradas.map((o) => o.value)])));
  };

  const alternar = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const texto =
    value.length === 0
      ? vazioLabel
      : value.length === 1
      ? options.find((o) => o.value === value[0])?.label ?? value[0]
      : `${value.length} ${unidadePlural}`;

  const visiveis = [...selecionadas, ...naoSelecionadas].slice(0, MULTI_SELECT_RENDER_MAX);
  const cortadas = filtradas.length - visiveis.length;

  const renderOpcao = (o: MultiSelectOpcao) => {
    const checked = value.includes(o.value);
    return (
      <button
        key={o.value}
        type="button"
        className={`${styles.optionRow} ${checked ? styles.optionRowActive : ""}`}
        onClick={() => alternar(o.value)}
      >
        <span className={styles.checkbox}>{checked ? "✓" : ""}</span>
        <span className={styles.optionInfo}>
          <span className={styles.optionName}>{o.label}</span>
          {o.meta && o.meta.length > 0 && (
            <span className={styles.optionMeta}>
              {o.meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className={variant === "pill" ? styles.dimWrap : styles.field} ref={ref}>
      {variant === "field" && <span className={styles.fieldLabel}>{label}</span>}
      <div className={variant === "field" ? styles.produtoWrap : undefined}>
        <button
          type="button"
          className={
            variant === "pill"
              ? `${styles.dimPill} ${value.length > 0 ? styles.dimPillActive : ""}`
              : `${styles.produtoButton} ${open ? styles.produtoButtonActive : ""}`
          }
          onClick={() => setOpen((prev) => !prev)}
        >
          {variant === "pill" ? (
            <>
              <span className={styles.dimLabel}>{label}:</span>
              <span className={styles.dimValue}>{texto}</span>
            </>
          ) : (
            <span>{texto}</span>
          )}
          <span className={styles.caret}>⌄</span>
        </button>

        {open && (
          <div className={`${styles.dropdown} ${largura === "lg" ? styles.dropdownLg : ""}`}>
            <div className={styles.searchBox}>
              <input
                ref={inputRef}
                className={styles.searchInput}
                type="text"
                placeholder={searchPlaceholder}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              {busca && (
                <button
                  type="button"
                  className={styles.searchClear}
                  onClick={() => {
                    setBusca("");
                    inputRef.current?.focus();
                  }}
                  aria-label="Limpar busca"
                >
                  ×
                </button>
              )}
            </div>

            <div className={styles.listHeader}>
              <button
                type="button"
                className={`${styles.optionRow} ${styles.selectAllRow} ${
                  todasFiltradasSelecionadas ? styles.optionRowActive : ""
                }`}
                onClick={alternarTodas}
                disabled={filtradas.length === 0}
              >
                <span className={styles.checkbox}>
                  {todasFiltradasSelecionadas ? "✓" : algumaFiltradaSelecionada ? "⊞" : ""}
                </span>
                <span>
                  (Selecionar tudo{busca.trim() ? ` — ${fmt(filtradas.length)} do filtro` : ""})
                </span>
              </button>
              {value.length > 0 && (
                <button
                  type="button"
                  className={styles.linkAction}
                  onClick={() => onChange([])}
                  title="Limpar todas as seleções"
                >
                  Limpar tudo
                </button>
              )}
            </div>

            <div className={styles.optionList}>
              {loading ? (
                <div className={styles.optionEmpty}>Carregando…</div>
              ) : filtradas.length === 0 ? (
                <div className={styles.optionEmpty}>Nenhum resultado encontrado</div>
              ) : (
                <>
                  {selecionadas.slice(0, MULTI_SELECT_RENDER_MAX).map(renderOpcao)}
                  {selecionadas.length > 0 && naoSelecionadas.length > 0 && (
                    <div className={styles.separator} />
                  )}
                  {naoSelecionadas
                    .slice(0, Math.max(0, MULTI_SELECT_RENDER_MAX - selecionadas.length))
                    .map(renderOpcao)}
                </>
              )}
            </div>

            <div className={styles.dropdownFoot}>
              <span>
                {fmt(filtradas.length)} {filtradas.length === 1 ? unidade : unidadePlural}
                {cortadas > 0 ? ` · mostrando ${fmt(visiveis.length)}` : ""}
                {value.length > 0 ? ` · ${fmt(value.length)} selecionado${value.length === 1 ? "" : "s"}` : ""}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
