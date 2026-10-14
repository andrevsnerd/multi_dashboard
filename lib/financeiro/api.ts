import { NextResponse } from "next/server";

import { resolveCompany } from "@/lib/config/company";

import { FinanceiroSemBancoError } from "./store";

/** Empresa do `?company=`: só as operações de varejo têm controle financeiro. */
export function empresaDaUrl(url: URL): string | null {
  const company = resolveCompany(url.searchParams.get("company") ?? "");
  if (!company || (company.key !== "scarfme" && company.key !== "nerd")) return null;
  return company.key;
}

export function semEmpresa() {
  return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
}

export function respostaErro(contexto: string, erro: unknown) {
  if (erro instanceof FinanceiroSemBancoError) {
    return NextResponse.json({ error: erro.message }, { status: 503 });
  }
  console.error(`[financeiro] ${contexto}`, erro);
  const msg = erro instanceof Error ? erro.message : "Erro inesperado.";
  return NextResponse.json({ error: msg }, { status: 500 });
}

export function inteiro(v: string | null, padrao: number, min: number, max: number) {
  if (v == null || v === "") return padrao;
  const n = Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function dataIso(v: string | null): string | undefined {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

/** Listas na query vêm separadas por U+001F (classificação pode ter vírgula). */
export const SEPARADOR_LISTA = "\u001f";

export function lista(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const itens = v.split(SEPARADOR_LISTA).map((s) => s.trim()).filter(Boolean);
  return itens.length ? itens : undefined;
}
