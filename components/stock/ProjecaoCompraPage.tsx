"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";

import FilialFilter from "@/components/filters/FilialFilter";
import { useAuth } from "@/components/auth/AuthContext";
import ProjecaoEmbalagensPanel, {
  type PedidoEmbalagens,
} from "@/components/stock/ProjecaoEmbalagensPanel";
import ProjecaoComoFunciona from "@/components/stock/ProjecaoComoFunciona";
import ProjecaoItensMensais, {
  type ItemCompra,
} from "@/components/stock/ProjecaoItensMensais";
import { formatDateForQuery } from "@/lib/utils/date";
import { VAREJO_VALUE, resolveCompany, type CompanyKey } from "@/lib/config/company";
import {
  INDICE_MAX,
  INDICE_MIN,
  MESES_JANELA_ATIVIDADE,
  PESO_JANELA_RECENTE,
  indiceDoModo,
  montarPerfil,
  projetarHorizonte,
  projetarMesCheio,
  type CriterioMes,
  type ModoProjecao,
} from "@/lib/utils/projecao-realista";

import {
  CRITERIO_TEXTO,
  REGRAS,
  REGRAS_CURVA,
  REGRA_LABEL,
  type RegraProjecao,
} from "@/lib/utils/projecao-regras";

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

/** Resposta de /api/products/dimensoes-escopo: as dimensões dos produtos do recorte. */
interface DimensoesEscopo {
  grupos?: string[];
  linhas?: string[];
  subgrupos?: string[];
  grades?: string[];
  colecoes?: Opcao[];
  tipos?: string[];
  cores?: string[];
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
  /** Estoque atual do item (só saldos positivos). */
  estoque?: number;
  /** Série do ano por item — só vem no modo "item a item". */
  mensal?: MensalItem[];
}

/** Uma compra salva na lista do select. */
interface CompraSalvaOpcao {
  id: string;
  title: string;
  itemCount: number;
  totalQtdManual: number;
  comprada?: boolean;
  savedAt: string;
}

/**
 * As compras salvas JÁ IMPORTADAS: são elas que mandam nas linhas da tabela item a item.
 * Pode ser mais de uma — os itens repetidos somam.
 */
interface CompraImportada {
  ids: string[];
  title: string;
  items: ItemCompra[];
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
  /** O servidor mandou a série mensal por item. */
  porItem?: boolean;
  /** Escopo grande demais: o detalhe por item não foi calculado. */
  porItemOmitido?: boolean;
  maxItensMensal?: number;
}

/**
 * O que a análise mede. `produtos` = unidades vendidas (visão de compra, com estoque,
 * sugestão e cobertura). `tickets` = contagem de vendas (visão de fluxo): as contas de
 * estoque não se aplicam, só ritmo e crescimento.
 */
type Metrica = "produtos" | "tickets" | "embalagens";
const METRICAS: { key: Metrica; label: string }[] = [
  { key: "produtos", label: "Produtos" },
  { key: "tickets", label: "Tickets" },
  { key: "embalagens", label: "Embalagens" },
];

/**
 * Escopo JÁ APLICADO (o que gerou os números na tela). A projeção não roda a cada clique de
 * filtro: o usuário monta o recorte e manda gerar. Isso evita disparar consulta pesada a cada
 * item marcado — e "Selecionar tudo" marca centenas de uma vez.
 */
interface PedidoProjecao {
  dataBase: string;
  metrica: Metrica;
  /** Projetar item a item (mês a mês por produto × cor). */
  porItem: boolean;
  /** A compra salva que originou o recorte, quando foi assim que ele nasceu. */
  compra: CompraImportada | null;
  /** Nome canônico da filial, VAREJO_VALUE ou null = rede inteira. */
  filial: string | null;
  dims: DimState;
  produtos: string[];
  /** Busca livre por nome, quando o usuário digitou sem escolher ninguém da lista. */
  busca: string;
}

/** Mínimo de caracteres para a busca livre valer como recorte (igual ao Gerador). */
const MIN_BUSCA = 2;

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
  const { user } = useAuth();
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
  // ── Compra salva: lista do select, a que está importada e o modo item a item ──
  const [comprasSalvas, setComprasSalvas] = useState<CompraSalvaOpcao[]>([]);
  const [comprasSelecionadas, setComprasSelecionadas] = useState<string[]>([]);
  const [compraImportada, setCompraImportada] = useState<CompraImportada | null>(null);
  const [carregandoCompra, setCarregandoCompra] = useState(false);
  const [erroCompra, setErroCompra] = useState<string | null>(null);
  /** Projetar produto × cor linha a linha. Importar uma compra salva liga isto sozinho. */
  const [porItem, setPorItem] = useState(false);
  /** O que o servidor respondeu sobre o detalhe por item na última projeção. */
  const [detalheItem, setDetalheItem] = useState({ disponivel: false, omitido: false, max: 400 });
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
  const [regra, setRegra] = useState<RegraProjecao>("realista");
  /**
   * Filial do recorte (null = rede inteira). Fica FORA de `dims` de propósito: as dimensões
   * filtram o cadastro de PRODUTOS, a filial restringe o universo de lojas consultado.
   * Em vendas a loja escolhida traz o grupo inteiro (CNPJ antigo é a mesma loja) — é o
   * servidor que expande, ver [[canonica-grupo-e-filial-ativa]].
   */
  const [filial, setFilial] = useState<string | null>(null);

  // Overrides editáveis (amarelos da planilha).
  const [estoqueOverride, setEstoqueOverride] = useState<number | null>(null);
  const [qtdOverride, setQtdOverride] = useState<Record<string, number | null>>({});

  /**
   * Opções globais (sem recorte de produto) guardadas depois do primeiro carregamento: limpar
   * a seleção volta para elas na hora, sem repetir as 7 consultas.
   */
  const dimOptionsGlobais = useRef<Record<DimKey, Opcao[]> | null>(null);

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

  /** Quebra um texto colado em códigos (linha, tab, vírgula, ponto-e-vírgula ou espaço). */
  const quebrarCodigos = (texto: string): string[] =>
    texto
      .split(/[\s,;]+/g)
      .map((c) => c.trim())
      .filter(Boolean);

  /**
   * Resolve em LOTE uma lista de códigos (código de barra interno OU código do produto) e
   * adiciona como chips. Código que não casou é mostrado na tela — colar 11 códigos e
   * receber 9 itens sem aviso seria pior que o erro.
   *
   * `codigosDiretos` é o caminho de quem colou NO CAMPO DE BUSCA; sem ele, vale o que está
   * na caixa "Colar lista de códigos".
   */
  const resolverCodigos = useCallback(async (codigos: string[], limparCaixa: boolean) => {
    if (codigos.length === 0) {
      setAvisoCodigos("Cole pelo menos um código.");
      return;
    }
    setProdutoOpen(true);
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
      if (limparCaixa && naoEncontrados.length === 0) setCodigosColados("");
    } catch (e) {
      setAvisoCodigos(e instanceof Error ? e.message : "Erro ao resolver os códigos");
    } finally {
      setResolvendoCodigos(false);
    }
  }, []);

  const adicionarCodigosColados = useCallback(
    () => resolverCodigos(quebrarCodigos(codigosColados), true),
    [codigosColados, resolverCodigos]
  );

  /**
   * Colar uma LISTA no campo de busca resolve em lote, sem passar pela caixa escondida no
   * dropdown. Era o passo que faltava: quem cola dez códigos espera dez chips, não uma
   * busca por nome com o blob inteiro (que nunca casa com nada).
   *
   * Um código só continua indo para a busca normal — colar um código para procurá-lo é
   * legítimo, e o campo já resolve barra e código de produto.
   */
  const onProdutoPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const texto = event.clipboardData.getData("text");
    if (!texto) return;
    const codigos = quebrarCodigos(texto);
    if (codigos.length < 2) return;
    event.preventDefault();
    setProdutoQuery("");
    setProdutoResults([]);
    void resolverCodigos(codigos, false);
  };

  // ── Compras salvas: lista do select ───────────────────────────────────────
  //    Só na aba Produtos, e uma vez por empresa. A lista é leve (cabeçalho, sem itens).
  useEffect(() => {
    if (metrica !== "produtos") return;
    let cancelado = false;
    fetch(`/api/controle-estoque/compras-salvas?company=${companyKey}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("falhou"))))
      .then((json: { data?: CompraSalvaOpcao[] }) => {
        if (!cancelado) setComprasSalvas(Array.isArray(json.data) ? json.data : []);
      })
      .catch(() => {
        // Sem lista o select simplesmente não aparece — não é erro que mereça alarme.
        if (!cancelado) setComprasSalvas([]);
      });
    return () => {
      cancelado = true;
    };
  }, [companyKey, metrica]);

  /**
   * Importa UMA OU MAIS compras salvas: os itens delas viram o recorte (um chip por PRODUTO)
   * e a projeção passa a sair item a item, com a Qtd salva ao lado do sugerido.
   *
   * Com várias compras, o mesmo produto × cor pedido em duas delas SOMA — é o pedido total
   * que se compara com a projeção, não cada lista isolada. A origem de cada quantidade fica
   * no tooltip da linha, para a soma não virar um número sem procedência.
   *
   * Gera na hora. Escolher no select já é a decisão — pedir um segundo clique em "Gerar
   * projeção" seria burocracia.
   */
  const importarComprasSalvas = async (ids: string[]) => {
    setComprasSelecionadas(ids);
    if (ids.length === 0) {
      setCompraImportada(null);
      setPorItem(false);
      setErroCompra(null);
      return;
    }
    setCarregandoCompra(true);
    setErroCompra(null);
    try {
      const respostas = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(
            `/api/controle-estoque/compras-salvas/${id}?company=${companyKey}`,
            { cache: "no-store" }
          );
          const json = (await res.json()) as {
            data?: { id: string; title: string; items?: Array<Record<string, unknown>> };
            error?: string;
          };
          if (!res.ok || !json.data) {
            throw new Error(json?.error || "Erro ao carregar a compra salva");
          }
          return json.data;
        })
      );

      // Junta os itens de todas as compras, somando o que se repete em produto × cor.
      const porItemChave = new Map<string, ItemCompra>();
      respostas.forEach((compra) => {
        const titulo = compra.title ?? "";
        (compra.items ?? []).forEach((raw) => {
          const produto = String(raw.produto ?? "").trim();
          if (!produto) return;
          const cor = String(raw.corProduto ?? "").trim();
          const qtd = Math.max(0, Math.round(Number(raw.qtdManual ?? 0) || 0));
          const chaveItem = `${produto}||${cor}`;
          const existente = porItemChave.get(chaveItem);
          if (existente) {
            existente.qtdManual += qtd;
            existente.origens = [...(existente.origens ?? []), { titulo, qtd }];
            return;
          }
          porItemChave.set(chaveItem, {
            produto,
            cor,
            corDescricao: String(raw.corDescricao ?? "").trim(),
            descricao: String(raw.descricao ?? "").trim(),
            qtdManual: qtd,
            custoUnitario: Number(raw.custoUnitario ?? 0) || undefined,
            origens: respostas.length > 1 ? [{ titulo, qtd }] : undefined,
          });
        });
      });
      const items = Array.from(porItemChave.values());

      const title =
        respostas.length === 1
          ? respostas[0].title
          : `${respostas.length} compras · ${respostas.map((c) => c.title).join(" + ")}`;
      const compra: CompraImportada = { ids: respostas.map((c) => c.id), title, items };

      // O recorte da consulta é por PRODUTO (todas as cores vêm); quem recorta a cor de
      // volta é a própria tabela, que monta as linhas a partir dos itens da compra.
      const chips: ProdutoChip[] = [];
      const vistos = new Set<string>();
      items.forEach((it) => {
        if (vistos.has(it.produto)) return;
        vistos.add(it.produto);
        chips.push({ id: it.produto, name: it.descricao || it.produto });
      });

      setProdutoChips(chips);
      setDims(EMPTY_DIMS);
      setProdutoQuery("");
      setProdutoResults([]);
      setCompraImportada(compra);
      setPorItem(true);
      setPedido({
        dataBase,
        metrica: "produtos",
        filial,
        dims: EMPTY_DIMS,
        produtos: chips.map((c) => c.id),
        busca: "",
        porItem: true,
        compra,
      });
    } catch (e) {
      setErroCompra(e instanceof Error ? e.message : "Erro ao carregar a compra salva");
      setCompraImportada(null);
    } finally {
      setCarregandoCompra(false);
    }
  };

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
   * Texto digitado sem escolher ninguém da lista JÁ É um recorte — mesma regra do Gerador
   * de Relatórios: "bandana" projeta todos os itens cujo nome tem "bandana".
   */
  const buscaLivre = produtoQuery.trim().length >= MIN_BUSCA ? produtoQuery.trim() : "";
  const temBusca = buscaLivre !== "";
  /**
   * Há recorte montado na barra de filtros (ainda não necessariamente gerado). Sem recorte a
   * projeção continua valendo: é o TOTAL DA REDE, o número contra o qual se compara o recorte.
   */
  const temEscopo = temSelecao || temDimensao || temBusca;
  /** Já existe projeção na tela. */
  const gerado = pedido !== null;

  const produtosSelecionados = useMemo(
    () => produtoChips.map((c) => c.id).sort(),
    [produtoChips]
  );
  const totalRecortes =
    produtosSelecionados.length + DIM_KEYS.reduce((soma, dim) => soma + dims[dim].length, 0);

  // ── Opções dos filtros: reagem ao item escolhido ──────────────────────────
  // Sem recorte, cada dimensão vem do seu endpoint de sempre (o que teve VENDA nos 12 meses,
  // mesma régua do Gerador de Relatórios). Com item(ns) escolhido(s) — ou busca por nome —
  // os selects passam a listar só o que existe NAQUELES itens: oferecer o cadastro inteiro ao
  // lado de uma seleção só confunde, e em Cor é pior ainda, porque no Linx o mesmo código de
  // cor é outra cor em outro produto (ver [[cor-escopada-por-produto-vs-mapa-global]]).
  const escopoDeProduto = temSelecao || temBusca;

  useEffect(() => {
    let cancelled = false;
    const escopado = produtosSelecionados.length > 0 || buscaLivre !== "";

    // Voltar ao estado sem recorte é instantâneo: as opções globais ficam guardadas.
    if (!escopado && dimOptionsGlobais.current) {
      setDimOptions(dimOptionsGlobais.current);
      setDimLoading({});
      return;
    }

    setDimLoading(Object.fromEntries(DIM_KEYS.map((dim) => [dim, true])));

    const carregar = () => {
      if (escopado) {
        // Um request só para as 7 dimensões (o servidor varre PRODUTOS uma vez).
        const params = new URLSearchParams({ company: companyKey });
        produtosSelecionados.forEach((p) => params.append("produto", p));
        if (buscaLivre) params.set("busca", buscaLivre);

        fetch(`/api/products/dimensoes-escopo?${params.toString()}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((json: DimensoesEscopo) => {
            if (cancelled) return;
            const simples = (values?: string[]): Opcao[] =>
              (values ?? []).filter(Boolean).map((v) => ({ value: v, label: v }));
            setDimOptions({
              grupo: simples(json.grupos),
              linha: simples(json.linhas),
              subgrupo: simples(json.subgrupos),
              grade: simples(json.grades),
              colecao: (json.colecoes ?? []).filter((o) => o?.value),
              cor: simples(json.cores),
              tipo: simples(json.tipos),
            });
          })
          .catch(() => {
            if (!cancelled) setDimOptions(EMPTY_DIM_OPTIONS);
          })
          .finally(() => {
            if (!cancelled) setDimLoading({});
          });
        return;
      }

      // Sem recorte: os endpoints de sempre, um por dimensão, na janela de 12 meses.
      const { start, end } = janela12Meses();
      const carregadas: Partial<Record<DimKey, Opcao[]>> = {};
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
            carregadas[dim] = options;
            setDimOptions((prev) => ({ ...prev, [dim]: options }));
          })
          .catch(() => {
            if (cancelled) return;
            carregadas[dim] = [];
            setDimOptions((prev) => ({ ...prev, [dim]: [] }));
          })
          .finally(() => {
            if (cancelled) return;
            setDimLoading((prev) => ({ ...prev, [dim]: false }));
            // Guarda o conjunto global assim que as 7 chegarem.
            if (DIM_KEYS.every((k) => carregadas[k])) {
              dimOptionsGlobais.current = { ...EMPTY_DIM_OPTIONS, ...carregadas } as Record<DimKey, Opcao[]>;
            }
          });
      });
    };

    // A busca muda a cada tecla; espera o usuário parar antes de ir ao banco.
    const timer = setTimeout(carregar, buscaLivre ? 350 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [companyKey, produtosSelecionados, buscaLivre]);

  // Valor que saiu do recorte não pode continuar marcado — filtraria por algo que não existe
  // nos itens escolhidos e a projeção voltaria vazia sem explicação. Só poda com a lista já
  // carregada: lista vazia pode ser falha da consulta (ou dimensão que a empresa não usa),
  // e aí a seleção fica de pé.
  useEffect(() => {
    setDims((prev) => {
      let mudou = false;
      const next = { ...prev };
      DIM_KEYS.forEach((dim) => {
        if (prev[dim].length === 0 || dimOptions[dim].length === 0) return;
        const disponiveis = new Set(dimOptions[dim].map((o) => o.value));
        const mantidas = prev[dim].filter((v) => disponiveis.has(v));
        if (mantidas.length !== prev[dim].length) {
          next[dim] = mantidas;
          mudou = true;
        }
      });
      return mudou ? next : prev;
    });
  }, [dimOptions]);

  /** Assinatura do recorte, para saber se mudou algo desde a última geração. */
  const assinaturaAtual = useMemo(
    () =>
      JSON.stringify({
        dataBase,
        metrica,
        filial,
        dims,
        produtos: produtosSelecionados,
        busca: buscaLivre,
        porItem,
        compra: compraImportada?.ids.join(",") ?? null,
      }),
    [dataBase, metrica, filial, dims, produtosSelecionados, buscaLivre, porItem, compraImportada]
  );
  const assinaturaGerada = useMemo(
    () =>
      pedido
        ? JSON.stringify({
            dataBase: pedido.dataBase,
            metrica: pedido.metrica,
            filial: pedido.filial,
            dims: pedido.dims,
            produtos: pedido.produtos,
            busca: pedido.busca,
            porItem: pedido.porItem,
            compra: pedido.compra?.ids.join(",") ?? null,
          })
        : null,
    [pedido]
  );
  const pendente = assinaturaAtual !== assinaturaGerada;

  const gerarProjecao = () => {
    setPedido({
      dataBase,
      metrica,
      filial,
      dims,
      produtos: produtosSelecionados,
      busca: buscaLivre,
      porItem,
      compra: compraImportada,
    });
  };

  // ── Busca a projeção do escopo APLICADO (só roda quando o usuário manda gerar).
  //    venderAte, Qtd Compra e a regra são puro cálculo no cliente (não vão ao servidor).
  useEffect(() => {
    if (!pedido) return;
    // Embalagem tem consulta própria (a lista é fixa e cada linha tem a sua série):
    // quem busca é o painel da aba.
    if (pedido.metrica === "embalagens") return;
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
    if (pedido.filial) params.set("filial", pedido.filial);
    if (pedido.porItem) params.set("porItem", "1");
    DIM_KEYS.forEach((dim) => pedido.dims[dim].forEach((v) => params.append(dim, v)));
    pedido.produtos.forEach((produto) => params.append("produto", produto));
    if (pedido.busca) params.set("busca", pedido.busca);

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
        setDetalheItem({
          disponivel: json.porItem === true,
          omitido: json.porItemOmitido === true,
          max: Number(json.maxItensMensal ?? 400) || 400,
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

  // ── Motor de projeção (curva do ano anterior × índice) ────────────────────
  // Porte do `projecao_scarfme.py`: NÃO se extrapola ritmo. Mantém-se a curva do ano
  // anterior — é ela que carrega a sazonalidade — e corrige-se o patamar por um índice YoY
  // que é RAZÃO DE SOMAS (ano corrido 50% + últimos 3 meses fechados 50%, clampado em
  // [0,30 ; 2,00]). A regra antiga tirava a MÉDIA das taxas mensais, o que dava o mesmo peso
  // a um mês de base 3 e a um de base 3.000.
  const perfil = useMemo(() => montarPerfil(mensal), [mensal]);

  /** Modo do motor quando a regra escolhida é de curva; null nas regras de janela. */
  const modoCurva: ModoProjecao | null = REGRAS_CURVA[regra] ?? null;
  /** Índice que a regra atual aplica sobre a curva (1,10 no conservador). */
  const indiceRegra = modoCurva ? indiceDoModo(perfil, modoCurva) : null;

  // ── KPI do índice: o número que move a projeção, com de onde ele saiu ─────
  const mesesNoIndice = perfil.ultimoMesReal;
  /** Nas regras de janela o índice não é aplicado, mas segue exibido como referência. */
  const indiceExibido = modoCurva ? indiceRegra : perfil.indice;
  /**
   * Legenda do KPI do índice, em português. A versão antiga mostrava "+100,0%" com o hint
   * "índice 2,00" — o mesmo número duas vezes, em duas unidades, sem dizer o que ele faz.
   * Agora o valor é o MULTIPLICADOR (é assim que ele entra na conta) e a legenda diz sobre
   * o que ele multiplica.
   */
  const indiceHint = useMemo(() => {
    if (indiceExibido == null) return "sem base no ano anterior — usa a média recente";
    if (regra === "mais10") return `projeta o resto do ano a +10% sobre ${anoBase - 1}`;
    const meses = `${fmt(mesesNoIndice)} ${mesesNoIndice === 1 ? "mês fechado" : "meses fechados"}`;
    const teto =
      indiceExibido >= INDICE_MAX
        ? " · no teto"
        : indiceExibido <= INDICE_MIN
        ? " · no piso"
        : "";
    const comparado = `comparando ${meses}`;
    return modoCurva
      ? `projeta cada mês a ${fmtDec(indiceExibido, 2)}× o mesmo mês de ${anoBase - 1} · ${comparado}${teto}`
      : `só referência — esta regra não usa índice · ${comparado}`;
  }, [indiceExibido, regra, modoCurva, mesesNoIndice, anoBase]);
  /** Tooltip: a conta inteira, para o número nunca parecer mágico. */
  const indiceExplicacao = useMemo(() => {
    if (regra === "mais10") return "Projeção conservadora: mesmo mês do ano anterior × 1,10.";
    const pAno = Math.round((1 - PESO_JANELA_RECENTE) * 100);
    const pRec = Math.round(PESO_JANELA_RECENTE * 100);
    const trecho = (v: number | null) => (v == null ? "sem base" : fmtDec(v, 3));
    const cru =
      perfil.yoyAno != null && perfil.yoyRecente != null
        ? (1 - PESO_JANELA_RECENTE) * perfil.yoyAno + PESO_JANELA_RECENTE * perfil.yoyRecente
        : perfil.yoyAno ?? perfil.yoyRecente;
    const travado =
      cru != null && perfil.indice != null && Math.abs(cru - perfil.indice) > 1e-9
        ? ` · travado em [0,30 ; 2,00] (bruto ${fmtDec(cru, 3)})`
        : "";
    return (
      `Índice = ${pAno}% do YoY do ano corrido (${trecho(perfil.yoyAno)}) + ` +
      `${pRec}% do YoY dos últimos ${MESES_JANELA_ATIVIDADE} meses fechados ` +
      `(${trecho(perfil.yoyRecente)})${travado}. Cada YoY é a soma do ano ÷ soma do ano ` +
      `anterior nos mesmos meses. A projeção é o mês do ano anterior × esse índice, ` +
      `preservando a sazonalidade.`
    );
  }, [regra, perfil.yoyAno, perfil.yoyRecente, perfil.indice]);

  /** Ritmo diário de uma janela de dias (para as regras que não usam a curva). */
  const ritmoDiaJanela = useCallback(
    (dias: number) => (dias > 0 ? (agregado.unidades[dias] ?? 0) / dias : 0),
    [agregado.unidades]
  );

  // Valor de cada mês do ano da data base: realizado (mês fechado) e projetado pela regra.
  const serieMes = useMemo(() => {
    const map = new Map<
      string,
      { realizado: number | null; projetado: number | null; criterio: CriterioMes | null }
    >();
    mensal.forEach((m) => {
      const mesNum = Number(m.mes.slice(5, 7));
      let projetado: number | null;
      let criterio: CriterioMes | null = null;
      if (modoCurva) {
        // Projeção do mês CHEIO — inclusive nos fechados, onde ela fica só como aferição
        // (a célula do mês fechado mostra o realizado).
        const r = projetarMesCheio(perfil, mesNum, modoCurva);
        projetado = perfil.ultimoMesReal >= 1 ? r.valor : null;
        criterio = r.criterio;
      } else {
        projetado = ritmoDiaJanela(Number(regra)) * diasNoMes(anoBase, mesNum);
      }
      map.set(m.mes, { realizado: m.futuro ? null : m.qtde, projetado, criterio });
    });
    return map;
  }, [mensal, perfil, modoCurva, regra, ritmoDiaJanela, anoBase]);

  /**
   * Unidades projetadas pela regra de curva entre a data base e "Vender até" (pro-rata nas
   * pontas). A conta vive no motor — [projecao-realista.ts](@/lib/utils/projecao-realista) —
   * porque a aba Embalagens projeta cada embalagem exatamente do mesmo jeito.
   */
  const projecaoHorizonte = useMemo(() => {
    if (!modoCurva) return 0;
    return projetarHorizonte(mensal, perfil, modoCurva, indiceRegra, dataBase, diasHorizonte);
  }, [mensal, perfil, modoCurva, indiceRegra, dataBase, diasHorizonte]);

  // ── A ÚNICA linha da tabela de giro: a regra escolhida no select.
  //    As regras de curva medem o horizonte inteiro mês a mês; as de dias extrapolam a janela.
  const linhaAtiva = useMemo(() => {
    const curva = modoCurva !== null;
    // Sem nenhum mês fechado (data base em janeiro) não há índice nem janela recente: a
    // projeção não existe e a tela mostra "—" em vez de um 0 que pareceria venda zero.
    const disponivel = curva ? perfil.ultimoMesReal >= 1 && diasHorizonte > 0 : true;
    const dias = curva ? diasHorizonte : Number(regra);
    const un = curva ? (disponivel ? projecaoHorizonte : 0) : agregado.unidades[dias] ?? 0;
    const ritmoDia = dias > 0 ? un / dias : 0;
    const sugestao = disponivel ? Math.max(0, Math.ceil(ritmoDia * diasHorizonte - estoqueAtual)) : 0;
    const qtd = qtdOverride[regra] ?? sugestao;
    const cobertura = ritmoDia > 0 ? (estoqueAtual + qtd) / ritmoDia : null;
    const duraAte = cobertura !== null ? addDaysFormatted(dataBase, Math.round(cobertura)) : null;
    return {
      curva,
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
    modoCurva,
    perfil.ultimoMesReal,
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
        const info = serieMes.get(m.mes);
        const projetado = info?.projetado ?? null;
        const criterio = info?.criterio ?? null;
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
          criterio,
          valorAno,
          pctSobreAnoAnterior,
          /** Mês fechado com base no ano anterior: é o que alimenta o índice YoY. */
          usadoNoIndice: !m.futuro && !m.parcial && m.qtdeAnoAnterior > 0,
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
    setFilial(null);
    setDims(EMPTY_DIMS);
    setProdutoQuery("");
    setProdutoResults([]);
    setAvisoCodigos(null);
    setComprasSelecionadas([]);
    setCompraImportada(null);
    setErroCompra(null);
    setPorItem(false);
  };

  /** O que está na tela é a rede inteira (geraram sem nenhum recorte). */
  const escopoRede =
    pedido !== null &&
    pedido.filial === null &&
    pedido.produtos.length === 0 &&
    pedido.busca === "" &&
    DIM_KEYS.every((dim) => pedido.dims[dim].length === 0);

  /** Rótulo da filial APLICADA (a do pedido, não a do select ao vivo). */
  const filialAplicadaLabel = useMemo(() => {
    const escolhida = pedido?.filial ?? null;
    if (!escolhida) return null;
    if (escolhida === VAREJO_VALUE) return "VAREJO";
    const cfg = resolveCompany(companyKey);
    return cfg?.filialDisplayNames?.[escolhida] ?? escolhida;
  }, [pedido, companyKey]);

  /** Métrica dos números NA TELA (o toggle ao vivo só vale depois de gerar). */
  const metricaAplicada: Metrica = pedido?.metrica ?? metrica;
  const ehTickets = metricaAplicada === "tickets";
  /** Aba Embalagens AO VIVO — é ela que decide quais campos o cabeçalho mostra. */
  const ehEmbalagens = metrica === "embalagens";
  /** Aba Embalagens APLICADA — é ela que decide o que aparece abaixo do título. */
  const ehEmbalagensAplicada = metricaAplicada === "embalagens";
  /** O pedido, quando ele é de embalagem: é o que dispara a consulta do painel. */
  const pedidoEmbalagens: PedidoEmbalagens | null =
    pedido && pedido.metrica === "embalagens"
      ? { dataBase: pedido.dataBase, filial: pedido.filial }
      : null;
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
            {/* Filial: o mesmo controle das outras telas (grupos canônicos, VAREJO,
                E-commerce). Recorta o universo de lojas, não o cadastro de produtos. */}
            <FilialFilter
              companyKey={companyKey}
              value={filial}
              onChange={setFilial}
              module="sales"
            />
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
            {/* Compras salvas: importa os itens e projeta cada um linha a linha, com a Qtd
                salva ao lado do sugerido. Aceita VÁRIAS — o mesmo item pedido em duas listas
                soma, porque o que se compara com a projeção é o pedido total. */}
            {metrica === "produtos" && comprasSalvas.length > 0 && (
              <MultiSelect
                label={carregandoCompra ? "Compras salvas · carregando…" : "Compras salvas"}
                variant="field"
                largura="lg"
                loading={carregandoCompra}
                searchPlaceholder="Buscar compra por título…"
                vazioLabel="Não importar"
                unidade="compra"
                unidadePlural="compras importadas"
                value={comprasSelecionadas}
                onChange={(ids) => void importarComprasSalvas(ids)}
                options={comprasSalvas.map((c) => ({
                  value: c.id,
                  label: c.title,
                  busca: `${c.title} ${ymdToBr(c.savedAt.slice(0, 10))}`,
                  meta: [
                    `${fmt(c.itemCount)} itens`,
                    `${fmt(c.totalQtdManual)} un`,
                    ymdToBr(c.savedAt.slice(0, 10)),
                    ...(c.comprada ? ["comprada"] : []),
                  ],
                }))}
              />
            )}
            {/* Sem compra importada o detalhe item a item continua disponível: é o mesmo
                cálculo, só que as linhas saem do recorte em vez da compra. */}
            {metrica === "produtos" && !compraImportada && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Detalhe</span>
                <label className={styles.checkField} title="Uma linha por produto × cor, mês a mês">
                  <input
                    type="checkbox"
                    checked={porItem}
                    onChange={(e) => setPorItem(e.target.checked)}
                  />
                  item a item
                </label>
              </label>
            )}
          </div>

          {/* Produto: busca no cadastro (mesma do Gerador de Relatórios). Cada escolha vira
              chip e o escopo é por PRODUTO — todas as cores entram. Embalagem não tem
              recorte de cadastro: a lista dela é fixa. */}
          {!ehEmbalagens && (
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
                    produtoChips.length > 0
                      ? "Adicionar outro produto — ou colar uma lista…"
                      : "Buscar produto, código — ou colar uma lista de códigos…"
                  }
                  onChange={(e) => onProdutoQueryChange(e.target.value)}
                  onFocus={() => setProdutoOpen(true)}
                  onPaste={onProdutoPaste}
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
                        : temBusca
                        ? `Sem escolher ninguém: projeta todos os itens com "${buscaLivre}" no nome`
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
          )}
        </div>

        {/* ── Filtros de cadastro (pílulas) ──────────────────────────────── */}
        <div className={styles.filterBar}>
          {!ehEmbalagens && (
          <>
          {escopoDeProduto && (
            <span
              className={styles.filterHint}
              title="Grupo, Linha, Subgrupo, Grade, Coleção, Cor e Tipo mostram só o que existe nos itens do recorte."
            >
              filtros do item
            </span>
          )}
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
          {temBusca && (
            <button
              type="button"
              className={styles.chip}
              title="Recorte por nome — remover a busca"
              onClick={() => {
                setProdutoQuery("");
                setProdutoResults([]);
              }}
            >
              nome: {buscaLivre}
              <span className={styles.chipX}>×</span>
            </button>
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
          </>
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
        {gerado && ehEmbalagensAplicada && (
          <span className={styles.scopeText}>
            {filialAplicadaLabel ? `${filialAplicadaLabel} · ` : "Rede inteira · "}
            embalagens ScarfMe
          </span>
        )}
        {gerado && !ehEmbalagensAplicada && (
          <span className={styles.scopeText}>
            {soUm ? (
              <>
                {filialAplicadaLabel && <>{filialAplicadaLabel} · </>}
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
                {filialAplicadaLabel && <>{filialAplicadaLabel} · </>}
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

      {/* A régua da projeção, recolhida por padrão. Vale para as três abas — todas usam o
          mesmo motor —, e fica ACIMA dos números porque é onde a dúvida aparece. */}
      <ProjecaoComoFunciona perfil={gerado ? perfil : null} anoBase={anoBase} />

      {ehEmbalagensAplicada ? (
        <ProjecaoEmbalagensPanel
          companyKey={companyKey}
          username={user?.username ?? ""}
          pedido={pedidoEmbalagens}
          dataBase={dataBase}
          diasHorizonte={diasHorizonte}
          regra={regra}
          onLoadingChange={setProjLoading}
        />
      ) : !gerado ? (
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
          {erroCompra && <div className={styles.erro}>{erroCompra}</div>}

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
            {/* "Projeção que falta" não dizia o que faltava. É o que ainda vai SAIR daqui
                até a data alvo — a mesma coisa que a coluna "Vai vender" da tabela item a
                item, para os dois nomes não divergirem. */}
            <div
              className={styles.kpi}
              title={
                linhaAtiva.curva
                  ? `Quanto o escopo ainda deve ${
                      ehTickets ? "receber de tickets" : "vender"
                    } entre ${ymdToBr(dataBase)} e ${ymdToBr(venderAte)} — soma mês a mês, com o mês da data base entrando só pelos dias que faltam dele.`
                  : `O que saiu nos últimos ${fmt(linhaAtiva.dias)} dias, esticado para os ${fmt(
                      diasHorizonte
                    )} dias do horizonte.`
              }
            >
              <span className={styles.kpiLabel}>
                {linhaAtiva.curva
                  ? ehTickets
                    ? `Tickets até ${ymdToBr(venderAte)}`
                    : `Vai vender até ${ymdToBr(venderAte)}`
                  : ehTickets
                  ? "Tickets da janela"
                  : "Unidades da janela"}
              </span>
              <span className={styles.kpiValue}>{linhaAtiva.disponivel ? fmt(linhaAtiva.un) : "—"}</span>
              <span className={styles.kpiHint}>
                {linhaAtiva.curva
                  ? `${unidadeLabel} nos ${fmt(diasHorizonte)} dias que faltam`
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
            {/* O valor é o MULTIPLICADOR, que é como o índice entra na conta. Mostrar
                "+100%" ao lado de "índice 2,00" era o mesmo número duas vezes. */}
            <div className={styles.kpi} title={indiceExplicacao}>
              <span className={styles.kpiLabel}>
                {linhaAtiva.curva ? `Ritmo vs ${anoBase - 1}` : `Crescimento vs ${anoBase - 1}`}
              </span>
              <span
                className={`${styles.kpiValue} ${
                  indiceExibido == null ? "" : indiceExibido >= 1 ? styles.varUp : styles.varDown
                }`}
              >
                {indiceExibido == null ? "—" : `${fmtDec(indiceExibido, 2)}×`}
                {indiceExibido != null && (
                  <span className={styles.kpiUnit}>{fmtPct(indiceExibido - 1)}</span>
                )}
              </span>
              <span className={styles.kpiHint}>{indiceHint}</span>
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
                                ? `${REGRA_LABEL[regra]}${
                                    m.criterio ? ` · ${CRITERIO_TEXTO[m.criterio]}` : ""
                                  }`
                                : m.parcial
                                ? `Mês em curso: projeção do mês cheio por ${REGRA_LABEL[regra]}${
                                    m.criterio ? ` · ${CRITERIO_TEXTO[m.criterio]}` : ""
                                  } · já vendeu ${fmt(m.qtde)} ${unidadeLabel} até ${ymdToBr(
                                    dataBase
                                  )} · fora do índice`
                                : `Realizado${m.usadoNoIndice ? " · entra no índice YoY" : ""}`
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

          {/* ── Item a item (produto × cor por mês) ───────────────────────── */}
          {!ehTickets && pedido?.porItem && (
            <ProjecaoItensMensais
              itens={Object.values(projItens)}
              compra={pedido.compra}
              dataBase={dataBase}
              venderAte={venderAte}
              diasHorizonte={diasHorizonte}
              regra={regra}
              carregando={projLoading}
              omitido={detalheItem.omitido}
              maxItens={detalheItem.max}
            />
          )}
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
