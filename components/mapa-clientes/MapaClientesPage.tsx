"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";
import type { StateData } from "@/app/api/mapa-clientes/route";

import styles from "./MapaClientesPage.module.css";

const BrazilMap = dynamic(() => import("./BrazilMap"), { ssr: false, loading: () => <div className={styles.mapLoading}>Carregando mapa...</div> });

interface MapaClientesPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

const UF_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas",
  BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
  MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

// Mesmo mapeamento do exportar_todos_relatorios.py
const UF_TO_REGIAO: Record<string, string> = {
  AC: "NORTE",  AM: "NORTE",  AP: "NORTE",  PA: "NORTE",
  RO: "NORTE",  RR: "NORTE",  TO: "NORTE",
  AL: "NORDESTE", BA: "NORDESTE", CE: "NORDESTE", MA: "NORDESTE",
  PB: "NORDESTE", PE: "NORDESTE", PI: "NORDESTE", RN: "NORDESTE", SE: "NORDESTE",
  DF: "CENTRO-OESTE", GO: "CENTRO-OESTE", MS: "CENTRO-OESTE", MT: "CENTRO-OESTE",
  ES: "SUDESTE", MG: "SUDESTE", RJ: "SUDESTE", SP: "SUDESTE",
  PR: "SUL", RS: "SUL", SC: "SUL",
};

async function fetchMapaClientes(
  company: string,
  range: DateRangeValue
): Promise<{ data: StateData[]; total: number }> {
  const params = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });
  const res = await fetch(`/api/mapa-clientes?${params}`);
  if (!res.ok) throw new Error("Erro ao buscar dados");
  return res.json();
}

export default function MapaClientesPage({ companyKey }: MapaClientesPageProps) {
  const initialRange = useMemo(() => {
    const r = getCurrentMonthRange();
    return { startDate: r.start, endDate: r.end };
  }, []);
  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [data, setData] = useState<StateData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchMapaClientes(companyKey, range)
      .then(({ data: d, total: t }) => {
        setData(d);
        setTotal(t);
      })
      .catch(() => setError("Não foi possível carregar os dados."))
      .finally(() => setLoading(false));
  }, [companyKey, range]);

  const dataByUF = Object.fromEntries(data.map((d) => [d.uf, d]));

  // Todos os estados com pelo menos 1 venda, ordenados por compradores desc
  const stateRows = useMemo(
    () => data.filter((d) => d.totalCompradores >= 1),
    [data]
  );

  const totalQtdGeral = useMemo(
    () => stateRows.reduce((sum, r) => sum + r.totalQtd, 0),
    [stateRows]
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>MAPA DE CLIENTES — E-COMMERCE</h1>
          <p className={styles.subtitle}>Distribuição geográfica de pedidos por estado</p>
        </div>
        <div className={styles.filters}>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.mapSection}>
        {loading ? (
          <div className={styles.mapLoading}>
            <div className={styles.spinner} />
            <span>Carregando dados...</span>
          </div>
        ) : (
          <BrazilMap dataByUF={dataByUF} total={total} />
        )}
      </div>

      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: "#e8edf5" }} />
          <span>&lt; 1%</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: "#b3cde8" }} />
          <span>1-5%</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: "#5a9fd4" }} />
          <span>5-10%</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: "#2b74c5" }} />
          <span>10-20%</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: "#1252a0" }} />
          <span>&gt; 20%</span>
        </div>
      </div>

      {!loading && stateRows.length > 0 && (
        <div className={styles.tableSection}>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ESTADO</th>
                  <th>REGIÃO</th>
                  <th>PEDIDOS</th>
                  <th>QTD VENDAS</th>
                  <th>% DO TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {stateRows.map((row) => (
                  <tr key={row.uf}>
                    <td className={styles.stateCell}>
                      <span className={styles.ufBadge}>{row.uf}</span>
                      <span className={styles.stateName}>{UF_NAMES[row.uf] ?? row.uf}</span>
                    </td>
                    <td className={styles.regiaoCell}>
                      {UF_TO_REGIAO[row.uf] ?? "—"}
                    </td>
                    <td className={styles.countCell}>
                      {(row.totalCompradores ?? 0).toLocaleString("pt-BR")}
                    </td>
                    <td className={styles.countCell}>
                      {(row.totalQtd ?? 0).toLocaleString("pt-BR")}
                    </td>
                    <td className={styles.percentCell}>{row.percentTotal.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.tableFooter}>
              {stateRows.length} estado{stateRows.length !== 1 ? "s" : ""} &nbsp;·&nbsp;
              {(total ?? 0).toLocaleString("pt-BR")} pedidos &nbsp;·&nbsp;
              <strong>{(totalQtdGeral ?? 0).toLocaleString("pt-BR")}</strong> itens vendidos
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
