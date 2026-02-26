"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getMonth, getYear } from "date-fns";

import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
import { resolveCompany } from "@/lib/config/company";

import styles from "./ProjecaoEstoquePage.module.css";

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
}

interface ProjecaoCategoria {
  categoria: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
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
): Promise<ProjecaoCategoria[]> {
  const params = new URLSearchParams({ company, dataType: "projecao-mensal" });
  if (filial) params.set("filial", filial);
  grupos.forEach((g) => params.append("grupos", g));
  linhas.forEach((l) => params.append("linhas", l));
  colecoes.forEach((c) => params.append("colecoes", c));
  subgrupos.forEach((s) => params.append("subgrupos", s));
  grades.forEach((g) => params.append("grades", g));

  const res = await fetch(`/api/controle-estoque?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar projecao");
  const json = (await res.json()) as { data: ProjecaoCategoria[] };
  return json.data;
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
  const [expansao, setExpansao] = useState<Map<string, { nivel: number; subgrupoSelecionado?: string }>>(new Map());
  const [projecoes, setProjecoes] = useState<ProjecaoCategoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (!cancelled) setProjecoes(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyKey, filial, grupos, linhas, colecoes, subgrupos, grades, searchParams]);

  // Meses: atual ate dezembro
  const mesesExibicao = useMemo(() => {
    const hoje = new Date();
    const mes0 = getMonth(hoje);
    const ano = getYear(hoje);
    const out: Array<{ mes: string; mesNumero: number; ano: number; isMesAtual: boolean }> = [];
    for (let i = 0; i < 12 - mes0; i++) {
      const idx = mes0 + i;
      out.push({
        mes: MESES_NOMES[idx],
        mesNumero: idx + 1,
        ano,
        isMesAtual: i === 0,
      });
    }
    return out;
  }, []);

  // Merge de meses (soma vendas; uma unica cadeia de estoque; duracao ao final)
  const reagrupar = useCallback((items: ProjecaoCategoria[]): ProjecaoCategoria[] => {
    if (items.length === 0) return [];
    const base = items[0].meses;
    const merged = base.map((mes, i) => {
      let vendas = 0, vendasReais: number | undefined, vendasVarejo: number | undefined, vendasEcommerce: number | undefined;
      items.forEach((it) => {
        const m = it.meses[i];
        if (m) {
          vendas += m.vendas;
          if (m.vendasReais != null) vendasReais = (vendasReais ?? 0) + m.vendasReais;
          if (m.vendasVarejo != null) vendasVarejo = (vendasVarejo ?? 0) + m.vendasVarejo;
          if (m.vendasEcommerce != null) vendasEcommerce = (vendasEcommerce ?? 0) + m.vendasEcommerce;
        }
      });
      return {
        ...mes,
        vendas,
        estoque: 0,
        duracao: 0,
        ...(vendasReais !== undefined && { vendasReais }),
        ...(vendasVarejo !== undefined && { vendasVarejo }),
        ...(vendasEcommerce !== undefined && { vendasEcommerce }),
      };
    });
    let estoqueAcum = 0;
    items.forEach((it) => { const m0 = it.meses[0]; if (m0) estoqueAcum += m0.estoque; });
    for (let i = 0; i < merged.length; i++) {
      merged[i].estoque = estoqueAcum;
      const v = merged[i];
      const descontar = i === 0 && v.vendasReais != null
        ? Math.max(0, v.vendas - v.vendasReais)
        : v.vendas;
      estoqueAcum = Math.max(0, estoqueAcum - descontar);
    }
    const diasAteAcabar = (meses: ProjecaoMensal[], startIndex: number): number => {
      const estoqueInicio = startIndex === 0 && meses[1] ? meses[1].estoque : meses[startIndex].estoque;
      let remaining = estoqueInicio;
      let totalDias = 0;
      let ultimoConsumo = 0;
      for (let j = startIndex + 1; j < meses.length; j++) {
        const v = meses[j].vendas;
        const diasMes = new Date(meses[j].ano, meses[j].mesNumero, 0).getDate();
        if (diasMes <= 0 || v <= 0) continue;
        const consumo = v / diasMes;
        ultimoConsumo = consumo;
        const dias = remaining / consumo;
        if (dias >= diasMes) {
          totalDias += diasMes;
          remaining -= v;
        } else {
          totalDias += Math.round(dias);
          return estoqueInicio > 0 ? totalDias : 0;
        }
      }
      if (remaining > 0 && ultimoConsumo > 0) totalDias += Math.round(remaining / ultimoConsumo);
      else if (remaining > 0) {
        const last = meses[meses.length - 1];
        const d = new Date(last.ano, last.mesNumero, 0).getDate();
        if (d > 0 && last.vendas > 0) totalDias += Math.round(remaining / (last.vendas / d));
      }
      return estoqueInicio > 0 ? totalDias : 0;
    };
    merged.forEach((_, i) => { merged[i].duracao = diasAteAcabar(merged, i); });
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
      }
    });
    if (expandidas.length > 0) {
      return out.filter((p) => {
        const n = expansao.get(p.categoria)?.nivel ?? 0;
        if (n === 0) return false;
        if (n === 2 && expansao.get(p.categoria)?.subgrupoSelecionado)
          return p.subgrupo === expansao.get(p.categoria)?.subgrupoSelecionado;
        return true;
      });
    }
    return out.filter((p) => (expansao.get(p.categoria)?.nivel ?? 0) === 0);
  }, [projecoes, companyKey, excludedLines, grupos, linhas, expansao, reagrupar]);

  const handleClickCategoria = useCallback((proj: ProjecaoCategoria) => {
    const n = expansao.get(proj.categoria)?.nivel ?? 0;
    const temSubgrupos = projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo);
    const temGrades = proj.subgrupo && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade);
    if (n === 0 && temSubgrupos) {
      setExpansao((prev) => new Map(prev).set(proj.categoria, { nivel: 1 }));
      return;
    }
    if (n === 1 && proj.subgrupo && temGrades) {
      setExpansao((prev) => new Map(prev).set(proj.categoria, { nivel: 2, subgrupoSelecionado: proj.subgrupo }));
    }
  }, [expansao, projecoes]);

  if (loading) return <div className={styles.wrapper}><div className={styles.loading}>Carregando...</div></div>;
  if (error) return <div className={styles.wrapper}><div className={styles.error}>{error}</div></div>;

  const temExpansao = Array.from(expansao.values()).some((e) => e.nivel > 0);

  return (
    <div className={styles.wrapper}>
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
                  <th key={`${m.ano}-${m.mesNumero}`}>{m.mes}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listaExibida.map((proj, idx) => {
                const ex = expansao.get(proj.categoria);
                const nivel = ex?.nivel ?? 0;
                const podeNivel1 = nivel === 0 && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo);
                const podeNivel2 = nivel === 1 && proj.subgrupo && projecoes.some((p) => p.categoria === proj.categoria && p.subgrupo === proj.subgrupo && p.grade);
                const clickable = podeNivel1 || (nivel === 1 && podeNivel2);
                const isLast = idx === listaExibida.length - 1;

                return (
                  <React.Fragment key={`${proj.categoria}-${proj.subgrupo ?? ""}-${proj.grade ?? ""}-${idx}`}>
                    <tr className={styles.categoriaRow}>
                      <td
                        rowSpan={3}
                        className={`${styles.categoriaCell} ${clickable ? styles.categoriaCellClickable : ""}`}
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={clickable ? () => handleClickCategoria(proj) : undefined}
                        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClickCategoria(proj); } } : undefined}
                      >
                        <div className={styles.categoriaCellContent}>
                          <span className={styles.categoriaLabel}>
                            {proj.categoria.toUpperCase()}
                            {proj.subgrupo && <span className={styles.detailInfo}>Subgrupo: {proj.subgrupo}</span>}
                            {proj.grade && <span className={styles.detailInfo}>Grade: {proj.grade}</span>}
                          </span>
                        </div>
                      </td>
                      <td className={styles.labelCell}>VENDA</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        const isFuturo = md && !md.isMesAtual && (md.vendasVarejo != null || md.vendasEcommerce != null);
                        return (
                          <td key={`v-${m.ano}-${m.mesNumero}`} className={styles.vendasCell} title={md?.isMesAtual && md.vendasReais != null ? `Vendas reais (ate hoje): ${fmt(md.vendasReais)} un` : undefined}>
                            {isFuturo ? (
                              <span className={styles.vendasCellWrapper}>
                                <span className={styles.vendasInfocard}>
                                  <span className={styles.vendasInfocardLine}>Total varejo: {fmt(md!.vendasVarejo ?? 0)}</span>
                                  <span className={styles.vendasInfocardLine}>Total e-commerce: {fmt(md!.vendasEcommerce ?? 0)}</span>
                                </span>
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
                      <td className={styles.labelCell}>ESTOQUE</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        return <td key={`e-${m.ano}-${m.mesNumero}`} className={styles.estoqueCell}>{md ? fmt(md.estoque) : "-"}</td>;
                      })}
                    </tr>
                    <tr className={`${styles.duracaoRow} ${!isLast ? styles.categorySeparator : ""}`}>
                      <td className={styles.labelCell}>DURACAO</td>
                      {mesesExibicao.map((m) => {
                        const md = proj.meses.find((pm) => pm.mesNumero === m.mesNumero && pm.ano === m.ano);
                        return <td key={`d-${m.ano}-${m.mesNumero}`} className={styles.duracaoCell}>{md ? `${md.duracao} dias` : "-"}</td>;
                      })}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
