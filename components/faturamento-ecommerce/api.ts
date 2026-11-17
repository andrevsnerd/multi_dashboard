"use client";

import { useCallback } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import type { EmpresaFat } from "@/lib/faturamento-ecommerce/config";

export class ApiErro extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly corpo: Record<string, unknown>
  ) {
    super(message);
  }
}

/** Chamadas às rotas /api/faturamento-ecommerce com o usuário e a empresa da página. */
export function useFatApi(empresa: EmpresaFat) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const get = useCallback(
    async <T,>(path: string, params: Record<string, string | undefined> = {}): Promise<T> => {
      const qs = new URLSearchParams({ empresa });
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, v);
      const res = await fetch(`/api/faturamento-ecommerce${path}?${qs}`, {
        headers: { "x-auth-username": username },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiErro(json.error ?? `Erro ${res.status}`, res.status, json);
      return json.data as T;
    },
    [empresa, username]
  );

  const send = useCallback(
    async <T,>(path: string, method: "POST" | "PATCH", body: Record<string, unknown>): Promise<T> => {
      const res = await fetch(`/api/faturamento-ecommerce${path}`, {
        method,
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({ empresa, ...body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiErro(json.error ?? `Erro ${res.status}`, res.status, json);
      return json.data as T;
    },
    [empresa, username]
  );

  return { get, send, username };
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const fmtBRL = (n: number | null | undefined) => brl.format(Number(n) || 0);
export const fmtData = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";
export const fmtDataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "UTC" }) : "—";
export const fmtDoc = (d: string) => {
  const x = (d ?? "").replace(/\D/g, "");
  if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
};
/** Data local (YYYY-MM-DD) de hoje − `dias`. */
export const dataLocal = (dias = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
