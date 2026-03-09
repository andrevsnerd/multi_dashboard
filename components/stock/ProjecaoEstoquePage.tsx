"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { getMonth, getYear } from "date-fns";

import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
import { resolveCompany } from "@/lib/config/company";

import styles from "./ProjecaoEstoquePage.module.css";

const TOOLTIP_OFFSET = 8;

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
  companyName,
}: {
  companyKey: CompanyKey;
  companyName: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  const [opcoesGrupos, setOpcoesGrupos] = useState<string[]>([]);
  const [opcoesLinhas, setOpcoesLinhas] = useState<string[]>([]);
  const [opcoesColecoes, setOpcoesColecoes] = useState<string[]>([]);
  const [opcoesSubgrupos, setOpcoesSubgrupos] = useState<string[]>([]);
  const [opcoesGrades, setOpcoesGrades] = useState<string[]>([]);

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

  const mesAtualIndex = getMonth(new Date()); // 0-11, índice do mês atual na lista de 12

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
        ...(items.some((it) => it.meses[i]?.duracaoRealSnapshot != null) && {
          duracaoRealSnapshot: items.reduce((s, it) => s + (it.meses[i]?.duracaoRealSnapshot ?? 0), 0),
        }),
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
    const diasAteAcabar = (meses: ProjecaoMensal[], startIndex: number): number => {
      const hoje = new Date();
      const diasNoMesAtual = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
      const diasRestantesMesAtual = Math.max(0, diasNoMesAtual - hoje.getDate());
      const estoqueInicio = meses[startIndex].estoque;
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
    };
    if (items.length > 1) {
      merged.forEach((_, i) => { merged[i].duracao = diasAteAcabar(merged, i); });
    }
    return [{ ...items[0], meses: merged }];
  }, []);

  // Filtrar por linha exclu?da e por filtros; aplicar n?veis de expans?o
  const listaExibida = useMemo(() => {
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
  }, [projecoes, companyKey, excludedLines, grupos, linhas, expansao, reagrupar]);

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

  // Dados reais (por categoria): estoque atual já tem venda real descontada; duração só com ritmo real
  const getReaisPorMes = useCallback((proj: ProjecaoCategoria) => {
    const meses = proj.meses;
    if (meses.length === 0) return { estoqueAtualReal: 0, duracaoRealMesAtual: 0 };
    const mesAtualIdx = getMonth(new Date()); // 0-11
    const mesAtual = meses[mesAtualIdx];
    if (!mesAtual) return { estoqueAtualReal: 0, duracaoRealMesAtual: 0 };
    // Estoque atual já está descontado das vendas reais (não descontar de novo)
    const estoqueAtualReal = mesAtual.estoque;
    const vendasReaisMesAtual = mesAtual.vendasReais ?? 0;
    const diasCorridos = new Date().getDate();
    // Duração real: com o estoque atual, ritmo = vendasReais/diasCorridos → dias até zerar
    let duracaoRealMesAtual = 0;
    if (estoqueAtualReal > 0 && vendasReaisMesAtual > 0 && diasCorridos > 0) {
      const consumoDiario = vendasReaisMesAtual / diasCorridos;
      duracaoRealMesAtual = Math.round(estoqueAtualReal / consumoDiario);
    }
    return { estoqueAtualReal, duracaoRealMesAtual };
  }, []);

  if (loading) return <div className={styles.wrapper}><div className={styles.loading}>Carregando...</div></div>;
  if (error) return <div className={styles.wrapper}><div className={styles.error}>{error}</div></div>;

  const temExpansao = Array.from(expansao.values()).some((e) => e.nivel > 0);

  return (
    <div className={styles.wrapper}>
      <div className={styles.headerCard}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.iconWrapper}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6H16L14 4H10L8 6H4C2.9 6 2 6.9 2 8V19C2 20.1 2.9 21 4 21H20C21.1 21 22 20.1 22 19V8C22 6.9 21.1 6 20 6Z" />
              </svg>
            </div>
            <div>
              <h1 className={styles.title}>Projecao de Estoque</h1>
              <p className={styles.subtitle}>Evolucao mensal de vendas, estoque e duracao (varejo + e-commerce)</p>
              {snapshotOk && <p className={styles.snapshotSaved}>Snapshot salvo.</p>}
            </div>
          </div>
          <button type="button" className={styles.backButton} onClick={() => router.back()}>Voltar</button>
        </div>

        <div className={styles.filtersRow}>
        <FilialFilter companyKey={companyKey} value={filial} onChange={setFilial} />
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
      </div>
      </div>

      {temExpansao && (
        <div className={styles.expandActions}>
          <button type="button" className={styles.voltarExpansaoButton} onClick={() => setExpansao(new Map())}>
            Voltar para todas as categorias
          </button>
        </div>
      )}

      <div className={styles.tableWrapper}>
        <div className={styles.tableScrollContainer}>
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
                const ex = expansao.get(proj.categoria);
                const nivel = ex?.nivel ?? 0;
                const podeNivel1 = nivel === 0 && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo);
                const podeNivel2 = nivel === 1 && proj.subgrupo && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade);
                const podeNivel3 = nivel === 2 && proj.grade && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade === proj.grade && p.produto);
                const podeNivel4 = nivel === 3 && proj.produto && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade === proj.grade && p.produto === proj.produto && p.cor);
                const clickable = podeNivel1 || (nivel === 1 && podeNivel2) || (nivel === 2 && podeNivel3) || (nivel === 3 && podeNivel4);
                const isLast = idx === listaExibida.length - 1;

                const { estoqueAtualReal, duracaoRealMesAtual } = getReaisPorMes(proj);
                const isLençosLine = proj.categoria === "LENÇOS" || proj.categoria === "APROVEITAMENTO LENÇOS";
                const limiteDiasAlerta = isLençosLine ? 120 : 90;

                return (
                  <React.Fragment key={`${proj.categoria}-${proj.subgrupo ?? ""}-${proj.grade ?? ""}-${proj.colecao ?? ""}-${proj.produto ?? ""}-${proj.cor ?? ""}-${idx}`}>
                    <tr className={`${styles.categoriaRow} ${idx > 0 ? styles.categoryBlockStart : ""} ${idx === 0 ? styles.firstDataRow : ""}`}>
                      <td
                        rowSpan={6}
                        className={`${styles.categoriaCell} ${clickable ? styles.categoriaCellClickable : ""} ${!isLast ? styles.categoriaCellBlockEnd : ""}`}
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={clickable ? () => handleClickCategoria(proj) : undefined}
                        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClickCategoria(proj); } } : undefined}
                      >
                        <div className={styles.categoriaCellContent}>
                          <span className={styles.categoriaLabel}>
                            {nivel === 4 ? (proj.cor?.toUpperCase() || 'SEM COR') : nivel === 3 ? (proj.descricao?.toUpperCase() ?? proj.produto?.toUpperCase() ?? proj.categoria.toUpperCase()) : proj.categoria.toUpperCase()}
                            {nivel === 4 && proj.produto && <span className={styles.detailInfo}>{proj.produto}</span>}
                            {nivel === 4 && proj.descricao && <span className={styles.detailInfo}>{proj.descricao}</span>}
                            {nivel === 4 && <span className={styles.detailInfo}>Linha: {proj.linha ?? proj.categoria}</span>}
                            {nivel === 4 && proj.subgrupo && <span className={styles.detailInfo}>Subgrupo: {proj.subgrupo}</span>}
                            {nivel === 4 && proj.grade && <span className={styles.detailInfo}>Grade: {proj.grade}</span>}
                            {nivel === 4 && proj.colecao && <span className={styles.detailInfo}>Coleção: {proj.colecao}</span>}
                            {nivel === 3 && proj.produto && <span className={styles.detailInfo}>{proj.produto}</span>}
                            {nivel === 3 && <span className={styles.detailInfo}>Linha: {proj.linha ?? proj.categoria}</span>}
                            {nivel === 3 && proj.subgrupo && <span className={styles.detailInfo}>Subgrupo: {proj.subgrupo}</span>}
                            {nivel === 3 && proj.grade && <span className={styles.detailInfo}>Grade: {proj.grade}</span>}
                            {nivel === 3 && proj.colecao && <span className={styles.detailInfo}>Coleção: {proj.colecao}</span>}
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
                        const valor = md == null ? "-" : (md.isMesPassado && md.estoque === 0 ? "-" : fmt(md.estoque));
                        return <td key={`e-${m.ano}-${m.mesNumero}`} className={`${styles.estoqueCell} ${m.isMesAtual ? styles.columnMesAtual : ""}`}>{valor}</td>;
                      })}
                    </tr>
                    <tr className={styles.duracaoRow}>
                      <td className={styles.labelCell}>DURACAO (projeção)</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const valor = md && md.duracao > 0 ? `${md.duracao} dias` : "-";
                        const alerta = md && md.duracao > 0 && md.duracao <= limiteDiasAlerta;
                        return <td key={`d-${m.ano}-${m.mesNumero}`} className={`${styles.duracaoCell} ${m.isMesAtual ? styles.columnMesAtual : ""} ${alerta ? styles.duracaoAlerta : ""}`}>{valor}</td>;
                      })}
                    </tr>
                    {/* Bloco números reais — mesmo cinza nas 3 linhas, como na imagem */}
                    <tr className={`${styles.realRow} ${styles.realRowFirst}`}>
                      <td className={styles.realLabelCell}>VENDA (real)</td>
                      {mesesExibicao.map((m, mi) => {
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
                      {mesesExibicao.map((m, mi) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const valor = m.isMesAtual ? fmt(estoqueAtualReal) : (md?.estoqueRealSnapshot != null ? fmt(md.estoqueRealSnapshot) : "-");
                        return <td key={`er-${m.ano}-${m.mesNumero}`} className={`${styles.realEstoqueCell} ${m.isMesAtual ? styles.columnMesAtual : ""}`}>{valor}</td>;
                      })}
                    </tr>
                    <tr className={`${styles.realRow} ${!isLast ? styles.categoryBlockEnd : ""}`}>
                      <td className={styles.realLabelCell}>DURACAO (real)</td>
                      {mesesExibicao.map((m, mi) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const valorNum = m.isMesAtual ? duracaoRealMesAtual : (md?.duracaoRealSnapshot ?? 0);
                        const valor = m.isMesAtual
                          ? (duracaoRealMesAtual > 0 ? `${duracaoRealMesAtual} dias` : "-")
                          : (md?.duracaoRealSnapshot != null ? `${md.duracaoRealSnapshot} dias` : "-");
                        const alerta = valorNum > 0 && valorNum <= limiteDiasAlerta;
                        return <td key={`dr-${m.ano}-${m.mesNumero}`} className={`${styles.realDuracaoCell} ${m.isMesAtual ? styles.columnMesAtual : ""} ${alerta ? styles.duracaoAlerta : ""}`}>{valor}</td>;
                      })}
                    </tr>
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
    </div>
  );
}
