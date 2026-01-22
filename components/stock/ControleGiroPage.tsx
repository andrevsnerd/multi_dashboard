"use client";

import { useEffect, useMemo, useState } from "react";
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

interface ControleGiroPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface GiroKPI {
  totalVendas: number;
}

interface CategoriaGiro {
  categoria: string;
  vendas: number;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
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
): Promise<GiroKPI> {
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

  const response = await fetch(`/api/controle-giro?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar KPIs");
  }

  const json = (await response.json()) as { data: GiroKPI };
  return json.data;
}

async function fetchCategorias(
  company: string,
  filial: string | null,
  range: DateRangeValue,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<CategoriaGiro[]> {
  const searchParams = new URLSearchParams({
    company,
    dataType: "categorias",
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

  const response = await fetch(`/api/controle-giro?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar categorias");
  }

  const json = (await response.json()) as { data: CategoriaGiro[] };
  return json.data;
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
}

export default function ControleGiroPage({
  companyKey,
  companyName,
}: ControleGiroPageProps) {
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
  const [selectedCategorias, setSelectedCategorias] = useState<Set<string>>(new Set());
  // Estado para controlar expansão de linhas (apenas SCARFME)
  // Map<linha, boolean> - true = expandida, false = colapsada
  const [linhasExpandidas, setLinhasExpandidas] = useState<Set<string>>(new Set());

  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);
  const [availableLinhas, setAvailableLinhas] = useState<string[]>([]);
  const [availableColecoes, setAvailableColecoes] = useState<string[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);

  const [kpis, setKpis] = useState<GiroKPI | null>(null);
  const [categorias, setCategorias] = useState<CategoriaGiro[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Linhas a serem excluídas da visualização
  const linhasExcluidas = useMemo(() => {
    const companyConfig = resolveCompany(companyKey);
    if (companyConfig?.excludedLines && companyConfig.excludedLines.length > 0) {
      return new Set(companyConfig.excludedLines.map(l => l.toUpperCase().trim()));
    }
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

  // Filtrar categorias selecionadas e remover linhas excluídas
  const categoriasFiltradas = useMemo(() => {
    // Para SCARFME: Se há linhas expandidas, mostrar apenas subgrupos dessas linhas
    // Se não há linhas expandidas, mostrar apenas linhas (nível 0)
    if (companyKey === 'scarfme') {
      const linhasExpandidasList = Array.from(linhasExpandidas);
      
      if (linhasExpandidasList.length > 0) {
        // Mostrar apenas subgrupos das linhas expandidas (agrupados por subgrupo)
        // Os dados já vêm agrupados por categoria+subgrupo da API
        return categorias.filter(c => {
          const categoriaUpper = c.categoria.toUpperCase();
          if (linhasExcluidas.has(categoriaUpper)) {
            return false;
          }
          // Deve ter subgrupo e a categoria (linha) deve estar expandida
          return c.subgrupo && linhasExpandidas.has(c.categoria);
        }).sort((a, b) => b.vendas - a.vendas);
      } else {
        // Mostrar apenas linhas (sem subgrupo) - nível 0
        return categorias.filter(c => {
          const categoriaUpper = c.categoria.toUpperCase();
          if (linhasExcluidas.has(categoriaUpper)) {
            return false;
          }
          if (!selectedCategorias.has(c.categoria)) {
            return false;
          }
          // Não deve ter subgrupo (é uma linha no nível 0)
          return !c.subgrupo;
        }).sort((a, b) => b.vendas - a.vendas);
      }
    }

    // Para NERD: sempre mostrar apenas grupos (sem expansão)
    let filtradas = categorias.filter(c => {
      const categoriaUpper = c.categoria.toUpperCase();
      if (linhasExcluidas.has(categoriaUpper)) {
        return false;
      }
      return selectedCategorias.has(c.categoria);
    });

    // Se há grupos selecionados nos filtros, filtrar por eles também
    if (companyKey === 'nerd' && selectedGrupos.length > 0) {
      filtradas = filtradas.filter(c => selectedGrupos.includes(c.categoria));
    }

    // Ordenar por vendas (do maior para o menor)
    filtradas.sort((a, b) => b.vendas - a.vendas);

    return filtradas;
  }, [categorias, selectedCategorias, linhasExcluidas, companyKey, selectedGrupos, linhasExpandidas]);

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
        // Para SCARFME: Se há linhas expandidas, buscar dados com subgrupos dessas linhas
        // Caso contrário, buscar apenas linhas (nível 0)
        const linhasParaBuscar = companyKey === 'scarfme' && linhasExpandidas.size > 0
          ? Array.from(linhasExpandidas)
          : selectedLinhas;

        const [kpisData, categoriasData] = await Promise.all([
          fetchKPIs(companyKey, selectedFilial, range, selectedGrupos, linhasParaBuscar, selectedColecoes, selectedSubgrupos, selectedGrades),
          fetchCategorias(companyKey, selectedFilial, range, selectedGrupos, linhasParaBuscar, selectedColecoes, selectedSubgrupos, selectedGrades),
        ]);

        if (active) {
          setKpis(kpisData);
          setCategorias(categoriasData);
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
  }, [companyKey, selectedFilial, range, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades, linhasExpandidas]);

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
            <h1 className={styles.title}>Controle de Giro</h1>
            <p className={styles.subtitle}>Análise de vendas por categoria</p>
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
          <div className={styles.kpiLabel}>TOTAL VENDAS</div>
          <div className={styles.kpiValue}>{formatNumber(kpis?.totalVendas ?? 0)} un</div>
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
                if (linhas.length > 0) {
                  linhas.forEach(linha => {
                    setSelectedCategorias(prev => {
                      const novo = new Set(prev);
                      novo.add(linha);
                      return novo;
                    });
                  });
                } else {
                  selectedLinhas.forEach(linha => {
                    setSelectedCategorias(prev => {
                      const novo = new Set(prev);
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
      <div className={styles.section} id="categorias-section">
        <div className={styles.sectionHeader}>
          {companyKey === 'scarfme' && linhasExpandidas.size > 0 && (
            <button
              onClick={() => {
                setLinhasExpandidas(new Set());
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={styles.backButton}
            >
              ← Voltar
            </button>
          )}
          <h2 className={styles.sectionTitle}>Por Categoria</h2>
        </div>
        <div className={styles.categoriasGrid}>
          {categoriasFiltradas.map((cat, index) => {
            // Para SCARFME: Se está no nível 0 (sem subgrupo), é uma linha clicável
            // Se tem subgrupo, é um subgrupo expandido
            const isLinhaNivel0 = companyKey === 'scarfme' && !cat.subgrupo && linhasExpandidas.size === 0;
            const isSubgrupoExpandido = companyKey === 'scarfme' && cat.subgrupo && linhasExpandidas.has(cat.categoria);
            
            return (
              <div key={`${cat.categoria}-${cat.subgrupo || ''}-${index}`} className={styles.categoriaCard}>
                <div className={styles.categoriaHeader}>
                  <div className={styles.categoriaNameWrapper}>
                    {isLinhaNivel0 ? (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setLinhasExpandidas(prev => {
                            const novo = new Set(prev);
                            novo.add(cat.categoria);
                            return novo;
                          });
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={styles.categoriaName}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                      >
                        {cat.categoria}
                      </button>
                    ) : (
                      <div className={styles.categoriaName}>
                        {cat.categoria}
                      </div>
                    )}
                    {isSubgrupoExpandido && cat.subgrupo && (
                      <div className={styles.categoriaDetails}>
                        <span className={styles.detailTag}>Subgrupo: {cat.subgrupo}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className={styles.categoriaContent}>
                  <div className={styles.estoqueValue}>
                    {formatNumber(cat.vendas)} <span className={styles.estoqueUnit}>unidades</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
