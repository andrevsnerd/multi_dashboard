"use client";

import { useCallback, useMemo } from "react";

import { useAuth } from "@/components/auth/AuthContext";

/* ---------------------------------------------------------- formatação */

const fmtBrl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("pt-BR");

export const brl = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : fmtBrl.format(v));
export const numero = (v: number | null | undefined) => (v == null ? "—" : fmtNum.format(v));
export const inteiro = (v: number | null | undefined) => (v == null ? "—" : fmtInt.format(v));

/** R$ 1,2 mi · R$ 350 mil · R$ 820 — para eixos e KPIs. */
export function compacto(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: a >= 1e7 ? 1 : 2 })} mi`;
  if (a >= 1e3) return `${s}R$ ${(a / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return `${s}R$ ${a.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

export function percentual(v: number | null | undefined, casas = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2025-01-01" → "jan/25". */
export function mesCurto(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${MESES_CURTOS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
}

/** "2025-01-03" → "03/01/2025". */
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function dataHoraBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function valorCelula(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") return numero(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dataBr(s);
  return s;
}

/* ---------------------------------------------------------------- API */

export const SEPARADOR_LISTA = "\u001f";

export type Params = Record<string, string | number | boolean | string[] | null | undefined>;

export function montarQuery(params: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) qs.set(k, v.join(SEPARADOR_LISTA));
    } else qs.set(k, String(v));
  }
  return qs.toString();
}

/** fetch com o usuário logado no header (o servidor confere a permissão da página). */
export function useFinanceiroApi(companyKey: string) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const get = useCallback(
    async <T,>(path: string, params: Params = {}): Promise<T> => {
      const qs = montarQuery({ company: companyKey, ...params });
      const res = await fetch(`/api/financeiro${path}?${qs}`, {
        headers: { "x-auth-username": username },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Erro ${res.status}`);
      return body as T;
    },
    [companyKey, username]
  );

  const send = useCallback(
    async <T,>(path: string, method: "POST" | "DELETE", body?: unknown): Promise<T> => {
      const res = await fetch(`/api/financeiro${path}?company=${encodeURIComponent(companyKey)}`, {
        method,
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `Erro ${res.status}`);
      return json as T;
    },
    [companyKey, username]
  );

  // Objeto estável: as telas usam `api` como dependência de efeito.
  return useMemo(() => ({ get, send, username, pronto: !!username }), [get, send, username]);
}

/* ------------------------------------------------------------- tipos */

export interface AbaInfo {
  aba: string;
  tipo: string;
  ordem: number;
  oculta: boolean;
  titulo: string | null;
  dataReferencia: string | null;
  linhaCabecalho: number | null;
  colunas: { letra: string; titulo: string; campo: string | null; chave: string }[];
  preambulo: { endereco: string; valor: string | number | null }[];
  totalRegistros: number;
  ignoradas: number;
  presenteUltima: boolean;
  atualizadoEm: string;
}

export interface ResumoAba {
  aba: string;
  tipo: string;
  noArquivo: number;
  vigentes: number;
  iguais: number;
  novos: number;
  alterados: number;
  removidos: number;
}

export interface ResumoImportacao {
  cargaInicial: boolean;
  abas: ResumoAba[];
  ausentes: string[];
  exemplos: { aba: string; linha: number | null; base: string; campos: { campo: string; antes: unknown; depois: unknown }[] }[];
  totais: { novos: number; alterados: number; removidos: number; iguais: number; noArquivo: number };
}

export interface ImportacaoInfo {
  id: number;
  arquivo: string;
  tamanho: number | null;
  status: string;
  totalEsperado: number;
  enviadoPor: string | null;
  criadoEm: string;
  analisadoEm: string | null;
  aplicadoPor: string | null;
  aplicadoEm: string | null;
  resumo: ResumoImportacao | null;
}

export interface MetaFinanceiro {
  abas: AbaInfo[];
  ultimaImportacao: ImportacaoInfo | null;
  totalRegistros: number;
  podeImportar: boolean;
}

export interface DreLinha {
  linha: number;
  bloco: string;
  rotulo: string;
  ocorrencia: number;
  formato: "moeda" | "pct" | "multiplo";
  titulo?: boolean;
}

export interface DreResposta {
  layout: DreLinha[];
  celulas: { linha: number; mes: string; valor: number | null; texto: string | null }[];
  mesMin: string | null;
  mesMax: string | null;
}

export interface AbaResposta {
  aba: AbaInfo | null;
  total: number;
  soma: number;
  /** c = como está na planilha; n = forma normalizada dos textos (descrição, cliente…). */
  itens: { id: number; linha: number; c: Record<string, unknown>; n?: Record<string, string>; x: Record<string, unknown> }[];
  serie: { mes: string; soma: number; n: number; extras: Record<string, number> }[];
}

/** Drill-down da DRE para a aba Lançamentos. */
export interface FiltroInicialLancamentos {
  classificacao?: string;
  mes?: string;
  token: number;
}

/** "Mês de referência": último mês fechado pela data de atualização das abas de lançamento. */
export function mesReferencia(meta: MetaFinanceiro | null): string | null {
  const datas = (meta?.abas ?? [])
    .filter((a) => a.tipo === "lancamento" && a.dataReferencia)
    .map((a) => a.dataReferencia!)
    .sort();
  const ultima = datas[datas.length - 1];
  return ultima ? `${ultima.slice(0, 7)}-01` : null;
}
