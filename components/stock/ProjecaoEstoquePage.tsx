"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { getMonth, getYear } from "date-fns";

import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
import { resolveCompany } from "@/lib/config/company";
import { useAuth } from "@/components/auth/AuthContext";

import styles from "./ProjecaoEstoquePage.module.css";

const TOOLTIP_OFFSET = 8;

// Tipo mínimo para callbacks do ExcelJS (evita any implícito)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

// ── Tipos para simulação de compras futuras ───────────────────────────────────
interface SimCompra {
  mesIdx: number;
  mesNumero: number;
  ano: number;
  qtd: number;
  data: string;
}
interface SimLeafData {
  meses: ProjecaoMensal[];
  compras: SimCompra[];
}
interface SimRowCompra {
  mesNumero: number;
  ano: number;
  qtd: number;
  custo: number;
  data: string;
}
interface SimRowData {
  mesesSimByNum: Map<number, { estoque: number; duracao: number }>;
  compras: SimRowCompra[];
}

const MESES_NOMES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

// --- Types (alinhados a API: varejo + e-commerce ja somados no backend) ---
interface ProjecaoMensal {
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  mes: string;
  mesNumero: number;
  ano: number;
  vendas: number;
  estoque: number;
  duracao: number;
  isMesAtual: boolean;
  isMesPassado: boolean;
  vendasReais?: number;
  vendasVarejo?: number;
  vendasEcommerce?: number;
  vendasVarejoReal?: number;
  vendasEcommerceReal?: number;
  /** Estoque/duração do snapshot daquele mês (preenchido ao virar o mês) */
  estoqueRealSnapshot?: number;
  duracaoRealSnapshot?: number;
}

interface ProjecaoCategoria {
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  produto?: string;
  descricao?: string;
  cor?: string;
  meses: ProjecaoMensal[];
}

// --- API ---
async function fetchProjecao(
  company: string,
  filial: string | null,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<{ data: ProjecaoCategoria[]; snapshotOk: boolean }> {
  const params = new URLSearchParams({ company, dataType: "projecao-mensal" });
  if (filial) params.set("filial", filial);
  grupos.forEach((g) => params.append("grupos", g));
  linhas.forEach((l) => params.append("linhas", l));
  colecoes.forEach((c) => params.append("colecoes", c));
  subgrupos.forEach((s) => params.append("subgrupos", s));
  grades.forEach((g) => params.append("grades", g));

  const res = await fetch(`/api/controle-estoque?${params.toString()}`, { cache: "no-store" });
  const json = (await res.json()) as {
    error?: string;
    data?: ProjecaoCategoria[];
    snapshot?: { ok?: boolean; snapshot_date?: string | null };
  };
  if (!res.ok) {
    const msg = typeof json?.error === "string" ? json.error : "Erro ao carregar projecao";
    throw new Error(msg);
  }
  return { data: json.data ?? [], snapshotOk: Boolean(json.snapshot?.ok) };
}

function fmt(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function fmtBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

interface ProdutoSugestaoMin {
  produto: string;
  valor3meses: number;
  vendas3meses: number;
}

/** Item individual com necessidade de reposição */
interface ReposicaoItem {
  produto: string;
  descricao: string;
  cor?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  linha?: string;
  qtdCompra: number;
  estoqueReal: number;
  duracaoReal: number;
  consumoDiario: number;
  diasCobertura: number;
  necessidadeTotal: number;
  custoUnit?: number;
}

/**
 * Varre `projecoes` para encontrar itens individuais dentro do escopo de `proj`
 * que precisam de reposição, retornando cada um com sua própria qty calculada.
 */
function computeReposicaoScope(
  proj: ProjecaoCategoria,
  projecoes: ProjecaoCategoria[],
  getReaisPorMesFn: (p: ProjecaoCategoria) => { estoqueAtualReal: number; duracaoRealMesAtual: number }
): ReposicaoItem[] {
  const isLençosLine = proj.categoria === "LENÇOS" || proj.categoria === "APROVEITAMENTO LENÇOS";
  const limiteDiasAlerta = isLençosLine ? 120 : 90;

  // Filtra projecoes ao escopo do proj clicado
  const inScope = projecoes.filter(p => {
    if (p.categoria !== proj.categoria) return false;
    if (proj.subgrupo && p.subgrupo !== proj.subgrupo) return false;
    if (proj.grade && p.grade !== proj.grade) return false;
    if (proj.produto && p.produto !== proj.produto) return false;
    if (proj.cor && p.cor !== proj.cor) return false;
    return true;
  });

  const result: ReposicaoItem[] = [];
  for (const item of inScope) {
    const { estoqueAtualReal, duracaoRealMesAtual } = getReaisPorMesFn(item);
    for (const mes of item.meses) {
      let duracaoReal = 0, estoqueReal = 0;
      if (mes.isMesAtual) {
        duracaoReal = duracaoRealMesAtual;
        estoqueReal = estoqueAtualReal;
      } else if (mes.isMesPassado) {
        duracaoReal = mes.duracaoRealSnapshot ?? 0;
        estoqueReal = mes.estoqueRealSnapshot ?? 0;
      } else continue;

      if (duracaoReal > 0 && duracaoReal <= limiteDiasAlerta && estoqueReal > 0) {
        const consumoDiario = estoqueReal / duracaoReal;
        const diasCobertura = 30 + limiteDiasAlerta;
        const necessidadeTotal = consumoDiario * diasCobertura;
        const qtdCompra = Math.max(0, Math.round(necessidadeTotal - estoqueReal));
        if (qtdCompra > 0) {
          result.push({
            produto: item.produto?.trim() ?? '',
            descricao: item.descricao ?? item.produto ?? item.categoria,
            cor: item.cor,
            subgrupo: item.subgrupo,
            grade: item.grade,
            colecao: item.colecao,
            linha: item.linha,
            qtdCompra,
            estoqueReal,
            duracaoReal,
            consumoDiario,
            diasCobertura,
            necessidadeTotal,
          });
        }
        break;
      }
    }
  }
  return result;
}

// ── Calcula dias até o estoque se esgotar a partir de startIndex ─────────────
function calcDiasAteAcabar(meses: ProjecaoMensal[], startIndex: number): number {
  const hoje = new Date();
  const diasNoMesAtual = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const diasRestantesMesAtual = Math.max(0, diasNoMesAtual - hoje.getDate());
  const estoqueInicio = meses[startIndex]?.estoque ?? 0;
  if (estoqueInicio <= 0) return 0;
  let remaining = estoqueInicio;
  let totalDias = 0;
  let ultimoConsumo = 0;
  for (let j = startIndex; j < meses.length; j++) {
    const mesJ = meses[j];
    const isMesAtualJ = mesJ.isMesAtual;
    const v = isMesAtualJ && mesJ.vendasReais != null ? Math.max(0, mesJ.vendas - mesJ.vendasReais) : mesJ.vendas;
    const diasMes = isMesAtualJ && diasRestantesMesAtual > 0 ? diasRestantesMesAtual : new Date(mesJ.ano, mesJ.mesNumero, 0).getDate();
    if (diasMes <= 0 || v <= 0) continue;
    const consumo = v / diasMes;
    ultimoConsumo = consumo;
    const dias = remaining / consumo;
    if (dias >= diasMes) {
      totalDias += diasMes;
      remaining -= v;
    } else {
      totalDias += Math.round(dias);
      remaining = 0;
      break;
    }
  }
  if (remaining > 0 && ultimoConsumo > 0) totalDias += Math.round(remaining / ultimoConsumo);
  else if (remaining > 0) {
    const last = meses[meses.length - 1];
    const d = new Date(last.ano, last.mesNumero, 0).getDate();
    if (d > 0 && last.vendas > 0) totalDias += Math.round(remaining / (last.vendas / d));
  }
  return totalDias;
}

// --- Default excluded lines (ScarfMe) ---
function getExcludedLines(companyKey: CompanyKey): Set<string> {
  const config = resolveCompany(companyKey);
  if (config?.excludedLines?.length)
    return new Set(config.excludedLines.map((l) => l.toUpperCase().trim()));
  return new Set([
    "PRIVATE LABEL", "GASTRONOMICA", "PERFUMARIA", "CASHMERE",
    "ELETRONICOS", "EMBALAGENS", "CAPAS E ACESSORIOS P/ CEL",
  ]);
}

export default function ProjecaoEstoquePage({
  companyKey,
}: {
  companyKey: CompanyKey;
  companyName?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [filial, setFilial] = useState<string | null>(searchParams.get("filial") || null);
  const [grupos, setGrupos] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<string[]>([]);
  const [colecoes, setColecoes] = useState<string[]>([]);
  const [subgrupos, setSubgrupos] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [expansao, setExpansao] = useState<Map<string, { nivel: number; subgrupoSelecionado?: string; gradeSelecionado?: string; produtoSelecionado?: string }>>(new Map());
  const [projecoes, setProjecoes] = useState<ProjecaoCategoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshotOk, setSnapshotOk] = useState(false);
  const [floatingTooltip, setFloatingTooltip] = useState<{
    varejo: string;
    ecommerce: string;
    x: number;
    y: number;
    above: boolean;
    projecaoReal?: string;
  } | null>(null);
  const [compraDebugTooltip, setCompraDebugTooltip] = useState<{
    x: number;
    y: number;
    above: boolean;
    estoqueReal: number;
    duracaoReal: number;
    consumoDiario: number;
    diasCobertura: number;
    necessidadeTotal: number;
    qtdCompra: number;
    limiteDias: number;
  } | null>(null);
  const [simCompraTooltip, setSimCompraTooltip] = useState<{
    x: number;
    y: number;
    above: boolean;
    items: Array<{ label: string; qtd: number; estoque: number; consumoDiario: number; diasCobertura: number }>;
    total: number;
  } | null>(null);
  const expansaoRestoredRef = useRef(false);

  const [opcoesGrupos, setOpcoesGrupos] = useState<string[]>([]);
  const [opcoesLinhas, setOpcoesLinhas] = useState<string[]>([]);
  const [opcoesColecoes, setOpcoesColecoes] = useState<string[]>([]);
  const [opcoesSubgrupos, setOpcoesSubgrupos] = useState<string[]>([]);
  const [opcoesGrades, setOpcoesGrades] = useState<string[]>([]);

  // Consulta por produto
  const [consultaOpen, setConsultaOpen] = useState(false);
  const [consultaInput, setConsultaInput] = useState("");
  const [consultaTermos, setConsultaTermos] = useState<string[]>([]);

  // Projeção de compras simuladas
  const [projetarComprasAtivo, setProjetarComprasAtivo] = useState(false);

  const excludedLines = useMemo(() => getExcludedLines(companyKey), [companyKey]);

  // Sync from URL once
  useEffect(() => {
    const f = searchParams.get("filial");
    if (f != null) setFilial(f);
    const g = searchParams.getAll("grupos");
    if (g.length) setGrupos(g);
    const l = searchParams.getAll("linhas");
    if (l.length) setLinhas(l);
    const c = searchParams.getAll("colecoes");
    if (c.length) setColecoes(c);
    const s = searchParams.getAll("subgrupos");
    if (s.length) setSubgrupos(s);
    const gr = searchParams.getAll("grades");
    if (gr.length) setGrades(gr);
    if (!expansaoRestoredRef.current) {
      expansaoRestoredRef.current = true;
      const expParam = searchParams.get("expansao");
      if (expParam) {
        try {
          const arr = JSON.parse(expParam) as Array<[string, { nivel: number; subgrupoSelecionado?: string; gradeSelecionado?: string; produtoSelecionado?: string }]>;
          setExpansao(new Map(arr));
        } catch {}
      }
    }
  }, [searchParams]);

  // Load filter options
  useEffect(() => {
    if (companyKey !== "nerd") return;
    const q = new URLSearchParams({ company: companyKey });
    if (filial) q.set("filial", filial);
    fetch(`/api/products/grupos?${q}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => j?.data && setOpcoesGrupos(j.data))
      .catch(() => {});
  }, [companyKey, filial]);

  useEffect(() => {
    if (companyKey !== "scarfme") return;
    const q = new URLSearchParams({ company: companyKey });
    if (filial) q.set("filial", filial);
    colecoes.forEach((c) => q.append("colecoes", c));
    subgrupos.forEach((s) => q.append("subgrupos", s));
    grades.forEach((g) => q.append("grades", g));
    fetch(`/api/products/linhas?${q}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => j?.data && setOpcoesLinhas(j.data))
      .catch(() => {});
  }, [companyKey, filial, colecoes, subgrupos, grades]);

  useEffect(() => {
    if (companyKey !== "scarfme" || linhas.length === 0) {
      setOpcoesColecoes([]);
      return;
    }
    const q = new URLSearchParams({ company: companyKey });
    if (filial) q.set("filial", filial);
    linhas.forEach((l) => q.append("linhas", l));
    fetch(`/api/products/colecoes?${q}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => j?.data && setOpcoesColecoes(j.data))
      .catch(() => {});
  }, [companyKey, filial, linhas]);

  useEffect(() => {
    if (companyKey !== "scarfme" || linhas.length === 0) {
      setOpcoesSubgrupos([]);
      return;
    }
    const q = new URLSearchParams({ company: companyKey });
    if (filial) q.set("filial", filial);
    linhas.forEach((l) => q.append("linhas", l));
    fetch(`/api/products/subgrupos?${q}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => j?.data && setOpcoesSubgrupos(j.data))
      .catch(() => {});
  }, [companyKey, filial, linhas]);

  useEffect(() => {
    if (companyKey !== "scarfme" || linhas.length === 0 || subgrupos.length === 0) {
      setOpcoesGrades([]);
      return;
    }
    const q = new URLSearchParams({ company: companyKey });
    if (filial) q.set("filial", filial);
    linhas.forEach((l) => q.append("linhas", l));
    subgrupos.forEach((s) => q.append("subgrupos", s));
    fetch(`/api/products/grades?${q}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => j?.data && setOpcoesGrades(j.data))
      .catch(() => {});
  }, [companyKey, filial, linhas, subgrupos]);

  // Load projection data
  useEffect(() => {
    let cancelled = false;
    const filialReq = filial ?? searchParams.get("filial") ?? null;
    setLoading(true);
    setError(null);
    fetchProjecao(companyKey, filialReq, grupos, linhas, colecoes, subgrupos, grades)
      .then((data) => {
        if (cancelled) return;
        setProjecoes(data.data);
        setSnapshotOk(data.snapshotOk);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyKey, filial, grupos, linhas, colecoes, subgrupos, grades, searchParams]);

  // Meses: todos os 12 (JAN a DEZ) para comparativo anual
  const mesesExibicao = useMemo(() => {
    const hoje = new Date();
    const ano = getYear(hoje);
    const mesAtualNum = getMonth(hoje) + 1; // 1-12
    const out: Array<{ mes: string; mesNumero: number; ano: number; isMesAtual: boolean }> = [];
    for (let i = 0; i < 12; i++) {
      out.push({
        mes: MESES_NOMES[i],
        mesNumero: i + 1,
        ano,
        isMesAtual: i + 1 === mesAtualNum,
      });
    }
    return out;
  }, []);

  // Merge de meses (soma vendas; uma unica cadeia de estoque a partir do mês atual)
  const reagrupar = useCallback((items: ProjecaoCategoria[]): ProjecaoCategoria[] => {
    if (items.length === 0) return [];
    const base = items[0].meses;
    const mesAtualIdx = getMonth(new Date());
    const merged = base.map((mes, i) => {
      let vendasReais: number | undefined, vendasVarejo = 0, vendasEcommerce = 0, vendasVarejoReal: number | undefined, vendasEcommerceReal: number | undefined;
      items.forEach((it) => {
        const m = it.meses[i];
        if (m) {
          vendasVarejo += m.vendasVarejo ?? 0;
          vendasEcommerce += m.vendasEcommerce ?? 0;
          if (m.vendasReais != null) vendasReais = (vendasReais ?? 0) + m.vendasReais;
          if (m.vendasVarejoReal != null) vendasVarejoReal = (vendasVarejoReal ?? 0) + m.vendasVarejoReal;
          if (m.vendasEcommerceReal != null) vendasEcommerceReal = (vendasEcommerceReal ?? 0) + m.vendasEcommerceReal;
        }
      });
      const totalBase = vendasVarejo + vendasEcommerce;
      const vendas = totalBase > 0 ? Math.round(totalBase * 1.1) : items.reduce((s, it) => s + (it.meses[i]?.vendas ?? 0), 0);
      return {
        ...mes,
        vendas,
        estoque: base[i]?.estoque ?? 0,
        // Quando é um único item, manter a duração do backend; em merge será recalculada
        duracao: items.length === 1 ? (mes?.duracao ?? 0) : 0,
        ...(vendasReais !== undefined && { vendasReais }),
        ...(totalBase > 0 && { vendasVarejo: Math.round(vendasVarejo), vendasEcommerce: Math.round(vendasEcommerce) }),
        ...(vendasVarejoReal !== undefined && { vendasVarejoReal }),
        ...(vendasEcommerceReal !== undefined && { vendasEcommerceReal }),
        ...(items.some((it) => it.meses[i]?.estoqueRealSnapshot != null) && {
          estoqueRealSnapshot: items.reduce((s, it) => s + (it.meses[i]?.estoqueRealSnapshot ?? 0), 0),
        }),
        ...(items.some((it) => it.meses[i]?.duracaoRealSnapshot != null) && (() => {
          // duração não é aditiva: calcula consumo agregado → duração = estoque_agg / consumo_agg
          const estoqueAgg = items.reduce((s, it) => s + (it.meses[i]?.estoqueRealSnapshot ?? 0), 0);
          const consumoAgg = items.reduce((s, it) => {
            const e = it.meses[i]?.estoqueRealSnapshot ?? 0;
            const d = it.meses[i]?.duracaoRealSnapshot ?? 0;
            return s + (d > 0 ? e / d : 0);
          }, 0);
          return { duracaoRealSnapshot: consumoAgg > 0 ? Math.round(estoqueAgg / consumoAgg) : 0 };
        })()),
      };
    });
    // Cadeia de estoque a partir do mês atual (meses passados ficam com 0)
    let estoqueAcum = 0;
    items.forEach((it) => { const m = it.meses[mesAtualIdx]; if (m) estoqueAcum += m.estoque; });
    for (let i = mesAtualIdx; i < merged.length; i++) {
      merged[i].estoque = estoqueAcum;
      const v = merged[i];
      const descontar = v.isMesAtual && v.vendasReais != null
        ? Math.max(0, v.vendas - v.vendasReais)
        : v.vendas;
      estoqueAcum = Math.max(0, estoqueAcum - descontar);
    }
    if (items.length > 1) {
      merged.forEach((_, i) => { merged[i].duracao = calcDiasAteAcabar(merged, i); });
    }
    return [{ ...items[0], meses: merged }];
  }, []);

  const handleConsultaBuscar = useCallback(() => {
    const termos = consultaInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setConsultaTermos(termos);
    if (termos.length > 0) setConsultaOpen(false);
  }, [consultaInput]);

  const handleConsultaLimpar = useCallback(() => {
    setConsultaTermos([]);
    setConsultaInput("");
  }, []);

  // Filtrar por linha excluída e por filtros; aplicar níveis de expansão
  const listaExibida = useMemo(() => {
    // Modo consulta: exibe produtos individuais filtrados por código/descrição
    if (consultaTermos.length > 0) {
      const matching = projecoes.filter((p) => {
        const cat = p.categoria.toUpperCase().trim();
        if (companyKey === "scarfme" && excludedLines.has(cat)) return false;
        return consultaTermos.some((termo) => {
          const t = termo.trim().toUpperCase();
          if (!t) return false;
          // Código: apenas dígitos e pontos → match exato no produto
          if (/^[\d.\s]+$/.test(t)) return p.produto?.toUpperCase().trim() === t;
          // Nome: busca parcial em produto, descrição e categoria
          return (
            p.produto?.toUpperCase().includes(t) ||
            p.descricao?.toUpperCase().includes(t) ||
            p.categoria.toUpperCase().includes(t)
          );
        });
      });
      // Agrupa por produto (soma cores)
      const mesAtualIdx = getMonth(new Date());
      const byProduto = new Map<string, ProjecaoCategoria[]>();
      matching.forEach((p) => {
        const k = p.produto || p.categoria;
        if (!byProduto.has(k)) byProduto.set(k, []);
        byProduto.get(k)!.push(p);
      });
      const result: ProjecaoCategoria[] = [];
      byProduto.forEach((group) => {
        const merged = reagrupar(group)[0];
        result.push({ ...group[0], meses: merged.meses });
      });
      // Ordena por estoque do mês atual desc
      result.sort((a, b) => (b.meses[mesAtualIdx]?.estoque ?? 0) - (a.meses[mesAtualIdx]?.estoque ?? 0));
      return result;
    }

    let base = projecoes.filter((p) => {
      const cat = p.categoria.toUpperCase().trim();
      if (companyKey === "scarfme" && excludedLines.has(cat)) return false;
      if (companyKey === "nerd" && grupos.length > 0 && !grupos.includes(p.categoria)) return false;
      if (companyKey === "scarfme" && linhas.length > 0 && !linhas.includes(p.categoria)) return false;
      return true;
    });
    const categorias = Array.from(new Set(base.map((p) => p.categoria)));
    const expandidas = categorias.filter((c) => (expansao.get(c)?.nivel ?? 0) > 0);
    const out: ProjecaoCategoria[] = [];
    categorias.forEach((cat) => {
      const ex = expansao.get(cat);
      const nivel = ex?.nivel ?? 0;
      const subSel = ex?.subgrupoSelecionado;
      const cats = base.filter((p) => p.categoria === cat);
      if (nivel === 0) {
        out.push(...reagrupar(cats));
        return;
      }
      if (nivel === 1) {
        const bySub = new Map<string, ProjecaoCategoria[]>();
        cats.forEach((c) => {
          const k = `${c.categoria}|${c.subgrupo ?? ""}`;
          if (!bySub.has(k)) bySub.set(k, []);
          bySub.get(k)!.push(c);
        });
        bySub.forEach((items) => {
          const sub = items[0]?.subgrupo;
          out.push({ categoria: cat, subgrupo: sub, linha: items[0]?.linha, meses: reagrupar(items)[0].meses });
        });
        return;
      }
      if (nivel === 2 && subSel) {
        const items = cats.filter((c) => c.subgrupo === subSel);
        const byGrade = new Map<string, ProjecaoCategoria[]>();
        items.forEach((c) => {
          const k = `${c.categoria}|${c.subgrupo ?? ""}|${c.grade ?? ""}`;
          if (!byGrade.has(k)) byGrade.set(k, []);
          byGrade.get(k)!.push(c);
        });
        byGrade.forEach((items) => {
          out.push({
            categoria: cat,
            subgrupo: subSel,
            grade: items[0]?.grade,
            linha: items[0]?.linha,
            colecao: items[0]?.colecao,
            meses: reagrupar(items)[0].meses,
          });
        });
        return;
      }
      if (nivel === 3 && subSel && ex?.gradeSelecionado) {
        const gradeSel = ex.gradeSelecionado;
        const mesAtualIdx = getMonth(new Date());
        const allItems = cats.filter((c) => c.subgrupo === subSel && c.grade === gradeSel);
        // Group by produto to aggregate across colors
        const byProduto = new Map<string, ProjecaoCategoria[]>();
        allItems.forEach((c) => {
          const k = c.produto || '';
          if (!byProduto.has(k)) byProduto.set(k, []);
          byProduto.get(k)!.push(c);
        });
        // Sort by total stock descending
        const sortedProdutos = Array.from(byProduto.entries()).sort((a, b) => {
          const sa = a[1].reduce((sum, i) => sum + (i.meses[mesAtualIdx]?.estoque ?? 0), 0);
          const sb = b[1].reduce((sum, i) => sum + (i.meses[mesAtualIdx]?.estoque ?? 0), 0);
          return sb - sa;
        });
        sortedProdutos.forEach(([, group]) => {
          const merged = reagrupar(group)[0];
          out.push({
            categoria: cat,
            subgrupo: subSel,
            grade: gradeSel,
            colecao: group[0].colecao,
            produto: group[0].produto,
            descricao: group[0].descricao,
            linha: group[0].linha,
            meses: merged.meses,
          });
        });
      }
      if (nivel === 4 && subSel && ex?.gradeSelecionado && ex?.produtoSelecionado) {
        const gradeSel = ex.gradeSelecionado;
        const produtoSel = ex.produtoSelecionado;
        const mesAtualIdx = getMonth(new Date());
        const items = cats
          .filter((c) => c.subgrupo === subSel && c.grade === gradeSel && c.produto === produtoSel)
          .sort((a, b) => (b.meses[mesAtualIdx]?.estoque ?? 0) - (a.meses[mesAtualIdx]?.estoque ?? 0));
        items.forEach((item) => {
          out.push({
            categoria: cat,
            subgrupo: subSel,
            grade: gradeSel,
            colecao: item.colecao,
            produto: item.produto,
            descricao: item.descricao,
            linha: item.linha,
            cor: item.cor,
            meses: reagrupar([item])[0].meses,
          });
        });
      }
    });
    if (expandidas.length > 0) {
      return out.filter((p) => {
        const ex = expansao.get(p.categoria);
        const n = ex?.nivel ?? 0;
        if (n === 0) return false;
        if (n === 2 && ex?.subgrupoSelecionado)
          return p.subgrupo === ex.subgrupoSelecionado;
        if (n === 3 && ex?.subgrupoSelecionado && ex?.gradeSelecionado)
          return p.subgrupo === ex.subgrupoSelecionado && p.grade === ex.gradeSelecionado;
        if (n === 4 && ex?.subgrupoSelecionado && ex?.gradeSelecionado && ex?.produtoSelecionado)
          return p.subgrupo === ex.subgrupoSelecionado && p.grade === ex.gradeSelecionado && p.produto === ex.produtoSelecionado;
        return true;
      });
    }
    return out.filter((p) => (expansao.get(p.categoria)?.nivel ?? 0) === 0);
  }, [projecoes, companyKey, excludedLines, grupos, linhas, expansao, reagrupar, consultaTermos]);

  // ── Simulação de compras futuras — nível folha ────────────────────────────
  const simulatedLeafMap = useMemo((): Map<string, SimLeafData> => {
    if (!projetarComprasAtivo || projecoes.length === 0) return new Map();
    const mesAtualIdx = getMonth(new Date());
    const map = new Map<string, SimLeafData>();

    projecoes.forEach(p => {
      const key = `${p.categoria}|${p.subgrupo ?? ""}|${p.grade ?? ""}|${p.colecao ?? ""}|${p.produto ?? ""}|${p.cor ?? ""}`;
      if (map.has(key)) return; // evita duplicatas
      const isLencos = p.categoria === "LENÇOS" || p.categoria === "APROVEITAMENTO LENÇOS";
      const limitDias = isLencos ? 120 : 90;
      const diasCobertura = 30 + limitDias;

      const newMeses = p.meses.map(m => ({ ...m }));
      const compras: SimCompra[] = [];

      let estoqueAcum = newMeses[mesAtualIdx]?.estoque ?? 0;

      for (let i = mesAtualIdx; i < newMeses.length; i++) {
        newMeses[i].estoque = estoqueAcum;

        // Só simula compra para meses FUTUROS (não o mês atual)
        if (i > mesAtualIdx) {
          const dur = calcDiasAteAcabar(newMeses, i);
          newMeses[i].duracao = dur;

          if (dur > 0 && dur <= limitDias) {
            const consumoDiario = estoqueAcum > 0 && dur > 0 ? estoqueAcum / dur : 0;
            const necessidadeTotal = consumoDiario * diasCobertura;
            const qtd = Math.max(0, Math.round(necessidadeTotal - estoqueAcum));
            if (qtd > 0) {
              compras.push({
                mesIdx: i,
                mesNumero: newMeses[i].mesNumero,
                ano: newMeses[i].ano,
                qtd,
                data: `25/${String(newMeses[i].mesNumero).padStart(2, "0")}/${newMeses[i].ano}`,
              });
              estoqueAcum += qtd;
              newMeses[i].estoque = estoqueAcum;
            }
          }
        }

        const descontar = newMeses[i].isMesAtual && newMeses[i].vendasReais != null
          ? Math.max(0, newMeses[i].vendas - (newMeses[i].vendasReais ?? 0))
          : newMeses[i].vendas;
        estoqueAcum = Math.max(0, estoqueAcum - descontar);
      }

      // Recalcula todas as durações com as compras simuladas incorporadas
      for (let i = mesAtualIdx; i < newMeses.length; i++) {
        newMeses[i].duracao = calcDiasAteAcabar(newMeses, i);
      }

      map.set(key, { meses: newMeses, compras });
    });

    return map;
  }, [projetarComprasAtivo, projecoes]);

  const showFloatingTooltip = useCallback((
    e: React.MouseEvent<HTMLElement>,
    varejo: string,
    ecommerce: string,
    showBelow: boolean,
    projecaoReal?: string
  ) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = showBelow ? rect.bottom + TOOLTIP_OFFSET : rect.top - TOOLTIP_OFFSET;
    setFloatingTooltip({ varejo, ecommerce, x, y, above: !showBelow, ...(projecaoReal != null && projecaoReal !== "" && { projecaoReal }) });
  }, []);
  const hideFloatingTooltip = useCallback(() => setFloatingTooltip(null), []);
  const showCompraDebugTooltip = useCallback((
    e: React.MouseEvent<HTMLElement>,
    debug: { estoqueReal: number; duracaoReal: number; consumoDiario: number; diasCobertura: number; necessidadeTotal: number; qtdCompra: number; limiteDias: number },
    showBelow: boolean
  ) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = showBelow ? rect.bottom + TOOLTIP_OFFSET : rect.top - TOOLTIP_OFFSET;
    setCompraDebugTooltip({ ...debug, x, y, above: !showBelow });
  }, []);
  const hideCompraDebugTooltip = useCallback(() => setCompraDebugTooltip(null), []);
  const hideSimCompraTooltip = useCallback(() => setSimCompraTooltip(null), []);

  const handleClickCategoria = useCallback((proj: ProjecaoCategoria) => {
    const n = expansao.get(proj.categoria)?.nivel ?? 0;
    const temSubgrupos = projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo);
    const temGrades = proj.subgrupo && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade);
    const temProdutos = proj.grade && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade === proj.grade && p.produto);
    const temCores = proj.produto && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade === proj.grade && p.produto === proj.produto && p.cor);
    if (n === 0 && temSubgrupos) {
      setExpansao((prev) => new Map(prev).set(proj.categoria, { nivel: 1 }));
      return;
    }
    if (n === 1 && proj.subgrupo && temGrades) {
      setExpansao((prev) => new Map(prev).set(proj.categoria, { nivel: 2, subgrupoSelecionado: proj.subgrupo }));
      return;
    }
    if (n === 2 && proj.grade && temProdutos) {
      setExpansao((prev) => new Map(prev).set(proj.categoria, { nivel: 3, subgrupoSelecionado: proj.subgrupo, gradeSelecionado: proj.grade }));
      return;
    }
    if (n === 3 && proj.produto && temCores) {
      setExpansao((prev) => new Map(prev).set(proj.categoria, { nivel: 4, subgrupoSelecionado: proj.subgrupo, gradeSelecionado: proj.grade, produtoSelecionado: proj.produto }));
    }
  }, [expansao, projecoes]);

  const voltarAoInicio = useCallback(() => setExpansao(new Map()), []);

  // Dados reais (por categoria): estoque atual já tem venda real descontada; duração só com ritmo real
  const getReaisPorMes = useCallback((proj: ProjecaoCategoria) => {
    const meses = proj.meses;
    if (meses.length === 0) return { estoqueAtualReal: 0, duracaoRealMesAtual: 0 };
    const mesAtualIdx = getMonth(new Date()); // 0-11
    const mesAtual = meses[mesAtualIdx];
    if (!mesAtual) return { estoqueAtualReal: 0, duracaoRealMesAtual: 0 };
    const estoqueAtualReal = mesAtual.estoque;
    const vendasReaisMesAtual = mesAtual.vendasReais ?? 0;
    const diasCorridos = new Date().getDate();
    let duracaoRealMesAtual = 0;
    if (estoqueAtualReal > 0 && vendasReaisMesAtual > 0 && diasCorridos > 0) {
      const consumoDiario = vendasReaisMesAtual / diasCorridos;
      duracaoRealMesAtual = Math.round(estoqueAtualReal / consumoDiario);
    }
    return { estoqueAtualReal, duracaoRealMesAtual };
  }, []);

  // Pré-computa compraInfo completo (inclui reposicaoItems individuais por produto/cor)
  const compraInfoMap = useMemo(() => {
    const map = new Map<string, {
      qtdCompra: number;
      dataCompra: string;
      redMesNumero: number;
      redAno: number;
      reposicaoItems: ReposicaoItem[];
      estoqueReal: number;
      duracaoReal: number;
      consumoDiario: number;
      diasCobertura: number;
      necessidadeTotal: number;
      limiteDias: number;
      categoria: string;
    }>();
    listaExibida.forEach((proj, idx) => {
      const { estoqueAtualReal, duracaoRealMesAtual } = getReaisPorMes(proj);
      const isLençosLine = proj.categoria === "LENÇOS" || proj.categoria === "APROVEITAMENTO LENÇOS";
      const limiteDiasAlerta = isLençosLine ? 120 : 90;
      // Gate: a PRÓPRIA linha deve ter duração em alerta (regra de negativo)
      for (const mes of proj.meses) {
        let duracaoReal = 0, estoqueReal = 0;
        if (mes.isMesAtual) { duracaoReal = duracaoRealMesAtual; estoqueReal = estoqueAtualReal; }
        else if (mes.isMesPassado) { duracaoReal = mes.duracaoRealSnapshot ?? 0; estoqueReal = mes.estoqueRealSnapshot ?? 0; }
        else continue;
        if (duracaoReal > 0 && duracaoReal <= limiteDiasAlerta && estoqueReal > 0) {
          const consumoDiario = estoqueReal / duracaoReal;
          const diasCobertura = 30 + limiteDiasAlerta;
          const necessidadeTotal = consumoDiario * diasCobertura;
          // Quantidade = soma dos produtos individuais com alerta dentro do escopo
          const reposicaoItems = computeReposicaoScope(proj, projecoes, getReaisPorMes);
          const qtdCompra = reposicaoItems.length > 0
            ? reposicaoItems.reduce((s, i) => s + i.qtdCompra, 0)
            : Math.max(0, Math.round(necessidadeTotal - estoqueReal));
          const rowKey = `${proj.categoria}|${proj.subgrupo ?? ""}|${proj.grade ?? ""}|${proj.colecao ?? ""}|${proj.produto ?? ""}|${proj.cor ?? ""}|${idx}`;
          map.set(rowKey, {
            qtdCompra,
            dataCompra: `25/${String(mes.mesNumero).padStart(2, "0")}/${mes.ano}`,
            redMesNumero: mes.mesNumero,
            redAno: mes.ano,
            reposicaoItems,
            estoqueReal,
            duracaoReal,
            consumoDiario,
            diasCobertura,
            necessidadeTotal,
            limiteDias: limiteDiasAlerta,
            categoria: proj.categoria,
          });
          break;
        }
      }
    });
    return map;
  }, [listaExibida, getReaisPorMes, projecoes]);

  // Sub-nível: computa itens com necessidade de compra dentro do escopo de linhas macro sem alerta próprio
  const rawSubCompraItems = useMemo(() => {
    const map = new Map<string, ReposicaoItem[]>();
    listaExibida.forEach((proj, idx) => {
      const rowKey = `${proj.categoria}|${proj.subgrupo ?? ""}|${proj.grade ?? ""}|${proj.colecao ?? ""}|${proj.produto ?? ""}|${proj.cor ?? ""}|${idx}`;
      if (compraInfoMap.has(rowKey)) return; // já tem alerta próprio
      const ex = expansao.get(proj.categoria);
      const nivel = ex?.nivel ?? 0;
      const hasSubLevels = projecoes.some((p) => {
        if (p.categoria !== proj.categoria) return false;
        if (nivel === 0) return !!p.subgrupo;
        if (nivel === 1) return p.subgrupo === proj.subgrupo && !!p.grade;
        if (nivel === 2) return p.subgrupo === proj.subgrupo && p.grade === proj.grade && !!p.produto;
        if (nivel === 3) return p.subgrupo === proj.subgrupo && p.grade === proj.grade && p.produto === proj.produto && !!p.cor;
        return false;
      });
      if (!hasSubLevels) return;
      // nivel 0: reagrupar() espalha campos do cats[0] (subgrupo, grade, etc.) na linha agregada,
      // então precisamos limpar esses campos para que o scope cubra toda a categoria
      const scopeProj: ProjecaoCategoria = nivel === 0
        ? { categoria: proj.categoria, meses: proj.meses }
        : proj;
      const subItems = computeReposicaoScope(scopeProj, projecoes, getReaisPorMes);
      if (subItems.length > 0) map.set(rowKey, subItems);
    });
    return map;
  }, [listaExibida, compraInfoMap, expansao, projecoes, getReaisPorMes]);

  // Coleta todos os códigos de produto que precisam de reposição (para buscar preço unitário em lote)
  const allProdutosReposicao = useMemo(() => {
    const codes = new Set<string>();
    compraInfoMap.forEach(({ reposicaoItems }) => {
      reposicaoItems.forEach(item => { const p = item.produto?.trim(); if (p) codes.add(p); });
    });
    rawSubCompraItems.forEach((items) => {
      items.forEach(item => { const p = item.produto?.trim(); if (p) codes.add(p); });
    });
    return Array.from(codes);
  }, [compraInfoMap, rawSubCompraItems]);

  // Busca preços unitários (valor60dias / vendas60dias) por produto específico
  const [unitPrices, setUnitPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    if (allProdutosReposicao.length === 0) return;
    const params = new URLSearchParams();
    params.set("company", companyKey);
    // Não passa filial: preço unitário deve considerar todas as filiais + ecommerce
    params.set("qtdCompra", "0");
    params.set("limit", String(allProdutosReposicao.length + 20));
    allProdutosReposicao.forEach(p => params.append("produtos", p));
    fetch(`/api/controle-estoque/lista-compra-sugerida?${params}`, { cache: "no-store" })
      .then(r => r.json())
      .then((json: { data?: ProdutoSugestaoMin[] }) => {
        const prices: Record<string, number> = {};
        (json.data ?? []).forEach(p => {
          if (p.vendas3meses > 0) prices[p.produto] = p.valor3meses / p.vendas3meses;
        });
        setUnitPrices(prices);
      })
      .catch(() => {});
  }, [allProdutosReposicao, companyKey, filial]);

  // Custo por row = soma dos custos individuais de cada produto em reposição
  const custosCompra = useMemo(() => {
    const costs: Record<string, number> = {};
    compraInfoMap.forEach(({ reposicaoItems }, rowKey) => {
      let total = 0;
      reposicaoItems.forEach(item => {
        const unitPrice = unitPrices[item.produto?.trim() ?? ''] ?? 0;
        total += item.qtdCompra * unitPrice;
      });
      if (total > 0) costs[rowKey] = total;
    });
    return costs;
  }, [compraInfoMap, unitPrices]);

  // Qtd e custo agregados dos sub-níveis (para linhas macro sem alerta próprio)
  const subCompraMap = useMemo(() => {
    const map = new Map<string, { qtdTotal: number; custoTotal: number; reposicaoItems: ReposicaoItem[] }>();
    rawSubCompraItems.forEach((subItems, rowKey) => {
      const qtdTotal = subItems.reduce((s, i) => s + i.qtdCompra, 0);
      const custoTotal = subItems.reduce((s, i) => {
        const unitPrice = unitPrices[i.produto?.trim() ?? ''] ?? 0;
        return s + i.qtdCompra * unitPrice;
      }, 0);
      if (qtdTotal > 0) map.set(rowKey, { qtdTotal, custoTotal, reposicaoItems: subItems });
    });
    return map;
  }, [rawSubCompraItems, unitPrices]);

  // ── Simulação de compras futuras — nível agregado por linha exibida ────────
  const simRowDataMap = useMemo((): Map<string, SimRowData> => {
    if (!projetarComprasAtivo || simulatedLeafMap.size === 0) return new Map();
    const mesAtualIdx = getMonth(new Date());
    const map = new Map<string, SimRowData>();

    listaExibida.forEach((proj, idx) => {
      const rowKey = `${proj.categoria}|${proj.subgrupo ?? ""}|${proj.grade ?? ""}|${proj.colecao ?? ""}|${proj.produto ?? ""}|${proj.cor ?? ""}|${idx}`;
      const ex = expansao.get(proj.categoria);
      const nivel = ex?.nivel ?? 0;
      const isConsulta = consultaTermos.length > 0;

      const inScope = projecoes.filter(p => {
        if (p.categoria !== proj.categoria) return false;
        if (isConsulta) return p.produto === proj.produto;
        if (nivel >= 1 && proj.subgrupo && p.subgrupo !== proj.subgrupo) return false;
        if (nivel >= 2 && proj.grade && p.grade !== proj.grade) return false;
        if (nivel >= 3 && proj.produto && p.produto !== proj.produto) return false;
        if (nivel >= 4 && proj.cor && p.cor !== proj.cor) return false;
        return true;
      });

      if (inScope.length === 0) return;

      const numMeses = proj.meses.length;
      const aggEstoque = new Array<number>(numMeses).fill(0);
      const aggVendas = new Array<number>(numMeses).fill(0);
      const aggVendasReais = new Array<number | null>(numMeses).fill(null);

      inScope.forEach(p => {
        const leafKey = `${p.categoria}|${p.subgrupo ?? ""}|${p.grade ?? ""}|${p.colecao ?? ""}|${p.produto ?? ""}|${p.cor ?? ""}`;
        const simLeaf = simulatedLeafMap.get(leafKey);
        if (!simLeaf) return;
        for (let i = 0; i < numMeses; i++) {
          const sm = simLeaf.meses[i];
          if (!sm) continue;
          aggEstoque[i] += sm.estoque;
          aggVendas[i] += sm.vendas;
          if (sm.vendasReais != null) aggVendasReais[i] = (aggVendasReais[i] ?? 0) + sm.vendasReais;
        }
      });

      const tempMeses: ProjecaoMensal[] = proj.meses.map((m, i) => ({
        ...m,
        estoque: aggEstoque[i],
        vendas: aggVendas[i],
        vendasReais: aggVendasReais[i] ?? undefined,
      }));

      const mesesSimByNum = new Map<number, { estoque: number; duracao: number }>();
      for (let i = mesAtualIdx; i < tempMeses.length; i++) {
        mesesSimByNum.set(tempMeses[i].mesNumero, {
          estoque: aggEstoque[i],
          duracao: calcDiasAteAcabar(tempMeses, i),
        });
      }

      const comprasByMes = new Map<number, { qtd: number; custo: number; data: string; ano: number }>();
      inScope.forEach(p => {
        const leafKey = `${p.categoria}|${p.subgrupo ?? ""}|${p.grade ?? ""}|${p.colecao ?? ""}|${p.produto ?? ""}|${p.cor ?? ""}`;
        const simLeaf = simulatedLeafMap.get(leafKey);
        if (!simLeaf) return;
        const unitPrice = unitPrices[p.produto?.trim() ?? ''] ?? 0;
        simLeaf.compras.forEach(c => {
          const existing = comprasByMes.get(c.mesNumero);
          const custo = c.qtd * unitPrice;
          if (existing) { existing.qtd += c.qtd; existing.custo += custo; }
          else comprasByMes.set(c.mesNumero, { qtd: c.qtd, custo, data: c.data, ano: c.ano });
        });
      });

      const compras: SimRowCompra[] = Array.from(comprasByMes.entries()).map(([mesNumero, v]) => ({
        mesNumero, ano: v.ano, qtd: v.qtd, custo: v.custo, data: v.data,
      }));

      map.set(rowKey, { mesesSimByNum, compras });
    });

    return map;
  }, [projetarComprasAtivo, simulatedLeafMap, listaExibida, projecoes, expansao, consultaTermos, unitPrices]);

  const [exportandoPDF, setExportandoPDF] = useState(false);

  // Ref para captura do conteúdo visual (PDF)
  const captureRef = useRef<HTMLDivElement>(null);

  // ── Exportar PDF: captura visual da página com html2canvas ─────────────────
  const gerarPDF = useCallback(async () => {
    const el = captureRef.current;
    if (!el) return;
    setExportandoPDF(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      // Expande scroll horizontal temporariamente para capturar toda a tabela
      const scrollEl = el.querySelector<HTMLElement>("[data-scroll-container]");
      const prevOverflow = scrollEl?.style.overflowX ?? "";
      const prevWidth = scrollEl?.style.width ?? "";
      if (scrollEl) {
        scrollEl.style.overflowX = "visible";
        scrollEl.style.width = `${scrollEl.scrollWidth}px`;
      }

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#f8f9fb",
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: el.scrollWidth,
      });

      // Restaura estilos
      if (scrollEl) {
        scrollEl.style.overflowX = prevOverflow;
        scrollEl.style.width = prevWidth;
      }

      const pdfW = 297; // A4 landscape largura em mm
      const pdfH = 210; // A4 landscape altura em mm
      const margin = 6;
      const usableW = pdfW - margin * 2;
      const usableH = pdfH - margin * 2;

      // Proporção da imagem capturada
      const imgW = canvas.width;
      const imgH = canvas.height;

      // Pode ser necessário mais de uma página se a tabela for muito longa
      const sliceHeightPx = Math.floor(imgW / (usableW / usableH)); // pixels por página
      const totalPages = Math.ceil(imgH / sliceHeightPx);

      const doc = new jsPDF({ orientation: "landscape", format: "a4", unit: "mm" });

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) doc.addPage();
        // Posição vertical no canvas para esta página
        const srcY = page * sliceHeightPx;
        const srcH = Math.min(sliceHeightPx, imgH - srcY);

        // Cria canvas de fatia
        const slice = document.createElement("canvas");
        slice.width = imgW;
        slice.height = srcH;
        const ctx = slice.getContext("2d")!;
        ctx.drawImage(canvas, 0, srcY, imgW, srcH, 0, 0, imgW, srcH);
        const sliceData = slice.toDataURL("image/png");

        const sliceRatio = imgW / srcH;
        const drawH = usableW / sliceRatio;
        doc.addImage(sliceData, "PNG", margin, margin, usableW, Math.min(drawH, usableH));
      }

      const dateStr = new Date().toISOString().split("T")[0];
      const suffix = consultaTermos.length > 0 ? "-consulta" : "";
      doc.save(`projecao-estoque${suffix}-${dateStr}.pdf`);
    } finally {
      setExportandoPDF(false);
    }
  }, [consultaTermos]);

  // ── Exportar XLSX: tabela estilizada com ExcelJS ──────────────────────────
  const [exportandoXLSX, setExportandoXLSX] = useState(false);

  const gerarXLSX = useCallback(async () => {
    if (listaExibida.length === 0) return;
    setExportandoXLSX(true);
    try {
      const excelJsMod = await import("exceljs");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ExcelJS = (excelJsMod as any).default ?? excelJsMod;

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("Projeção", {
        views: [{ state: "frozen", ySplit: 1 }],
      });

      const mesesNomes = mesesExibicao.map((m) => m.mes);
      const totalCols = 7 + mesesNomes.length;

      ws.columns = [
        { width: 30 },
        { width: 14 },
        { width: 14 },
        { width: 14 },
        { width: 8  },
        { width: 14 },
        { width: 22 },
        ...mesesNomes.map(() => ({ width: 10 })),
      ];

      // ── Cabeçalho ──
      const headerRow = ws.addRow([
        "Categoria", "Código", "Linha", "Subgrupo", "Grade", "Coleção", "Tipo", ...mesesNomes,
      ]);
      headerRow.height = 22;
      headerRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin" }, left: { style: "thin" },
          bottom: { style: "thin" }, right: { style: "thin" },
        };
      });
      // Categoria header: alinhado à esquerda
      headerRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };

      // ── Paleta de cores por bloco ──
      const PROJ_BG = "FFE8F0FE"; // azul claro — projeção
      const REAL_BG = "FFF0F0F0"; // cinza claro — real
      const TIPOS: { label: string; bg: string }[] = [
        { label: "VENDA (projeção)",   bg: PROJ_BG },
        { label: "ESTOQUE (projeção)", bg: PROJ_BG },
        { label: "DURAÇÃO (projeção)", bg: PROJ_BG },
        { label: "VENDA (real)",       bg: REAL_BG },
        { label: "ESTOQUE (real)",     bg: REAL_BG },
        { label: "DURAÇÃO (real)",     bg: REAL_BG },
      ];

      listaExibida.forEach((proj, projIdx) => {
        const { estoqueAtualReal, duracaoRealMesAtual } = getReaisPorMes(proj);
        const catLabel = proj.descricao || proj.categoria;
        const mDados = mesesExibicao.map((m) => proj.meses.find((pm) => pm.mesNumero === m.mesNumero) ?? null);

        const rowsData: (number | null)[][] = [
          mDados.map((md) => (md && !md.isMesPassado ? md.vendas : null)),
          mDados.map((md) => (md && !md.isMesPassado ? md.estoque : null)),
          mDados.map((md) => { const d = md && !md.isMesPassado ? md.duracao : null; return d != null && d > 0 ? d : null; }),
          mDados.map((md) => md?.vendasReais ?? null),
          mDados.map((md) => { if (md?.isMesAtual) return estoqueAtualReal > 0 ? estoqueAtualReal : null; return md?.estoqueRealSnapshot ?? null; }),
          mDados.map((md) => { const d = md?.isMesAtual ? duracaoRealMesAtual : (md?.duracaoRealSnapshot ?? null); return d != null && d > 0 ? d : null; }),
        ];

        const prefixo = [
          catLabel,
          proj.produto ?? "",
          proj.linha ?? proj.categoria,
          proj.subgrupo ?? "",
          proj.grade ?? "",
          proj.colecao ?? "",
        ];

        const startRowNum: number = ws.rowCount + 1;

        TIPOS.forEach(({ label, bg }, i) => {
          const row = ws.addRow([...prefixo, label, ...rowsData[i].map((v) => v ?? "")]);
          row.height = 16;
          row.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
            cell.font = { size: 10, name: "Calibri" };
            cell.alignment = { horizontal: colNum <= 2 ? "left" : "center", vertical: "middle" };
            cell.border = {
              top: { style: "hair" }, left: { style: "hair" },
              bottom: { style: "hair" }, right: { style: "hair" },
            };
          });
          // Tipo: itálico discreto
          const tipoCell = row.getCell(7);
          tipoCell.font = { size: 9, name: "Calibri", italic: true, color: { argb: "FF444444" } };
          // Células numéricas: direita + formato milhar
          for (let c = 8; c <= totalCols; c++) {
            const cell = row.getCell(c);
            if (typeof cell.value === "number") {
              cell.alignment = { horizontal: "right", vertical: "middle" };
              cell.numFmt = "#,##0";
            }
          }
        });

        // Mescla coluna Categoria (col 1) pelas 6 linhas do produto
        ws.mergeCells(startRowNum, 1, startRowNum + 5, 1);
        const catCell = ws.getCell(startRowNum, 1);
        catCell.value = catLabel + (proj.produto ? `\n${proj.produto}` : "");
        catCell.font = { bold: true, size: 10, name: "Calibri" };
        catCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        catCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: projIdx % 2 === 0 ? PROJ_BG : REAL_BG } };
        catCell.border = {
          top: { style: "thin" }, left: { style: "thin" },
          bottom: { style: "thin" }, right: { style: "thin" },
        };

        // Separador entre blocos de produto (borda inferior grossa)
        if (projIdx < listaExibida.length - 1) {
          const lastRow = ws.getRow(startRowNum + 5);
          for (let col = 1; col <= totalCols; col++) {
            const cell = lastRow.getCell(col);
            const b = cell.border ?? {};
            cell.border = { ...b, bottom: { style: "medium", color: { argb: "FF999999" } } };
          }
        }
      });

      // Gera e baixa o arquivo
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date().toISOString().split("T")[0];
      const suffix = consultaTermos.length > 0 ? "-consulta" : "";
      a.download = `projecao-estoque${suffix}-${dateStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExportandoXLSX(false);
    }
  }, [listaExibida, mesesExibicao, consultaTermos, getReaisPorMes]);
  const voltarUmNivel = useCallback(() => {
    setExpansao((prev) => {
      const next = new Map(prev);
      prev.forEach((ex, cat) => {
        const n = ex.nivel ?? 0;
        if (n <= 0) return;
        if (n === 4) next.set(cat, { nivel: 3, subgrupoSelecionado: ex.subgrupoSelecionado, gradeSelecionado: ex.gradeSelecionado });
        else if (n === 3) next.set(cat, { nivel: 2, subgrupoSelecionado: ex.subgrupoSelecionado });
        else if (n === 2) next.set(cat, { nivel: 1 });
        else next.set(cat, { nivel: 0 });
      });
      return next;
    });
  }, []);


  if (loading) return <div className={styles.wrapper}><div className={styles.loading}>Carregando...</div></div>;
  if (error) return <div className={styles.wrapper}><div className={styles.error}>{error}</div></div>;

  const temExpansao = Array.from(expansao.values()).some((e) => e.nivel > 0);

  return (
    <div ref={captureRef} className={styles.wrapper}>
      <div className={styles.headerCard}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.iconWrapper}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6H16L14 4H10L8 6H4C2.9 6 2 6.9 2 8V19C2 20.1 2.9 21 4 21H20C21.1 21 22 20.1 22 19V8C22 6.9 21.1 6 20 6Z" />
              </svg>
            </div>
            <div>
              <h1 className={styles.title}>
                <button type="button" className={styles.titleLink} onClick={voltarAoInicio} title="Voltar ao início">
                  Projeção de Estoque
                </button>
              </h1>
              <p className={styles.subtitle}>Evolução mensal de vendas, estoque e duração (varejo + e-commerce)</p>
              {snapshotOk && <p className={styles.snapshotSaved}>Snapshot salvo.</p>}
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={`${styles.projetarComprasBtn} ${projetarComprasAtivo ? styles.projetarComprasBtnAtivo : ""}`}
              onClick={() => setProjetarComprasAtivo(v => !v)}
              title={projetarComprasAtivo ? "Desativar projeção de compras simuladas" : "Ativar projeção de compras simuladas futuras"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 01-8 0"/>
                <line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/>
              </svg>
              {projetarComprasAtivo ? "Projeção Ativa" : "Projetar Compras"}
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  className={styles.pdfButton}
                  onClick={gerarPDF}
                  disabled={exportandoPDF || listaExibida.length === 0}
                  title={`Exportar ${listaExibida.length} item(ns) para PDF`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  {exportandoPDF ? "Gerando..." : "Exportar PDF"}
                </button>
                <button
                  type="button"
                  className={styles.xlsxButton}
                  onClick={gerarXLSX}
                  disabled={exportandoXLSX || listaExibida.length === 0}
                  title={`Exportar ${listaExibida.length} item(ns) para XLSX`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="16" y2="17" />
                    <line x1="10" y1="9" x2="14" y2="9" />
                  </svg>
                  {exportandoXLSX ? "Gerando..." : "Exportar XLSX"}
                </button>
              </>
            )}
            <button type="button" className={styles.backButton} onClick={() => router.back()}>Voltar</button>
          </div>
        </div>

        <div className={styles.filtersRow}>
          <FilialFilter companyKey={companyKey} value={filial} onChange={setFilial} module="inventory" />
          {companyKey === "nerd" && (
            <MultiSelectFilter
              label="Grupo"
              value={grupos}
              options={opcoesGrupos}
              onChange={(g) => { setGrupos(g); if (g.length === 0) { setSubgrupos([]); setGrades([]); setColecoes([]); } }}
            />
          )}
          {companyKey === "scarfme" && (
            <>
              <MultiSelectFilter
                label="Linha"
                value={linhas}
                options={opcoesLinhas}
                onChange={(l) => { setLinhas(l); if (l.length === 0) { setSubgrupos([]); setGrades([]); setColecoes([]); } }}
              />
              {linhas.length > 0 && (
                <>
                  <MultiSelectFilter label="Subgrupo" value={subgrupos} options={opcoesSubgrupos} onChange={(s) => { setSubgrupos(s); if (s.length === 0) setGrades([]); }} />
                  <MultiSelectFilter label="Colecao" value={colecoes} options={opcoesColecoes} onChange={setColecoes} />
                </>
              )}
              {linhas.length > 0 && subgrupos.length > 0 && (
                <MultiSelectFilter label="Grade" value={grades} options={opcoesGrades} onChange={setGrades} />
              )}
            </>
          )}
          <button
            type="button"
            className={`${styles.consultaBtn} ${consultaTermos.length > 0 ? styles.consultaBtnAtivo : ""}`}
            onClick={() => setConsultaOpen((v) => !v)}
            title="Consultar produtos por código ou nome"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Consulta Produtos
            {consultaTermos.length > 0 && (
              <span className={styles.consultaBadge}>{consultaTermos.length}</span>
            )}
          </button>
        </div>

        {consultaOpen && (
          <div className={styles.consultaPanel}>
            <div className={styles.consultaPanelHeader}>
              <span className={styles.consultaPanelTitulo}>Consulta por produto</span>
              <span className={styles.consultaPanelDica}>
                Informe códigos (ex: 45.14.0035) ou nomes parciais, separados por vírgula
              </span>
            </div>
            <div className={styles.consultaPanelBody}>
              <textarea
                className={styles.consultaTextarea}
                placeholder="Ex: 45.14.0035, BRASIL TROPICAL, LENÇOS BASICOS"
                value={consultaInput}
                onChange={(e) => setConsultaInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleConsultaBuscar(); } }}
                rows={2}
                autoFocus
              />
              <div className={styles.consultaPanelActions}>
                <button type="button" className={styles.consultaBuscarBtn} onClick={handleConsultaBuscar}>
                  Buscar
                </button>
                {consultaTermos.length > 0 && (
                  <button type="button" className={styles.consultaLimparBtn} onClick={handleConsultaLimpar}>
                    Limpar filtro
                  </button>
                )}
                <button type="button" className={styles.consultaFecharBtn} onClick={() => setConsultaOpen(false)}>
                  Fechar
                </button>
              </div>
            </div>
            {consultaTermos.length > 0 && (
              <div className={styles.consultaTermosAtivos}>
                Filtrando por: {consultaTermos.map((t, i) => (
                  <span key={i} className={styles.consultaTermoTag}>{t}</span>
                ))}
                <span className={styles.consultaResultCount}>— {listaExibida.length} resultado(s)</span>
              </div>
            )}
          </div>
        )}
      </div>

      {consultaTermos.length > 0 && !consultaOpen && (
        <div className={styles.consultaBanner}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Consulta ativa:&nbsp;
          {consultaTermos.map((t, i) => <span key={i} className={styles.consultaTermoTag}>{t}</span>)}
          &nbsp;—&nbsp;<strong>{listaExibida.length}</strong> resultado(s)
          <button type="button" className={styles.consultaLimparBtn} onClick={handleConsultaLimpar}>✕ Limpar</button>
        </div>
      )}

      {temExpansao && !consultaTermos.length && (
        <div className={styles.expandActions}>
          <button type="button" className={styles.voltarExpansaoButton} onClick={voltarUmNivel} title="Voltar um nível na hierarquia">
            Voltar um nível
          </button>
        </div>
      )}

      <div className={styles.tableWrapper}>
        <div className={styles.tableScrollContainer} data-scroll-container>
          <table className={styles.projecaoTable}>
            <thead>
              <tr>
                <th rowSpan={2} className={styles.categoriaHeader}>Categoria</th>
                <th rowSpan={2} className={styles.labelHeader}>Tipo</th>
                {mesesExibicao.map((m) => (
                  <th key={`${m.ano}-${m.mesNumero}`} className={m.isMesAtual ? styles.columnMesAtual : undefined}>{m.mes}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listaExibida.map((proj, idx) => {
                const rowKey = `${proj.categoria}|${proj.subgrupo ?? ""}|${proj.grade ?? ""}|${proj.colecao ?? ""}|${proj.produto ?? ""}|${proj.cor ?? ""}|${idx}`;
                const compraInfo = compraInfoMap.get(rowKey) ?? null;
                const subCompraInfo = !compraInfo ? (subCompraMap.get(rowKey) ?? null) : null;
                const simRowData = projetarComprasAtivo ? (simRowDataMap.get(rowKey) ?? null) : null;
                const { estoqueAtualReal, duracaoRealMesAtual } = getReaisPorMes(proj);
                const isLençosLine = proj.categoria === "LENÇOS" || proj.categoria === "APROVEITAMENTO LENÇOS";
                const limiteDiasAlerta = isLençosLine ? 120 : 90;

                const ex = expansao.get(proj.categoria);
                const nivel = ex?.nivel ?? 0;
                const podeNivel1 = nivel === 0 && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo);
                const podeNivel2 = nivel === 1 && proj.subgrupo && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade);
                const podeNivel3 = nivel === 2 && proj.grade && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade === proj.grade && p.produto);
                const podeNivel4 = nivel === 3 && proj.produto && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade === proj.grade && p.produto === proj.produto && p.cor);
                const clickable = podeNivel1 || (nivel === 1 && podeNivel2) || (nivel === 2 && podeNivel3) || (nivel === 3 && podeNivel4);
                const isLast = idx === listaExibida.length - 1;

                return (
                  <React.Fragment key={`${proj.categoria}-${proj.subgrupo ?? ""}-${proj.grade ?? ""}-${proj.colecao ?? ""}-${proj.produto ?? ""}-${proj.cor ?? ""}-${idx}`}>
                    <tr className={`${styles.categoriaRow} ${idx > 0 ? styles.categoryBlockStart : ""} ${idx === 0 ? styles.firstDataRow : ""}`}>
                      <td
                        rowSpan={9}
                        className={`${styles.categoriaCell} ${clickable ? styles.categoriaCellClickable : ""} ${!isLast ? styles.categoriaCellBlockEnd : ""}`}
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={clickable ? () => handleClickCategoria(proj) : undefined}
                        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClickCategoria(proj); } } : undefined}
                      >
                        <div className={styles.categoriaCellContent}>
                          <span className={styles.categoriaLabel}>
                            {nivel === 4 ? (
                              <>
                                <span className={styles.categoryRowWithBadge}>
                                  <span className={styles.productNameBold}>{proj.descricao?.toUpperCase() ?? proj.produto?.toUpperCase() ?? proj.categoria.toUpperCase()}</span>
                                  <span className={styles.colorBadge}>{proj.cor?.toUpperCase() || "SEM COR"}</span>
                                </span>
                                {proj.produto && proj.produto !== proj.descricao && <span className={styles.detailInfo}>{proj.produto}</span>}
                                <span className={styles.detailInfo}>Linha: {proj.linha ?? proj.categoria}</span>
                                {proj.subgrupo && <span className={styles.detailInfo}>Subgrupo: {proj.subgrupo}</span>}
                                {proj.grade && <span className={styles.detailInfo}>Grade: {proj.grade}</span>}
                                {proj.colecao && <span className={styles.detailInfo}>Coleção: {proj.colecao}</span>}
                              </>
                            ) : nivel === 3 || (consultaTermos.length > 0 && proj.produto) ? (
                              <>
                                <span className={styles.productNameBold}>{proj.descricao?.toUpperCase() ?? proj.produto?.toUpperCase() ?? proj.categoria.toUpperCase()}</span>
                                {proj.produto && <span className={styles.detailInfo}>{proj.produto}</span>}
                                <span className={styles.detailInfo}>Linha: {proj.linha ?? proj.categoria}</span>
                                {proj.subgrupo && <span className={styles.detailInfo}>Subgrupo: {proj.subgrupo}</span>}
                                {proj.grade && <span className={styles.detailInfo}>Grade: {proj.grade}</span>}
                                {proj.colecao && <span className={styles.detailInfo}>Coleção: {proj.colecao}</span>}
                              </>
                            ) : (
                              proj.categoria.toUpperCase()
                            )}
                            {nivel > 0 && nivel < 3 && proj.subgrupo && <span className={styles.detailInfo}>Subgrupo: {proj.subgrupo}</span>}
                            {nivel > 0 && nivel < 3 && proj.grade && <span className={styles.detailInfo}>Grade: {proj.grade}</span>}
                          </span>
                        </div>
                      </td>
                      <td className={styles.labelCell}>VENDA (projeção)</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const isFuturo = md && !md.isMesAtual && (md.vendasVarejo != null || md.vendasEcommerce != null);
                        const temInfocard = isFuturo || (md?.isMesAtual && (md.vendasReais != null || md.vendasVarejo != null || md.vendasEcommerce != null));
                        const showBelow = idx === 0;
                        return (
                          <td
                            key={`v-${m.ano}-${m.mesNumero}`}
                            className={`${styles.vendasCell} ${m.isMesAtual ? styles.columnMesAtual : ""}`}
                            {...(temInfocard ? {
                              onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showFloatingTooltip(e, fmt(md!.vendasVarejo ?? 0), fmt(md!.vendasEcommerce ?? 0), showBelow),
                              onMouseLeave: hideFloatingTooltip,
                            } : {})}
                          >
                            {temInfocard ? (
                              <span className={styles.vendasCellWrapper}>
                                {md ? fmt(md.vendas) : "-"}
                              </span>
                            ) : (
                              md ? fmt(md.vendas) : "-"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className={styles.estoqueRow}>
                      <td className={styles.labelCell}>ESTOQUE (projeção)</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const simMes = simRowData?.mesesSimByNum.get(m.mesNumero);
                        const estoqueVal = simMes ? simMes.estoque : (md?.estoque ?? 0);
                        const isMesPassado = md?.isMesPassado ?? false;
                        const valor = isMesPassado && estoqueVal === 0 ? "-" : (md == null ? "-" : fmt(estoqueVal));
                        return <td key={`e-${m.ano}-${m.mesNumero}`} className={`${styles.estoqueCell} ${m.isMesAtual ? styles.columnMesAtual : ""}`}>{valor}</td>;
                      })}
                    </tr>
                    <tr className={styles.duracaoRow}>
                      <td className={styles.labelCell}>DURACAO (projeção)</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const simMes = simRowData?.mesesSimByNum.get(m.mesNumero);
                        const duracaoVal = simMes ? simMes.duracao : (md?.duracao ?? 0);
                        const valor = duracaoVal > 0 ? `${duracaoVal} dias` : "-";
                        const alerta = duracaoVal > 0 && duracaoVal <= limiteDiasAlerta;
                        return <td key={`d-${m.ano}-${m.mesNumero}`} className={`${styles.duracaoCell} ${m.isMesAtual ? styles.columnMesAtual : ""} ${alerta ? styles.duracaoAlerta : ""}`}>{valor}</td>;
                      })}
                    </tr>
                    {/* Bloco números reais — mesmo cinza nas 3 linhas, como na imagem */}
                    <tr className={`${styles.realRow} ${styles.realRowFirst}`}>
                      <td className={styles.realLabelCell}>VENDA (real)</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const valor = md?.vendasReais != null ? fmt(md.vendasReais) : "-";
                        const temTooltip = md && (md.vendasReais != null || md.vendasVarejoReal != null || md.vendasEcommerceReal != null);
                        const varejo = md?.vendasVarejoReal ?? 0;
                        const ecommerce = md?.vendasEcommerceReal ?? 0;
                        const totalReal = md?.vendasReais ?? (varejo + ecommerce);
                        const showBelow = idx === 0;
                        const now = new Date();
                        const diasCorridos = now.getDate();
                        const diasNoMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                        const projecaoRealVal = m.isMesAtual && totalReal > 0 && diasCorridos > 0
                          ? Math.round((totalReal / diasCorridos) * diasNoMes)
                          : undefined;
                        const projecaoRealStr = projecaoRealVal != null ? fmt(projecaoRealVal) : undefined;
                        return (
                          <td
                            key={`vr-${m.ano}-${m.mesNumero}`}
                            className={`${styles.realVendasCell} ${m.isMesAtual ? styles.columnMesAtual : ""}`}
                            {...(temTooltip ? {
                              onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showFloatingTooltip(e, fmt(varejo), fmt(ecommerce), showBelow, projecaoRealStr),
                              onMouseLeave: hideFloatingTooltip,
                            } : {})}
                          >
                            {temTooltip ? <span className={styles.vendasCellWrapper}>{valor}</span> : valor}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className={styles.realRow}>
                      <td className={styles.realLabelCell}>ESTOQUE (real)</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const valor = m.isMesAtual ? fmt(estoqueAtualReal) : (md?.estoqueRealSnapshot != null ? fmt(md.estoqueRealSnapshot) : "-");
                        return <td key={`er-${m.ano}-${m.mesNumero}`} className={`${styles.realEstoqueCell} ${m.isMesAtual ? styles.columnMesAtual : ""}`}>{valor}</td>;
                      })}
                    </tr>
                    <tr className={styles.realRow}>
                      <td className={styles.realLabelCell}>DURACAO (real)</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const valorNum = m.isMesAtual ? duracaoRealMesAtual : (md?.duracaoRealSnapshot ?? 0);
                        const valor = m.isMesAtual
                          ? (duracaoRealMesAtual > 0 ? `${duracaoRealMesAtual} dias` : "-")
                          : (md?.duracaoRealSnapshot != null ? `${md.duracaoRealSnapshot} dias` : "-");
                        const alerta = valorNum > 0 && valorNum <= limiteDiasAlerta;
                        return <td key={`dr-${m.ano}-${m.mesNumero}`} className={`${styles.realDuracaoCell} ${m.isMesAtual ? styles.columnMesAtual : ""} ${alerta ? styles.duracaoAlerta : ""}`}>{valor}</td>;
                      })}
                    </tr>
                    <tr className={styles.compraRow}>
                      <td className={styles.compraLabelCell}>DATA COMPRA</td>
                      {mesesExibicao.map((m) => {
                        const isRedMonth = compraInfo && m.mesNumero === compraInfo.redMesNumero && m.ano === compraInfo.redAno;
                        const isSubNivelMonth = !compraInfo && subCompraInfo != null && m.isMesAtual;
                        const simCompra = simRowData?.compras.find(c => c.mesNumero === m.mesNumero && c.ano === m.ano);
                        const isSimMonth = !isRedMonth && !isSubNivelMonth && !!simCompra && !m.isMesAtual;
                        return (
                          <td key={`dc-${m.ano}-${m.mesNumero}`} className={`${styles.compraDataCell} ${m.isMesAtual ? styles.columnMesAtual : ""} ${isSimMonth ? styles.compraSimuladaDataCell : ""} ${!isRedMonth && !isSubNivelMonth && !isSimMonth ? styles.compraCellEmpty : ""} ${isSubNivelMonth ? styles.compraSubNivelCell : ""}`}>
                            {isRedMonth ? compraInfo!.dataCompra : isSubNivelMonth ? "Sub-itens" : isSimMonth ? simCompra!.data : "-"}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className={styles.compraRow}>
                      <td className={styles.compraLabelCell}>QTD COMPRA</td>
                      {mesesExibicao.map((m) => {
                        const isRedMonth = compraInfo && m.mesNumero === compraInfo.redMesNumero && m.ano === compraInfo.redAno;
                        const isSubNivelMonth = !compraInfo && subCompraInfo != null && m.isMesAtual;
                        const simCompra = simRowData?.compras.find(c => c.mesNumero === m.mesNumero && c.ano === m.ano);
                        const isSimMonth = !isRedMonth && !isSubNivelMonth && !!simCompra && !m.isMesAtual;
                        const showBelow = idx === 0;
                        const handleClickQtdCompra = () => {
                          const info = compraInfo ?? (isSubNivelMonth ? subCompraInfo : null);
                          if (!info) return;
                          const qtd = compraInfo ? compraInfo.qtdCompra : subCompraInfo!.qtdTotal;
                          const items = compraInfo ? compraInfo.reposicaoItems : subCompraInfo!.reposicaoItems;
                          try {
                            sessionStorage.setItem("lista_compra_reposicao", JSON.stringify({
                              categoria: proj.categoria,
                              totalQtd: qtd,
                              itens: items.map(item => ({
                                ...item,
                                custoUnit: unitPrices[item.produto] ?? 0,
                              })),
                              timestamp: Date.now(),
                            }));
                          } catch (_) { /* ignora se sessionStorage não disponível */ }
                          const params = new URLSearchParams();
                          params.set("categoria", proj.categoria);
                          params.set("qtdCompra", String(qtd));
                          params.set("mode", "reposicao");
                          if (filial) params.set("filial", filial);
                          grupos.forEach((g) => params.append("grupos", g));
                          linhas.forEach((l) => params.append("linhas", l));
                          colecoes.forEach((c) => params.append("colecoes", c));
                          subgrupos.forEach((s) => params.append("subgrupos", s));
                          grades.forEach((g) => params.append("grades", g));
                          if (expansao.size > 0) {
                            params.set("expansao", JSON.stringify(Array.from(expansao.entries())));
                          }
                          router.push(`/${companyKey}/controle-estoque/projecao/lista-compra?${params.toString()}`);
                        };
                        const handleClickSimCompra = () => {
                          if (!simCompra) return;
                          const ex2 = expansao.get(proj.categoria);
                          const nivel2 = ex2?.nivel ?? 0;
                          const isConsulta2 = consultaTermos.length > 0;
                          const inScope = projecoes.filter(p => {
                            if (p.categoria !== proj.categoria) return false;
                            if (isConsulta2) return p.produto === proj.produto;
                            if (nivel2 >= 1 && proj.subgrupo && p.subgrupo !== proj.subgrupo) return false;
                            if (nivel2 >= 2 && proj.grade && p.grade !== proj.grade) return false;
                            if (nivel2 >= 3 && proj.produto && p.produto !== proj.produto) return false;
                            if (nivel2 >= 4 && proj.cor && p.cor !== proj.cor) return false;
                            return true;
                          });
                          const simItems = inScope.flatMap(p => {
                            const lk = `${p.categoria}|${p.subgrupo ?? ""}|${p.grade ?? ""}|${p.colecao ?? ""}|${p.produto ?? ""}|${p.cor ?? ""}`;
                            const sl = simulatedLeafMap.get(lk);
                            if (!sl) return [];
                            const c = sl.compras.find(cc => cc.mesNumero === simCompra.mesNumero && cc.ano === simCompra.ano);
                            if (!c || c.qtd <= 0) return [];
                            const estoqueNoMes = sl.meses[c.mesIdx]?.estoque ?? 0;
                            const isLencos2 = p.categoria === "LENÇOS" || p.categoria === "APROVEITAMENTO LENÇOS";
                            const lim2 = isLencos2 ? 120 : 90;
                            const consumoDiario = estoqueNoMes > 0 ? estoqueNoMes / lim2 : 0;
                            return [{
                              produto: p.produto?.trim() ?? '',
                              descricao: p.descricao ?? p.produto ?? p.categoria,
                              cor: p.cor,
                              subgrupo: p.subgrupo,
                              grade: p.grade,
                              colecao: p.colecao,
                              linha: p.linha,
                              qtdCompra: c.qtd,
                              estoqueReal: estoqueNoMes,
                              duracaoReal: lim2,
                              consumoDiario,
                              diasCobertura: 30 + lim2,
                              necessidadeTotal: consumoDiario * (30 + lim2),
                              custoUnit: unitPrices[p.produto?.trim() ?? ''] ?? 0,
                            }];
                          });
                          try {
                            sessionStorage.setItem("lista_compra_reposicao", JSON.stringify({
                              categoria: proj.categoria,
                              totalQtd: simCompra.qtd,
                              itens: simItems,
                              timestamp: Date.now(),
                              isProjecaoSimulada: true,
                              mesCompra: simCompra.data,
                            }));
                          } catch (_) {}
                          const params = new URLSearchParams();
                          params.set("categoria", proj.categoria);
                          params.set("qtdCompra", String(simCompra.qtd));
                          params.set("mode", "projecao-simulada");
                          if (filial) params.set("filial", filial);
                          grupos.forEach((g) => params.append("grupos", g));
                          linhas.forEach((l) => params.append("linhas", l));
                          colecoes.forEach((c) => params.append("colecoes", c));
                          subgrupos.forEach((s) => params.append("subgrupos", s));
                          grades.forEach((g) => params.append("grades", g));
                          if (expansao.size > 0) params.set("expansao", JSON.stringify(Array.from(expansao.entries())));
                          router.push(`/${companyKey}/controle-estoque/projecao/lista-compra?${params.toString()}`);
                        };
                        return (
                          <td
                            key={`qc-${m.ano}-${m.mesNumero}`}
                            className={`${styles.compraQtdCell} ${m.isMesAtual ? styles.columnMesAtual : ""} ${isSimMonth ? styles.compraSimuladaQtdCell : ""} ${!isRedMonth && !isSubNivelMonth && !isSimMonth ? styles.compraCellEmpty : ""} ${isRedMonth ? styles.compraQtdClickable : ""} ${isSubNivelMonth ? styles.compraSubNivelCell : ""} ${isSubNivelMonth ? styles.compraQtdClickable : ""} ${isSimMonth ? styles.compraQtdClickable : ""}`}
                            {...(isRedMonth && compraInfo ? {
                              onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showCompraDebugTooltip(e, {
                                estoqueReal: compraInfo.estoqueReal,
                                duracaoReal: compraInfo.duracaoReal,
                                consumoDiario: compraInfo.consumoDiario,
                                diasCobertura: compraInfo.diasCobertura,
                                necessidadeTotal: compraInfo.necessidadeTotal,
                                qtdCompra: compraInfo.qtdCompra,
                                limiteDias: compraInfo.limiteDias,
                              }, showBelow),
                              onMouseLeave: hideCompraDebugTooltip,
                              onClick: handleClickQtdCompra,
                            } : isSubNivelMonth ? { onClick: handleClickQtdCompra } : isSimMonth ? {
                              onClick: handleClickSimCompra,
                              onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
                                if (!simCompra) return;
                                const ex2 = expansao.get(proj.categoria);
                                const nivel2 = ex2?.nivel ?? 0;
                                const isConsulta2 = consultaTermos.length > 0;
                                const scopeLeaves = projecoes.filter(p => {
                                  if (p.categoria !== proj.categoria) return false;
                                  if (isConsulta2) return p.produto === proj.produto;
                                  if (nivel2 >= 1 && proj.subgrupo && p.subgrupo !== proj.subgrupo) return false;
                                  if (nivel2 >= 2 && proj.grade && p.grade !== proj.grade) return false;
                                  if (nivel2 >= 3 && proj.produto && p.produto !== proj.produto) return false;
                                  if (nivel2 >= 4 && proj.cor && p.cor !== proj.cor) return false;
                                  return true;
                                });
                                // Agrupa apenas pelo próximo nível (não detalha até a folha)
                                const nextKey = (p: ProjecaoCategoria): string => {
                                  if (nivel2 === 0) return p.subgrupo ?? "—";
                                  if (nivel2 === 1) return p.grade ?? "—";
                                  if (nivel2 === 2) return p.descricao ?? p.produto ?? "—";
                                  return p.cor ?? p.produto ?? "—";
                                };
                                const byNext = new Map<string, { qtd: number; estoque: number; consumoDiario: number; diasCobertura: number }>();
                                scopeLeaves.forEach(p => {
                                  const lk = `${p.categoria}|${p.subgrupo ?? ""}|${p.grade ?? ""}|${p.colecao ?? ""}|${p.produto ?? ""}|${p.cor ?? ""}`;
                                  const sl = simulatedLeafMap.get(lk);
                                  if (!sl) return;
                                  const c = sl.compras.find(cc => cc.mesNumero === simCompra.mesNumero && cc.ano === simCompra.ano);
                                  if (!c || c.qtd <= 0) return;
                                  const estoqueAntes = Math.max(0, (sl.meses[c.mesIdx]?.estoque ?? 0) - c.qtd);
                                  const isLencos2 = p.categoria === "LENÇOS" || p.categoria === "APROVEITAMENTO LENÇOS";
                                  const lim2 = isLencos2 ? 120 : 90;
                                  const cDia = estoqueAntes > 0 ? estoqueAntes / lim2 : 0;
                                  const k = nextKey(p);
                                  const prev = byNext.get(k);
                                  if (prev) {
                                    prev.qtd += c.qtd;
                                    prev.estoque += estoqueAntes;
                                    prev.consumoDiario += cDia;
                                    prev.diasCobertura = 30 + lim2;
                                  } else {
                                    byNext.set(k, { qtd: c.qtd, estoque: estoqueAntes, consumoDiario: cDia, diasCobertura: 30 + lim2 });
                                  }
                                });
                                const tooltipItems = Array.from(byNext.entries()).map(([label, v]) => ({ label, ...v }));
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const x = rect.left + rect.width / 2;
                                const y = showBelow ? rect.bottom + TOOLTIP_OFFSET : rect.top - TOOLTIP_OFFSET;
                                setSimCompraTooltip({ x, y, above: !showBelow, items: tooltipItems, total: simCompra.qtd });
                              },
                              onMouseLeave: hideSimCompraTooltip,
                            } : {})}
                          >
                            {isRedMonth ? (
                              <span className={styles.compraQtdCellWrapper}>
                                {fmt(compraInfo!.qtdCompra)}
                                <span className={styles.compraQtdArrow}>→</span>
                              </span>
                            ) : isSubNivelMonth ? (
                              <span className={styles.compraQtdCellWrapper}>
                                {fmt(subCompraInfo!.qtdTotal)}
                                <span className={styles.compraQtdArrow}>→</span>
                              </span>
                            ) : isSimMonth ? (
                              <span className={styles.compraQtdCellWrapper}>
                                {fmt(simCompra!.qtd)}
                                <span className={styles.compraQtdArrow}>→</span>
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {(() => {
                      const custoValor = compraInfo != null ? custosCompra[rowKey] : undefined;
                      return (
                        <tr className={`${styles.compraRow} ${!isLast ? styles.categoryBlockEnd : ""}`}>
                          <td className={styles.compraLabelCell}>CUSTO</td>
                          {mesesExibicao.map((m) => {
                            const isRedMonth = compraInfo && m.mesNumero === compraInfo.redMesNumero && m.ano === compraInfo.redAno;
                            const isSubNivelMonth = !compraInfo && subCompraInfo != null && m.isMesAtual;
                            const simCompra = simRowData?.compras.find(c => c.mesNumero === m.mesNumero && c.ano === m.ano);
                            const isSimMonth = !isRedMonth && !isSubNivelMonth && !!simCompra && !m.isMesAtual;
                            return (
                              <td
                                key={`cu-${m.ano}-${m.mesNumero}`}
                                className={`${styles.compraQtdCell} ${m.isMesAtual ? styles.columnMesAtual : ""} ${isSimMonth ? styles.compraSimuladaQtdCell : ""} ${!isRedMonth && !isSubNivelMonth && !isSimMonth ? styles.compraCellEmpty : ""} ${isSubNivelMonth ? styles.compraSubNivelCell : ""}`}
                              >
                                {isRedMonth ? (custoValor != null ? fmtBRL(custoValor) : "...") : isSubNivelMonth ? (subCompraInfo!.custoTotal > 0 ? fmtBRL(subCompraInfo!.custoTotal) : "...") : isSimMonth ? (simCompra!.custo > 0 ? fmtBRL(simCompra!.custo) : "...") : "-"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {typeof document !== "undefined" &&
        floatingTooltip &&
        createPortal(
          <div
            className={styles.vendasInfocardFloating}
            style={{
              left: floatingTooltip.x,
              top: floatingTooltip.y,
              transform: floatingTooltip.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            }}
            role="tooltip"
          >
            <span className={styles.vendasInfocardLine}>Total varejo: {floatingTooltip.varejo}</span>
            <span className={styles.vendasInfocardLine}>Total e-commerce: {floatingTooltip.ecommerce}</span>
            {floatingTooltip.projecaoReal != null && (
              <span className={styles.vendasInfocardLine}>Projeção real: {floatingTooltip.projecaoReal}</span>
            )}
          </div>,
          document.body
        )}
      {typeof document !== "undefined" &&
        compraDebugTooltip &&
        createPortal(
          <div
            className={styles.compraDebugTooltip}
            style={{
              left: compraDebugTooltip.x,
              top: compraDebugTooltip.y,
              transform: compraDebugTooltip.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            }}
            role="tooltip"
          >
            <div className={styles.compraDebugTitle}>Cálculo Qtd Compra</div>
            <span className={styles.compraDebugLine}>Estoque real = {fmt(compraDebugTooltip.estoqueReal)}</span>
            <span className={styles.compraDebugLine}>Duração real = {compraDebugTooltip.duracaoReal} dias</span>
            <span className={styles.compraDebugLine}>Consumo/dia = Estoque ÷ Duração = {compraDebugTooltip.consumoDiario.toFixed(2)}</span>
            <span className={styles.compraDebugLine}>Meta cobertura = 30 + {compraDebugTooltip.limiteDias} = {compraDebugTooltip.diasCobertura} dias</span>
            <span className={styles.compraDebugLine}>Necessidade total = Consumo × Meta = {fmt(Math.round(compraDebugTooltip.necessidadeTotal))}</span>
            <span className={styles.compraDebugLine}>Qtd compra = Necessidade − Estoque = {fmt(compraDebugTooltip.qtdCompra)}</span>
          </div>,
          document.body
        )}
      {typeof document !== "undefined" &&
        simCompraTooltip &&
        createPortal(
          <div
            className={styles.simCompraTooltip}
            style={{
              left: simCompraTooltip.x,
              top: simCompraTooltip.y,
              transform: simCompraTooltip.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            }}
            role="tooltip"
          >
            <div className={styles.compraDebugTitle}>Compra Simulada — sub-itens</div>
            <span className={styles.simCompraFormula}>(C/dia × cob.) − est. = qtd</span>
            {simCompraTooltip.items.map((item, i) => (
              <span key={i} className={styles.simCompraItem}>
                <span className={styles.simCompraLabel}>{item.label}</span>
                <span className={styles.simCompraDetail}>est.{fmt(item.estoque)} | {item.consumoDiario.toFixed(1)}/dia × {item.diasCobertura}d − {fmt(item.estoque)} =</span>
                <strong className={styles.simCompraQtd}>{fmt(item.qtd)}</strong>
              </span>
            ))}
            {simCompraTooltip.items.length > 1 && (
              <span className={styles.simCompraTotalLine}>Total: {fmt(simCompraTooltip.total)}</span>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
