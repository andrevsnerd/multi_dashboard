import { NextResponse } from "next/server";

import { autorizarFinanceiro } from "@/lib/auth/controle-financeiro-guard";
import { empresaDaUrl, respostaErro, semEmpresa } from "@/lib/financeiro/api";
import type { AbaMeta } from "@/lib/financeiro/planilha";
import { criarImportacao, listarImportacoes } from "@/lib/financeiro/store";

export async function GET(request: Request) {
  const autorizado = await autorizarFinanceiro(request);
  if ("erro" in autorizado) return autorizado.erro;
  const empresa = empresaDaUrl(new URL(request.url));
  if (!empresa) return semEmpresa();
  try {
    return NextResponse.json({ importacoes: await listarImportacoes(empresa) });
  } catch (erro) {
    return respostaErro("listar importações", erro);
  }
}

/**
 * Abre uma importação: recebe só o metadado das abas (a planilha é lida no navegador);
 * os registros chegam depois, em lotes, em /importacoes/[id].
 */
export async function POST(request: Request) {
  const autorizado = await autorizarFinanceiro(request, { exigirImportacao: true });
  if ("erro" in autorizado) return autorizado.erro;
  const empresa = empresaDaUrl(new URL(request.url));
  if (!empresa) return semEmpresa();
  try {
    const body = (await request.json()) as {
      arquivo?: string;
      tamanho?: number;
      abas?: AbaMeta[];
      totalEsperado?: number;
    };
    if (!body.arquivo || !Array.isArray(body.abas) || !body.abas.length) {
      return NextResponse.json({ error: "Planilha sem abas reconhecíveis." }, { status: 400 });
    }
    const id = await criarImportacao({
      empresa,
      arquivo: String(body.arquivo).slice(0, 255),
      tamanho: Number(body.tamanho) || null,
      usuario: autorizado.auth.username,
      abas: body.abas,
      totalEsperado: Number(body.totalEsperado) || 0,
    });
    return NextResponse.json({ id });
  } catch (erro) {
    return respostaErro("criar importação", erro);
  }
}
