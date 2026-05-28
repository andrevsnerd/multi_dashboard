"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import FilialFilter from "@/components/filters/FilialFilter";
import ControleTransferenciasTable, {
  type ControleTransferenciasFilialApi,
  type ControleTransferenciasPermissao,
} from "@/components/controle-transferencias/ControleTransferenciasTable";
import type { ProdutoTransferencia } from "@/lib/repositories/controleTransferencias";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import { useAuth } from "@/components/auth/AuthContext";

import styles from "./ControleTransferenciasPage.module.css";

async function fetchPermissoes(username: string): Promise<ControleTransferenciasPermissao | null> {
  try {
    const res = await fetch("/api/transferencia-produtos/permissoes", {
      headers: { "x-auth-username": username },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: ControleTransferenciasPermissao | null };
    return json.data ?? null;
  } catch {
    return null;
  }
}

async function fetchFiliais(): Promise<ControleTransferenciasFilialApi[]> {
  try {
    const res = await fetch("/api/transferencia-produtos/filiais", { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: ControleTransferenciasFilialApi[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

interface ControleTransferenciasPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

/** Período fixo: últimos 30 dias (data fim = hoje). */
function getLast30DaysRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    startDate: start,
    endDate: end,
  };
}

async function fetchCooldownKeys(company: string, days = 7): Promise<Set<string>> {
  try {
    const res = await fetch(
      `/api/transferencias-pendentes/cooldown?company=${encodeURIComponent(company)}&days=${days}`,
      { cache: "no-store" }
    );
    if (!res.ok) return new Set();
    const json = (await res.json()) as { keys: string[] };
    return new Set(json.keys || []);
  } catch {
    return new Set();
  }
}

async function fetchRealizadasContadores(
  company: string,
  days = 30
): Promise<Map<string, number>> {
  try {
    const res = await fetch(
      `/api/transferencias-pendentes/contadores?company=${encodeURIComponent(company)}&days=${days}`,
      { cache: "no-store" }
    );
    if (!res.ok) return new Map();
    const json = (await res.json()) as {
      data: Array<{ origemCanonico: string; destinoCanonico: string; total: number }>;
    };
    const map = new Map<string, number>();
    for (const row of json.data || []) {
      map.set(`${row.origemCanonico}|${row.destinoCanonico}`, row.total);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function fetchControleTransferencias(
  company: string,
  range: { startDate: Date; endDate: Date },
  filial: string | null
): Promise<ProdutoTransferencia[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  const response = await fetch(`/api/controle-transferencias?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar controle de transferências");
  }

  const json = (await response.json()) as {
    data: ProdutoTransferencia[];
  };

  return json.data;
}

/**
 * Obtém a matriz padrão para a empresa
 */
function getDefaultMatriz(companyKey: CompanyKey): string | null {
  if (companyKey === "nerd") {
    return "NERD";
  } else if (companyKey === "scarfme") {
    return "SCARF ME - MATRIZ";
  }
  return null;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export default function ControleTransferenciasPage({
  companyKey,
  companyName,
}: ControleTransferenciasPageProps) {
  const { user } = useAuth();
  const company = resolveCompany(companyKey);
  const filialDisplayNames = company?.filialDisplayNames ?? {};
  const inventoryFiliais = company?.filialFilters.inventory ?? [];

  // Período fixo: sempre últimos 30 dias (recalculado a cada montagem para refletir "hoje")
  const range = useMemo(() => getLast30DaysRange(), []);

  const defaultMatriz = useMemo(() => getDefaultMatriz(companyKey), [companyKey]);

  const [selectedFilial, setSelectedFilial] = useState<string | null>(defaultMatriz);
  const [permissoes, setPermissoes] = useState<ControleTransferenciasPermissao | null>(null);
  const [filiais, setFiliais] = useState<ControleTransferenciasFilialApi[]>([]);
  const [data, setData] = useState<ProdutoTransferencia[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownKeys, setCooldownKeys] = useState<Set<string>>(new Set());
  const [realizadasContadores, setRealizadasContadores] = useState<Map<string, number>>(new Map());

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}`,
    [range.startDate, range.endDate]
  );

  const loadData = useCallback(
    async (signal?: { aborted: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        // Carrega os 3 datasets em paralelo: produtos (MSSQL pesado),
        // cooldown (Neon leve) e contadores das tabs Realizadas (Neon leve).
        const [transferenciasData, cooldown, contadores] = await Promise.all([
          fetchControleTransferencias(companyKey, range, null),
          fetchCooldownKeys(companyKey, 7),
          fetchRealizadasContadores(companyKey, 30),
        ]);
        if (signal?.aborted) return;
        const dataWithDates = transferenciasData.map(item => ({
          ...item,
          filiais: item.filiais.map(filial => ({
            ...filial,
            ultimaEntrada: filial.ultimaEntrada
              ? (typeof filial.ultimaEntrada === "string"
                  ? new Date(filial.ultimaEntrada)
                  : filial.ultimaEntrada)
              : null,
          })),
        }));
        setData(dataWithDates);
        setCooldownKeys(cooldown);
        setRealizadasContadores(contadores);
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar os dados."
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [companyKey, range]
  );

  useEffect(() => {
    const signal = { aborted: false };
    void loadData(signal);
    return () => {
      signal.aborted = true;
    };
  }, [loadData, rangeKey]);

  useEffect(() => {
    if (!user?.username) return;
    Promise.all([fetchPermissoes(user.username), fetchFiliais()]).then(([perms, filiaisData]) => {
      setPermissoes(perms);
      setFiliais(filiaisData);
    });
  }, [user?.username]);

  // TEMPORARIO: lojas novas ainda nao devem transferir como ORIGEM.
  // Manter ocultas no filtro de origem ate liberacao operacional.
  const blockedOriginDisplayNames = useMemo(() => {
    if (companyKey === "nerd") {
      return new Set(["ELDORADO", "MORUMBI 2"]);
    }
    if (companyKey === "scarfme") {
      return new Set(["GALEAO RJ"]);
    }
    return new Set<string>();
  }, [companyKey]);

  const visibleOriginFiliais = useMemo(
    () =>
      inventoryFiliais.filter((filial) => {
        const displayName = filialDisplayNames[filial] ?? filial;
        return !blockedOriginDisplayNames.has(normalizeName(displayName));
      }),
    [inventoryFiliais, filialDisplayNames, blockedOriginDisplayNames]
  );

  const allowedFiliaisOrigem = useMemo(() => {
    if (user?.role === "admin" || !permissoes || permissoes.podeVerOutrasFiliais) {
      return visibleOriginFiliais;
    }
    // Origem no controle de transferências = apenas a filialAtribuida do usuário.
    // filiaisOrigem é para permissão de execução de saídas, não para filtrar origens aqui.
    const filialAtribuida = permissoes.filialAtribuida?.trim() || null;
    if (!filialAtribuida) return visibleOriginFiliais;
    const filialNome = filiais.find((f) => f.codFilial.trim() === filialAtribuida)?.filial ?? filialAtribuida;
    return visibleOriginFiliais.filter(
      (filial) => filial.trim().toUpperCase() === filialNome.trim().toUpperCase()
    );
  }, [user?.role, permissoes, filiais, visibleOriginFiliais]);

  useEffect(() => {
    if (!allowedFiliaisOrigem || allowedFiliaisOrigem.length === 0) return;
    const allowedSet = new Set(allowedFiliaisOrigem.map((a) => a.trim().toUpperCase()));
    // Quando permissão é apenas uma filial, fixar a origem nela (e não mostrar "Todas as filiais")
    if (allowedFiliaisOrigem.length === 1) {
      setSelectedFilial(allowedFiliaisOrigem[0]);
      return;
    }
    if (selectedFilial && !allowedSet.has(selectedFilial.trim().toUpperCase())) {
      setSelectedFilial(allowedFiliaisOrigem[0] ?? null);
    }
  }, [allowedFiliaisOrigem]);

  const periodLabel = useMemo(() => {
    const start = format(range.startDate, "dd/MM/yyyy", { locale: ptBR });
    const end = format(range.endDate, "dd/MM/yyyy", { locale: ptBR });
    return `Últimos 30 dias (${start} a ${end})`;
  }, [range.startDate, range.endDate]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Controle de Transferências</h1>
        <div className={styles.controls}>
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={setSelectedFilial}
            label="Filial de Origem"
            module="inventory"
            allowedFiliais={allowedFiliaisOrigem}
            hideVarejo={companyKey === "scarfme"}
          />
          <span className={styles.periodLabel}>{periodLabel}</span>
          {loading ? (
            <span className={styles.loading}>Carregando dados…</span>
          ) : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      <div className={styles.infoBox}>
        <div className={styles.infoIcon}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 6V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 14H10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className={styles.infoText}>
          <strong>Período analisado:</strong> {periodLabel}.{" "}
          <strong>Visualização por Filial:</strong> Selecione uma filial para ver apenas as transferências que devem ser feitas a partir dessa filial.
          {selectedFilial && (
            <span className={styles.infoFilial}>
              {" "}Visualizando: <strong>{company?.filialDisplayNames?.[selectedFilial] || selectedFilial}</strong>
            </span>
          )}
        </div>
      </div>

      <ControleTransferenciasTable
        companyKey={companyKey}
        data={data}
        loading={loading}
        dateRange={range}
        selectedFilial={selectedFilial}
        permissoes={permissoes}
        filiaisApi={filiais}
        cooldownKeys={cooldownKeys}
        realizadasContadores={realizadasContadores}
        onTransferExecuted={() => loadData()}
      />
    </div>
  );
}
