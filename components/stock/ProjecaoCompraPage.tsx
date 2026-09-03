"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import { formatDateForQuery } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProjecaoCompraPage.module.css";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface PickerRow {
  produto: string;
  descricao: string;
  cor?: string;
  corDescricao?: string;
  codigoBarra?: string;
  grade?: string;
  grupo?: string;
  linha?: string;
  subgrupo?: string;
  colecao?: string;
  tipoProduto?: string;
  estoque?: number;
}

interface CurvaAbcResponse {
  produtos: PickerRow[];
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
  itens: ProjecaoItem[];
  mensal: MensalItem[];
}

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
const EMPTY_DIM_OPTIONS: Record<DimKey, MultiSelectOption[]> = {
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
/** Valor da dimensão numa linha do universo (mesma normalização das opções: UPPER/trim). */
function dimValue(row: PickerRow, dim: DimKey): string {
  const raw =
    dim === "grupo"
      ? row.grupo
      : dim === "linha"
      ? row.linha
      : dim === "subgrupo"
      ? row.subgrupo
      : dim === "grade"
      ? row.grade
      : dim === "colecao"
      ? row.colecao
      : dim === "cor"
      ? row.corDescricao || row.cor
      : row.tipoProduto;
  return (raw ?? "").trim().toUpperCase();
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
/** 'yyyy-MM' → 'jan/26'. */
function mesLabel(mesYm: string): string {
  const [ano, mes] = mesYm.split("-").map(Number);
  return `${MES_NOME[mes - 1]}/${String(ano).slice(2)}`;
}
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

  // Universo pesquisável — reusa o dataset da Curva ABC (12m, rede, por cor): traz
  // estoque atual + as dimensões de cadastro de cada item (produto × cor).
  const [pickerRows, setPickerRows] = useState<PickerRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [dims, setDims] = useState<DimState>(EMPTY_DIMS);
  const [dimOptions, setDimOptions] = useState<Record<DimKey, MultiSelectOption[]>>(EMPTY_DIM_OPTIONS);
  // Já nasce carregando: o efeito abaixo dispara na montagem e só desliga por dimensão.
  const [dimLoading, setDimLoading] = useState<Partial<Record<DimKey, boolean>>>(() =>
    Object.fromEntries(DIM_KEYS.map((dim) => [dim, true]))
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Projeção (unidades vendidas por janela) — vem do endpoint dedicado.
  const [projItens, setProjItens] = useState<Record<string, ProjecaoItem>>({});
  const [mensal, setMensal] = useState<MensalItem[]>([]);
  const [projLoading, setProjLoading] = useState(false);
  const [projErro, setProjErro] = useState<string | null>(null);
  const [regra, setRegra] = useState<RegraProjecao>("yoy");

  // Overrides editáveis (amarelos da planilha).
  const [estoqueOverride, setEstoqueOverride] = useState<number | null>(null);
  const [qtdOverride, setQtdOverride] = useState<Record<string, number | null>>({});

  // Debounce da busca do picker.
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Fecha o dropdown de produtos ao clicar fora.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

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
        .then((json: { data?: Array<string | MultiSelectOption> }) => {
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

  // ── Carrega a base de produtos (uma vez por empresa): últimos 12 meses, rede inteira,
  //    por cor — dá o universo pesquisável com estoque atual e metadados de cadastro.
  useEffect(() => {
    let cancelled = false;
    setPickerLoading(true);
    const { start, end } = janela12Meses();
    const params = new URLSearchParams({ company: companyKey, start, end, porCor: "1" });
    fetch(`/api/curva-abc?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: CurvaAbcResponse) => {
        if (!cancelled) setPickerRows(Array.isArray(json.produtos) ? json.produtos : []);
      })
      .catch(() => {
        if (!cancelled) setPickerRows([]);
      })
      .finally(() => {
        if (!cancelled) setPickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey]);

  const pickerByKey = useMemo(() => {
    const map = new Map<string, PickerRow>();
    pickerRows.forEach((p) => map.set(rowKey(p.produto, p.cor), p));
    return map;
  }, [pickerRows]);

  /** Rótulo bonito da coleção ("DESCRIÇÃO (CÓDIGO)") para os chips. */
  const colecaoLabels = useMemo(() => {
    const map = new Map<string, string>();
    dimOptions.colecao.forEach((opt) => map.set(opt.value, opt.label));
    return map;
  }, [dimOptions.colecao]);

  const dimChipLabel = (dim: DimKey, value: string) =>
    dim === "colecao" ? colecaoLabels.get(value) ?? value : value;

  // ── Escopo ────────────────────────────────────────────────────────────────
  /** Uma linha do universo casa com todos os filtros marcados. */
  const matchesDims = useCallback(
    (row: PickerRow) =>
      DIM_KEYS.every((dim) => dims[dim].length === 0 || dims[dim].includes(dimValue(row, dim))),
    [dims]
  );

  const dimFiltradas = useMemo(() => DIM_KEYS.filter((dim) => dims[dim].length > 0), [dims]);
  const temDimensao = dimFiltradas.length > 0;
  const temSelecao = selectedKeys.size > 0;

  /** Itens do escopo quando ele vem dos filtros (sem seleção manual de produto). */
  const dimScopeRows = useMemo(
    () => (temDimensao ? pickerRows.filter((row) => matchesDims(row)) : []),
    [temDimensao, pickerRows, matchesDims]
  );

  // ── Busca a projeção sempre que muda o escopo ou a data base.
  //    venderAte e Qtd Compra são puro cálculo no cliente (não vão ao servidor).
  useEffect(() => {
    const params = new URLSearchParams({ company: companyKey, base: dataBase });
    if (temSelecao) {
      // Seleção manual manda: projeta exatamente os itens escolhidos (produto × cor).
      selectedKeys.forEach((key) => params.append("item", key));
    } else if (temDimensao) {
      // Sem seleção, o recorte de cadastro vai para o SQL (nada de listar milhares de códigos).
      DIM_KEYS.forEach((dim) => dims[dim].forEach((v) => params.append(dim, v)));
    } else {
      setProjItens({});
      setMensal([]);
      setProjErro(null);
      return;
    }

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
        setMensal(Array.isArray(json.mensal) ? json.mensal : []);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setProjItens({});
        setMensal([]);
        setProjErro(error.message || "Erro ao calcular a projeção");
      })
      .finally(() => {
        if (!cancelled) setProjLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey, dataBase, selectedKeys, dims, temSelecao, temDimensao]);

  // Trocar a data base ou o escopo zera os overrides (a base de cálculo mudou).
  useEffect(() => {
    setEstoqueOverride(null);
    setQtdOverride({});
  }, [dataBase, selectedKeys, dims]);

  // ── Itens selecionados resolvidos (metadados do picker + janelas da projeção).
  const selectedItems = useMemo(() => {
    return Array.from(selectedKeys)
      .map((key) => {
        const picker = pickerByKey.get(key);
        const proj = projItens[key];
        const produto = key.split("||")[0];
        const cor = key.split("||")[1] ?? "";
        return {
          key,
          produto,
          cor,
          descricao: picker?.descricao || proj?.descricao || produto,
          corDescricao: picker?.corDescricao || proj?.corDescricao || cor,
          codigoBarra: picker?.codigoBarra || proj?.codigoBarra || "",
          grade: picker?.grade || proj?.grade || "",
          estoque: Math.max(0, picker?.estoque ?? 0),
          janelas: proj?.janelas ?? {},
        };
      })
      .sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
  }, [selectedKeys, pickerByKey, projItens]);

  // ── Agregado do escopo: estoque somado + unidades vendidas somadas por janela.
  //    Seleção manual → só os itens escolhidos. Filtros → tudo o que o SQL devolveu.
  const agregado = useMemo(() => {
    const unidades: Record<number, number> = {};
    if (temSelecao) {
      const estoqueSomado = selectedItems.reduce((s, it) => s + it.estoque, 0);
      WINDOWS_DIAS.forEach((dias) => {
        // Piso 0 no TOTAL (não por item): a quantidade líquida de um item pode ser negativa
        // quando houve mais troca que venda, e descartar essas linhas antes de somar infla o
        // total — ver [[vendas-nunca-filtrar-linhas-da-regra-global]].
        unidades[dias] = Math.max(
          0,
          selectedItems.reduce((s, it) => s + (Number(it.janelas[String(dias)] ?? 0) || 0), 0)
        );
      });
      return { estoqueSomado, unidades, itens: selectedItems.length };
    }
    const projList = Object.values(projItens);
    WINDOWS_DIAS.forEach((dias) => {
      unidades[dias] = Math.max(
        0,
        projList.reduce((s, it) => s + (Number(it.janelas[String(dias)] ?? 0) || 0), 0)
      );
    });
    const estoqueSomado = dimScopeRows.reduce((s, row) => s + Math.max(0, row.estoque ?? 0), 0);
    return { estoqueSomado, unidades, itens: Math.max(dimScopeRows.length, projList.length) };
  }, [temSelecao, selectedItems, projItens, dimScopeRows]);

  const estoqueAtual = estoqueOverride ?? agregado.estoqueSomado;
  const diasHorizonte = Math.max(0, diffDays(dataBase, venderAte));
  const hasScope = temSelecao || temDimensao;
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
        // % sempre contra o MESMO mês do ano anterior: mês realizado usa o que vendeu, mês
        // futuro usa a projeção da regra escolhida (assim a coluna nunca fica vazia).
        const valorCelula = m.futuro ? projetado : m.qtde;
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
    // O que ainda falta vender no ano: meses futuros inteiros + o resto do mês em curso.
    const projetadoRestante = mensalRows.reduce(
      (s, r) => s + (r.futuro ? r.projetado ?? 0 : Math.max(0, r.valorAno - r.qtde)),
      0
    );
    return {
      anoAnterior,
      realizado,
      ano,
      projetadoRestante,
      variacao: anoAnterior > 0 ? ano / anoAnterior - 1 : null,
    };
  }, [mensalRows]);

  // ── Picker: universo já recortado pelos filtros de dimensão + busca textual.
  const pickerFiltered = useMemo(() => {
    let rows = pickerRows.filter((row) => matchesDims(row));
    if (searchDebounced) {
      rows = rows.filter((p) => {
        const hay = `${p.descricao ?? ""} ${p.produto ?? ""} ${p.codigoBarra ?? ""} ${p.corDescricao ?? ""} ${p.subgrupo ?? ""} ${p.colecao ?? ""}`.toLowerCase();
        return hay.includes(searchDebounced);
      });
    }
    return rows;
  }, [pickerRows, matchesDims, searchDebounced]);
  const pickerVisible = useMemo(() => pickerFiltered.slice(0, 120), [pickerFiltered]);

  const toggleKey = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const limparTudo = () => {
    setSelectedKeys(new Set());
    setDims(EMPTY_DIMS);
    setSearch("");
  };

  const soUm = temSelecao && selectedItems.length === 1 ? selectedItems[0] : null;

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.headerCard}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Projeção Compra</h1>
          <span
            className={`${styles.loadingCue} ${projLoading || pickerLoading ? styles.loadingCueActive : ""}`}
            role="status"
          >
            <span className={styles.spinner} aria-hidden="true" />
            Calculando…
          </span>
        </div>
        <p className={styles.subtitle}>
          Escolha o escopo — pelos filtros de cadastro (grupo, linha, subgrupo, grade, coleção, cor,
          tipo) ou por produtos específicos (um ou vários) — e veja quanto comprar para o estoque
          durar até a data alvo. O ritmo é medido em várias janelas (loja + e-commerce) com a venda
          validada global. Mude a data ou a quantidade e tudo recalcula na hora.
        </p>
      </div>

      {/* Menus (acima da tabela) */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarRow}>
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
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Estoque atual (un)</span>
            <input
              type="number"
              className={styles.input}
              value={estoqueAtual}
              min={0}
              disabled={!hasScope}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value)));
                setEstoqueOverride(Number.isNaN(v as number) ? null : v);
              }}
            />
          </label>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Dias no horizonte</span>
            <span className={styles.computed}>{fmt(diasHorizonte)}</span>
          </div>
          {estoqueOverride !== null && hasScope && (
            <button type="button" className={styles.resetLink} onClick={() => setEstoqueOverride(null)}>
              ↺ voltar ao estoque real ({fmt(agregado.estoqueSomado)} un)
            </button>
          )}
        </div>

        {/* Um select por dimensão (só some quando a empresa não tem opção nenhuma) */}
        <div className={styles.toolbarRow}>
          {DIM_KEYS.map((dim) =>
            dimOptions[dim].length > 0 || dims[dim].length > 0 ? (
              <MultiSelectFilter
                key={dim}
                label={DIM_LABEL[dim]}
                value={dims[dim]}
                options={dimOptions[dim]}
                loading={!!dimLoading[dim]}
                onChange={(values) => setDims((prev) => ({ ...prev, [dim]: values }))}
              />
            ) : null
          )}

          {/* Picker de produtos (produto × cor), multi-seleção */}
          <div className={styles.produtoPicker} ref={pickerRef}>
            <span className={styles.fieldLabel}>Produtos</span>
            <button
              type="button"
              className={`${styles.pickerButton} ${pickerOpen ? styles.pickerButtonActive : ""}`}
              onClick={() => setPickerOpen((prev) => !prev)}
            >
              <span>
                {selectedItems.length === 0
                  ? "Todos do filtro"
                  : selectedItems.length === 1
                  ? selectedItems[0].descricao
                  : `${selectedItems.length} itens`}
              </span>
              <span>▼</span>
            </button>
            {pickerOpen && (
              <div className={styles.pickerDropdown}>
                <div className={styles.searchBox}>
                  <input
                    className={styles.searchInput}
                    type="text"
                    placeholder="Buscar produto, código, cor…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      type="button"
                      className={styles.searchClear}
                      onClick={() => setSearch("")}
                      aria-label="Limpar"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className={styles.pickerList}>
                  {pickerLoading ? (
                    <div className={styles.pickerEmpty}>Carregando produtos…</div>
                  ) : pickerVisible.length === 0 ? (
                    <div className={styles.pickerEmpty}>Nenhum produto encontrado.</div>
                  ) : (
                    pickerVisible.map((p) => {
                      const key = rowKey(p.produto, p.cor);
                      const checked = selectedKeys.has(key);
                      return (
                        <label
                          key={key}
                          className={`${styles.pickerRow} ${checked ? styles.pickerRowActive : ""}`}
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleKey(key)} />
                          <span className={styles.pickerInfo}>
                            <span className={styles.pickerName}>{p.descricao || p.produto}</span>
                            <span className={styles.pickerMeta}>
                              {(p.corDescricao || p.cor) && <span>{p.corDescricao || p.cor}</span>}
                              <span>{(p.codigoBarra || p.produto).trim()}</span>
                              <span>{fmt(Math.max(0, p.estoque ?? 0))} un</span>
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                <div className={styles.pickerFoot}>
                  <span>
                    {fmt(pickerFiltered.length)} itens no filtro
                    {pickerFiltered.length > pickerVisible.length
                      ? ` · mostrando ${fmt(pickerVisible.length)}, busque para refinar`
                      : ""}
                  </span>
                  {temSelecao && (
                    <button
                      type="button"
                      className={styles.pickerFootAction}
                      onClick={() => setSelectedKeys(new Set())}
                    >
                      limpar seleção
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {hasScope && (
            <button type="button" className={styles.clearAll} onClick={limparTudo}>
              Limpar filtros
            </button>
          )}
        </div>

        {/* Chips do escopo ativo */}
        {hasScope && (
          <div className={styles.chips}>
            {dimFiltradas.flatMap((dim) =>
              dims[dim].map((value) => (
                <button
                  key={`${dim}:${value}`}
                  type="button"
                  className={styles.chip}
                  title={`Remover filtro de ${DIM_LABEL[dim]}`}
                  onClick={() =>
                    setDims((prev) => ({ ...prev, [dim]: prev[dim].filter((v) => v !== value) }))
                  }
                >
                  <span className={styles.chipDim}>{DIM_LABEL[dim]}</span>
                  {dimChipLabel(dim, value)} ×
                </button>
              ))
            )}
            {temSelecao && temDimensao && (
              <span className={styles.chipNote}>
                com produtos selecionados, os filtros só recortam a busca — a projeção usa os itens
                escolhidos
              </span>
            )}
            {selectedItems.map((it) => (
              <button
                key={it.key}
                type="button"
                className={`${styles.chip} ${styles.chipProduto}`}
                title="Remover da seleção"
                onClick={() => toggleKey(it.key)}
              >
                {it.descricao}
                {it.corDescricao || it.cor ? ` · ${it.corDescricao || it.cor}` : ""} ×
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Projeção (tabela em tela cheia) */}
      {!hasScope ? (
        <div className={styles.emptyPanel}>
          <div className={styles.emptyIcon}>🎯</div>
          <div className={styles.emptyTitle}>Escolha um escopo para projetar</div>
          <div className={styles.emptyText}>
            Use os filtros de cadastro acima — grupo, linha, subgrupo, grade, coleção, cor, tipo — ou
            selecione produtos específicos. Tudo o que estiver no escopo é somado num único bloco de
            compra.
          </div>
        </div>
      ) : (
        <div className={styles.projCard}>
          {/* Cabeçalho do escopo */}
          <div className={styles.projHead}>
            <div className={styles.projTitle}>Análise de giro e sugestão de compra</div>
            {soUm ? (
              <div className={styles.projSubtitle}>
                <strong>{soUm.descricao}</strong>
                {(soUm.corDescricao || soUm.cor) && <> · {soUm.corDescricao || soUm.cor}</>}
                {soUm.codigoBarra && <> · cód. {soUm.codigoBarra}</>}
                {soUm.grade && <> · {soUm.grade}</>}
                {" · "}estoque <strong>{fmt(estoqueAtual)}</strong> un · vender até{" "}
                <strong>{ymdToBr(venderAte)}</strong> ({fmt(diasHorizonte)} dias)
              </div>
            ) : (
              <div className={styles.projSubtitle}>
                <strong>{fmt(agregado.itens)}</strong> itens (produto × cor) somados · estoque{" "}
                <strong>{fmt(estoqueAtual)}</strong> un · vender até{" "}
                <strong>{ymdToBr(venderAte)}</strong> ({fmt(diasHorizonte)} dias)
              </div>
            )}
          </div>

          {projErro && <div className={styles.erro}>{projErro}</div>}

          {/* Regra do ritmo (select) + a linha calculada */}
          <div className={styles.regraBar}>
            <label className={styles.regraField}>
              <span className={styles.fieldLabel}>Regra do ritmo</span>
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
            <div className={styles.regraNota}>
              {regra === "yoy" ? (
                crescimento.media != null ? (
                  <>
                    Crescimento médio <strong>{fmtPct(crescimento.media)}</strong> em{" "}
                    <strong>{fmt(crescimento.meses.length)}</strong>{" "}
                    {crescimento.meses.length === 1 ? "mês fechado" : "meses fechados"} contra o
                    mesmo mês do ano anterior, aplicado mês a mês até {ymdToBr(venderAte)}.
                  </>
                ) : (
                  <>Sem mês comparável no ano anterior para medir crescimento neste escopo.</>
                )
              ) : (
                <>
                  Ritmo medido nos últimos {fmt(Number(regra))} dias antes da data base, mantido
                  constante até {ymdToBr(venderAte)}.
                </>
              )}
            </div>
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thLeft}>Regra</th>
                  <th>Dias</th>
                  <th>Unidades</th>
                  <th>Ritmo (un/dia)</th>
                  <th>Ritmo (un/mês)</th>
                  <th>Sugestão compra</th>
                  <th>Qtd Compra</th>
                  <th>Cobertura (dias)</th>
                  <th>Dura até</th>
                </tr>
              </thead>
              <tbody>
                <tr className={styles.rowBase}>
                  <td className={styles.tdLeft}>{REGRA_LABEL[regra]}</td>
                  <td className={styles.num}>{fmt(linhaAtiva.dias)}</td>
                  <td
                    className={styles.num}
                    title={
                      linhaAtiva.yoy
                        ? "Unidades PROJETADAS no horizonte pela regra de crescimento"
                        : "Unidades vendidas na janela (venda líquida validada, com trocas)"
                    }
                  >
                    {linhaAtiva.disponivel ? (
                      <>
                        {fmt(linhaAtiva.un)}
                        {linhaAtiva.yoy && <span className={styles.projTag}>proj.</span>}
                      </>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td className={styles.num}>
                    {linhaAtiva.disponivel ? fmtDec(linhaAtiva.ritmoDia) : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.num}>
                    {linhaAtiva.disponivel ? fmtDec(linhaAtiva.ritmoMes, 1) : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={`${styles.num} ${styles.sugestao}`}>
                    {linhaAtiva.disponivel ? fmt(linhaAtiva.sugestao) : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.num}>
                    <input
                      type="number"
                      className={`${styles.qtdInput} ${linhaAtiva.editado ? styles.qtdInputEdited : ""}`}
                      value={linhaAtiva.qtd}
                      min={0}
                      disabled={!linhaAtiva.disponivel}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setQtdOverride((prev) => ({
                          ...prev,
                          [regra]: raw === "" ? 0 : Math.max(0, Math.round(Number(raw))),
                        }));
                      }}
                    />
                  </td>
                  <td className={styles.num}>
                    {linhaAtiva.cobertura !== null ? fmt(linhaAtiva.cobertura) : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.num}>{linhaAtiva.duraAte ?? <span className={styles.muted}>—</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.footNote}>
            Como usar: altere <strong>Qtd Compra</strong> (ou o estoque / as datas) e as colunas{" "}
            <strong>Cobertura</strong> e <strong>Dura até</strong> se ajustam sozinhas. A{" "}
            <strong>Sugestão de compra</strong> é a quantidade para o estoque durar exatamente até{" "}
            <strong>Vender até</strong>. Ritmo = unidades vendidas na janela ÷ dias (loja +
            e-commerce), pela venda líquida validada global (com trocas). O{" "}
            <strong>estoque</strong> do escopo soma os itens com venda nos últimos 12 meses (saldos
            positivos da rede) — ajuste o campo à mão quando quiser outro cenário. Na regra{" "}
            <strong>Crescimento YoY</strong> não existe janela de dias: os <em>Dias</em> são o
            próprio horizonte e as <em>Unidades</em> já são a projeção mês a mês até{" "}
            <strong>Vender até</strong>.
          </div>
        </div>
      )}

      {/* Vendas por mês: meses em COLUNAS, quantidade + % de crescimento na mesma célula */}
      {hasScope && (
        <div className={styles.projCard}>
          <div className={styles.mensalHead}>
            <div>
              <div className={styles.projTitle}>Vendas por mês — {anoBase}</div>
              <div className={styles.mensalSubtitle}>
                Cada célula traz a quantidade e o crescimento sobre o mesmo mês do ano anterior.
                Mês fechado é realizado; o mês em curso vai até {ymdToBr(dataBase)}; os que faltam
                são projeção por <strong>{REGRA_LABEL[regra]}</strong>.
              </div>
            </div>
            <div className={styles.mensalKpis}>
              <div className={styles.kpi}>
                <span className={styles.kpiLabel}>Crescimento médio</span>
                <span className={styles.kpiValue}>{fmtPct(crescimento.media)}</span>
                <span className={styles.kpiHint}>
                  {crescimento.meses.length > 0
                    ? `${fmt(crescimento.meses.length)} ${
                        crescimento.meses.length === 1 ? "mês fechado" : "meses fechados"
                      }`
                    : "sem base comparável"}
                </span>
              </div>
              <div className={styles.kpi}>
                <span className={styles.kpiLabel}>Projeção que falta</span>
                <span className={styles.kpiValue}>
                  {fmt(Math.round(mensalTotais.projetadoRestante))}
                </span>
                <span className={styles.kpiHint}>un até dez/{String(anoBase).slice(2)}</span>
              </div>
            </div>
          </div>

          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.mensalTable}`}>
              <thead>
                <tr>
                  <th className={`${styles.thLeft} ${styles.stickyCol}`}>Série</th>
                  {mensalRows.map((m) => (
                    <th key={m.mes} className={m.futuro ? styles.thFuturo : undefined}>
                      {mesLabel(m.mes)}
                    </th>
                  ))}
                  <th className={styles.thTotal}>Total</th>
                </tr>
              </thead>
              <tbody>
                {mensalRows.length === 0 ? (
                  <tr>
                    <td className={`${styles.tdLeft} ${styles.stickyCol}`} colSpan={14}>
                      <span className={styles.muted}>
                        {projLoading
                          ? "Carregando a série mensal…"
                          : "Sem série mensal para o escopo."}
                      </span>
                    </td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td className={`${styles.tdLeft} ${styles.stickyCol}`}>{anoBase - 1}</td>
                      {mensalRows.map((m) => (
                        <td key={m.mes} className={styles.num}>
                          {fmt(m.qtdeAnoAnterior)}
                        </td>
                      ))}
                      <td className={`${styles.num} ${styles.tdTotal}`}>
                        {fmt(mensalTotais.anoAnterior)}
                      </td>
                    </tr>
                    <tr>
                      <td className={`${styles.tdLeft} ${styles.stickyCol}`}>
                        {anoBase}
                        <span className={styles.rowHint}>realizado / projeção</span>
                      </td>
                      {mensalRows.map((m) => {
                        const valor = m.futuro ? m.projetado : m.qtde;
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
                                ? `Parcial: até ${ymdToBr(dataBase)} (fora da média de crescimento)`
                                : "Realizado"
                            }
                          >
                            <span className={styles.cellQtd}>
                              {valor == null ? "—" : fmt(Math.round(valor))}
                            </span>
                            <span
                              className={`${styles.cellPct} ${
                                pct == null
                                  ? styles.muted
                                  : pct >= 0
                                  ? styles.varUp
                                  : styles.varDown
                              }`}
                            >
                              {fmtPct(pct)}
                            </span>
                            {m.parcial && <span className={styles.cellFlag}>parcial</span>}
                            {m.futuro && <span className={styles.cellFlag}>proj.</span>}
                          </td>
                        );
                      })}
                      <td className={`${styles.num} ${styles.tdTotal}`}>
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
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.footNote}>
            A linha <strong>{anoBase - 1}</strong> é o mês inteiro do ano anterior. Na linha{" "}
            <strong>{anoBase}</strong>, a <strong>%</strong> ao lado da quantidade é sempre o
            crescimento sobre o mesmo mês do ano anterior. A <strong>média de crescimento</strong>{" "}
            usa só os meses fechados com base no ano anterior — o mês em curso (<em>parcial</em>)
            fica fora porque a comparação seria injusta. O <strong>Total</strong> é o realizado dos
            meses fechados somado à projeção dos que faltam.
          </div>
        </div>
      )}
    </div>
  );
}
