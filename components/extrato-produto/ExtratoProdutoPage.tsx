"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import { useTheme } from "@/components/theme/ThemeContext";
import type { CompanyKey } from "@/lib/config/company";
import type {
  ExtratoResponse,
  ProdutoCorOption,
  ProdutoFilialOption,
  ProdutoLookupResponse,
} from "@/app/api/extrato-produto/route";
import type { ProdutosAtivosResponse } from "@/app/api/extrato-produto/produtos/route";
import type { AdminFilialOption } from "@/app/api/extrato-produto/filiais/route";
import { FILIAIS } from "@/lib/config/filial-registry";

// ── Tema (segue o tema global do dashboard — botão único no cabeçalho) ────────

interface Palette {
  pageBg: string;
  text: string;
  heading: string;
  muted: string;
  subMuted: string;
  border: string;
  borderStrong: string;
  cardBg: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  accent: string;
  accentText: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  rowEven: string;
  rowOdd: string;
  rowDiverge: string;
  mono: string;
  romaneio: string;
  errorBg: string;
  errorBorder: string;
  errorText: string;
  dropdownHover: string;
  highlight: string;
  saldo: string;
  posNum: string;
  negNum: string;
  zeroNum: string;
  gradePos: string;
  gradeNeg: string;
  gradeWarn: string;
  warnBg: string;
  warnBorder: string;
  warnText: string;
  /** Sombra suave dos cards do layout clean. */
  cardShadow: string;
  /** Pílula de metadado (cabeçalho do produto, chips de classificação). */
  chipBg: string;
  chipText: string;
  /** Linha da tabela sob o mouse. */
  rowHover: string;
  /** Veredito "tudo confere". */
  okBg: string;
  okBorder: string;
  okText: string;
  listCor: string;
  // cores dos badges por tipo de movimento
  tipoCores: Record<string, string>;
}

const TIPO_CORES_DARK: Record<string, string> = {
  "ENTRADA NORMAL": "#86efac",
  "ENTRADA POR TRANSFERENCIA": "#22c55e",
  "SAÍDA NORMAL": "#fdba74",
  "SAÍDA POR TRANSFERÊNCIA": "#f97316",
  "AJUSTE": "#a78bfa",
  "LOJA VENDAS": "#ef4444",
  // Troca/devolução volta ao estoque (entra positivo) — família das entradas.
  "TROCA/DEVOLUÇÃO": "#38bdf8",
  // NF de saída baixa estoque (entra negativo) — família das saídas.
  "NF DE SAÍDA": "#fbbf24",
  // VM (peça em exposição) — mesma família da etiqueta VM nas telas de estoque.
  "VM": "#f87171",
};

const TIPO_CORES_LIGHT: Record<string, string> = {
  "ENTRADA NORMAL": "#16a34a",
  "ENTRADA POR TRANSFERENCIA": "#15803d",
  "SAÍDA NORMAL": "#ea580c",
  "SAÍDA POR TRANSFERÊNCIA": "#c2410c",
  "AJUSTE": "#7c3aed",
  "LOJA VENDAS": "#dc2626",
  // Troca/devolução volta ao estoque (entra positivo) — família das entradas.
  "TROCA/DEVOLUÇÃO": "#0284c7",
  // NF de saída baixa estoque (entra negativo) — família das saídas.
  "NF DE SAÍDA": "#b45309",
  // VM (peça em exposição) — mesma família da etiqueta VM nas telas de estoque.
  "VM": "#dc2626",
};

const LIGHT: Palette = {
  pageBg: "#f8fafc",
  text: "#334155",
  heading: "#0f172a",
  muted: "#64748b",
  subMuted: "#64748b",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  cardBg: "#ffffff",
  inputBg: "#ffffff",
  inputBorder: "#cbd5e1",
  inputText: "#0f172a",
  accent: "#3b82f6",
  accentText: "#ffffff",
  tableHeaderBg: "#f1f5f9",
  tableHeaderText: "#475569",
  rowEven: "#ffffff",
  rowOdd: "#f8fafc",
  rowDiverge: "#fff7ed",
  mono: "#0369a1",
  romaneio: "#7c3aed",
  errorBg: "#fef2f2",
  errorBorder: "#fca5a5",
  errorText: "#b91c1c",
  dropdownHover: "#f1f5f9",
  highlight: "#b45309",
  saldo: "#0891b2",
  posNum: "#16a34a",
  negNum: "#dc2626",
  zeroNum: "#94a3b8",
  gradePos: "#ca8a04",
  gradeNeg: "#ea580c",
  gradeWarn: "#b45309",
  warnBg: "#fffbeb",
  warnBorder: "#fde68a",
  warnText: "#92400e",
  cardShadow: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.05)",
  chipBg: "#f1f5f9",
  chipText: "#475569",
  rowHover: "#f8fafc",
  okBg: "#f0fdf4",
  okBorder: "#bbf7d0",
  okText: "#15803d",
  listCor: "#65a30d",
  tipoCores: TIPO_CORES_LIGHT,
};

const DARK: Palette = {
  // Superfícies alinhadas aos tokens globais do dashboard (app-bg/s-white/b-200)
  // para uniformidade com as demais páginas no tema noturno.
  pageBg: "#090a0e",
  text: "#e5eaf2",
  heading: "#f3f6fb",
  muted: "#8b95a6",
  subMuted: "#69737f",
  border: "#242832",
  borderStrong: "#30353f",
  cardBg: "#161922",
  inputBg: "#12141b",
  inputBorder: "#30353f",
  inputText: "#f3f6fb",
  accent: "#3b82f6",
  accentText: "#ffffff",
  tableHeaderBg: "#1d212c",
  tableHeaderText: "#8b95a6",
  rowEven: "#161922",
  rowOdd: "#12141b",
  rowDiverge: "#3a1e0a",
  mono: "#7dd3fc",
  romaneio: "#a78bfa",
  errorBg: "#450a0a",
  errorBorder: "#dc2626",
  errorText: "#fca5a5",
  dropdownHover: "#334155",
  highlight: "#f59e0b",
  saldo: "#22d3ee",
  posNum: "#86efac",
  negNum: "#fca5a5",
  zeroNum: "#64748b",
  gradePos: "#fde68a",
  gradeNeg: "#fdba74",
  gradeWarn: "#f59e0b",
  warnBg: "#1c1917",
  warnBorder: "#44403c",
  warnText: "#78716c",
  cardShadow: "0 1px 2px rgba(0,0,0,0.35)",
  chipBg: "#1d212c",
  chipText: "#b0b9c8",
  rowHover: "#1d212c",
  okBg: "rgba(34,197,94,0.12)",
  okBorder: "rgba(34,197,94,0.32)",
  okText: "#86efac",
  listCor: "#a3e635",
  tipoCores: TIPO_CORES_DARK,
};

// ── Constantes ──────────────────────────────────────────────────────────────

// Filial em branco = sem filtro. É uma opção de verdade na lista ("TODAS") porque o
// campo vazio parecia filtro aplicado — e a matriz da NERD, que no banco se chama só
// "NERD", ainda vinha somada com a rede inteira.
const TODAS_LABEL = "TODAS as filiais";

const STATUS_TRANSITO: Record<number, string> = {
  0: "Aguardando",
  2: "Em trânsito",
  3: "Recebido",
  4: "Liberado",
  5: "Encerrado",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function fmtNum(n: number) {
  return n === 0 ? "0" : n > 0 ? `+${n}` : `${n}`;
}

/** Normaliza para busca: sem acento, sem pontuação, minúsculo. */
function chaveBusca(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Apelido do registry por nome de banco: 'NERD' → "nerd matriz". Serve para achar a
 * filial pelo nome que o pessoal usa, não só pelo que está gravado no Linx — a matriz
 * da NERD se chama só "NERD" e ninguém a procura assim.
 */
const APELIDO_POR_NOME_DB: Record<string, string> = FILIAIS.reduce((acc, f) => {
  if (f.dbNameFallback) acc[chaveBusca(f.dbNameFallback)] = chaveBusca(`${f.company} ${f.display}`);
  return acc;
}, {} as Record<string, string>);

/** Rótulo curto do registry ("matriz", "e-commerce") para desempatar nomes crus do Linx. */
const DISPLAY_POR_NOME_DB: Record<string, string> = FILIAIS.reduce((acc, f) => {
  if (f.dbNameFallback) acc[chaveBusca(f.dbNameFallback)] = f.display;
  return acc;
}, {} as Record<string, string>);

interface FilialSugestao {
  filial: string;
  /** Estoque do produto nesta filial; null quando a filial não tem cadastro do item. */
  estoque: number | null;
}

/**
 * Lista do dropdown de filial: as filiais do produto primeiro (com o saldo), depois
 * TODAS as cadastradas — inclusive as sem cadastro do item. Antes o dropdown trocava
 * uma lista pela outra, então escolher um produto tirava do alcance qualquer filial
 * fora dele e não havia como abrir o extrato de uma loja que zerou.
 */
function montarSugestoesFilial(
  doProduto: ProdutoFilialOption[],
  todas: AdminFilialOption[],
  termo: string
): FilialSugestao[] {
  const vistas = new Set<string>();
  const lista: FilialSugestao[] = [];
  for (const f of doProduto) {
    const k = chaveBusca(f.filial);
    if (vistas.has(k)) continue;
    vistas.add(k);
    lista.push({ filial: f.filial, estoque: f.estoqueAtual });
  }
  for (const f of todas) {
    const k = chaveBusca(f.filial);
    if (vistas.has(k)) continue;
    vistas.add(k);
    lista.push({ filial: f.filial, estoque: null });
  }

  const tokens = chaveBusca(termo).split(" ").filter(Boolean);
  if (tokens.length === 0) return lista;
  return lista.filter((f) => {
    const k = chaveBusca(f.filial);
    const alvo = `${k} ${APELIDO_POR_NOME_DB[k] ?? ""}`;
    return tokens.every((tk) => alvo.includes(tk));
  });
}

/**
 * Rótulo curto do badge da tabela. A coluna Tipo é estreita para a grade caber sem
 * scroll horizontal; o nome completo fica no title e nas abas de filtro acima.
 */
const TIPO_CURTO: Record<string, string> = {
  "ENTRADA NORMAL": "Entrada",
  "ENTRADA POR TRANSFERENCIA": "Entrada transf.",
  "SAÍDA NORMAL": "Saída",
  "SAÍDA POR TRANSFERÊNCIA": "Saída transf.",
  "AJUSTE": "Ajuste",
  "LOJA VENDAS": "Venda",
  "TROCA/DEVOLUÇÃO": "Troca/dev.",
  "NF DE SAÍDA": "NF saída",
  "VM": "VM",
};

function badge(tipo: string, t: Palette) {
  const color = t.tipoCores[tipo] ?? t.subMuted;
  return (
    <span
      title={tipo}
      style={{
        display: "inline-block",
        background: color + "1a",
        color,
        border: `1px solid ${color}40`,
        borderRadius: 5,
        padding: "2px 7px",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {TIPO_CURTO[tipo] ?? rotuloTipo(tipo)}
    </span>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

interface ExtratoProdutoPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

export default function ExtratoProdutoPage({ companyKey }: ExtratoProdutoPageProps) {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const basePath = `/${companyKey}/extrato-produto`;
  const { theme } = useTheme();
  const t = theme === "light" ? LIGHT : DARK;
  const [produto, setProduto] = useState("");
  const [cor, setCor] = useState("");
  const [filial, setFilial] = useState("");
  const [dados, setDados] = useState<ExtratoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [lookupMsg, setLookupMsg] = useState("");
  const [coresDisponiveis, setCoresDisponiveis] = useState<ProdutoCorOption[]>([]);
  const [filiaisDisponiveis, setFiliaisDisponiveis] = useState<ProdutoFilialOption[]>([]);
  const [tiposFiltro, setTiposFiltro] = useState<string[]>([]);
  const [mostrarZeroGrade, setMostrarZeroGrade] = useState(true);
  const [allFiliais, setAllFiliais] = useState<AdminFilialOption[]>([]);
  const [showFilialDropdown, setShowFilialDropdown] = useState(false);
  const corRef = useRef(cor);
  const tableRef = useRef<HTMLDivElement>(null);
  const filialInputRef = useRef<HTMLInputElement>(null);
  const filialDropdownRef = useRef<HTMLDivElement>(null);

  // ── Responsivo ── esta página usa estilos inline (sem CSS module), então o
  // "mobile" é detectado por JS. ≤768px ativa o layout compacto de celular.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ── Lista de produtos por filial ───────────────────────────────────────────
  const [listaPage, setListaPage] = useState(1);
  const [listaLoading, setListaLoading] = useState(false);
  const [listaErro, setListaErro] = useState("");
  const [listaDados, setListaDados] = useState<ProdutosAtivosResponse | null>(null);

  const authHeader = useCallback(
    (): Record<string, string> =>
      user ? { "X-Auth-Username": user.username } : {},
    [user]
  );

  // Carrega todas as filiais disponíveis uma vez para o autocomplete.
  useEffect(() => {
    if (!user) return;
    fetch("/api/extrato-produto/filiais", { headers: authHeader() })
      .then((r) => r.json())
      .then((json) => { if (json.data) setAllFiliais(json.data); })
      .catch(() => {});
  }, [user, authHeader]);

  // Fecha dropdown de filial ao clicar fora.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        filialInputRef.current &&
        !filialInputRef.current.contains(e.target as Node) &&
        filialDropdownRef.current &&
        !filialDropdownRef.current.contains(e.target as Node)
      ) {
        setShowFilialDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Ler querystring para permitir abrir extrato automaticamente.
  useEffect(() => {
    if (!searchParams) return;
    const p = searchParams.get("produto")?.trim();
    const c = searchParams.get("cor")?.trim();
    const f = searchParams.get("filial")?.trim();

    if (p && p !== produto) setProduto(p);
    if (c && c !== cor) setCor(c);
    if (f && f !== filial) setFilial(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Se a URL vier com produto+cor, já carrega o extrato automaticamente (fluxo 1-clique).
  useEffect(() => {
    if (!user || !searchParams) return;
    const p = searchParams.get("produto")?.trim() ?? "";
    const c = searchParams.get("cor")?.trim() ?? "";
    const f = searchParams.get("filial")?.trim() ?? "";
    if (!p || !c) return;
    if (dados) return;
    fetchExtrato({ produto: p, cor: c, filial: f || filial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);

  useEffect(() => {
    corRef.current = cor;
  }, [cor]);

  useEffect(() => {
    if (!user) return;
    const termo = produto.trim();
    if (termo.length < 2) {
      setCoresDisponiveis([]);
      setFiliaisDisponiveis([]);
      setLookupMsg("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLookupLoading(true);
      setLookupMsg("");
      try {
        const params = new URLSearchParams({ produto: termo, lookup: "1" });
        if (corRef.current.trim()) params.set("cor", corRef.current.trim());
        const res = await fetch(`/api/extrato-produto?${params}`, {
          headers: authHeader(),
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erro ao buscar cores");

        const lookup = json as ProdutoLookupResponse;
        setCoresDisponiveis(lookup.coresDisponiveis ?? []);
        setFiliaisDisponiveis(lookup.filiaisDisponiveis ?? []);

        if (lookup.barcodeMatched && lookup.produto) {
          setProduto(lookup.produto);
          setLookupMsg(
            lookup.codigoBarra
              ? `Código ${lookup.codigoBarra} localizado.`
              : "Código de barras localizado."
          );
        }

        if (lookup.cor && lookup.cor !== corRef.current) {
          setCor(lookup.cor);
        } else if (
          lookup.coresDisponiveis.length === 1 &&
          lookup.coresDisponiveis[0].cor !== corRef.current
        ) {
          setCor(lookup.coresDisponiveis[0].cor);
        } else if (
          corRef.current &&
          lookup.coresDisponiveis.length > 0 &&
          !lookup.coresDisponiveis.some((item) => item.cor === corRef.current)
        ) {
          setCor("");
        }

        // Só limpa a filial se ela não for uma filial de verdade. Antes bastava o
        // produto não ter cadastro nela para o campo ser apagado — era o que tirava a
        // matriz da NERD da mão do usuário logo depois de ele digitá-la.
        const filialAtual = filial.trim();
        if (
          filialAtual &&
          allFiliais.length > 0 &&
          !allFiliais.some((f) => chaveBusca(f.filial) === chaveBusca(filialAtual)) &&
          !allFiliais.some((f) => f.codFilial === filialAtual)
        ) {
          setFilial("");
        }
      } catch (ex) {
        if ((ex as Error).name !== "AbortError") {
          setCoresDisponiveis([]);
          setFiliaisDisponiveis([]);
          setLookupMsg((ex as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setLookupLoading(false);
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [produto, cor, filial, user, authHeader, allFiliais]);

  async function buscarListaProdutos(targetPage?: number, overrideFilial?: string) {
    if (!user) return;
    const f = (overrideFilial ?? filial).trim();
    if (!f) {
      setListaDados(null);
      return;
    }

    const nextPage = Math.max(1, targetPage ?? listaPage);
    setListaLoading(true);
    setListaErro("");
    try {
      const params = new URLSearchParams({ filial: f, page: String(nextPage), pageSize: "20" });
      const res = await fetch(`/api/extrato-produto/produtos?${params}`, {
        headers: authHeader(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao listar produtos");
      setListaDados(json as ProdutosAtivosResponse);
      setListaPage(nextPage);
    } catch (e) {
      setListaErro((e as Error).message);
      setListaDados(null);
    } finally {
      setListaLoading(false);
    }
  }

  async function fetchExtrato(paramsIn: { produto: string; cor?: string; filial?: string }) {
    const p = paramsIn.produto.trim();
    if (!p) return;
    setLoading(true);
    setErro("");
    setDados(null);

    try {
      const params = new URLSearchParams({ produto: p });
      if (paramsIn.cor?.trim()) params.set("cor", paramsIn.cor.trim());
      if (paramsIn.filial?.trim()) params.set("filial", paramsIn.filial.trim());

      const res = await fetch(`/api/extrato-produto?${params}`, { headers: authHeader() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao buscar");
      setDados(json as ExtratoResponse);
      setProduto((json as ExtratoResponse).produto);
      setCor((json as ExtratoResponse).cor);
      setCoresDisponiveis((json as ExtratoResponse).coresDisponiveis ?? []);
      setFiliaisDisponiveis((json as ExtratoResponse).filiaisDisponiveis ?? []);
      setTiposFiltro([]); // reset filtro
    } catch (ex) {
      setErro((ex as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    const p = produto.trim();
    const f = filial.trim();

    // Fluxo 1: só filial => lista paginada de produtos por atividade
    if (!p) {
      if (!f) {
        setErro("Preencha Filial para listar produtos (ou informe Produto/Código de barras).");
        return;
      }
      setErro("");
      setListaErro("");
      setListaPage(1);
      setDados(null);
      await buscarListaProdutos(1, f);
      return;
    }

    // Fluxo 2: produto informado => extrato normal
    setListaDados(null);
    await fetchExtrato({ produto: p, cor, filial: f });
  }

  if (!user) return null;

  // ── Grade de tamanhos ──
  // Só produto de grade múltipla (P/M/G, 36/38/40...) tem tamanhos; na prática isso
  // hoje só existe no fashion da ScarfMe. Em tamanho único a lista vem vazia e a tela
  // continua exatamente como era, com a coluna única de grade.
  const tamanhos = dados?.tamanhos ?? [];
  const multiTamanho = tamanhos.length > 1;
  const estoquePorTamanho = dados?.estoquePorTamanho ?? [];

  // ── Filtros e saldo corrente ──
  const tiposDisponiveis = dados
    ? [...new Set(dados.linhas.map((l) => l.tipo))].sort()
    : [];
  const saldoMovimentos = dados
    ? dados.linhas.reduce((s, l) => s + l.qtde, 0)
    : 0;
  const saldoGrade = dados
    ? dados.linhas.reduce((s, l) => s + l.qtdeGrade, 0)
    : 0;
  const diferencaEstoque = dados ? dados.estoqueAtual - saldoMovimentos : 0;


  const linhasFiltradas = dados
    ? dados.linhas.filter((l) => {
        if (tiposFiltro.length > 0 && !tiposFiltro.includes(l.tipo)) return false;
        if (!mostrarZeroGrade) {
          // Em grade múltipla o "zero" é a soma dos tamanhos, não só a 1ª posição.
          const grade = multiTamanho
            ? l.qtdePorTamanho?.reduce((s, v) => s + v, 0) ?? l.qtde
            : l.qtdeGrade;
          if (grade === 0) return false;
        }
        return true;
      })
    : [];

  // Saldo calculado em ordem cronológica (ascendente) para ficar correto,
  // depois invertido para exibição do mais recente ao mais antigo.
  let saldo = 0;
  const linhasComSaldo = [...linhasFiltradas.map((l) => {
    saldo += l.qtde;
    return { ...l, saldoAcumulado: saldo };
  })].reverse();

  // Totais por tipo
  const totaisPorTipo = tiposDisponiveis.map((tipo) => {
    const ls = dados!.linhas.filter((l) => l.tipo === tipo);
    return {
      tipo,
      qtde: ls.reduce((s, l) => s + l.qtde, 0),
      qtdeGrade: ls.reduce((s, l) => s + l.qtdeGrade, 0),
      porTamanho: tamanhos.map((_, idx) =>
        ls.reduce((s, l) => s + (l.qtdePorTamanho?.[idx] ?? 0), 0)
      ),
      count: ls.length,
    };
  });

  const inputStyle = makeInputStyle(t, isMobile);
  const th = makeTh(t);
  const card: React.CSSProperties = {
    background: t.cardBg,
    border: `1px solid ${t.border}`,
    borderRadius: 12,
    boxShadow: t.cardShadow,
  };
  const labelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    fontSize: 12,
    fontWeight: 500,
    color: t.subMuted,
    ...(isMobile ? { width: "100%" } : {}),
  };

  // Soma de grade dos movimentos: em grade múltipla é a soma dos tamanhos, porque
  // qtdeGrade sozinho seria só a 1ª posição (o P) e não fecharia com o QTDE.
  const saldoGradeTotal = dados
    ? multiTamanho
      ? dados.linhas.reduce((s, l) => s + (l.qtdePorTamanho?.reduce((a, v) => a + v, 0) ?? 0), 0)
      : saldoGrade
    : 0;
  const confereEstoque = diferencaEstoque === 0;
  const confereGrade = saldoGradeTotal === saldoMovimentos;
  const tudoConfere = confereEstoque && confereGrade;

  // Larguras proporcionais das colunas. A tabela é `table-layout: fixed` para caber na
  // largura da página sem scroll horizontal — o que não couber trunca com "…" e o valor
  // inteiro fica no title. Em grade múltipla cada tamanho vira uma coluna estreita e aí
  // a tabela pode voltar a rolar, o que é esperado.
  const larguraColunas = [
    6,  // Data
    11, // Tipo
    9,  // Documento
    7,  // Romaneio
    8,  // Origem
    8,  // Destino
    5,  // QTDE
    ...(multiTamanho ? tamanhos.map(() => 4) : [6]), // Grade
    5,  // Saldo
    7,  // Preço
    7,  // Trânsito
    10, // Responsável
    11, // OBS
  ];
  const somaColunas = larguraColunas.reduce((s, v) => s + v, 0);

  return (
    <main
      style={{
        padding: isMobile ? "16px 12px" : "24px 28px",
        fontFamily: SANS,
        // A página vive num `.content` com `flex: 1` (sem min-width: 0): sem isto, o
        // conteúdo mais largo estica a coluna inteira e a barra de busca e a ficha do
        // produto saem cortadas junto com a tabela.
        minWidth: 0,
        maxWidth: "100%",
        minHeight: "100vh",
        background: t.pageBg,
        color: t.text,
      }}
    >
      {/* ── Cabeçalho ── */}
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: "4px 0 6px", fontSize: isMobile ? 22 : 27, fontWeight: 700, letterSpacing: "-0.02em", color: t.heading }}>
          Extrato de Produto
        </h1>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: t.muted, maxWidth: 980 }}>
          Visualiza todos os movimentos de estoque de um produto+cor+filial, mostrando a diferença
          entre o campo QTDE (total) e os campos de grade (EN_1/SA_1...). Em produto de grade
          múltipla (P/M/G, 36/38/40...) o estoque e cada movimento aparecem quebrados por tamanho.
        </p>
      </header>

      {/* ── Barra de busca ── */}
      <form
        onSubmit={buscar}
        style={{
          ...card,
          padding: isMobile ? 14 : "14px 16px",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: 14,
        }}
      >
        <label style={labelStyle}>
          Produto ou código de barras *
          <span style={{ position: "relative", display: "block", ...(isMobile ? { width: "100%" } : {}) }}>
            <input
              type="text"
              value={produto}
              onChange={(e) => {
                setProduto(e.target.value);
                setDados(null);
                setFiliaisDisponiveis([]);
              }}
              placeholder="Ex: 13.71.0365 ou 789..."
              style={{ ...inputStyle, paddingRight: 32 }}
            />
            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: t.muted, display: "flex", pointerEvents: "none" }}>
              <IconeBusca />
            </span>
          </span>
        </label>
        <label style={labelStyle}>
          Cor *
          {coresDisponiveis.length > 0 ? (
            <select
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              style={{ ...inputStyle, width: isMobile ? "100%" : 240, cursor: "pointer" }}
            >
              <option value="">Selecione</option>
              {coresDisponiveis.map((item) => (
                <option key={item.cor} value={item.cor}>
                  {item.cor} – {item.descCor ?? "sem descrição"} ({item.estoqueAtual} un)
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              placeholder="Ex: 03"
              style={{ ...inputStyle, width: isMobile ? "100%" : 96 }}
            />
          )}
        </label>
        <label style={labelStyle}>
          Filial
          <div style={{ position: "relative", ...(isMobile ? { width: "100%" } : {}) }}>
            <input
              ref={filialInputRef}
              type="text"
              value={filial}
              onChange={(e) => { setFilial(e.target.value); setShowFilialDropdown(true); }}
              onFocus={() => setShowFilialDropdown(true)}
              placeholder={TODAS_LABEL}
              style={{ ...inputStyle, width: isMobile ? "100%" : 210, paddingRight: 30 }}
              autoComplete="off"
            />
            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: t.muted, display: "flex", pointerEvents: "none" }}>
              <IconeChevron />
            </span>
            {showFilialDropdown && (() => {
              const q = filial.trim();
              const sugestoes = montarSugestoesFilial(filiaisDisponiveis, allFiliais, q)
                .slice(0, 12)
                .map((f) => {
                  const display = DISPLAY_POR_NOME_DB[chaveBusca(f.filial)];
                  const rotulo = display && chaveBusca(display) !== chaveBusca(f.filial)
                    ? ` · ${display.toLowerCase()}`
                    : "";
                  return {
                    filial: f.filial,
                    rotulo,
                    extra: f.estoque === null ? " (sem cadastro do item)" : ` (${f.estoque} un)`,
                  };
                });
              const mostrarTodas = q === "" || chaveBusca(TODAS_LABEL).includes(chaveBusca(q));
              if (!mostrarTodas && sugestoes.length === 0) return null;
              return (
                <div
                  ref={filialDropdownRef}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    minWidth: 240,
                    background: t.cardBg,
                    border: `1px solid ${t.border}`,
                    borderRadius: 10,
                    zIndex: 50,
                    maxHeight: 260,
                    overflowY: "auto",
                    boxShadow: "0 12px 32px rgba(15,23,42,0.16)",
                    padding: 4,
                  }}
                >
                  {mostrarTodas && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setFilial("");
                        setShowFilialDropdown(false);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        background: "none",
                        border: "none",
                        borderRadius: 7,
                        color: filial.trim() ? t.muted : t.accent,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        display: "flex",
                        gap: 5,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = t.dropdownHover; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                    >
                      <span>{TODAS_LABEL}</span>
                      <span style={{ color: t.muted, fontWeight: 400 }}>(rede inteira)</span>
                    </button>
                  )}
                  {sugestoes.map((s) => (
                    <button
                      key={s.filial}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setFilial(s.filial);
                        setShowFilialDropdown(false);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        background: "none",
                        border: "none",
                        borderRadius: 7,
                        color: t.heading,
                        cursor: "pointer",
                        fontSize: 12,
                        fontFamily: "inherit",
                        display: "flex",
                        gap: 5,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = t.dropdownHover; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                    >
                      <span>
                        {s.filial}
                        {s.rotulo && <span style={{ color: t.subMuted }}>{s.rotulo}</span>}
                      </span>
                      {s.extra && <span style={{ color: t.muted }}>{s.extra}</span>}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </label>
        <button
          type="submit"
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            padding: "0 20px",
            background: t.accent,
            color: t.accentText,
            border: "none",
            borderRadius: 8,
            cursor: loading ? "progress" : "pointer",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            height: 38,
            ...(isMobile ? { width: "100%" } : {}),
          }}
        >
          <IconeBusca />
          {loading ? "Buscando..." : "Buscar"}
        </button>

        {/* Controles de exibição ficam na própria barra para não virar mais uma faixa. */}
        {dados && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 12,
              color: t.subMuted,
              height: 38,
              ...(isMobile ? { width: "100%" } : { marginLeft: "auto" }),
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={mostrarZeroGrade}
                onChange={(e) => setMostrarZeroGrade(e.target.checked)}
                style={{ accentColor: t.accent, width: 15, height: 15, cursor: "pointer" }}
              />
              Exibir movimentos com grade = 0
            </label>
            <span style={{ width: 1, height: 18, background: t.border }} />
            <span style={{ whiteSpace: "nowrap" }}>
              {tiposFiltro.length > 0 || !mostrarZeroGrade
                ? `${linhasFiltradas.length} de ${dados.linhas.length} movimentos`
                : `${dados.linhas.length} movimentos`}
            </span>
          </div>
        )}
      </form>

      {(lookupLoading || lookupMsg || coresDisponiveis.length > 0 || filiaisDisponiveis.length > 0) && (
        <div style={{ marginTop: -4, marginBottom: 14, fontSize: 12, color: lookupMsg.includes("Erro") ? t.errorText : t.subMuted }}>
          {lookupLoading
            ? "Buscando cores e filiais disponíveis..."
            : lookupMsg ||
              `${coresDisponiveis.length} cor${coresDisponiveis.length === 1 ? "" : "es"} e ${filiaisDisponiveis.length} ${filiaisDisponiveis.length === 1 ? "filial" : "filiais"} com cadastro deste produto (${filiaisDisponiveis.filter((f) => f.estoqueAtual !== 0).length} com saldo). Qualquer outra filial também pode ser selecionada.`}
        </div>
      )}

      {erro && (
        <div style={{ background: t.errorBg, border: `1px solid ${t.errorBorder}`, borderRadius: 10, padding: "10px 16px", color: t.errorText, marginBottom: 14, fontSize: 13 }}>
          {erro}
        </div>
      )}

      {/* ── Lista de produtos por filial (quando buscar sem produto) ── */}
      {listaDados && (
        <div style={{ marginBottom: 20 }}>
          {listaErro && (
            <div style={{ background: t.errorBg, border: `1px solid ${t.errorBorder}`, borderRadius: 10, padding: "10px 16px", color: t.errorText, marginBottom: 12, fontSize: 13 }}>
              {listaErro}
            </div>
          )}

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10, color: t.subMuted, fontSize: 12 }}>
            <span>
              {listaDados.total} produto(s) com movimento em <strong style={{ color: t.text }}>{listaDados.filial}</strong> · página {listaDados.page}
            </span>
            <span style={{ marginLeft: "auto" }}>20 por página · mais recente → mais antigo</span>
          </div>

          <div style={{ ...card, overflow: "hidden" }}>
            {listaDados.items.map((item, i) => (
              <button
                key={`${item.produto}-${item.cor}`}
                type="button"
                onClick={() => {
                  // 1 clique: seleciona produto+cor do movimento mais recente e já busca o extrato
                  const p = item.produto;
                  const c = item.cor;
                  const f = listaDados.filial;

                  setProduto(p);
                  setCor(c);
                  setFilial(f);
                  setListaDados(null);

                  const params = new URLSearchParams({ produto: p, cor: c, filial: f });
                  router.replace(`${basePath}?${params.toString()}`);
                  fetchExtrato({ produto: p, cor: c, filial: f });
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: "11px 14px",
                  background: t.cardBg,
                  border: "none",
                  borderTop: i === 0 ? "none" : `1px solid ${t.border}`,
                  cursor: "pointer",
                  color: t.text,
                  fontFamily: "inherit",
                  fontSize: 13,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = t.rowHover; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = t.cardBg; }}
              >
                <span style={{ fontFamily: MONO, color: t.mono, minWidth: 110 }}>
                  {item.produto}
                </span>
                <span style={{ color: t.listCor, fontFamily: MONO, minWidth: 40 }}>
                  {item.cor || "—"}
                </span>
                <span style={{ color: t.subMuted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.descProduto ?? "—"}
                </span>
                <span style={{ color: t.muted, fontSize: 12, whiteSpace: "nowrap" }}>
                  {fmtDate(item.ultimoMovimento)}
                </span>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              disabled={listaLoading || listaPage <= 1}
              onClick={() => buscarListaProdutos(listaPage - 1)}
              style={{
                padding: "7px 13px",
                background: t.cardBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >
              ← Anterior
            </button>
            <button
              type="button"
              disabled={listaLoading || listaPage * listaDados.pageSize >= listaDados.total}
              onClick={() => buscarListaProdutos(listaPage + 1)}
              style={{
                padding: "7px 13px",
                background: t.cardBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >
              Próxima →
            </button>
          </div>
        </div>
      )}

      {/* ── Resultado ── */}
      {dados && (
        <>
          {/* Ficha do produto + conferência (estoque físico = movimentos = grade) */}
          <section
            style={{
              ...card,
              padding: isMobile ? 14 : "16px 18px",
              marginBottom: 14,
              display: "flex",
              gap: isMobile ? 14 : 22,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background: t.chipBg,
                color: t.muted,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <IconeCaixa size={24} />
            </div>

            <div style={{ flex: "1 1 340px", minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, color: t.heading, letterSpacing: "-0.01em" }}>
                {dados.produto} – {dados.descProduto ?? "?"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 0", marginTop: 7, fontSize: 11.5 }}>
                {[
                  dados.codigoBarra ? { k: "Cód. barras", v: dados.codigoBarra } : null,
                  { k: "Cor", v: `${dados.cor} – ${dados.descCor ?? "?"}` },
                  { k: "Grade", v: dados.grade ?? "—" },
                  { k: "Filial", v: dados.filial },
                  dados.linha ? { k: "Linha", v: dados.linha } : null,
                  dados.subgrupo ? { k: "Subgrupo", v: dados.subgrupo } : null,
                  dados.grupo ? { k: "Grupo", v: dados.grupo } : null,
                  dados.tipoProduto ? { k: "Tipo", v: dados.tipoProduto } : null,
                  dados.colecao
                    ? { k: "Coleção", v: dados.descColecao ? `${dados.colecao} – ${dados.descColecao}` : dados.colecao }
                    : null,
                ]
                  .filter((x): x is { k: string; v: string } => x != null)
                  .map((item, idx, arr) => (
                    <span key={item.k} style={{ display: "inline-flex", alignItems: "center" }}>
                      <span style={{ color: t.muted }}>{item.k}:&nbsp;</span>
                      <span style={{ color: t.text, fontWeight: 500 }}>{item.v}</span>
                      {idx < arr.length - 1 && (
                        <span style={{ margin: "0 10px", width: 1, height: 11, background: t.border, display: "inline-block" }} />
                      )}
                    </span>
                  ))}
              </div>
            </div>

            {/* A conferência é uma equação: o número do Linx, o saldo remontado e a grade. */}
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, flexWrap: "wrap" }}>
              <Metrica
                icone={<IconeCaixa />}
                label="Estoque físico"
                valor={`${dados.estoqueAtual} un`}
                sub={multiTamanho ? tamanhos.map((tam, idx) => `${tam.label} ${estoquePorTamanho[idx] ?? 0}`).join(" · ") : undefined}
                t={t}
              />
              <SinalIgual ok={confereEstoque} t={t} />
              <Metrica icone={<IconeTroca />} label="Movimentos acumulados" valor={`${saldoMovimentos} un`} t={t} />
              <SinalIgual ok={confereGrade} t={t} />
              <Metrica icone={<IconeGrade />} label="Grade" valor={`${saldoGradeTotal} un`} t={t} />
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderRadius: 10,
                background: tudoConfere ? t.okBg : t.warnBg,
                border: `1px solid ${tudoConfere ? t.okBorder : t.warnBorder}`,
                color: tudoConfere ? t.okText : t.warnText,
                fontSize: 14,
                fontWeight: 600,
                whiteSpace: "nowrap",
                ...(isMobile ? { width: "100%", justifyContent: "center" } : {}),
              }}
            >
              {tudoConfere ? <IconeCheck /> : <IconeAlerta />}
              {tudoConfere
                ? "Tudo confere"
                : !confereEstoque
                ? `Divergência de ${diferencaEstoque} un`
                : "Grade divergente"}
            </div>
          </section>

          {/* Abas por tipo de movimento — clicar filtra a tabela. */}
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: isMobile ? "nowrap" : "wrap",
              overflowX: isMobile ? "auto" : "visible",
              paddingBottom: isMobile ? 4 : 0,
              marginBottom: 14,
            }}
          >
            <AbaTipo
              ativo={tiposFiltro.length === 0}
              cor={t.accent}
              icone={<IconeGrade />}
              titulo="Todos"
              detalhe={`${dados.linhas.length}`}
              detalheForte
              onClick={() => setTiposFiltro([])}
              t={t}
            />
            {totaisPorTipo.map((resumo) => {
              const corTipo = t.tipoCores[resumo.tipo] ?? t.subMuted;
              return (
                <AbaTipo
                  key={resumo.tipo}
                  ativo={tiposFiltro.includes(resumo.tipo)}
                  cor={corTipo}
                  icone={iconeTipo(resumo.tipo)}
                  titulo={rotuloTipo(resumo.tipo)}
                  detalhe={`${resumo.count}x · QTDE: ${fmtNum(resumo.qtde)}`}
                  extra={
                    multiTamanho
                      ? tamanhos.map((tam, idx) => `${tam.label}: ${fmtNum(resumo.porTamanho[idx] ?? 0)}`).join(" · ")
                      : resumo.qtde !== resumo.qtdeGrade
                      ? `Grade: ${fmtNum(resumo.qtdeGrade)}`
                      : undefined
                  }
                  onClick={() =>
                    setTiposFiltro((prev) =>
                      prev.includes(resumo.tipo) ? prev.filter((x) => x !== resumo.tipo) : [...prev, resumo.tipo]
                    )
                  }
                  t={t}
                />
              );
            })}
          </div>

          {/* Tabela */}
          <div ref={tableRef} style={{ ...card, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  minWidth: multiTamanho ? 900 : isMobile ? 760 : undefined,
                  tableLayout: "fixed",
                  borderCollapse: "collapse",
                  fontSize: 11.5,
                }}
              >
                <colgroup>
                  {larguraColunas.map((largura, i) => (
                    <col key={i} style={{ width: `${(largura / somaColunas) * 100}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ background: t.tableHeaderBg, color: t.tableHeaderText }}>
                    <th style={th}>Data</th>
                    <th style={th}>Tipo</th>
                    <th style={th}>Documento</th>
                    <th style={th} title="Romaneio / pedido">Romaneio</th>
                    <th style={th} title="Filial de origem">Origem</th>
                    <th style={th} title="Filial de destino">Destino</th>
                    <th style={{ ...th, textAlign: "right", color: t.heading }}>QTDE</th>
                    {multiTamanho ? (
                      tamanhos.map((tam) => (
                        <th key={tam.ordinal} style={{ ...th, color: t.highlight, textAlign: "right" }}>
                          {tam.label}
                        </th>
                      ))
                    ) : (
                      <th
                        style={{ ...th, textAlign: "right", color: t.highlight }}
                        title={`Grade ${dados.grade ?? "?"} (campo EN_1/SA_1)`}
                      >
                        Grade
                      </th>
                    )}
                    <th style={{ ...th, textAlign: "right", color: t.saldo }}>Saldo</th>
                    <th style={{ ...th, textAlign: "right" }}>Preço</th>
                    <th style={th} title="Status do trânsito">Trânsito</th>
                    <th style={th}>Responsável</th>
                    <th style={th}>OBS</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasComSaldo.map((l, i) => {
                    // Em grade múltipla, "grade zerada" tem que olhar a soma dos tamanhos:
                    // um movimento só de M tem EN_1 = 0 e não é divergência nenhuma.
                    const somaTamanhos = l.qtdePorTamanho?.reduce((s, v) => s + v, 0) ?? 0;
                    const diverge = multiTamanho
                      ? l.qtde !== 0 && l.qtdePorTamanho != null && somaTamanhos === 0
                      : l.qtde !== 0 && l.qtdeGrade === 0;
                    const bgLinha = diverge ? t.rowDiverge : t.cardBg;
                    return (
                      <tr
                        key={i}
                        style={{ background: bgLinha, borderTop: `1px solid ${t.border}` }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = diverge ? t.rowDiverge : t.rowHover; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = bgLinha; }}
                      >
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDate(l.emissao)}</td>
                        <td style={td}>{badge(l.tipo, t)}</td>
                        <td
                          style={{ ...td, fontFamily: MONO, color: t.mono, whiteSpace: l.cancelada ? "normal" : "nowrap", lineHeight: 1.45 }}
                          title={l.doc}
                        >
                          {l.doc}
                          {/* Linha de venda cancelada: fica visível para auditoria, mas
                              com movimento 0 — a venda não aconteceu, o estoque nunca desceu. */}
                          {l.cancelada && (
                            <span
                              style={{
                                display: "inline-block",
                                marginTop: 2,
                                fontFamily: SANS,
                                fontSize: 9.5,
                                fontWeight: 600,
                                color: t.warnText,
                                background: t.warnBg,
                                border: `1px solid ${t.warnBorder}`,
                                borderRadius: 4,
                                padding: "1px 5px",
                              }}
                            >
                              Cancelada
                            </span>
                          )}
                        </td>
                        <td style={{ ...td, color: t.romaneio, fontFamily: MONO, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            title={l.romaneio ?? undefined}>
                          {l.romaneio ?? "—"}
                        </td>
                        <td style={{ ...td, color: t.subMuted, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            title={l.filialOrigem ?? undefined}>
                          {l.filialOrigem ?? "—"}
                        </td>
                        <td style={{ ...td, color: t.subMuted, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            title={l.filialDestino ?? undefined}>
                          {l.filialDestino ?? "—"}
                        </td>
                        <td style={{ ...td, textAlign: "right", color: l.qtde > 0 ? t.posNum : l.qtde < 0 ? t.negNum : t.zeroNum, fontWeight: 700 }}>
                          {fmtNum(l.qtde)}
                        </td>
                        {multiTamanho ? (
                          tamanhos.map((tam, idx) => {
                            const v = l.qtdePorTamanho?.[idx];
                            if (v == null) {
                              return (
                                <td
                                  key={tam.ordinal}
                                  style={{ ...td, textAlign: "right", color: t.muted }}
                                  title="Fonte sem detalhe de grade (ajuste manual do dashboard)"
                                >
                                  —
                                </td>
                              );
                            }
                            return (
                              <td
                                key={tam.ordinal}
                                style={{ ...td, textAlign: "right", fontWeight: 700, color: v > 0 ? t.gradePos : v < 0 ? t.gradeNeg : t.zeroNum }}
                              >
                                {v === 0 ? "·" : fmtNum(v)}
                              </td>
                            );
                          })
                        ) : (
                          <td style={{ ...td, textAlign: "right", color: l.qtdeGrade > 0 ? t.gradePos : l.qtdeGrade < 0 ? t.gradeNeg : (diverge ? t.gradeWarn : t.zeroNum), fontWeight: 700 }}>
                            {diverge ? (
                              <span title="Grade zerada! QTDE tem valor mas EN_1/SA_1 = 0. Pode causar divergência no extrato Linx.">
                                ⚠ {fmtNum(l.qtdeGrade)}
                              </span>
                            ) : (
                              fmtNum(l.qtdeGrade)
                            )}
                          </td>
                        )}
                        <td style={{ ...td, textAlign: "right", color: t.saldo, fontWeight: 700 }}>
                          {l.saldoAcumulado}
                        </td>
                        <td style={{ ...td, textAlign: "right", color: t.subMuted, whiteSpace: "nowrap" }}>
                          {l.preco > 0 ? `R$ ${l.preco.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ ...td, color: t.subMuted }}>
                          {l.statusTransito != null
                            ? STATUS_TRANSITO[l.statusTransito] ?? l.statusTransito
                            : "—"}
                        </td>
                        <td style={{ ...td, color: l.responsavel ? t.subMuted : t.muted, whiteSpace: "nowrap" }}
                            title={l.responsavel ?? "Sem responsável registrado nesta fonte"}>
                          {l.responsavel ?? "—"}
                        </td>
                        <td style={{ ...td, color: t.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            title={l.obs ?? undefined}>
                          {l.obs ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {linhasComSaldo.length === 0 && (
                    <tr>
                      <td colSpan={multiTamanho ? 12 + tamanhos.length : 13} style={{ ...td, textAlign: "center", color: t.muted, padding: 32 }}>
                        Nenhum movimento encontrado com os filtros atuais.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legenda — recolhida por padrão para não competir com a tabela. */}
          <details style={{ ...card, marginTop: 14, padding: "12px 16px", fontSize: 12, color: t.muted }}>
            <summary style={{ cursor: "pointer", color: t.subMuted, fontWeight: 600, userSelect: "none" }}>
              Legenda e origem dos dados
            </summary>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 8, marginTop: 12 }}>
              <div>
                <strong style={{ color: t.heading }}>QTDE</strong> — campo total declarado no romaneio
              </div>
              {multiTamanho ? (
                <div>
                  <strong style={{ color: t.highlight }}>
                    {tamanhos.map((tam) => tam.label).join(" / ")}
                  </strong>{" "}
                  — quantidade por posição da grade {dados.grade ?? "?"} (EN_1..EN_{tamanhos.length} /
                  SA_1..SA_{tamanhos.length}; venda pelo TAMANHO do item). “·” = zero naquele tamanho.
                </div>
              ) : (
                <div>
                  <strong style={{ color: t.highlight }}>Grade ({dados.grade ?? "?"})</strong> — campo EN_1/SA_1 (grade específica)
                </div>
              )}
              <div>
                <strong style={{ color: t.saldo }}>Saldo</strong> — acumulado cronológico pelo campo QTDE
              </div>
              <div>
                <strong style={{ color: t.highlight }}>⚠ Grade zerada</strong> — QTDE tem valor mas EN_1/SA_1 = 0 → divergência no Linx
              </div>
              <div>
                <strong>Status Trânsito 4 = Liberado</strong> — entrada liberada do trânsito pela tela de liberação
              </div>
              <div>
                <strong>ENTRADA NORMAL</strong> — tabela ESTOQUE_PROD_ENT (inclui transferências, ajustes, produção)
              </div>
              <div>
                <strong>SAIDA NORMAL</strong> — tabela ESTOQUE_PROD_SAI (inclui transferências, ajustes)
              </div>
              <div>
                <strong>LOJA ENTRADAS</strong> — tabela LOJA_ENTRADAS (romaneios confirmados via loja)
              </div>
            </div>
          </details>

          {/* Erros da API */}
          {dados.erros.length > 0 && (
            <div style={{ marginTop: 14, padding: 12, background: t.warnBg, border: `1px solid ${t.warnBorder}`, borderRadius: 10, fontSize: 11, color: t.warnText }}>
              <p style={{ margin: "0 0 6px" }}>Avisos da API:</p>
              {dados.erros.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </>
      )}
    </main>
  );
}

// ── Sub-componentes ─────────────────────────────────────────────────────────

/** Um dos três números da equação de conferência (estoque = movimentos = grade). */
function Metrica({
  icone,
  label,
  valor,
  sub,
  t,
}: {
  icone: React.ReactNode;
  label: string;
  valor: string;
  sub?: string;
  t: Palette;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ color: t.muted, display: "flex", flexShrink: 0 }}>{icone}</span>
      <span>
        <span style={{ display: "block", fontSize: 11, color: t.muted, whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ display: "block", fontSize: 20, fontWeight: 700, color: t.heading, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
          {valor}
        </span>
        {sub && <span style={{ display: "block", fontSize: 10.5, color: t.subMuted }}>{sub}</span>}
      </span>
    </div>
  );
}

/** Ligação entre dois números da equação: "=" quando bate, "≠" quando não. */
function SinalIgual({ ok, t }: { ok: boolean; t: Palette }) {
  return (
    <span style={{ fontSize: 17, fontWeight: 600, color: ok ? t.muted : t.negNum }} aria-hidden>
      {ok ? "=" : "≠"}
    </span>
  );
}

/** Aba de filtro por tipo de movimento. */
function AbaTipo({
  ativo,
  cor,
  icone,
  titulo,
  detalhe,
  extra,
  detalheForte,
  onClick,
  t,
}: {
  ativo: boolean;
  cor: string;
  icone: React.ReactNode;
  titulo: string;
  detalhe: string;
  extra?: string;
  detalheForte?: boolean;
  onClick: () => void;
  t: Palette;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 14px",
        borderRadius: 10,
        border: `1px solid ${ativo ? cor : t.border}`,
        background: ativo ? cor + "16" : t.cardBg,
        boxShadow: t.cardShadow,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        flexShrink: 0,
        color: t.text,
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: cor + "1f",
          color: cor,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        {icone}
      </span>
      <span>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: cor, whiteSpace: "nowrap" }}>
          {titulo}
        </span>
        <span
          style={{
            display: "block",
            fontSize: detalheForte ? 17 : 12.5,
            fontWeight: detalheForte ? 700 : 500,
            color: t.heading,
            whiteSpace: "nowrap",
            lineHeight: 1.25,
          }}
        >
          {detalhe}
        </span>
        {extra && (
          <span style={{ display: "block", fontSize: 10.5, color: t.highlight, whiteSpace: "nowrap" }}>{extra}</span>
        )}
      </span>
    </button>
  );
}

// ── Ícones ──────────────────────────────────────────────────────────────────
// Inline (sem dependência): stroke em currentColor, então herdam a cor do tipo.

const svgProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconeBusca({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function IconeChevron({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IconeCaixa({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

function IconeGrade({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconeTroca({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M4 8h15l-3.5-3.5" />
      <path d="M20 16H5l3.5 3.5" />
    </svg>
  );
}

function IconeSetaCima({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M12 20V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}

function IconeSetaBaixo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M12 4v15" />
      <path d="M6 13l6 6 6-6" />
    </svg>
  );
}

function IconeSetaDireita({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function IconeEngrenagem({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  );
}

function IconeCarrinho({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h3l2.6 12h11L21 7H6" />
    </svg>
  );
}

function IconeCiclo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M20 12a8 8 0 0 1-13.7 5.6" />
      <path d="M4 12a8 8 0 0 1 13.7-5.6" />
      <path d="M17.5 3v3.5H14" />
      <path d="M6.5 21v-3.5H10" />
    </svg>
  );
}

function IconeNota({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function IconeEtiqueta({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M20.6 12.6L12 21.2 3.4 12.6V3.4h9.2z" />
      <circle cx="8" cy="8" r="1.4" />
    </svg>
  );
}

function IconeCheck({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps} strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

function IconeAlerta({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps} strokeWidth={2}>
      <path d="M12 3.5L21.5 20h-19z" />
      <path d="M12 10v4M12 17.2v.1" />
    </svg>
  );
}

/** Ícone por tipo de movimento — a família (entra/sai) fica legível de relance. */
function iconeTipo(tipo: string): React.ReactNode {
  switch (tipo) {
    case "ENTRADA NORMAL":
      return <IconeSetaCima />;
    case "ENTRADA POR TRANSFERENCIA":
      return <IconeTroca />;
    case "SAÍDA NORMAL":
      return <IconeSetaBaixo />;
    case "SAÍDA POR TRANSFERÊNCIA":
      return <IconeSetaDireita />;
    case "AJUSTE":
      return <IconeEngrenagem />;
    case "LOJA VENDAS":
      return <IconeCarrinho />;
    case "TROCA/DEVOLUÇÃO":
      return <IconeCiclo />;
    case "NF DE SAÍDA":
      return <IconeNota />;
    case "VM":
      return <IconeEtiqueta />;
    default:
      return <IconeGrade />;
  }
}

/** "SAÍDA POR TRANSFERÊNCIA" → "Saída por transferência" (siglas ficam como estão). */
function rotuloTipo(tipo: string) {
  return tipo
    .split(" ")
    .map((palavra, i) => {
      if (palavra === "NF" || palavra === "VM" || palavra === "OP") return palavra;
      const minusculo = palavra.toLocaleLowerCase("pt-BR");
      return i === 0 ? minusculo.charAt(0).toLocaleUpperCase("pt-BR") + minusculo.slice(1) : minusculo;
    })
    .join(" ");
}

// ── Estilos inline ──────────────────────────────────────────────────────────

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function makeInputStyle(t: Palette, isMobile = false): React.CSSProperties {
  return {
    padding: "9px 11px",
    background: t.inputBg,
    border: `1px solid ${t.inputBorder}`,
    borderRadius: 8,
    color: t.inputText,
    fontSize: 13,
    fontFamily: "inherit",
    width: isMobile ? "100%" : 210,
    height: 38,
    outline: "none",
  };
}

function makeTh(t: Palette): React.CSSProperties {
  return {
    padding: "10px 9px",
    textAlign: "left",
    fontSize: 10.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    borderBottom: `1px solid ${t.border}`,
  };
}

// Com `table-layout: fixed`, é a célula que precisa truncar — daí o ellipsis na base.
const td: React.CSSProperties = {
  padding: "8px 9px",
  fontSize: 11.5,
  verticalAlign: "middle",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
