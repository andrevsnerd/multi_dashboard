"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
import { resolveCompany } from "@/lib/config/company";
import { getCurrentMonthRange } from "@/lib/utils/date";
import { useAuth } from "@/components/auth/AuthContext";
import { canSeeCusto } from "@/lib/auth/permissions";

import MovimentoDetalhesModal from "./MovimentoDetalhesModal";

import styles from "./ControleMovimentoPage.module.css";

interface ControleMovimentoPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface ControleMovimentoKPIs {
  entradasPeriodo: {
    quantidade: number;
    custo: number;
    quantidadeAnterior: number;
    custoAnterior: number;
  };
  vendidos: {
    quantidade: number;
    valor: number;
    quantidadeAnterior: number;
    valorAnterior: number;
  };
  itensParados: {
    quantidade: number;
    custo: number;
  };
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
): Promise<ControleMovimentoKPIs> {
  const searchParams = new URLSearchParams({
    company,
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

  const response = await fetch(`/api/controle-movimento?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar KPIs");
  }

  const json = (await response.json()) as { data: ControleMovimentoKPIs };
  return json.data;
}

async function fetchFilterOptions(company: string, range: DateRangeValue): Promise<{
  grupos: string[];
  linhas: string[];
  colecoes: MultiSelectOption[];
  subgrupos: string[];
  grades: string[];
}> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  const response = await fetch(`/api/products/grupos?${searchParams.toString()}`, {
    cache: "no-store",
  });
  const grupos = response.ok ? ((await response.json()) as { data: string[] }).data : [];

  const responseLinhas = await fetch(`/api/products/linhas?${searchParams.toString()}`, {
    cache: "no-store",
  });
  const linhas = responseLinhas.ok ? ((await responseLinhas.json()) as { data: string[] }).data : [];

  // includeDescriptions: rótulo "DESCRIÇÃO (CÓDIGO)"; o value continua sendo o código.
  const colecoesParams = new URLSearchParams(searchParams);
  colecoesParams.set("includeDescriptions", "1");
  const responseColecoes = await fetch(`/api/products/colecoes?${colecoesParams.toString()}`, {
    cache: "no-store",
  });
  const colecoes = responseColecoes.ok
    ? ((await responseColecoes.json()) as { data: MultiSelectOption[] }).data
    : [];

  const responseSubgrupos = await fetch(`/api/products/subgrupos?${searchParams.toString()}`, {
    cache: "no-store",
  });
  const subgrupos = responseSubgrupos.ok ? ((await responseSubgrupos.json()) as { data: string[] }).data : [];

  const responseGrades = await fetch(`/api/products/grades?${searchParams.toString()}`, {
    cache: "no-store",
  });
  const grades = responseGrades.ok ? ((await responseGrades.json()) as { data: string[] }).data : [];

  return { grupos, linhas, colecoes, subgrupos, grades };
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

function calculateChangePercentage(current: number, previous: number): number | null {
  if (previous === 0) {
    return current > 0 ? 100 : null;
  }
  return ((current - previous) / previous) * 100;
}

export default function ControleMovimentoPage({
  companyKey,
  companyName,
}: ControleMovimentoPageProps) {
  const { user } = useAuth();
  const podeVerCusto = canSeeCusto(user);
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

  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);
  const [availableLinhas, setAvailableLinhas] = useState<string[]>([]);
  const [availableColecoes, setAvailableColecoes] = useState<MultiSelectOption[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);

  const [kpis, setKpis] = useState<ControleMovimentoKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTipo, setModalTipo] = useState<"entradas" | "vendidos" | "parados">("entradas");

  // Filtrar linhas disponíveis (remover excluídas)
  const linhasDisponiveis = useMemo(() => {
    const companyConfig = resolveCompany(companyKey);
    const excludedLines = companyConfig?.excludedLines ?? [];
    const excludedSet = new Set(excludedLines.map(l => l.toUpperCase().trim()));
    
    return availableLinhas.filter(linha => {
      const linhaUpper = linha.toUpperCase().trim();
      return !excludedSet.has(linhaUpper);
    });
  }, [availableLinhas, companyKey]);

  // Carregar opções de filtros
  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const options = await fetchFilterOptions(companyKey, range);
        if (!active) return;

        setAvailableGrupos(options.grupos);
        setAvailableLinhas(options.linhas);
        setAvailableColecoes(options.colecoes);
        setAvailableSubgrupos(options.subgrupos);
        setAvailableGrades(options.grades);
      } catch (err) {
        console.error("Erro ao carregar opções de filtros:", err);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [companyKey, range]);

  // Carregar KPIs
  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchKPIs(
          companyKey,
          selectedFilial,
          range,
          selectedGrupos,
          selectedLinhas,
          selectedColecoes,
          selectedSubgrupos,
          selectedGrades
        );

        if (!active) return;

        setKpis(data);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erro ao carregar dados");
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
  }, [companyKey, range, selectedFilial, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades]);

  const periodLabel = useMemo(() => {
    const start = format(range.startDate, "dd 'de' MMMM", { locale: ptBR });
    const end = format(range.endDate, "dd 'de' MMMM yyyy", { locale: ptBR });
    return `${start} - ${end}`;
  }, [range]);

  const entradasChange = kpis
    ? calculateChangePercentage(
        kpis.entradasPeriodo.quantidade,
        kpis.entradasPeriodo.quantidadeAnterior
      )
    : null;

  const vendidosChange = kpis
    ? calculateChangePercentage(
        kpis.vendidos.quantidade,
        kpis.vendidos.quantidadeAnterior
      )
    : null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.iconWrapper}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3h18v18H3zM9 9h6v6H9z" />
            </svg>
          </div>
          <div>
            <h1 className={styles.title}>Controle de Movimento</h1>
            <p className={styles.subtitle}>
              {periodLabel} • Análise de giro e tempo de venda
            </p>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.dateDisplay}>
            <span className={styles.statusDot}></span>
            <span>Atualizado agora</span>
          </div>
        </div>
      </div>

      {loading && (
        <div className={styles.loadingBanner}>
          <span className={styles.loadingSpinner}></span>
          <span className={styles.loadingText}>Atualizando métricas…</span>
        </div>
      )}

      {error && (
        <div className={styles.errorBanner}>
          <span>{error}</span>
        </div>
      )}

      <div className={styles.kpisGrid}>
        {/* Card: Entradas do Período */}
        <div 
          className={styles.kpiCard}
          onClick={() => {
            setModalTipo("entradas");
            setModalOpen(true);
          }}
        >
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Entradas do Período</span>
            <div className={styles.kpiIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M2 12h20" />
              </svg>
            </div>
          </div>
          <div className={styles.kpiValue}>
            {loading ? "—" : formatNumber(kpis?.entradasPeriodo.quantidade ?? 0)}
          </div>
          {podeVerCusto && (
            <div className={styles.kpiSecondary}>
              Custo: {loading ? "—" : formatCurrency(kpis?.entradasPeriodo.custo ?? 0)}
            </div>
          )}
          {entradasChange !== null && !loading && (
            <div className={`${styles.kpiChange} ${entradasChange >= 0 ? styles.positive : styles.negative}`}>
              {entradasChange >= 0 ? "+" : ""}{entradasChange.toFixed(1)}% vs período anterior
            </div>
          )}
        </div>

        {/* Card: Vendidos */}
        <div 
          className={styles.kpiCard}
          onClick={() => {
            setModalTipo("vendidos");
            setModalOpen(true);
          }}
        >
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Vendidos</span>
            <div className={styles.kpiIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
            </div>
          </div>
          <div className={styles.kpiValue}>
            {loading ? "—" : formatNumber(kpis?.vendidos.quantidade ?? 0)}
          </div>
          <div className={styles.kpiSecondary}>
            {loading ? "—" : formatCurrency(kpis?.vendidos.valor ?? 0)}
          </div>
          {vendidosChange !== null && !loading && (
            <div className={`${styles.kpiChange} ${vendidosChange >= 0 ? styles.positive : styles.negative}`}>
              {vendidosChange >= 0 ? "+" : ""}{vendidosChange.toFixed(1)}% vs período anterior
            </div>
          )}
        </div>

        {/* Card: Itens Parados */}
        <div 
          className={`${styles.kpiCard} ${styles.kpiCardWarning}`}
          onClick={() => {
            setModalTipo("parados");
            setModalOpen(true);
          }}
        >
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Itens Parados</span>
            <div className={styles.kpiIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          </div>
          <div className={styles.kpiValue}>
            {loading ? "—" : formatNumber(kpis?.itensParados.quantidade ?? 0)}
          </div>
          <div className={styles.kpiSecondary}>
            Custo: {loading ? "—" : formatCurrency(kpis?.itensParados.custo ?? 0)}
          </div>
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

      <MovimentoDetalhesModal
        companyKey={companyKey}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        tipo={modalTipo}
        range={range}
        filial={selectedFilial}
        grupos={selectedGrupos}
        linhas={selectedLinhas}
        colecoes={selectedColecoes}
        subgrupos={selectedSubgrupos}
        grades={selectedGrades}
      />
    </div>
  );
}
