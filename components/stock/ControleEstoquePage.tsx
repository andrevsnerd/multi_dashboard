"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
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
  vendasMesAnterior: number;
}

interface CategoriaEstoque {
  categoria: string;
  estoqueAtual: number;
  custoTotal: number;
  custoUnitario: number;
  vendasMes: number;
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
  mediaDia: number;
  duracao: number;
  prevFimMes: number;
  prevFimAno: number;
  status: "OK" | "ALERTA" | "CRITICO";
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
  grades: string[]
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

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number): string {
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
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedLinhas, setSelectedLinhas] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [periodType, setPeriodType] = useState<"semanal" | "mensal">("semanal");
  const [selectedCategorias, setSelectedCategorias] = useState<Set<string>>(new Set());
  // Estado para controlar expansão: Map<categoria, { nivel: number, subgrupoSelecionado?: string, gradeSelecionado?: string }>
  // nível 0 = categoria, 1 = linha+subgrupo+grade, 2 = linha+subgrupo+grade+coleção
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
    return new Set([
      'PRIVATE LABEL',
      'GASTRONOMICA',
      'PERFUMARIA',
      'CASHMERE',
      'ELETRONICOS',
      'EMBALAGENS',
      'CAPAS E ACESSORIOS P/ CEL'
    ]);
  }, []);

  // Filtrar linhas disponíveis removendo as excluídas
  const linhasDisponiveis = useMemo(() => {
    return availableLinhas.filter(linha => {
      const linhaUpper = linha.toUpperCase().trim();
      return !linhasExcluidas.has(linhaUpper);
    });
  }, [availableLinhas, linhasExcluidas]);

  // Função para reagrupar dados baseado no nível de expansão
  const reagruparPorNivel = useMemo(() => {
    return (cats: CategoriaEstoque[], categoria: string, nivel: number): CategoriaEstoque[] => {
      // Filtrar apenas a categoria específica
      const catsCategoria = cats.filter(c => c.categoria === categoria);
      
      if (nivel === 0) {
        // Nível 0: Agrupar apenas por categoria (sem detalhes)
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
            acc[key].vendasMes += cat.vendasMes;
            acc[key].estoqueSemanaPassada = (acc[key].estoqueSemanaPassada || 0) + (cat.estoqueSemanaPassada || 0);
            acc[key].tendenciaSemanal = (acc[key].tendenciaSemanal || 0) + (cat.tendenciaSemanal || 0);
            acc[key].projecaoVendasMes = (acc[key].projecaoVendasMes || 0) + (cat.projecaoVendasMes || 0);
            
            // Recalcular métricas derivadas
            const totalEstoque = acc[key].estoqueAtual;
            const totalProjecaoVendas = acc[key].projecaoVendasMes;
            const diasCorridos = new Date().getDate();
            const totalDiasMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            
            // Recalcular projeções
            const mesesRestantes = Math.max(0, 12 - (new Date().getMonth() + 1) + 1);
            acc[key].projecaoMes = Math.round(totalEstoque - totalProjecaoVendas);
            acc[key].projecaoAnual = Math.round(totalEstoque - (totalProjecaoVendas * mesesRestantes));
            acc[key].duracao = totalProjecaoVendas > 0 
              ? Math.round((totalEstoque / totalProjecaoVendas) * totalDiasMes)
              : 999;
          }
          return acc;
        }, {} as Record<string, CategoriaEstoque>);
        return Object.values(agrupado);
      } else if (nivel === 1) {
        // Nível 1: Agrupar por categoria + linha + subgrupo + grade (sem coleção)
        const agrupado = catsCategoria.reduce((acc, cat) => {
          // Agrupar por linha+subgrupo+grade, ignorando coleção
          const key = `${cat.categoria}|${cat.linha || ''}|${cat.subgrupo || ''}|${cat.grade || ''}`;
          if (!acc[key]) {
            acc[key] = {
              ...cat,
              colecao: undefined, // Não mostrar coleção no nível 1
            };
          } else {
            // Somar valores simples
            acc[key].estoqueAtual += cat.estoqueAtual;
            acc[key].custoTotal += cat.custoTotal;
            acc[key].vendasMes += cat.vendasMes;
            acc[key].estoqueSemanaPassada = (acc[key].estoqueSemanaPassada || 0) + (cat.estoqueSemanaPassada || 0);
            acc[key].tendenciaSemanal = (acc[key].tendenciaSemanal || 0) + (cat.tendenciaSemanal || 0);
            acc[key].projecaoVendasMes = (acc[key].projecaoVendasMes || 0) + (cat.projecaoVendasMes || 0);
            
            // Recalcular métricas derivadas
            const totalEstoque = acc[key].estoqueAtual;
            const totalProjecaoVendas = acc[key].projecaoVendasMes;
            const diasCorridos = new Date().getDate();
            const totalDiasMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            
            // Recalcular projeções
            const mesesRestantes = Math.max(0, 12 - (new Date().getMonth() + 1) + 1);
            acc[key].projecaoMes = Math.round(totalEstoque - totalProjecaoVendas);
            acc[key].projecaoAnual = Math.round(totalEstoque - (totalProjecaoVendas * mesesRestantes));
            acc[key].duracao = totalProjecaoVendas > 0 
              ? Math.round((totalEstoque / totalProjecaoVendas) * totalDiasMes)
              : 999;
          }
          return acc;
        }, {} as Record<string, CategoriaEstoque>);
        return Object.values(agrupado);
      } else {
        // Nível 2: Mostrar tudo (categoria + linha + subgrupo + grade + coleção)
        return catsCategoria;
      }
    };
  }, []);

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
      const reagrupadas = reagruparPorNivel(cats, categoria, nivel);
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
          // Para ScarfMe, categoria = linha, então garantir que linha === categoria
          if (companyKey === 'scarfme') {
            // Para ScarfMe, quando expandimos "LENÇOS", mostrar apenas cards onde linha = "LENÇOS"
            if (cat.categoria === cat.linha) {
              // Se está no nível 2, filtrar pelo subgrupo e grade selecionados
              if (nivel === 2 && expansao.subgrupoSelecionado && expansao.gradeSelecionado) {
                if (cat.subgrupo === expansao.subgrupoSelecionado && cat.grade === expansao.gradeSelecionado) {
                  resultadoFiltrado.push(cat);
                }
              } else {
                // Nível 1: mostrar todos os cards da categoria (sem coleção)
                resultadoFiltrado.push(cat);
              }
            }
          } else {
            // Para NERD, apenas verificar se a categoria corresponde
            if (nivel === 2 && expansao.subgrupoSelecionado && expansao.gradeSelecionado) {
              if (cat.subgrupo === expansao.subgrupoSelecionado && cat.grade === expansao.gradeSelecionado) {
                resultadoFiltrado.push(cat);
              }
            } else {
              resultadoFiltrado.push(cat);
            }
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

    return resultadoFiltrado;
  }, [categorias, selectedCategorias, linhasExcluidas, categoriaExpansao, reagruparPorNivel, companyKey]);

  // Recalcular KPIs baseado nas categorias filtradas
  const kpisFiltrados = useMemo(() => {
    if (!kpis) return null;

    // Calcular estoque total e valor em estoque das categorias filtradas
    const estoqueTotalFiltrado = categoriasFiltradas.reduce((sum, cat) => sum + cat.estoqueAtual, 0);
    const valorEmEstoqueFiltrado = categoriasFiltradas.reduce((sum, cat) => sum + cat.custoTotal, 0);
    const vendasEsteMesFiltrado = categoriasFiltradas.reduce((sum, cat) => sum + cat.vendasMes, 0);
    const categoriasAtivasFiltrado = categoriasFiltradas.length;

    // Calcular valores do período anterior baseado na proporção
    // Se temos X% do estoque total, assumimos X% do estoque anterior também
    const proporcaoEstoque = kpis.estoqueTotal > 0 ? estoqueTotalFiltrado / kpis.estoqueTotal : 0;
    const estoqueTotalAnteriorFiltrado = Math.round(kpis.estoqueTotalAnterior * proporcaoEstoque);
    
    // Para vendas, usar a mesma proporção ou calcular baseado nas vendas filtradas
    const proporcaoVendas = kpis.vendasEsteMes > 0 ? vendasEsteMesFiltrado / kpis.vendasEsteMes : 0;
    const vendasMesAnteriorFiltrado = Math.round(kpis.vendasMesAnterior * proporcaoVendas);

    return {
      estoqueTotal: estoqueTotalFiltrado,
      valorEmEstoque: valorEmEstoqueFiltrado,
      vendasEsteMes: vendasEsteMesFiltrado,
      categoriasAtivas: categoriasAtivasFiltrado,
      estoqueTotalAnterior: estoqueTotalAnteriorFiltrado,
      vendasMesAnterior: vendasMesAnteriorFiltrado,
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
          fetchCategorias(companyKey, selectedFilial, range, periodType, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades),
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
  }, [companyKey, selectedFilial, range, periodType, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades]);

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

  // Cores para gráficos
  const colors = ["#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#00ff00", "#ff00ff"];

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
          {kpisFiltrados && estoqueChangePercent !== 0 && (
            <div className={`${styles.kpiChange} ${estoqueChangePercent > 0 ? styles.positive : styles.negative}`}>
              {estoqueChangePercent > 0 ? "▲" : "▼"} {Math.abs(estoqueChangePercent).toFixed(1)}% vs mês anterior
            </div>
          )}
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>VALOR EM ESTOQUE</div>
          <div className={styles.kpiValue}>{formatCurrency(kpisFiltrados?.valorEmEstoque ?? 0)}</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>VENDAS ESTE MÊS</div>
          <div className={styles.kpiValue}>{formatNumber(kpisFiltrados?.vendasEsteMes ?? 0)} un</div>
          {kpisFiltrados && vendasChangePercent !== 0 && (
            <div className={`${styles.kpiChange} ${vendasChangePercent > 0 ? styles.positive : styles.negative}`}>
              {vendasChangePercent > 0 ? "▲" : "▼"} {Math.abs(vendasChangePercent).toFixed(1)}% vs mês anterior
            </div>
          )}
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>CATEGORIAS ATIVAS</div>
          <div className={styles.kpiValue}>{kpisFiltrados?.categoriasAtivas ?? 0}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className={styles.filtersRow}>
        <DateRangeFilter value={range} onChange={setRange} />
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
                        // Voltar do nível 2 para nível 1 (remover filtro de coleção, manter subgrupo/grade)
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
            const temDetalhes = cat.linha || cat.subgrupo || cat.grade || cat.colecao;
            const isCardExpandido = nivelAtual > 0 && temDetalhes;
            // Criar chave única sempre (usar index para garantir unicidade)
            const cardKey = isCardExpandido 
              ? `${cat.categoria}-${cat.linha || ''}-${cat.subgrupo || ''}-${cat.grade || ''}-${nivelAtual === 2 ? cat.colecao || '' : ''}-${index}`
              : `${cat.categoria}-${index}`;
            
            return (
            <div key={cardKey} className={styles.categoriaCard}>
              <div className={styles.categoriaHeader}>
                <div className={styles.categoriaNameWrapper}>
                  {(() => {
                    const expansao = categoriaExpansao.get(cat.categoria);
                    const nivelAtual = expansao?.nivel || 0;
                    const temDetalhes = cat.linha || cat.subgrupo || cat.grade || cat.colecao;
                    const isCardExpandido = nivelAtual > 0 && temDetalhes;
                    
                    // Se é nível 2 (com coleção), clicar navega para página de detalhes
                    // Se é nível 1 (sem coleção), clicar expande para nível 2
                    // Se é nível 0, clicar expande para nível 1
                    if (nivelAtual === 2 && isCardExpandido) {
                      // Nível 2: clicar navega para página de detalhes
                      return (
                        <>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              const params = new URLSearchParams();
                              if (cat.linha) params.set("linha", cat.linha);
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
                          {/* Mostrar detalhes: linha, subgrupo, grade, coleção */}
                          <div className={styles.categoriaDetails}>
                            {cat.linha && <span className={styles.detailTag}>Linha: {cat.linha}</span>}
                            {cat.subgrupo && <span className={styles.detailTag}>Subgrupo: {cat.subgrupo}</span>}
                            {cat.grade && <span className={styles.detailTag}>Grade: {cat.grade}</span>}
                            {cat.colecao && <span className={styles.detailTag}>Coleção: {cat.colecao}</span>}
                          </div>
                        </>
                      );
                    } else if (nivelAtual === 1 && isCardExpandido) {
                      // Nível 1: clicar expande para nível 2 (mostrar coleção) do subgrupo específico
                      return (
                        <>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setCategoriaExpansao(prev => {
                                const novo = new Map(prev);
                                // Salvar o subgrupo e grade selecionados para filtrar as coleções
                                novo.set(cat.categoria, {
                                  nivel: 2,
                                  subgrupoSelecionado: cat.subgrupo,
                                  gradeSelecionado: cat.grade,
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
                          {/* Mostrar detalhes: linha, subgrupo, grade (sem coleção) */}
                          <div className={styles.categoriaDetails}>
                            {cat.linha && <span className={styles.detailTag}>Linha: {cat.linha}</span>}
                            {cat.subgrupo && <span className={styles.detailTag}>Subgrupo: {cat.subgrupo}</span>}
                            {cat.grade && <span className={styles.detailTag}>Grade: {cat.grade}</span>}
                          </div>
                        </>
                      );
                    } else {
                      // Nível 0: clicar expande para nível 1
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
                  title="Clique para ver detalhes das entradas da semana"
                >
                  {cat.tendenciaSemanal >= 0 ? "+" : ""}{formatNumber(cat.tendenciaSemanal)} na Semana
                </div>
              </div>
              <div className={styles.categoriaContent}>
                <div className={styles.estoqueValue}>
                  {formatNumber(cat.estoqueAtual)} <span className={styles.estoqueUnit}>unidades</span>
                </div>
                {cat.estoqueSemanaPassada !== undefined && (
                  <div className={styles.estoqueSemanaPassada}>
                    {formatNumber(cat.estoqueSemanaPassada)} semana passada
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
                    <span className={styles.metricLabel}>Venda acumulada (mês):</span>
                    <span className={styles.metricValue}>{formatNumber(cat.vendasMes)}</span>
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
              <LineChart data={evolucaoFiltrada}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="semana" />
                <YAxis />
                <Tooltip />
                <Legend />
                {categoriasFiltradas.map((cat, index) => (
                  <Line
                    key={`${cat.categoria}-${index}`}
                    type="monotone"
                    dataKey={cat.categoria}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    name={cat.categoria}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Vendas por Categoria</h3>
          <div className={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={vendasFiltradas}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="categoria" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="vendas" fill="#8884d8" />
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
                <th>Média/Dia</th>
                <th>Duração (dias)</th>
                <th>Prev. Fim Mês</th>
                <th>Prev. Fim Ano</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {previsoesFiltradas.map((prev, index) => (
                <tr key={`${prev.categoria}-${index}`}>
                  <td>{prev.categoria}</td>
                  <td>{formatNumber(prev.estoqueAtual)}</td>
                  <td>{prev.mediaDia.toFixed(1)}</td>
                  <td>{prev.duracao}</td>
                  <td>
                    {formatNumber(prev.prevFimMes)}
                  </td>
                  <td>
                    {formatNumber(prev.prevFimAno)}
                  </td>
                  <td>
                    <span className={`${styles.statusBadge} ${styles[prev.status.toLowerCase()]}`}>
                      {prev.status === "OK" && (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M13.3333 4L6 11.3333L2.66667 8"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                      {prev.status}
                    </span>
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
              <h2>Detalhes da Semana</h2>
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
              <div className={styles.modalResumo}>
                <div className={styles.resumoItem}>
                  <span className={styles.resumoLabel}>Entradas:</span>
                  <span className={styles.resumoValue}>{detalhesEntradas.reduce((sum, e) => sum + e.quantidade, 0)}</span>
                </div>
                <div className={styles.resumoItem}>
                  <span className={styles.resumoLabel}>Vendas:</span>
                  <span className={styles.resumoValue}>{detalhesVendas.reduce((sum, v) => sum + v.quantidade, 0)}</span>
                </div>
                <div className={styles.resumoItem}>
                  <span className={styles.resumoLabel}>Variação:</span>
                  <span className={`${styles.resumoValue} ${categoriaModal.tendenciaSemanal < 0 ? styles.negative : styles.positive}`}>
                    {categoriaModal.tendenciaSemanal >= 0 ? '+' : ''}{categoriaModal.tendenciaSemanal}
                  </span>
                </div>
              </div>

              {/* Abas */}
              <div className={styles.modalTabs}>
                <button
                  className={`${styles.modalTab} ${abaAtiva === 'entradas' ? styles.modalTabActive : ''}`}
                  onClick={() => setAbaAtiva('entradas')}
                >
                  Entradas ({detalhesEntradas.length})
                </button>
                <button
                  className={`${styles.modalTab} ${abaAtiva === 'vendas' ? styles.modalTabActive : ''}`}
                  onClick={() => setAbaAtiva('vendas')}
                >
                  Vendas ({detalhesVendas.length})
                </button>
              </div>
              
              {loadingDetalhes ? (
                <div className={styles.modalLoading}>Carregando detalhes...</div>
              ) : abaAtiva === 'entradas' ? (
                detalhesEntradas.length === 0 ? (
                  <div className={styles.modalEmpty}>Nenhuma entrada encontrada na semana.</div>
                ) : (
                  <div className={styles.detalhesTable}>
                    <table>
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Romaneio</th>
                          <th>Descrição</th>
                          <th>Cor</th>
                          <th>Linha</th>
                          <th>Grade</th>
                          <th>Qtd</th>
                          <th>Filial</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalhesEntradas.map((entrada, idx) => (
                          <tr key={`${entrada.romaneio}-${entrada.produto}-${entrada.cor}-${idx}`}>
                            <td>{format(new Date(entrada.data), 'dd/MM/yyyy', { locale: ptBR })}</td>
                            <td>{entrada.romaneio}</td>
                            <td>{entrada.descricao}</td>
                            <td>{entrada.corDescricao || entrada.cor || '-'}</td>
                            <td>{entrada.linha || '-'}</td>
                            <td>{entrada.grade || '-'}</td>
                            <td>{formatNumber(entrada.quantidade)}</td>
                            <td>{entrada.filial}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                detalhesVendas.length === 0 ? (
                  <div className={styles.modalEmpty}>Nenhuma venda encontrada na semana.</div>
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
                        {detalhesVendas.map((venda, idx) => (
                          <tr key={`${venda.ticket}-${venda.produto}-${venda.cor}-${idx}`}>
                            <td>{format(new Date(venda.data), 'dd/MM/yyyy', { locale: ptBR })}</td>
                            <td>{venda.produto}</td>
                            <td>{venda.descricao}</td>
                            <td>{venda.corDescricao || venda.cor || '-'}</td>
                            <td>{venda.linha || '-'}</td>
                            <td>{venda.grade || '-'}</td>
                            <td>{formatNumber(venda.quantidade)}</td>
                            <td>{formatCurrency(venda.valorLiquido || 0)}</td>
                            <td>{venda.filial}</td>
                          </tr>
                        ))}
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
