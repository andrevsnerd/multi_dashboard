"use client";

import { useEffect, useMemo, useState } from "react";
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

  // Linhas a serem excluídas da visualização
  const linhasExcluidas = useMemo(() => {
    return new Set([
      'PRIVATE LABEL',
      'GASTRONOMICA',
      'PERFUMARIA',
      'CASHMERE',
      'ELETRONICOS',
      'EMBALAGENS'
    ]);
  }, []);

  // Filtrar categorias selecionadas e remover linhas excluídas
  const categoriasFiltradas = useMemo(() => {
    return categorias.filter(c => {
      const categoriaUpper = c.categoria.toUpperCase();
      // Remover linhas excluídas
      if (linhasExcluidas.has(categoriaUpper)) {
        return false;
      }
      // Filtrar por categorias selecionadas
      return selectedCategorias.has(c.categoria);
    });
  }, [categorias, selectedCategorias, linhasExcluidas]);

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
          setAvailableLinhas(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadLinhas();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, selectedColecoes, selectedSubgrupos, selectedGrades]);

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

  const toggleCategoria = (categoria: string) => {
    setSelectedCategorias(prev => {
      const next = new Set(prev);
      if (next.has(categoria)) {
        next.delete(categoria);
      } else {
        next.add(categoria);
      }
      return next;
    });
  };

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
              options={availableLinhas}
              onChange={setSelectedLinhas}
            />
            <MultiSelectFilter
              label="Coleção"
              value={selectedColecoes}
              options={availableColecoes}
              onChange={setSelectedColecoes}
            />
            <MultiSelectFilter
              label="Subgrupo"
              value={selectedSubgrupos}
              options={availableSubgrupos}
              onChange={setSelectedSubgrupos}
            />
            <MultiSelectFilter
              label="Grade"
              value={selectedGrades}
              options={availableGrades}
              onChange={setSelectedGrades}
            />
          </>
        )}
      </div>

      {/* Por Categoria */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Por Categoria</h2>
        <div className={styles.categoriasGrid}>
          {categoriasFiltradas.map((cat, index) => (
            <div key={cat.categoria} className={styles.categoriaCard}>
              <div className={styles.categoriaHeader}>
                <div className={styles.categoriaNameWrapper}>
                  <span className={styles.categoriaName}>{cat.categoria}</span>
                  {/* Mostrar detalhes quando disponíveis */}
                  {(cat.linha || cat.subgrupo || cat.grade || cat.colecao) && (
                    <div className={styles.categoriaDetails}>
                      {cat.linha && <span className={styles.detailTag}>Linha: {cat.linha}</span>}
                      {cat.subgrupo && <span className={styles.detailTag}>Subgrupo: {cat.subgrupo}</span>}
                      {cat.grade && <span className={styles.detailTag}>Grade: {cat.grade}</span>}
                      {cat.colecao && <span className={styles.detailTag}>Coleção: {cat.colecao}</span>}
                    </div>
                  )}
                </div>
                <div className={`${styles.tendencia} ${cat.tendenciaSemanal >= 0 ? styles.positive : styles.negative}`}>
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
                    <span className={styles.metricLabel}>Duração:</span>
                    <span className={styles.metricValue}>{cat.duracao} dias</span>
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
                    <span className={styles.metricLabel}>Projeção vendas mês:</span>
                    <span className={styles.metricValue}>
                      {formatNumber(cat.projecaoVendasMes)} un
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filtros de Categoria e Período */}
      <div className={styles.categoryFilters}>
        <div className={styles.categoryButtons}>
          {categorias.map(cat => (
            <button
              key={cat.categoria}
              className={`${styles.categoryButton} ${selectedCategorias.has(cat.categoria) ? styles.active : ""}`}
              onClick={() => toggleCategoria(cat.categoria)}
            >
              {selectedCategorias.has(cat.categoria) && (
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
              {cat.categoria}
            </button>
          ))}
        </div>
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
                    key={cat.categoria}
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
              {previsoesFiltradas.map(prev => (
                <tr key={prev.categoria}>
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
    </div>
  );
}
