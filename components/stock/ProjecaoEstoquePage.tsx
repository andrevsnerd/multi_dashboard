"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  getMonth,
  getYear,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProjecaoEstoquePage.module.css";

interface ProjecaoEstoquePageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface ProjecaoMensal {
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  mes: string; // "JAN", "FEV", etc.
  mesNumero: number; // 1-12
  ano: number;
  vendas: number;
  estoque: number;
  duracao: number; // dias
  isMesAtual: boolean;
  isMesPassado: boolean;
}

interface ProjecaoCategoria {
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  meses: ProjecaoMensal[];
}

async function fetchProjecaoMensal(
  company: string,
  filial: string | null,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<ProjecaoCategoria[]> {
  const searchParams = new URLSearchParams({
    company,
    dataType: "projecao-mensal",
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
    throw new Error("Erro ao carregar projeção");
  }

  const json = (await response.json()) as { data: ProjecaoCategoria[] };
  return json.data;
}

function formatNumber(value: number): string {
  // Formatar com ponto como separador de milhar (ex: 1.120, 2.305)
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

const mesesNomes = [
  "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
  "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"
];

export default function ProjecaoEstoquePage({
  companyKey,
  companyName,
}: ProjecaoEstoquePageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [selectedFilial, setSelectedFilial] = useState<string | null>(
    searchParams.get("filial") || null
  );
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedLinhas, setSelectedLinhas] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);

  // Ler parâmetros da URL ao montar o componente
  useEffect(() => {
    const filial = searchParams.get("filial");
    if (filial) setSelectedFilial(filial);

    const grupos = searchParams.getAll("grupos");
    if (grupos.length > 0) setSelectedGrupos(grupos);

    const linhas = searchParams.getAll("linhas");
    if (linhas.length > 0) setSelectedLinhas(linhas);

    const colecoes = searchParams.getAll("colecoes");
    if (colecoes.length > 0) setSelectedColecoes(colecoes);

    const subgrupos = searchParams.getAll("subgrupos");
    if (subgrupos.length > 0) setSelectedSubgrupos(subgrupos);

    const grades = searchParams.getAll("grades");
    if (grades.length > 0) setSelectedGrades(grades);
  }, [searchParams]);

  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);
  const [availableLinhas, setAvailableLinhas] = useState<string[]>([]);
  const [availableColecoes, setAvailableColecoes] = useState<string[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);

  const [projecoes, setProjecoes] = useState<ProjecaoCategoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar grupos disponíveis para NERD (nível 0 - inicial)
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

        const json = (await response.json()) as { data: string[] };

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
  }, [companyKey, selectedFilial]);

  // Carregar linhas disponíveis para ScarfMe (nível 0 - inicial)
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

        const json = (await response.json()) as { data: string[] };

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
  }, [companyKey, selectedFilial, selectedColecoes, selectedSubgrupos, selectedGrades]);

  // Carregar coleções disponíveis (nível 1 - após selecionar linha)
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableColecoes([]);
      return;
    }

    // Só carregar se tiver linha selecionada
    if (selectedLinhas.length === 0) {
      setAvailableColecoes([]);
      return;
    }

    let active = true;

    async function loadColecoes() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
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

        const json = (await response.json()) as { data: string[] };

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
  }, [companyKey, selectedFilial, selectedLinhas, selectedSubgrupos, selectedGrades]);

  // Carregar subgrupos disponíveis (nível 1 - após selecionar linha)
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableSubgrupos([]);
      return;
    }

    // Só carregar se tiver linha selecionada
    if (selectedLinhas.length === 0) {
      setAvailableSubgrupos([]);
      return;
    }

    let active = true;

    async function loadSubgrupos() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
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

        const json = (await response.json()) as { data: string[] };

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
  }, [companyKey, selectedFilial, selectedLinhas, selectedColecoes, selectedGrades]);

  // Carregar grades disponíveis (nível 2 - após selecionar subgrupo)
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableGrades([]);
      return;
    }

    // Só carregar se tiver linha e subgrupo selecionados
    if (selectedLinhas.length === 0 || selectedSubgrupos.length === 0) {
      setAvailableGrades([]);
      return;
    }

    let active = true;

    async function loadGrades() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
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

        const json = (await response.json()) as { data: string[] };

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
  }, [companyKey, selectedFilial, selectedLinhas, selectedColecoes, selectedSubgrupos]);

  // Carregar dados de projeção
  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // Ler parâmetros da URL diretamente para garantir que estão atualizados
        const filial = searchParams.get("filial");
        const grupos = searchParams.getAll("grupos");
        const linhas = searchParams.getAll("linhas");
        const colecoes = searchParams.getAll("colecoes");
        const subgrupos = searchParams.getAll("subgrupos");
        const grades = searchParams.getAll("grades");

        // Atualizar estados se necessário
        if (filial !== selectedFilial) setSelectedFilial(filial);
        if (grupos.length > 0 && JSON.stringify(grupos) !== JSON.stringify(selectedGrupos)) setSelectedGrupos(grupos);
        if (linhas.length > 0 && JSON.stringify(linhas) !== JSON.stringify(selectedLinhas)) setSelectedLinhas(linhas);
        if (colecoes.length > 0 && JSON.stringify(colecoes) !== JSON.stringify(selectedColecoes)) setSelectedColecoes(colecoes);
        if (subgrupos.length > 0 && JSON.stringify(subgrupos) !== JSON.stringify(selectedSubgrupos)) setSelectedSubgrupos(subgrupos);
        if (grades.length > 0 && JSON.stringify(grades) !== JSON.stringify(selectedGrades)) setSelectedGrades(grades);

        const data = await fetchProjecaoMensal(
          companyKey,
          filial,
          grupos,
          linhas,
          colecoes,
          subgrupos,
          grades
        );

        if (active) {
          setProjecoes(data);
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
  }, [companyKey, searchParams, selectedFilial, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades]);

  // Gerar meses para exibição (12 meses a partir do mês atual)
  const mesesExibicao = useMemo(() => {
    const hoje = new Date();
    const mesAtual = getMonth(hoje);
    const anoAtual = getYear(hoje);
    const meses: Array<{ mes: string; mesNumero: number; ano: number; isMesAtual: boolean }> = [];

    for (let i = 0; i < 12; i++) {
      const mesIndex = (mesAtual + i) % 12;
      const ano = anoAtual + Math.floor((mesAtual + i) / 12);
      meses.push({
        mes: mesesNomes[mesIndex],
        mesNumero: mesIndex + 1,
        ano,
        isMesAtual: i === 0,
      });
    }

    return meses;
  }, []);

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
            <h1 className={styles.title}>Projeção de Estoque</h1>
            <p className={styles.subtitle}>Evolução mensal de vendas, estoque e duração</p>
          </div>
        </div>
        <button
          className={styles.backButton}
          onClick={() => router.back()}
        >
          ← Voltar
        </button>
      </div>

      {/* Filtros */}
      <div className={styles.filtersRow}>
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
            onChange={(grupos) => {
              setSelectedGrupos(grupos);
              // Limpar filtros dependentes quando grupo mudar
              if (grupos.length === 0) {
                setSelectedSubgrupos([]);
                setSelectedGrades([]);
                setSelectedColecoes([]);
              }
            }}
          />
        )}
        {companyKey === "scarfme" && (
          <>
            {/* Nível 0: Linha (sempre visível) */}
            <MultiSelectFilter
              label="Linha"
              value={selectedLinhas}
              options={availableLinhas}
              onChange={(linhas) => {
                setSelectedLinhas(linhas);
                // Limpar filtros dependentes quando linha mudar
                if (linhas.length === 0) {
                  setSelectedSubgrupos([]);
                  setSelectedGrades([]);
                  setSelectedColecoes([]);
                }
              }}
            />
            {/* Nível 1: Subgrupo e Coleção (só aparece se tiver linha selecionada) */}
            {selectedLinhas.length > 0 && (
              <>
                <MultiSelectFilter
                  label="Subgrupo"
                  value={selectedSubgrupos}
                  options={availableSubgrupos}
                  onChange={(subgrupos) => {
                    setSelectedSubgrupos(subgrupos);
                    // Limpar grades quando subgrupo mudar
                    if (subgrupos.length === 0) {
                      setSelectedGrades([]);
                    }
                  }}
                />
                <MultiSelectFilter
                  label="Coleção"
                  value={selectedColecoes}
                  options={availableColecoes}
                  onChange={setSelectedColecoes}
                />
              </>
            )}
            {/* Nível 2: Grade (só aparece se tiver linha e subgrupo selecionados) */}
            {selectedLinhas.length > 0 && selectedSubgrupos.length > 0 && (
              <MultiSelectFilter
                label="Grade"
                value={selectedGrades}
                options={availableGrades}
                onChange={setSelectedGrades}
              />
            )}
          </>
        )}
      </div>

      {/* Tabela de Projeção */}
      <div className={styles.tableWrapper}>
        <table className={styles.projecaoTable}>
          <thead>
            <tr>
              <th rowSpan={2} className={styles.categoriaHeader}>Categoria</th>
              <th rowSpan={2} className={styles.labelHeader}>Tipo</th>
              {mesesExibicao.map((m) => (
                <th
                  key={`${m.ano}-${m.mesNumero}`}
                  colSpan={1}
                >
                  {m.mes}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projecoes.map((proj, idx) => {
              const isLastCategory = idx === projecoes.length - 1;
              return (
                <React.Fragment key={`${proj.categoria}-${idx}`}>
                  <tr className={styles.categoriaRow}>
                    <td rowSpan={3} className={styles.categoriaCell}>
                      {proj.categoria.toUpperCase()}
                      {proj.subgrupo && <div className={styles.detailInfo}>Subgrupo: {proj.subgrupo}</div>}
                      {proj.grade && <div className={styles.detailInfo}>Grade: {proj.grade}</div>}
                    </td>
                    <td className={styles.labelCell}>VENDA</td>
                    {mesesExibicao.map((m) => {
                      const mesData = proj.meses.find(
                        pm => pm.mesNumero === m.mesNumero && pm.ano === m.ano
                      );
                      return (
                        <td
                          key={`${proj.categoria}-vendas-${m.ano}-${m.mesNumero}`}
                          className={styles.vendasCell}
                        >
                          {mesData ? formatNumber(mesData.vendas) : "-"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className={styles.estoqueRow}>
                    <td className={styles.labelCell}>ESTOQUE</td>
                    {mesesExibicao.map((m) => {
                      const mesData = proj.meses.find(
                        pm => pm.mesNumero === m.mesNumero && pm.ano === m.ano
                      );
                      return (
                        <td
                          key={`${proj.categoria}-estoque-${m.ano}-${m.mesNumero}`}
                          className={styles.estoqueCell}
                        >
                          {mesData ? formatNumber(mesData.estoque) : "-"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className={`${styles.duracaoRow} ${!isLastCategory ? styles.categorySeparator : ""}`}>
                    <td className={styles.labelCell}>DURAÇÃO</td>
                    {mesesExibicao.map((m) => {
                      const mesData = proj.meses.find(
                        pm => pm.mesNumero === m.mesNumero && pm.ano === m.ano
                      );
                      return (
                        <td
                          key={`${proj.categoria}-duracao-${m.ano}-${m.mesNumero}`}
                          className={styles.duracaoCell}
                        >
                          {mesData ? `${mesData.duracao} dias` : "-"}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
