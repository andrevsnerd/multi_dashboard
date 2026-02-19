"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
import { resolveCompany } from "@/lib/config/company";
import { getCurrentMonthRange } from "@/lib/utils/date";

import styles from "./ControleEstoquePage.module.css";

interface ControleEstoquePageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface EstoqueKPI {
  estoqueTotal: number;
  valorEmEstoque: number;
  vendasEsteMes: number;
  categoriasAtivas: number;
  estoqueTotalAnterior: number;
  valorEmEstoqueAnterior: number;
  vendasMesAnterior: number;
}

interface CategoriaEstoque {
  categoria: string;
  estoqueAtual: number;
  custoTotal: number;
  custoUnitario: number;
  vendasPeriodo: number; // Renomeado de vendasMes - Venda Total (período)
  duracao: number;
  projecaoMes: number;
  projecaoAnual: number;
  projecaoVendasMes: number;
  tendenciaSemanal: number;
  estoqueSemanaPassada: number;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
}

interface EvolucaoEstoqueData {
  semana: string;
  [categoria: string]: string | number;
}

interface VendasCategoriaData {
  categoria: string;
  vendas: number;
}

interface PrevisaoEstoque {
  categoria: string;
  estoqueAtual: number;
  vendaTotal: number;
  duracao: number;
  prevFimMes: number;
  prevFimAno: number;
}

async function fetchKPIs(
  company: string,
  filial: string | null,
  range: DateRangeValue,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<EstoqueKPI> {
  const searchParams = new URLSearchParams({
    company,
    dataType: "kpis",
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }
  grupos.forEach(g => searchParams.append("grupos", g));
  linhas.forEach(l => searchParams.append("linhas", l));
  colecoes.forEach(c => searchParams.append("colecoes", c));
  subgrupos.forEach(s => searchParams.append("subgrupos", s));
  grades.forEach(g => searchParams.append("grades", g));

  const response = await fetch(`/api/controle-estoque?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar KPIs");
  }

  const json = (await response.json()) as { data: EstoqueKPI };
  return json.data;
}

async function fetchCategorias(
  company: string,
  filial: string | null,
  range: DateRangeValue,
  periodType: "semanal" | "mensal",
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[],
  filtrarEstoquePorGiro?: boolean,
  giroDias?: number
): Promise<CategoriaEstoque[]> {
  const searchParams = new URLSearchParams({
    company,
    dataType: "categorias",
    periodType,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }
  if (filtrarEstoquePorGiro) {
    searchParams.set("filtrarEstoquePorGiro", "1");
  }
  if (typeof giroDias === "number" && Number.isFinite(giroDias)) {
    searchParams.set("giroDias", String(giroDias));
  }
  grupos.forEach(g => searchParams.append("grupos", g));
  linhas.forEach(l => searchParams.append("linhas", l));
  colecoes.forEach(c => searchParams.append("colecoes", c));
  subgrupos.forEach(s => searchParams.append("subgrupos", s));
  grades.forEach(g => searchParams.append("grades", g));

  const response = await fetch(`/api/controle-estoque?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar categorias");
  }

  const json = (await response.json()) as { data: CategoriaEstoque[] };
  return json.data;
}

async function fetchEvolucao(
  company: string,
  filial: string | null,
  range: DateRangeValue,
  periodType: "semanal" | "mensal",
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<EvolucaoEstoqueData[]> {
  const searchParams = new URLSearchParams({
    company,
    dataType: "evolucao",
    periodType,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }
  grupos.forEach(g => searchParams.append("grupos", g));
  linhas.forEach(l => searchParams.append("linhas", l));
  colecoes.forEach(c => searchParams.append("colecoes", c));
  subgrupos.forEach(s => searchParams.append("subgrupos", s));
  grades.forEach(g => searchParams.append("grades", g));

  const response = await fetch(`/api/controle-estoque?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar evolução");
  }

  const json = (await response.json()) as { data: EvolucaoEstoqueData[] };
  return json.data;
}

async function fetchVendas(
  company: string,
  filial: string | null,
  range: DateRangeValue,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<VendasCategoriaData[]> {
  const searchParams = new URLSearchParams({
    company,
    dataType: "vendas",
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }
  grupos.forEach(g => searchParams.append("grupos", g));
  linhas.forEach(l => searchParams.append("linhas", l));
  colecoes.forEach(c => searchParams.append("colecoes", c));
  subgrupos.forEach(s => searchParams.append("subgrupos", s));
  grades.forEach(g => searchParams.append("grades", g));

  const response = await fetch(`/api/controle-estoque?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar vendas");
  }

  const json = (await response.json()) as { data: VendasCategoriaData[] };
  return json.data;
}

async function fetchPrevisoes(
  company: string,
  filial: string | null,
  range: DateRangeValue,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<PrevisaoEstoque[]> {
  const searchParams = new URLSearchParams({
    company,
    dataType: "previsoes",
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }
  grupos.forEach(g => searchParams.append("grupos", g));
  linhas.forEach(l => searchParams.append("linhas", l));
  colecoes.forEach(c => searchParams.append("colecoes", c));
  subgrupos.forEach(s => searchParams.append("subgrupos", s));
  grades.forEach(g => searchParams.append("grades", g));

  const response = await fetch(`/api/controle-estoque?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar previsões");
  }

  const json = (await response.json()) as { data: PrevisaoEstoque[] };
  return json.data;
}

async function fetchGiroCategories(
  company: string,
  filial: string | null,
  diasGiro: number,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<string[]> {
  const searchParams = new URLSearchParams({
    company,
    dataType: "giro",
    diasGiro: String(diasGiro),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }
  grupos.forEach(g => searchParams.append("grupos", g));
  linhas.forEach(l => searchParams.append("linhas", l));
  colecoes.forEach(c => searchParams.append("colecoes", c));
  subgrupos.forEach(s => searchParams.append("subgrupos", s));
  grades.forEach(g => searchParams.append("grades", g));

  const response = await fetch(`/api/controle-estoque?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar filtro de giro");
  }

  const json = (await response.json()) as { data: string[] };
  return json.data;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) {
    return "0";
  }
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
}

export default function ControleEstoquePage({
  companyKey,
  companyName,
}: ControleEstoquePageProps) {
  const router = useRouter();
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const rangeBeforeGiroRef = useRef<DateRangeValue | null>(null);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedLinhas, setSelectedLinhas] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [periodType, setPeriodType] = useState<"semanal" | "mensal">("semanal");
  const [selectedGiro, setSelectedGiro] = useState<string | null>(null);
  const [giroCategoriasPermitidas, setGiroCategoriasPermitidas] = useState<Set<string> | null>(null);
  const [loadingGiro, setLoadingGiro] = useState(false);

  // Faixas de giro (mesma ordem do backend): cada uma = janela exclusiva em dias atrás
  const GIRO_BUCKETS = useMemo(() => [30, 60, 90, 120, 150, 300] as const, []);

  // Quando o giro é ativado: período do dashboard = janela do giro (Obsoleto = últimos 300 dias para contexto)
  useEffect(() => {
    if (!selectedGiro) {
      if (rangeBeforeGiroRef.current) {
        setRange(rangeBeforeGiroRef.current);
        rangeBeforeGiroRef.current = null;
      }
      return;
    }
    rangeBeforeGiroRef.current = range;
    const hoje = new Date();
    const startDate = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const endDate = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

    if (selectedGiro === "0") {
      // Obsoleto: sem venda nos últimos 300 dias; range de contexto = 300 dias
      startDate.setDate(startDate.getDate() - 300);
      endDate.setDate(endDate.getDate() + 1);
    } else {
      const diasGiro = parseInt(selectedGiro, 10);
      const idx = GIRO_BUCKETS.indexOf(diasGiro as (typeof GIRO_BUCKETS)[number]);
      const diasInicio = idx > 0 ? GIRO_BUCKETS[idx - 1] : 0;
      const diasFim = idx >= 0 ? diasGiro : 30;
      startDate.setDate(startDate.getDate() - diasFim);
      endDate.setDate(endDate.getDate() - diasInicio);
    }
    setRange({ startDate, endDate });
  }, [selectedGiro]); // eslint-disable-line react-hooks/exhaustive-deps -- só reagir à mudança de giro, não ao range
  const [selectedCategorias, setSelectedCategorias] = useState<Set<string>>(new Set());
  // Estado para controlar expansão: Map<categoria, { nivel: number, subgrupoSelecionado?: string, gradeSelecionado?: string }>
  // nível 0 = categoria, 1 = subgrupos, 2 = grades do subgrupo selecionado
  const [categoriaExpansao, setCategoriaExpansao] = useState<Map<string, { nivel: number; subgrupoSelecionado?: string; gradeSelecionado?: string }>>(new Map());

  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);
  const [availableLinhas, setAvailableLinhas] = useState<string[]>([]);
  const [availableColecoes, setAvailableColecoes] = useState<string[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);

  const [kpis, setKpis] = useState<EstoqueKPI | null>(null);
  const [categorias, setCategorias] = useState<CategoriaEstoque[]>([]);
  const [evolucao, setEvolucao] = useState<EvolucaoEstoqueData[]>([]);
  const [vendas, setVendas] = useState<VendasCategoriaData[]>([]);
  const [previsoes, setPrevisoes] = useState<PrevisaoEstoque[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado para modal de detalhes das entradas/vendas
  const [modalEntradasAberto, setModalEntradasAberto] = useState(false);
  const [categoriaModal, setCategoriaModal] = useState<CategoriaEstoque | null>(null);
  const [abaAtiva, setAbaAtiva] = useState<'entradas' | 'vendas'>('entradas');
  const [detalhesEntradas, setDetalhesEntradas] = useState<Array<{
    data: Date | string;
    romaneio: string;
    produto: string;
    descricao: string;
    cor: string;
    corDescricao: string;
    linha?: string;
    subgrupo?: string;
    grade?: string;
    colecao?: string;
    quantidade: number;
    filial: string;
    vendas?: number;
  }>>([]);
  const [detalhesVendas, setDetalhesVendas] = useState<Array<{
    data: Date | string;
    ticket: string;
    produto: string;
    descricao: string;
    cor: string;
    corDescricao: string;
    linha?: string;
    subgrupo?: string;
    grade?: string;
    colecao?: string;
    quantidade: number;
    filial: string;
    valorLiquido?: number;
  }>>([]);
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);

  // Linhas a serem excluídas da visualização
  const linhasExcluidas = useMemo(() => {
    // Usar configuração da empresa se disponível, caso contrário usar lista padrão
    const companyConfig = resolveCompany(companyKey);
    if (companyConfig?.excludedLines && companyConfig.excludedLines.length > 0) {
      return new Set(companyConfig.excludedLines.map(l => l.toUpperCase().trim()));
    }
    // Fallback para lista hardcoded (caso não haja configuração)
    return new Set([
      'PRIVATE LABEL',
      'GASTRONOMICA',
      'PERFUMARIA',
      'CASHMERE',
      'ELETRONICOS',
      'EMBALAGENS',
      'CAPAS E ACESSORIOS P/ CEL'
    ]);
  }, [companyKey]);

  // Filtrar linhas disponíveis removendo as excluídas
  const linhasDisponiveis = useMemo(() => {
    return availableLinhas.filter(linha => {
      const linhaUpper = linha.toUpperCase().trim();
      return !linhasExcluidas.has(linhaUpper);
    });
  }, [availableLinhas, linhasExcluidas]);

  // Função para reagrupar dados baseado no nível de expansão
  const reagruparPorNivel = useMemo(() => {
    const isNerd = companyKey === 'nerd';
    
    return (cats: CategoriaEstoque[], categoria: string, nivel: number, subgrupoSelecionado?: string): CategoriaEstoque[] => {
      // Filtrar apenas a categoria específica
      const catsCategoria = cats.filter(c => c.categoria === categoria);
      
      if (nivel === 0) {
        // Nível 0: Agrupar apenas por categoria (sem detalhes) - igual para ambas empresas
        const agrupado = catsCategoria.reduce((acc, cat) => {
          const key = cat.categoria;
          if (!acc[key]) {
            acc[key] = {
              ...cat,
              linha: undefined,
              subgrupo: undefined,
              grade: undefined,
              colecao: undefined,
            };
          } else {
            // Somar valores simples
            acc[key].estoqueAtual += cat.estoqueAtual;
            acc[key].custoTotal += cat.custoTotal;
            acc[key].vendasPeriodo += cat.vendasPeriodo;
            acc[key].estoqueSemanaPassada = (acc[key].estoqueSemanaPassada || 0) + (cat.estoqueSemanaPassada || 0);
            acc[key].tendenciaSemanal = (acc[key].tendenciaSemanal || 0) + (cat.tendenciaSemanal || 0);
            acc[key].projecaoVendasMes = (acc[key].projecaoVendasMes || 0) + (cat.projecaoVendasMes || 0);
            
            // Recalcular métricas derivadas
            const totalEstoque = acc[key].estoqueAtual;
            const totalProjecaoVendas = acc[key].projecaoVendasMes;
            const diasCorridos = new Date().getDate();
            const totalDiasMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            
            // Recalcular projeções
            // IMPORTANTE: No frontend, não temos acesso a vendasMesAtual (vendas reais até hoje),
            // apenas a projecaoVendasMes (projeção do mês inteiro). Por isso, precisamos estimar.
            // Assumimos que projecaoVendasMes foi calculado como: (vendasMesAtual / diasCorridos) * totalDiasMes
            // Então: vendasMesAtual = (projecaoVendasMes * diasCorridos) / totalDiasMes
            
            // Calcular vendas restantes do mês (apenas o que falta vender)
            const diasRestantes = totalDiasMes - diasCorridos;
            const vendasMesAtualEstimada = diasCorridos > 0 && totalDiasMes > 0
              ? (totalProjecaoVendas * diasCorridos) / totalDiasMes
              : 0;
            const projecaoVendasRestantes = diasCorridos > 0 && diasRestantes > 0
              ? Math.round((vendasMesAtualEstimada / diasCorridos) * diasRestantes)
              : 0;
            
            // Calcular projeção anual corretamente
            // IMPORTANTE: Não podemos multiplicar projecaoVendasMes pelos meses restantes,
            // porque projecaoVendasMes é do mês INTEIRO e já vendemos parte do mês atual
            const mesesCompletosRestantes = 12 - (new Date().getMonth() + 1); // Meses após o mês atual
            const projecaoAnual = projecaoVendasRestantes + (totalProjecaoVendas * mesesCompletosRestantes);
            
            acc[key].projecaoMes = Math.round(totalEstoque - projecaoVendasRestantes);
            acc[key].projecaoAnual = Math.round(totalEstoque - projecaoAnual);
            acc[key].duracao = totalProjecaoVendas > 0 
              ? Math.round((totalEstoque / totalProjecaoVendas) * totalDiasMes)
              : 999;
          }
          return acc;
        }, {} as Record<string, CategoriaEstoque>);
        return Object.values(agrupado);
      } else if (nivel === 1) {
        // Nível 1: Agrupar por subgrupos (igual para NERD e SCARFME)
        const agrupado = catsCategoria.reduce((acc, cat) => {
          // Agrupar apenas por subgrupo
          const key = `${cat.categoria}|${cat.subgrupo || ''}`;
          if (!acc[key]) {
            acc[key] = {
              ...cat,
              grade: undefined, // Não mostrar grade no nível 1
              colecao: undefined, // Não mostrar coleção no nível 1
            };
          } else {
            // Somar valores simples
            acc[key].estoqueAtual += cat.estoqueAtual;
            acc[key].custoTotal += cat.custoTotal;
            acc[key].vendasPeriodo += cat.vendasPeriodo;
            acc[key].estoqueSemanaPassada = (acc[key].estoqueSemanaPassada || 0) + (cat.estoqueSemanaPassada || 0);
            acc[key].tendenciaSemanal = (acc[key].tendenciaSemanal || 0) + (cat.tendenciaSemanal || 0);
            acc[key].projecaoVendasMes = (acc[key].projecaoVendasMes || 0) + (cat.projecaoVendasMes || 0);
            
            // Recalcular métricas derivadas
            const totalEstoque = acc[key].estoqueAtual;
            const totalProjecaoVendas = acc[key].projecaoVendasMes;
            const diasCorridos = new Date().getDate();
            const totalDiasMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            
            // Recalcular projeções
            // Calcular vendas restantes do mês (apenas o que falta vender)
            const diasRestantes = totalDiasMes - diasCorridos;
            const projecaoVendasRestantes = diasCorridos > 0 && diasRestantes > 0
              ? Math.round((totalProjecaoVendas / diasCorridos) * diasRestantes)
              : 0;
            
            // Calcular meses restantes do ano (incluindo o mês atual)
            const mesesRestantes = 12 - new Date().getMonth();
            
            acc[key].projecaoMes = Math.round(totalEstoque - projecaoVendasRestantes);
            acc[key].projecaoAnual = Math.round(totalEstoque - (totalProjecaoVendas * mesesRestantes));
            acc[key].duracao = totalProjecaoVendas > 0 
              ? Math.round((totalEstoque / totalProjecaoVendas) * totalDiasMes)
              : 999;
          }
          return acc;
        }, {} as Record<string, CategoriaEstoque>);
        return Object.values(agrupado);
      } else {
        // Nível 2: Mostrar as diferentes grades do subgrupo selecionado
        // Filtrar apenas os cards que correspondem ao subgrupo selecionado
        if (subgrupoSelecionado) {
          // Filtrar por subgrupo selecionado e agrupar por grade
          const filtradas = catsCategoria.filter(cat => cat.subgrupo === subgrupoSelecionado);
          const agrupado = filtradas.reduce((acc, cat) => {
            // Agrupar por grade
            const key = `${cat.categoria}|${cat.subgrupo || ''}|${cat.grade || ''}`;
            if (!acc[key]) {
              acc[key] = {
                ...cat,
                colecao: undefined, // Não mostrar coleção no nível 2
              };
            } else {
              // Somar valores simples
              acc[key].estoqueAtual += cat.estoqueAtual;
              acc[key].custoTotal += cat.custoTotal;
              acc[key].vendasPeriodo += cat.vendasPeriodo;
              acc[key].estoqueSemanaPassada = (acc[key].estoqueSemanaPassada || 0) + (cat.estoqueSemanaPassada || 0);
              acc[key].tendenciaSemanal = (acc[key].tendenciaSemanal || 0) + (cat.tendenciaSemanal || 0);
              acc[key].projecaoVendasMes = (acc[key].projecaoVendasMes || 0) + (cat.projecaoVendasMes || 0);
              
              // Recalcular métricas derivadas
              const totalEstoque = acc[key].estoqueAtual;
              const totalProjecaoVendas = acc[key].projecaoVendasMes;
              const diasCorridos = new Date().getDate();
              const totalDiasMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
              
              // Recalcular projeções
              const diasRestantes = totalDiasMes - diasCorridos;
              const projecaoVendasRestantes = diasCorridos > 0 && diasRestantes > 0
                ? Math.round((totalProjecaoVendas / diasCorridos) * diasRestantes)
                : 0;
              
              const mesesRestantes = 12 - new Date().getMonth();
              
              acc[key].projecaoMes = Math.round(totalEstoque - projecaoVendasRestantes);
              acc[key].projecaoAnual = Math.round(totalEstoque - (totalProjecaoVendas * mesesRestantes));
              acc[key].duracao = totalProjecaoVendas > 0 
                ? Math.round((totalEstoque / totalProjecaoVendas) * totalDiasMes)
                : 999;
            }
            return acc;
          }, {} as Record<string, CategoriaEstoque>);
          return Object.values(agrupado);
        }
        
        // Se não há subgrupo selecionado, retornar vazio (não deveria acontecer)
        return [];
      }
    };
  }, [companyKey, categoriaExpansao]);

  // Filtrar categorias selecionadas e remover linhas excluídas, depois reagrupar por nível de expansão
  const categoriasFiltradas = useMemo(() => {
    // Primeiro filtrar e remover linhas excluídas
    let filtradas = categorias.filter(c => {
      const categoriaUpper = c.categoria.toUpperCase();
      if (linhasExcluidas.has(categoriaUpper)) {
        return false;
      }
      return selectedCategorias.has(c.categoria);
    });

    // Se há linhas selecionadas nos filtros, filtrar por elas também
    if (companyKey === 'scarfme' && selectedLinhas.length > 0) {
      filtradas = filtradas.filter(c => selectedLinhas.includes(c.categoria));
    }

    // Se há subgrupos selecionados, filtrar por eles
    if (companyKey === 'scarfme' && selectedSubgrupos.length > 0) {
      filtradas = filtradas.filter(c => c.subgrupo && selectedSubgrupos.includes(c.subgrupo));
    }

    // Se há grades selecionadas, filtrar por elas
    if (companyKey === 'scarfme' && selectedGrades.length > 0) {
      filtradas = filtradas.filter(c => c.grade && selectedGrades.includes(c.grade));
    }

    // Se há coleções selecionadas, filtrar por elas
    if (companyKey === 'scarfme' && selectedColecoes.length > 0) {
      filtradas = filtradas.filter(c => c.colecao && selectedColecoes.includes(c.colecao));
    }

    // Filtro de giro: só mostrar linhas cuja chave está no set da faixa selecionada
    if (selectedGiro) {
      if (!giroCategoriasPermitidas || giroCategoriasPermitidas.size === 0) {
        filtradas = [];
      } else {
        const trim = (s: string | number | undefined) => String(s ?? '').trim();
        filtradas = filtradas.filter(cat => {
          const chave = `${trim(cat.categoria)}|${trim(cat.linha)}|${trim(cat.subgrupo)}|${trim(cat.grade)}|${trim(cat.colecao)}`;
          return giroCategoriasPermitidas.has(chave);
        });
      }
    }

    // Agrupar por categoria e aplicar expansão
    const categoriasAgrupadas = new Map<string, CategoriaEstoque[]>();
    
    filtradas.forEach(cat => {
      const catBase = cat.categoria;
      if (!categoriasAgrupadas.has(catBase)) {
        categoriasAgrupadas.set(catBase, []);
      }
      categoriasAgrupadas.get(catBase)!.push(cat);
    });

    // Reagrupar cada categoria baseado no nível de expansão
    const resultado: CategoriaEstoque[] = [];
    categoriasAgrupadas.forEach((cats, categoria) => {
      const expansao = categoriaExpansao.get(categoria);
      const nivel = expansao?.nivel || 0;
      const subgrupoSelecionado = expansao?.subgrupoSelecionado;
      const reagrupadas = reagruparPorNivel(cats, categoria, nivel, subgrupoSelecionado);
      resultado.push(...reagrupadas);
    });

    // IMPORTANTE: Filtrar novamente para garantir que apenas a categoria correta seja mostrada
    // Quando uma categoria está expandida, mostrar APENAS os cards expandidos dessa categoria
    // e esconder todos os outros cards (incluindo os não expandidos de outras categorias)
    const resultadoFiltrado: CategoriaEstoque[] = [];
    
    // Obter categorias expandidas (com nível > 0)
    const categoriasExpandidas = new Set(Array.from(categoriaExpansao.keys()).filter(cat => {
      const expansao = categoriaExpansao.get(cat);
      return expansao && expansao.nivel > 0;
    }));
    
    // Se há categorias expandidas, mostrar APENAS os cards expandidos dessas categorias
    if (categoriasExpandidas.size > 0) {
      resultado.forEach(cat => {
        const expansao = categoriaExpansao.get(cat.categoria);
        const nivel = expansao?.nivel || 0;
        
        // Só mostrar cards expandidos (nível > 0) da categoria expandida
        if (nivel > 0 && categoriasExpandidas.has(cat.categoria)) {
          // Se está no nível 2, filtrar pelo subgrupo selecionado
          if (nivel === 2 && expansao?.subgrupoSelecionado) {
            if (cat.subgrupo === expansao.subgrupoSelecionado) {
              resultadoFiltrado.push(cat);
            }
          } else {
            // Nível 1: mostrar todos os cards da categoria (agrupados por subgrupo)
            resultadoFiltrado.push(cat);
          }
        }
      });
    } else {
      // Se não há categorias expandidas, mostrar todos os cards não expandidos
      resultado.forEach(cat => {
        const expansao = categoriaExpansao.get(cat.categoria);
        const nivel = expansao?.nivel || 0;
        if (nivel === 0) {
          resultadoFiltrado.push(cat);
        }
      });
    }

    // Ordenar por quantidade de estoque (do maior para o menor)
    resultadoFiltrado.sort((a, b) => b.estoqueAtual - a.estoqueAtual);

    return resultadoFiltrado;
  }, [categorias, selectedCategorias, linhasExcluidas, categoriaExpansao, reagruparPorNivel, companyKey, selectedLinhas, selectedSubgrupos, selectedGrades, selectedColecoes, selectedGiro, giroCategoriasPermitidas]);

  // Recalcular KPIs baseado nas categorias filtradas
  const kpisFiltrados = useMemo(() => {
    if (!kpis) return null;

    // Calcular estoque total e valor em estoque das categorias filtradas
    const estoqueTotalFiltrado = categoriasFiltradas.reduce((sum, cat) => sum + cat.estoqueAtual, 0);
    const valorEmEstoqueFiltrado = categoriasFiltradas.reduce((sum, cat) => sum + cat.custoTotal, 0);
    const categoriasAtivasFiltrado = categoriasFiltradas.length;

    // IMPORTANTE: Usar o valor do KPI diretamente para vendas, pois ele já inclui TODAS as vendas
    // (incluindo produtos sem estoque), enquanto vendasPeriodo das categorias pode não incluir tudo
    const vendasEsteMesFiltrado = kpis.vendasEsteMes;

    // IMPORTANTE: Calcular estoque anterior como soma dos estoques anteriores das categorias individuais
    // Isso garante que o total seja EXATAMENTE igual à soma das partes
    // Quando não há filtros, isso deve ser igual ao estoque anterior do KPI geral
    const estoqueTotalAnteriorFiltrado = categoriasFiltradas.reduce((sum, cat) => sum + (cat.estoqueSemanaPassada || 0), 0);
    
    // Para vendas, usar o valor do KPI diretamente (já está correto)
    const vendasMesAnteriorFiltrado = kpis.vendasMesAnterior;

    // Calcular valor em estoque anterior usando o mesmo método do backend
    // Usar o valor do KPI diretamente, que já foi calculado com a mesma fórmula do estoque total
    const valorEmEstoqueAnteriorFiltrado = kpis.valorEmEstoqueAnterior;

    return {
      estoqueTotal: estoqueTotalFiltrado,
      valorEmEstoque: valorEmEstoqueFiltrado,
      vendasEsteMes: vendasEsteMesFiltrado,
      categoriasAtivas: categoriasAtivasFiltrado,
      estoqueTotalAnterior: estoqueTotalAnteriorFiltrado,
      vendasMesAnterior: vendasMesAnteriorFiltrado,
      valorEmEstoqueAnterior: valorEmEstoqueAnteriorFiltrado,
    };
  }, [kpis, categoriasFiltradas]);

  // Calcular percentuais de mudança baseado nos KPIs filtrados
  const estoqueChangePercent = useMemo(() => {
    if (!kpisFiltrados || kpisFiltrados.estoqueTotalAnterior === 0) return 0;
    return ((kpisFiltrados.estoqueTotal - kpisFiltrados.estoqueTotalAnterior) / kpisFiltrados.estoqueTotalAnterior) * 100;
  }, [kpisFiltrados]);

  const vendasChangePercent = useMemo(() => {
    if (!kpisFiltrados || kpisFiltrados.vendasMesAnterior === 0) return 0;
    return ((kpisFiltrados.vendasEsteMes - kpisFiltrados.vendasMesAnterior) / kpisFiltrados.vendasMesAnterior) * 100;
  }, [kpisFiltrados]);

  const valorEmEstoqueChangePercent = useMemo(() => {
    if (!kpisFiltrados || !kpisFiltrados.valorEmEstoqueAnterior || kpisFiltrados.valorEmEstoqueAnterior === 0) return 0;
    return ((kpisFiltrados.valorEmEstoque - kpisFiltrados.valorEmEstoqueAnterior) / kpisFiltrados.valorEmEstoqueAnterior) * 100;
  }, [kpisFiltrados]);

  // Buscar grupos disponíveis para NERD
  useEffect(() => {
    if (companyKey !== "nerd") {
      setAvailableGrupos([]);
      return;
    }

    let active = true;

    async function loadGrupos() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        const response = await fetch(`/api/products/grupos?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableGrupos(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadGrupos();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  // Ler parâmetros da URL e expandir automaticamente os níveis correspondentes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const params = new URLSearchParams(window.location.search);
    const linha = params.get("linha");
    const grupo = params.get("grupo");
    const subgrupo = params.get("subgrupo");
    const grade = params.get("grade");
    const colecao = params.get("colecao");
    
    // Determinar qual categoria expandir e em qual nível
    const categoriaParaExpandir = companyKey === 'nerd' ? grupo : linha;
    
    if (categoriaParaExpandir && categoriaParaExpandir.trim() !== '') {
      // Primeiro, selecionar a categoria para que os dados apareçam
      setSelectedCategorias(prev => {
        const novo = new Set(prev);
        novo.add(categoriaParaExpandir.trim());
        return novo;
      });
      
      // Depois, expandir para o nível correto
      setCategoriaExpansao(prev => {
        const novo = new Map(prev);
        
        // Determinar o nível baseado nos parâmetros disponíveis
        // Nova lógica: Nível 1 = subgrupos, Nível 2 = grades do subgrupo
        if (grade && grade.trim() !== '' && subgrupo && subgrupo.trim() !== '') {
          // Nível 2: tem grade e subgrupo (mostrar grades do subgrupo)
          novo.set(categoriaParaExpandir.trim(), {
            nivel: 2,
            subgrupoSelecionado: subgrupo.trim(),
          });
        } else if (subgrupo && subgrupo.trim() !== '') {
          // Nível 1: tem só subgrupo (mostrar subgrupos)
          novo.set(categoriaParaExpandir.trim(), {
            nivel: 1,
            subgrupoSelecionado: subgrupo.trim(),
          });
        } else {
          // Nível 0: só tem linha/grupo, não expandir
          // Não fazer nada, deixar no nível 0
        }
        
        return novo;
      });
      
      // Limpar os parâmetros da URL após processar (opcional, para manter URL limpa)
      // Mas vamos manter para que o usuário possa ver onde está
    }
  }, [companyKey]); // Executar apenas uma vez quando o componente montar

  // Buscar linhas disponíveis para ScarfMe
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableLinhas([]);
      return;
    }

    let active = true;

    async function loadLinhas() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        // Adicionar filtros dependentes (colecoes, subgrupos, grades)
        selectedColecoes.forEach(c => searchParams.append("colecoes", c));
        selectedSubgrupos.forEach(s => searchParams.append("subgrupos", s));
        selectedGrades.forEach(g => searchParams.append("grades", g));

        const response = await fetch(`/api/products/linhas?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          // Filtrar linhas excluídas diretamente ao carregar
          const linhasFiltradas = (json.data || []).filter(linha => {
            const linhaUpper = linha.toUpperCase().trim();
            return !linhasExcluidas.has(linhaUpper);
          });
          setAvailableLinhas(linhasFiltradas);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadLinhas();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, selectedColecoes, selectedSubgrupos, selectedGrades, linhasExcluidas]);

  // Buscar coleções disponíveis para ScarfMe
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableColecoes([]);
      return;
    }

    let active = true;

    async function loadColecoes() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        // Adicionar filtros dependentes (linhas, subgrupos, grades)
        selectedLinhas.forEach(l => searchParams.append("linhas", l));
        selectedSubgrupos.forEach(s => searchParams.append("subgrupos", s));
        selectedGrades.forEach(g => searchParams.append("grades", g));

        const response = await fetch(`/api/products/colecoes?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableColecoes(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadColecoes();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, selectedLinhas, selectedSubgrupos, selectedGrades]);

  // Buscar subgrupos disponíveis para ScarfMe
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableSubgrupos([]);
      return;
    }

    let active = true;

    async function loadSubgrupos() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        // Adicionar filtros dependentes (linhas, colecoes, grades)
        selectedLinhas.forEach(l => searchParams.append("linhas", l));
        selectedColecoes.forEach(c => searchParams.append("colecoes", c));
        selectedGrades.forEach(g => searchParams.append("grades", g));

        const response = await fetch(`/api/products/subgrupos?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableSubgrupos(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadSubgrupos();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, selectedLinhas, selectedColecoes, selectedGrades]);

  // Buscar grades disponíveis para ScarfMe
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableGrades([]);
      return;
    }

    let active = true;

    async function loadGrades() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        // Adicionar filtros dependentes (linhas, colecoes, subgrupos)
        selectedLinhas.forEach(l => searchParams.append("linhas", l));
        selectedColecoes.forEach(c => searchParams.append("colecoes", c));
        selectedSubgrupos.forEach(s => searchParams.append("subgrupos", s));

        const response = await fetch(`/api/products/grades?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableGrades(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadGrades();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, selectedLinhas, selectedColecoes, selectedSubgrupos]);

  // Atualizar categorias selecionadas quando categorias mudarem
  useEffect(() => {
    if (categorias.length > 0 && selectedCategorias.size === 0) {
      setSelectedCategorias(new Set(categorias.map(c => c.categoria)));
    }
  }, [categorias, selectedCategorias.size]);

  // Carregar dados
  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [kpisData, categoriasData, evolucaoData, vendasData, previsoesData] = await Promise.all([
          fetchKPIs(companyKey, selectedFilial, range, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades),
          fetchCategorias(companyKey, selectedFilial, range, periodType, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades, selectedGiro != null, selectedGiro != null ? parseInt(selectedGiro, 10) : undefined),
          fetchEvolucao(companyKey, selectedFilial, range, periodType, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades),
          fetchVendas(companyKey, selectedFilial, range, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades),
          fetchPrevisoes(companyKey, selectedFilial, range, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades),
        ]);

        if (active) {
          setKpis(kpisData);
          setCategorias(categoriasData);
          setEvolucao(evolucaoData);
          setVendas(vendasData);
          setPrevisoes(previsoesData);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Erro ao carregar dados");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [companyKey, selectedFilial, range, periodType, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades, selectedGiro]);

  // Buscar categorias com giro quando filtro de giro é selecionado
  useEffect(() => {
    if (!selectedGiro) {
      setGiroCategoriasPermitidas(null);
      return;
    }

    // Limpar set antigo ao trocar de faixa (30 → 300 etc.) para não filtrar com dados errados
    setGiroCategoriasPermitidas(null);
    let active = true;
    setLoadingGiro(true);

    async function loadGiro() {
      try {
        const diasGiro = parseInt(selectedGiro!, 10);
        const chaves = await fetchGiroCategories(
          companyKey,
          selectedFilial,
          diasGiro,
          selectedGrupos,
          selectedLinhas,
          selectedColecoes,
          selectedSubgrupos,
          selectedGrades
        );
        if (active) {
          setGiroCategoriasPermitidas(new Set(chaves));
        }
      } catch (err) {
        if (active) {
          setGiroCategoriasPermitidas(null);
        }
      } finally {
        if (active) {
          setLoadingGiro(false);
        }
      }
    }

    void loadGiro();

    return () => {
      active = false;
    };
  }, [selectedGiro, companyKey, selectedFilial, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades]);

  const evolucaoFiltrada = useMemo(() => {
    if (evolucao.length === 0) return [];
    
    return evolucao.map(row => {
      const filtered: EvolucaoEstoqueData = { semana: row.semana };
      categoriasFiltradas.forEach(cat => {
        if (row[cat.categoria] !== undefined) {
          filtered[cat.categoria] = row[cat.categoria];
        }
      });
      return filtered;
    });
  }, [evolucao, categoriasFiltradas]);

  // Evolução geral: mesma regra dos cards Estoque Total e Início do período (valores intocáveis nos cards)
  // Primeiro ponto = início do período (estoqueTotalAnterior), último ponto = atual (estoqueTotal)
  const evolucaoGeral = useMemo(() => {
    if (!kpisFiltrados) return [];
    const inicio = kpisFiltrados.estoqueTotalAnterior ?? 0;
    const atual = kpisFiltrados.estoqueTotal ?? 0;
    const start = range.startDate.getTime();
    const end = range.endDate.getTime();
    const numPontos = 6;
    const pontos: { data: string; valor: number }[] = [];
    for (let i = 0; i < numPontos; i++) {
      const t = i / (numPontos - 1);
      const valor = Math.round(inicio + t * (atual - inicio));
      const dataLabel = format(new Date(start + t * (end - start)), "d 'de' MMM", { locale: ptBR });
      pontos.push({ data: dataLabel, valor });
    }
    return pontos;
  }, [kpisFiltrados, range.startDate, range.endDate]);

  // Domínio do eixo Y: padding maior para a curva ficar mais suave, menos íngreme
  const evolucaoGeralDomain = useMemo(() => {
    if (evolucaoGeral.length === 0) return undefined;
    const vals = evolucaoGeral.map(d => d.valor);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const rangeVal = maxVal - minVal || 1;
    const padding = Math.max(rangeVal * 0.35, 1);
    return [Math.floor(minVal - padding), Math.ceil(maxVal + padding)] as [number, number];
  }, [evolucaoGeral]);

  const vendasFiltradas = useMemo(() => {
    return vendas.filter(v => {
      const categoriaUpper = v.categoria.toUpperCase();
      // Remover linhas excluídas
      if (linhasExcluidas.has(categoriaUpper)) {
        return false;
      }
      // Filtrar por categorias selecionadas
      return selectedCategorias.has(v.categoria);
    });
  }, [vendas, selectedCategorias, linhasExcluidas]);

  const previsoesFiltradas = useMemo(() => {
    return previsoes.filter(p => {
      const categoriaUpper = p.categoria.toUpperCase();
      // Remover linhas excluídas
      if (linhasExcluidas.has(categoriaUpper)) {
        return false;
      }
      // Filtrar por categorias selecionadas
      return selectedCategorias.has(p.categoria);
    });
  }, [previsoes, selectedCategorias, linhasExcluidas]);


  const currentDate = format(new Date(), "EEEE, d 'De' MMMM 'De' yyyy", { locale: ptBR });

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.iconWrapper}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M20 6H16L14 4H10L8 6H4C2.9 6 2 6.9 2 8V19C2 20.1 2.9 21 4 21H20C21.1 21 22 20.1 22 19V8C22 6.9 21.1 6 20 6Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <h1 className={styles.title}>Controle de Estoque</h1>
            <p className={styles.subtitle}>Análise {periodType === "semanal" ? "semanal" : "mensal"} de inventário</p>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.dateDisplay}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2H4C2.9 2 2 2.9 2 4V12C2 13.1 2.9 14 4 14H12C13.1 14 14 13.1 14 12V4C14 2.9 13.1 2 12 2Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M2 6H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M6 2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M10 2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{currentDate}</span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className={styles.kpisGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>ESTOQUE TOTAL</div>
          <div className={styles.kpiValue}>{formatNumber(kpisFiltrados?.estoqueTotal ?? 0)} un</div>
          {kpisFiltrados && kpisFiltrados.estoqueTotalAnterior !== undefined && (
            <>
              <div className={styles.kpiPrevious}>
                Início do período: {formatNumber(kpisFiltrados.estoqueTotalAnterior)} un
              </div>
              {(() => {
                const diferenca = (kpisFiltrados.estoqueTotal ?? 0) - (kpisFiltrados.estoqueTotalAnterior ?? 0);
                if (diferenca !== 0) {
                  return (
                    <div className={`${styles.kpiChange} ${diferenca > 0 ? styles.positive : styles.negative}`}>
                      {diferenca > 0 ? "▲" : "▼"} {formatNumber(Math.abs(diferenca))} un
                      {estoqueChangePercent !== 0 && (
                        <span> ({estoqueChangePercent > 0 ? "+" : ""}{estoqueChangePercent.toFixed(1)}%)</span>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
            </>
          )}
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>VALOR EM ESTOQUE</div>
          <div className={styles.kpiValue}>{formatCurrency(kpisFiltrados?.valorEmEstoque ?? 0)}</div>
          {kpisFiltrados && kpisFiltrados.valorEmEstoqueAnterior !== undefined && (
            <>
              <div className={styles.kpiPrevious}>
                Início do período: {formatCurrency(kpisFiltrados.valorEmEstoqueAnterior)}
              </div>
              {(() => {
                const diferenca = (kpisFiltrados.valorEmEstoque ?? 0) - (kpisFiltrados.valorEmEstoqueAnterior ?? 0);
                if (diferenca !== 0) {
                  return (
                    <div className={`${styles.kpiChange} ${diferenca > 0 ? styles.positive : styles.negative}`}>
                      {diferenca > 0 ? "▲" : "▼"} {formatCurrency(Math.abs(diferenca))}
                      {valorEmEstoqueChangePercent !== 0 && (
                        <span> ({valorEmEstoqueChangePercent > 0 ? "+" : ""}{valorEmEstoqueChangePercent.toFixed(1)}%)</span>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
            </>
          )}
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>VENDAS TOTAIS</div>
          <div className={styles.kpiValue}>{formatNumber(kpisFiltrados?.vendasEsteMes ?? 0)} un</div>
          {kpisFiltrados && kpisFiltrados.vendasMesAnterior !== undefined && (
            <>
              <div className={styles.kpiPrevious}>
                Período anterior: {formatNumber(kpisFiltrados.vendasMesAnterior)} un
              </div>
              {vendasChangePercent !== 0 && (
                <div className={`${styles.kpiChange} ${vendasChangePercent > 0 ? styles.positive : styles.negative}`}>
                  {vendasChangePercent > 0 ? "▲" : "▼"} {Math.abs(vendasChangePercent).toFixed(1)}% vs período anterior
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>CATEGORIAS ATIVAS</div>
          <div className={styles.kpiValue}>{kpisFiltrados?.categoriasAtivas ?? 0}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className={styles.filtersRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <DateRangeFilter
            value={range}
            onChange={setRange}
            disabled={!!selectedGiro}
          />
          {selectedGiro && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)" }} title="Período fixado pela faixa de giro selecionada">
              (período = faixa do giro)
            </span>
          )}
        </div>
        <FilialFilter
          companyKey={companyKey}
          value={selectedFilial}
          onChange={setSelectedFilial}
        />
        {companyKey === "nerd" && (
          <MultiSelectFilter
            label="Grupo"
            value={selectedGrupos}
            options={availableGrupos}
            onChange={setSelectedGrupos}
          />
        )}
        {companyKey === "scarfme" && (
          <>
            <MultiSelectFilter
              label="Linha"
              value={selectedLinhas}
              options={linhasDisponiveis}
              onChange={(linhas) => {
                setSelectedLinhas(linhas);
                // Quando selecionar uma linha, selecionar a categoria correspondente e expandir para nível 1
                if (linhas.length > 0) {
                  linhas.forEach(linha => {
                    // Selecionar a categoria correspondente
                    setSelectedCategorias(prev => {
                      const novo = new Set(prev);
                      novo.add(linha);
                      return novo;
                    });
                    // Expandir para nível 1
                    setCategoriaExpansao(prev => {
                      const novo = new Map(prev);
                      novo.set(linha, { nivel: 1 });
                      return novo;
                    });
                  });
                } else {
                  // Se remover todas as linhas, desmarcar categorias e colapsar
                  selectedLinhas.forEach(linha => {
                    setSelectedCategorias(prev => {
                      const novo = new Set(prev);
                      novo.delete(linha);
                      return novo;
                    });
                    setCategoriaExpansao(prev => {
                      const novo = new Map(prev);
                      novo.delete(linha);
                      return novo;
                    });
                  });
                }
              }}
            />
            <MultiSelectFilter
              label="Coleção"
              value={selectedColecoes}
              options={availableColecoes}
              onChange={(colecoes) => {
                setSelectedColecoes(colecoes);
                // Quando selecionar coleção, expandir para nível 2 se já estiver no nível 1
                if (colecoes.length > 0 && selectedLinhas.length > 0) {
                  selectedLinhas.forEach(linha => {
                    setCategoriaExpansao(prev => {
                      const novo = new Map(prev);
                      const expansao = novo.get(linha);
                      if (expansao && expansao.nivel === 1) {
                        // Se já está no nível 1, expandir para nível 2
                        // Mas precisamos do subgrupo e grade selecionados
                        // Por enquanto, vamos apenas manter no nível 1 se não tiver subgrupo/grade
                      }
                      return novo;
                    });
                  });
                }
              }}
            />
            <MultiSelectFilter
              label="Subgrupo"
              value={selectedSubgrupos}
              options={availableSubgrupos}
              onChange={(subgrupos) => {
                setSelectedSubgrupos(subgrupos);
                // Quando selecionar subgrupo, expandir para nível 2 se tiver grade também
                if (subgrupos.length > 0 && selectedGrades.length > 0 && selectedLinhas.length > 0) {
                  selectedLinhas.forEach(linha => {
                    setCategoriaExpansao(prev => {
                      const novo = new Map(prev);
                      novo.set(linha, {
                        nivel: 2,
                        subgrupoSelecionado: subgrupos[0], // Usar o primeiro selecionado
                        gradeSelecionado: selectedGrades[0], // Usar o primeiro selecionado
                      });
                      return novo;
                    });
                  });
                } else if (subgrupos.length > 0 && selectedLinhas.length > 0) {
                  // Se só tem subgrupo, manter no nível 1
                  selectedLinhas.forEach(linha => {
                    setCategoriaExpansao(prev => {
                      const novo = new Map(prev);
                      if (!novo.has(linha)) {
                        novo.set(linha, { nivel: 1 });
                      }
                      return novo;
                    });
                  });
                }
              }}
            />
            <MultiSelectFilter
              label="Grade"
              value={selectedGrades}
              options={availableGrades}
              onChange={(grades) => {
                setSelectedGrades(grades);
                // Quando selecionar grade, expandir para nível 2 se tiver subgrupo também
                if (grades.length > 0 && selectedSubgrupos.length > 0 && selectedLinhas.length > 0) {
                  selectedLinhas.forEach(linha => {
                    setCategoriaExpansao(prev => {
                      const novo = new Map(prev);
                      novo.set(linha, {
                        nivel: 2,
                        subgrupoSelecionado: selectedSubgrupos[0], // Usar o primeiro selecionado
                        gradeSelecionado: grades[0], // Usar o primeiro selecionado
                      });
                      return novo;
                    });
                  });
                } else if (grades.length > 0 && selectedLinhas.length > 0) {
                  // Se só tem grade, manter no nível 1
                  selectedLinhas.forEach(linha => {
                    setCategoriaExpansao(prev => {
                      const novo = new Map(prev);
                      if (!novo.has(linha)) {
                        novo.set(linha, { nivel: 1 });
                      }
                      return novo;
                    });
                  });
                }
              }}
            />
          </>
        )}
      </div>

      {/* Botão PROJEÇÃO */}
      <div className={styles.filterRow}>
        <button
          className={styles.projecaoButton}
          onClick={() => {
            const params = new URLSearchParams();
            if (selectedFilial) params.set("filial", selectedFilial);
            
            // Verificar se há categorias expandidas
            const categoriasExpandidas = Array.from(categoriaExpansao.entries()).filter(([_, expansao]) => expansao.nivel > 0);
            
            if (categoriasExpandidas.length > 0) {
              // Se há expansão, aplicar filtros baseados no nível de expansão
              const [categoriaExpandida, expansao] = categoriasExpandidas[0];
              const nivel = expansao.nivel;
              const subgrupoSelecionado = expansao.subgrupoSelecionado;
              
              // Usar categorias originais (antes do reagrupamento) para extrair subgrupos e grades
              const categoriasOriginais = categorias.filter(cat => {
                // Aplicar mesmos filtros básicos
                const categoriaUpper = cat.categoria.toUpperCase();
                if (linhasExcluidas.has(categoriaUpper)) return false;
                if (!selectedCategorias.has(cat.categoria)) return false;
                
                // Filtrar pela categoria expandida
                if (cat.categoria !== categoriaExpandida) return false;
                
                // Aplicar filtros de linha/subgrupo/grade/coleção se existirem
                if (companyKey === 'scarfme') {
                  if (selectedLinhas.length > 0 && !selectedLinhas.includes(cat.categoria)) return false;
                  if (selectedSubgrupos.length > 0 && cat.subgrupo && !selectedSubgrupos.includes(cat.subgrupo)) return false;
                  if (selectedGrades.length > 0 && cat.grade && !selectedGrades.includes(cat.grade)) return false;
                  if (selectedColecoes.length > 0 && cat.colecao && !selectedColecoes.includes(cat.colecao)) return false;
                }
                
                return true;
              });
              
              if (companyKey === 'scarfme') {
                // Para ScarfMe, categoria expandida é a linha
                params.append("linhas", categoriaExpandida);
                
                if (nivel === 1) {
                  // Nível 1: mostrar apenas os subgrupos dessa linha
                  const subgruposUnicos = new Set<string>();
                  categoriasOriginais
                    .filter(cat => cat.subgrupo)
                    .forEach(cat => {
                      if (cat.subgrupo) subgruposUnicos.add(cat.subgrupo);
                    });
                  subgruposUnicos.forEach(s => params.append("subgrupos", s));
                } else if (nivel === 2 && subgrupoSelecionado) {
                  // Nível 2: mostrar apenas as grades do subgrupo selecionado
                  params.append("subgrupos", subgrupoSelecionado);
                  const gradesUnicas = new Set<string>();
                  categoriasOriginais
                    .filter(cat => cat.subgrupo === subgrupoSelecionado && cat.grade)
                    .forEach(cat => {
                      if (cat.grade) gradesUnicas.add(cat.grade);
                    });
                  gradesUnicas.forEach(g => params.append("grades", g));
                }
              } else if (companyKey === 'nerd') {
                // Para NERD, categoria expandida é o grupo
                params.append("grupos", categoriaExpandida);
                
                if (nivel === 1) {
                  // Nível 1: mostrar apenas os subgrupos desse grupo
                  const subgruposUnicos = new Set<string>();
                  categoriasOriginais
                    .filter(cat => cat.subgrupo)
                    .forEach(cat => {
                      if (cat.subgrupo) subgruposUnicos.add(cat.subgrupo);
                    });
                  subgruposUnicos.forEach(s => params.append("subgrupos", s));
                } else if (nivel === 2 && subgrupoSelecionado) {
                  // Nível 2: mostrar apenas as grades do subgrupo selecionado
                  params.append("subgrupos", subgrupoSelecionado);
                  const gradesUnicas = new Set<string>();
                  categoriasOriginais
                    .filter(cat => cat.subgrupo === subgrupoSelecionado && cat.grade)
                    .forEach(cat => {
                      if (cat.grade) gradesUnicas.add(cat.grade);
                    });
                  gradesUnicas.forEach(g => params.append("grades", g));
                }
              }
            } else {
              // Sem expansão: usar filtros selecionados normalmente
              selectedGrupos.forEach(g => params.append("grupos", g));
              selectedLinhas.forEach(l => params.append("linhas", l));
              selectedColecoes.forEach(c => params.append("colecoes", c));
              selectedSubgrupos.forEach(s => params.append("subgrupos", s));
              selectedGrades.forEach(g => params.append("grades", g));
            }
            
            router.push(`/${companyKey}/controle-estoque/projecao?${params.toString()}`);
          }}
        >
          PROJEÇÃO
        </button>
      </div>

      {/* Giro: faixas exclusivas — 30 = 0–30 dias, 60 = 30–60, 90 = 60–90, 120 = 90–120, 150 = 120–150, 300 = 150–300 */}
      <div className={styles.filterRow}>
        <span
          style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #888)', marginRight: '8px', alignSelf: 'center' }}
          title="Cada faixa é exclusiva: 30 = vendeu há 0–30 dias, 60 = 30–60 dias, 120 = 90–120 dias, etc. Quem levou 120 dias não aparece em 60."
        >
          Giro (faixa):
        </span>
        {[
          { label: '30 dias', value: '30', title: 'Vendeu entre 0 e 30 dias atrás (ativos)' },
          { label: '60 dias', value: '60', title: 'Vendeu entre 30 e 60 dias atrás' },
          { label: '90 dias', value: '90', title: 'Vendeu entre 60 e 90 dias atrás' },
          { label: '120 dias', value: '120', title: 'Vendeu entre 90 e 120 dias atrás' },
          { label: '150 dias', value: '150', title: 'Vendeu entre 120 e 150 dias atrás' },
          { label: '300 dias', value: '300', title: 'Vendeu entre 150 e 300 dias atrás' },
          { label: 'Obsoleto', value: '0', title: 'Sem venda nos últimos 300 dias' },
        ].map(({ label, value, title }) => (
          <button
            key={value}
            className={`${styles.toggleButton} ${selectedGiro === value ? styles.toggleButtonActive : ''}`}
            style={{ marginRight: '6px' }}
            onClick={() => setSelectedGiro(selectedGiro === value ? null : value)}
            disabled={loadingGiro}
            title={title}
          >
            <span className={styles.toggleLabel}>{label}</span>
          </button>
        ))}
        {loadingGiro && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #888)', alignSelf: 'center' }}>
            carregando...
          </span>
        )}
      </div>

      {/* Por Categoria */}
      <div className={styles.section} id="categorias-section">
        <div className={styles.sectionHeader}>
          {(() => {
            // Verificar se há categorias expandidas para mostrar botão de voltar
            const categoriasExpandidas = Array.from(categoriaExpansao.entries()).filter(([_, expansao]) => expansao.nivel > 0);
            if (categoriasExpandidas.length > 0) {
              const [categoriaExpandida, expansao] = categoriasExpandidas[0];
              return (
                <button
                  onClick={() => {
                    setCategoriaExpansao(prev => {
                      const novo = new Map(prev);
                      if (expansao.nivel === 2) {
                        // Voltar do nível 2 para nível 1 (remover subgrupo selecionado)
                        novo.set(categoriaExpandida, { nivel: 1 });
                      } else if (expansao.nivel === 1) {
                        // Voltar do nível 1 para nível 0 (colapsar)
                        novo.delete(categoriaExpandida);
                      }
                      return novo;
                    });
                  }}
                  className={styles.backButton}
                >
                  ← Voltar
                </button>
              );
            }
            return null;
          })()}
          <h2 className={styles.sectionTitle}>Por Categoria</h2>
        </div>
        <div className={styles.categoriasGrid}>
          {categoriasFiltradas.map((cat, index) => {
            const expansao = categoriaExpansao.get(cat.categoria);
            const nivelAtual = expansao?.nivel || 0;
            // Para NERD, não usar linha (usa grupo/subgrupo), para SCARFME usar linha
            const temDetalhes = companyKey === 'nerd' 
              ? (cat.subgrupo || cat.grade || cat.colecao)
              : (cat.linha || cat.subgrupo || cat.grade || cat.colecao);
            const isCardExpandido = nivelAtual > 0 && temDetalhes;
            // Criar chave única sempre (usar index para garantir unicidade)
            // Para NERD, não usar linha na chave
            const cardKey = isCardExpandido 
              ? companyKey === 'nerd'
                ? `${cat.categoria}-${cat.subgrupo || ''}-${cat.grade || ''}-${nivelAtual === 2 ? cat.colecao || '' : ''}-${index}`
                : `${cat.categoria}-${cat.linha || ''}-${cat.subgrupo || ''}-${cat.grade || ''}-${nivelAtual === 2 ? cat.colecao || '' : ''}-${index}`
              : `${cat.categoria}-${index}`;
            
            return (
            <div key={cardKey} className={styles.categoriaCard}>
              <div className={styles.categoriaHeader}>
                <div className={styles.categoriaNameWrapper}>
                  {(() => {
                    const expansao = categoriaExpansao.get(cat.categoria);
                    const nivelAtual = expansao?.nivel || 0;
                    // Para NERD, não usar linha (usa grupo/subgrupo), para SCARFME usar linha
                    const temDetalhes = companyKey === 'nerd' 
                      ? (cat.subgrupo || cat.grade || cat.colecao)
                      : (cat.linha || cat.subgrupo || cat.grade || cat.colecao);
                    const isCardExpandido = nivelAtual > 0 && temDetalhes;
                    
                    // Nova lógica: Nível 0 -> subgrupos, Nível 1 -> grades do subgrupo, Nível 2 -> navega para detalhes
                    if (nivelAtual === 2 && isCardExpandido) {
                      // Nível 2: clicar navega para página de detalhes
                      return (
                        <>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              const params = new URLSearchParams();
                              if (companyKey === 'nerd') {
                                params.set("grupo", cat.categoria);
                              } else {
                                const linhaParaUsar = cat.linha || cat.categoria;
                                if (linhaParaUsar) params.set("linha", linhaParaUsar);
                              }
                              if (cat.subgrupo) params.set("subgrupo", cat.subgrupo);
                              if (cat.grade) params.set("grade", cat.grade);
                              if (cat.colecao) params.set("colecao", cat.colecao);
                              if (selectedFilial) params.set("filial", selectedFilial);
                              // Scroll para o topo antes de navegar
                              window.scrollTo({ top: 0, behavior: 'instant' });
                              router.push(`/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`);
                            }}
                            className={styles.categoriaName}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                          >
                            {cat.categoria}
                          </button>
                          {/* Mostrar detalhes: subgrupo e grade */}
                          <div className={styles.categoriaDetails}>
                            {cat.subgrupo && <span className={styles.detailTag}>Subgrupo: {cat.subgrupo}</span>}
                            {cat.grade && <span className={styles.detailTag}>Grade: {cat.grade}</span>}
                          </div>
                        </>
                      );
                    } else if (nivelAtual === 1 && isCardExpandido) {
                      // Nível 1: clicar expande para nível 2 (mostrar grades do subgrupo selecionado)
                      return (
                        <>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setCategoriaExpansao(prev => {
                                const novo = new Map(prev);
                                // Salvar o subgrupo selecionado para filtrar as grades
                                novo.set(cat.categoria, {
                                  nivel: 2,
                                  subgrupoSelecionado: cat.subgrupo,
                                });
                                return novo;
                              });
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className={styles.categoriaName}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                          >
                            {cat.categoria}
                          </button>
                          {/* Mostrar detalhes: subgrupo */}
                          <div className={styles.categoriaDetails}>
                            {cat.subgrupo && <span className={styles.detailTag}>Subgrupo: {cat.subgrupo}</span>}
                          </div>
                        </>
                      );
                    } else {
                      // Nível 0: clicar expande para nível 1 (mostrar subgrupos)
                      return (
                        <>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setCategoriaExpansao(prev => {
                                const novo = new Map(prev);
                                novo.set(cat.categoria, { nivel: 1 });
                                return novo;
                              });
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className={styles.categoriaName}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                          >
                            {cat.categoria}
                          </button>
                        </>
                      );
                    }
                  })()}
                </div>
                <div 
                  className={`${styles.tendencia} ${cat.tendenciaSemanal >= 0 ? styles.positive : styles.negative}`}
                  style={{ cursor: 'pointer' }}
                  onClick={async () => {
                    setCategoriaModal(cat);
                    setModalEntradasAberto(true);
                    setAbaAtiva('entradas');
                    setLoadingDetalhes(true);
                    
                    // Buscar detalhes das entradas e vendas em paralelo
                    const baseParams = new URLSearchParams({
                      company: companyKey,
                      categoria: cat.categoria,
                      start: range.startDate.toISOString(),
                      end: range.endDate.toISOString(),
                    });
                    
                    if (selectedFilial) {
                      baseParams.set('filial', selectedFilial);
                    }
                    
                    if (cat.linha) baseParams.set('linha', cat.linha);
                    if (cat.subgrupo) baseParams.set('subgrupo', cat.subgrupo);
                    if (cat.grade) baseParams.set('grade', cat.grade);
                    if (cat.colecao) baseParams.set('colecao', cat.colecao);
                    
                    selectedGrupos.forEach(g => baseParams.append('grupos', g));
                    selectedLinhas.forEach(l => baseParams.append('linhas', l));
                    selectedSubgrupos.forEach(s => baseParams.append('subgrupos', s));
                    selectedGrades.forEach(g => baseParams.append('grades', g));
                    selectedColecoes.forEach(c => baseParams.append('colecoes', c));
                    
                    // Buscar entradas e vendas (que já inclui e-commerce) em paralelo
                    const [entradasRes, vendasRes] = await Promise.all([
                      fetch(`/api/controle-estoque?${baseParams.toString()}&dataType=detalhes-entradas`),
                      fetch(`/api/controle-estoque?${baseParams.toString()}&dataType=detalhes-vendas`),
                    ]);
                    
                    const [entradasData, vendasData] = await Promise.all([
                      entradasRes.json(),
                      vendasRes.json(),
                    ]);
                    
                    setDetalhesEntradas(entradasData.data || []);
                    setDetalhesVendas(vendasData.data || []);
                    setLoadingDetalhes(false);
                  }}
                  title="Clique para ver detalhes das entradas do período"
                >
                  {cat.tendenciaSemanal >= 0 ? "+" : ""}{formatNumber(cat.tendenciaSemanal)} no Período
                </div>
              </div>
              <div className={styles.categoriaContent}>
                <div 
                  className={styles.estoqueValue}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const params = new URLSearchParams();
                    
                    // Determinar parâmetros baseado no nível atual e empresa
                    const expansao = categoriaExpansao.get(cat.categoria);
                    const nivelAtual = expansao?.nivel || 0;
                    const isNerd = companyKey === 'nerd';
                    
                    if (isNerd) {
                      // NERD: usar grupo
                      if (cat.categoria) params.set("grupo", cat.categoria);
                      if (cat.subgrupo) params.set("subgrupo", cat.subgrupo);
                      if (cat.grade) params.set("grade", cat.grade);
                      if (cat.colecao) params.set("colecao", cat.colecao);
                    } else {
                      // SCARFME: usar linha (categoria é a linha em SCARFME)
                      // Se cat.linha existe, usar ela; senão, usar cat.categoria que é a linha
                      const linhaParaUsar = cat.linha || cat.categoria;
                      if (linhaParaUsar) params.set("linha", linhaParaUsar);
                      if (cat.subgrupo) params.set("subgrupo", cat.subgrupo);
                      if (cat.grade) params.set("grade", cat.grade);
                      if (cat.colecao) params.set("colecao", cat.colecao);
                    }
                    
                    if (selectedFilial) params.set("filial", selectedFilial);
                    // Quando giro está ativo: passar período para a página de detalhes filtrar só itens que venderam
                    if (selectedGiro) {
                      params.set("giroDias", selectedGiro);
                      params.set("start", range.startDate.toISOString());
                      params.set("end", range.endDate.toISOString());
                    }
                    
                    window.scrollTo({ top: 0, behavior: 'instant' });
                    router.push(`/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`);
                  }}
                  title="Clique para ver detalhes do estoque"
                >
                  {formatNumber(cat.estoqueAtual)} <span className={styles.estoqueUnit}>unidades</span>
                </div>
                {cat.estoqueSemanaPassada !== undefined && (
                  <div className={styles.estoqueSemanaPassada}>
                    {formatNumber(cat.estoqueSemanaPassada)} início do período
                  </div>
                )}
                <div className={styles.categoriaInfo}>
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>Custo total:</span>
                    <span className={styles.infoValue}>{formatCurrency(cat.custoTotal)}</span>
                  </div>
                </div>
                <div className={styles.categoriaMetrics}>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Venda Total (período):</span>
                    <span className={styles.metricValue}>{formatNumber(cat.vendasPeriodo)}</span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Projeção vendas mês:</span>
                    <span className={styles.metricValue}>
                      {formatNumber(cat.projecaoVendasMes)} un
                    </span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Estoque final mês:</span>
                    <span className={styles.metricValue}>
                      {formatNumber(cat.projecaoMes)} un
                    </span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Estoque final ano:</span>
                    <span className={styles.metricValue}>
                      {formatNumber(cat.projecaoAnual)} un
                    </span>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>Duração:</span>
                    <span className={styles.metricValue}>{cat.duracao} dias</span>
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Filtros de Período */}
      <div className={styles.categoryFilters}>
        <div className={styles.periodButtons}>
          <button
            className={`${styles.periodButton} ${periodType === "semanal" ? styles.active : ""}`}
            onClick={() => setPeriodType("semanal")}
          >
            Semanal
          </button>
          <button
            className={`${styles.periodButton} ${periodType === "mensal" ? styles.active : ""}`}
            onClick={() => setPeriodType("mensal")}
          >
            Mensal
          </button>
        </div>
      </div>

      {/* Gráficos */}
      <div className={styles.chartsRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>
            Evolução do Estoque - {periodType === "semanal" ? "Semanal" : "Mensal"}
          </h3>
          <div className={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={evolucaoGeral} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <defs>
                  <linearGradient id="evolucaoEstoqueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e5e5e5" stopOpacity={1} />
                    <stop offset="100%" stopColor="#e5e5e5" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={true} vertical={false} />
                <XAxis dataKey="data" tick={{ fill: "#666", fontSize: 12 }} axisLine={{ stroke: "#ddd" }} tickLine={false} />
                <YAxis domain={evolucaoGeralDomain} tick={{ fill: "#666", fontSize: 12 }} axisLine={{ stroke: "#ddd" }} tickLine={false} tickFormatter={v => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} />
                <Tooltip formatter={(value: number) => [value.toLocaleString("pt-BR", { maximumFractionDigits: 0 }), "Estoque"]} contentStyle={{ backgroundColor: "#fff", border: "1px solid #eee", borderRadius: 8 }} />
                <Area type="monotone" dataKey="valor" stroke="#333" strokeWidth={2} fill="url(#evolucaoEstoqueFill)" isAnimationActive={true} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Vendas por Categoria</h3>
          <div className={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={vendasFiltradas} margin={{ top: 16, right: 8, left: 8, bottom: 8 }}>
                <defs>
                  <linearGradient id="vendasBarGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7A7A7A" stopOpacity={1} />
                    <stop offset="100%" stopColor="#505050" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={true} vertical={false} />
                <XAxis dataKey="categoria" tick={{ fill: "#555", fontSize: 12 }} axisLine={{ stroke: "#ddd" }} tickLine={false} />
                <YAxis tick={{ fill: "#666", fontSize: 12 }} axisLine={{ stroke: "#ddd" }} tickLine={false} tickFormatter={v => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} />
                <Tooltip formatter={(value: number) => [value.toLocaleString("pt-BR", { maximumFractionDigits: 0 }), "Vendas"]} contentStyle={{ backgroundColor: "#fff", border: "1px solid #eee", borderRadius: 8 }} />
                <Bar dataKey="vendas" fill="url(#vendasBarGradient)" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  <LabelList dataKey="vendas" position="top" formatter={(v) => (typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : String(v ?? ""))} style={{ fill: "#666", fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabela de Previsões */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Previsões de Vendas e Estoque</h2>
        <div className={styles.tableWrapper}>
          <table className={styles.previsoesTable}>
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Estoque Atual</th>
                <th>Venda Total</th>
                <th>Duração (dias)</th>
                <th>Prev. Fim Mês</th>
                <th>Prev. Fim Ano</th>
              </tr>
            </thead>
            <tbody>
              {previsoesFiltradas.map((prev, index) => (
                <tr key={`${prev.categoria}-${index}`}>
                  <td>{prev.categoria}</td>
                  <td>{formatNumber(prev.estoqueAtual)}</td>
                  <td>{formatNumber(prev.vendaTotal)}</td>
                  <td>{prev.duracao}</td>
                  <td>
                    {formatNumber(prev.prevFimMes)}
                  </td>
                  <td>
                    {formatNumber(prev.prevFimAno)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Detalhes das Entradas */}
      {modalEntradasAberto && categoriaModal && (
        <div 
          className={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setModalEntradasAberto(false);
              setCategoriaModal(null);
              setDetalhesEntradas([]);
            }
          }}
        >
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2>Detalhes do Período</h2>
              <button 
                className={styles.modalClose}
                onClick={() => {
                  setModalEntradasAberto(false);
                  setCategoriaModal(null);
                  setDetalhesEntradas([]);
                  setDetalhesVendas([]);
                  setAbaAtiva('entradas');
                }}
              >
                ×
              </button>
            </div>
            
            <div className={styles.modalBody}>
              <div className={styles.modalInfo}>
                <strong>Categoria:</strong> {categoriaModal.categoria}
                {categoriaModal.linha && <>, <strong>Linha:</strong> {categoriaModal.linha}</>}
                {categoriaModal.subgrupo && <>, <strong>Subgrupo:</strong> {categoriaModal.subgrupo}</>}
                {categoriaModal.grade && <>, <strong>Grade:</strong> {categoriaModal.grade}</>}
                {categoriaModal.colecao && <>, <strong>Coleção:</strong> {categoriaModal.colecao}</>}
              </div>

              {/* Resumo */}
              {(() => {
                const totalEntradas = detalhesEntradas.reduce((sum, e) => sum + (e.quantidade || 0), 0);
                const totalVendas = detalhesVendas.reduce((sum, v) => sum + (v.quantidade || 0), 0);
                const variacao = totalEntradas - totalVendas;
                
                return (
                  <div className={styles.modalResumo}>
                    <div className={styles.resumoItem}>
                      <span className={styles.resumoLabel}>Entradas:</span>
                      <span className={styles.resumoValue}>{totalEntradas}</span>
                    </div>
                    <div className={styles.resumoItem}>
                      <span className={styles.resumoLabel}>Vendas:</span>
                      <span className={styles.resumoValue}>{totalVendas}</span>
                    </div>
                    <div className={styles.resumoItem}>
                      <span className={styles.resumoLabel}>Variação:</span>
                      <span className={`${styles.resumoValue} ${variacao < 0 ? styles.negative : styles.positive}`}>
                        {variacao >= 0 ? '+' : ''}{variacao}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Abas */}
              <div className={styles.modalTabs}>
                <button
                  className={`${styles.modalTab} ${abaAtiva === 'entradas' ? styles.modalTabActive : ''}`}
                  onClick={() => setAbaAtiva('entradas')}
                >
                  Entradas ({detalhesEntradas.reduce((sum, e) => sum + (e.quantidade || 0), 0)})
                </button>
                <button
                  className={`${styles.modalTab} ${abaAtiva === 'vendas' ? styles.modalTabActive : ''}`}
                  onClick={() => setAbaAtiva('vendas')}
                >
                  Vendas ({detalhesVendas.reduce((sum, v) => sum + (v.quantidade || 0), 0)})
                </button>
              </div>
              
              {loadingDetalhes ? (
                <div className={styles.modalLoading}>Carregando detalhes...</div>
              ) : abaAtiva === 'entradas' ? (
                detalhesEntradas.length === 0 ? (
                  <div className={styles.modalEmpty}>Nenhuma entrada encontrada no período.</div>
                ) : (
                  <div className={styles.detalhesTable}>
                    <table>
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Romaneio</th>
                          <th>Produto</th>
                          <th>Descrição</th>
                          <th>Cor</th>
                          <th>Linha</th>
                          <th>Grade</th>
                          <th>Qtd</th>
                          <th>Filial</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalhesEntradas.map((entrada, idx) => {
                          const params = new URLSearchParams();
                          if (entrada.produto) params.set("produtoNome", entrada.produto.trim());
                          // Usar corDescricao se disponível, senão usar cor
                          const corParaUrl = entrada.corDescricao?.trim() || entrada.cor?.trim();
                          if (corParaUrl) params.set("cor", corParaUrl);
                          if (entrada.linha) params.set("linha", entrada.linha.trim());
                          if (entrada.subgrupo) params.set("subgrupo", entrada.subgrupo.trim());
                          if (entrada.grade) params.set("grade", entrada.grade.trim());
                          if (entrada.colecao) params.set("colecao", entrada.colecao.trim());
                          if (selectedFilial) params.set("filial", selectedFilial);
                          
                          return (
                            <tr key={`${entrada.romaneio}-${entrada.produto}-${entrada.cor}-${idx}`}>
                              <td>{format(new Date(entrada.data), 'dd/MM/yyyy', { locale: ptBR })}</td>
                              <td>{entrada.romaneio}</td>
                              <td>
                                <Link
                                  href={`/${companyKey}/controle-estoque/estoquedetalhado02?${params.toString()}`}
                                  className={styles.productLink}
                                >
                                  {entrada.produto}
                                </Link>
                              </td>
                              <td>{entrada.descricao}</td>
                              <td>{entrada.corDescricao || entrada.cor || '-'}</td>
                              <td>{entrada.linha || '-'}</td>
                              <td>{entrada.grade || '-'}</td>
                              <td>{formatNumber(entrada.quantidade)}</td>
                              <td>{entrada.filial}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                detalhesVendas.length === 0 ? (
                  <div className={styles.modalEmpty}>Nenhuma venda encontrada no período.</div>
                ) : (
                  <div className={styles.detalhesTable}>
                    <table>
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Produto</th>
                          <th>Descrição</th>
                          <th>Cor</th>
                          <th>Linha</th>
                          <th>Grade</th>
                          <th>Qtd</th>
                          <th>Valor</th>
                          <th>Filial</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalhesVendas.map((venda, idx) => {
                          const params = new URLSearchParams();
                          if (venda.produto) params.set("produtoNome", venda.produto.trim());
                          // Usar corDescricao se disponível, senão usar cor
                          const corParaUrl = venda.corDescricao?.trim() || venda.cor?.trim();
                          if (corParaUrl) params.set("cor", corParaUrl);
                          if (venda.linha) params.set("linha", venda.linha.trim());
                          if (venda.subgrupo) params.set("subgrupo", venda.subgrupo.trim());
                          if (venda.grade) params.set("grade", venda.grade.trim());
                          if (venda.colecao) params.set("colecao", venda.colecao.trim());
                          if (selectedFilial) params.set("filial", selectedFilial);
                          
                          return (
                            <tr key={`${venda.ticket}-${venda.produto}-${venda.cor}-${idx}`}>
                              <td>{format(new Date(venda.data), 'dd/MM/yyyy', { locale: ptBR })}</td>
                              <td>
                                <Link
                                  href={`/${companyKey}/controle-estoque/estoquedetalhado02?${params.toString()}`}
                                  className={styles.productLink}
                                >
                                  {venda.produto}
                                </Link>
                              </td>
                              <td>{venda.descricao}</td>
                              <td>{venda.corDescricao || venda.cor || '-'}</td>
                              <td>{venda.linha || '-'}</td>
                              <td>{venda.grade || '-'}</td>
                              <td>{formatNumber(venda.quantidade)}</td>
                              <td>{formatCurrency(venda.valorLiquido || 0)}</td>
                              <td>{venda.filial}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}