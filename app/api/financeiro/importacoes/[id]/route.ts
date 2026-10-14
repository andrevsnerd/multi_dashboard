import { NextResponse } from "next/server";

import { autorizarFinanceiro } from "@/lib/auth/controle-financeiro-guard";
import { empresaDaUrl, inteiro, respostaErro, semEmpresa } from "@/lib/financeiro/api";
import { renormalizar } from "@/lib/financeiro/normalizacao-store";
import type { RegistroFin } from "@/lib/financeiro/planilha";
import {
  aplicarImportacao,
  analisarImportacao,
  descartarImportacao,
  inserirLote,
  listarAlteracoes,
  obterImportacao,
} from "@/lib/financeiro/store";

// Comparar e gravar ~185 mil registros leva alguns segundos no Neon.
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ id: string }>;
}

/** Importação + alterações registradas (paginadas). */
export async function GET(request: Request, { params }: Ctx) {
  const autorizado = await autorizarFinanceiro(request);
  if ("erro" in autorizado) return autorizado.erro;
  const url = new URL(request.url);
  const empresa = empresaDaUrl(url);
  if (!empresa) return semEmpresa();
  const id = Number((await params).id);
  try {
    const importacao = await obterImportacao(empresa, id);
    if (!importacao) return NextResponse.json({ error: "Importação não encontrada." }, { status: 404 });
    const p = url.searchParams;
    const acao = p.get("acao");
    const alteracoes = await listarAlteracoes(empresa, id, {
      aba: p.get("aba") || undefined,
      acao: acao === "novo" || acao === "alterado" || acao === "removido" ? acao : undefined,
      pagina: inteiro(p.get("pagina"), 1, 1, 100000),
      porPagina: inteiro(p.get("porPagina"), 50, 10, 500),
    });
    return NextResponse.json({ importacao, alteracoes });
  } catch (erro) {
    return respostaErro("obter importação", erro);
  }
}

/** `{ acao: "lote", registros }` | `{ acao: "analisar" }` | `{ acao: "aplicar" }`. */
export async function POST(request: Request, { params }: Ctx) {
  const autorizado = await autorizarFinanceiro(request, { exigirImportacao: true });
  if ("erro" in autorizado) return autorizado.erro;
  const empresa = empresaDaUrl(new URL(request.url));
  if (!empresa) return semEmpresa();
  const id = Number((await params).id);
  try {
    const body = (await request.json()) as { acao?: string; registros?: RegistroFin[] };
    if (body.acao === "lote") {
      if (!Array.isArray(body.registros)) {
        return NextResponse.json({ error: "Lote sem registros." }, { status: 400 });
      }
      return NextResponse.json({ recebidos: await inserirLote(empresa, id, body.registros) });
    }
    if (body.acao === "analisar") {
      return NextResponse.json({ resumo: await analisarImportacao(empresa, id) });
    }
    if (body.acao === "aplicar") {
      const resumo = await aplicarImportacao(empresa, id, autorizado.auth.username);
      // Registros novos/alterados ganham a forma normalizada dos textos.
      await renormalizar(empresa);
      return NextResponse.json({ resumo });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (erro) {
    return respostaErro("importação", erro);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const autorizado = await autorizarFinanceiro(request, { exigirImportacao: true });
  if ("erro" in autorizado) return autorizado.erro;
  const empresa = empresaDaUrl(new URL(request.url));
  if (!empresa) return semEmpresa();
  try {
    await descartarImportacao(empresa, Number((await params).id));
    return NextResponse.json({ ok: true });
  } catch (erro) {
    return respostaErro("descartar importação", erro);
  }
}
