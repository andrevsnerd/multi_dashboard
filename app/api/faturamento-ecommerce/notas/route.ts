import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { gravarNota, listarNotasFat } from "@/lib/repositories/faturamentoEcommerce/notas";
import type { NotaInput } from "@/lib/faturamento-ecommerce/types";
import { resolveResponsavelLinx } from "@/lib/server/responsavel-linx";

export const maxDuration = 120;

/** Lista NFs das filiais de e-commerce da empresa (busca da aba Faturamento e Monitor). */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    const data = await listarNotasFat({
      empresa: a.auth.empresa,
      filial: sp.get("filial") ?? undefined,
      de: sp.get("de") ?? undefined,
      ate: sp.get("ate") ?? undefined,
      busca: sp.get("busca") ?? undefined,
      statusGrupo: sp.get("status") ?? undefined,
    });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/notas GET]", err);
    return erroJson(err);
  }
}

/**
 * Grava a NF no Linx (STATUS_NFE = 1, pronta para o Monitor de NF-e).
 * `simular: true` roda a gravação inteira — triggers do Linx inclusive — e desfaz.
 */
export async function POST(request: Request) {
  let body: { nota?: NotaInput; simular?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const nota = body.nota;
  const a = await autorizarFaturamentoEcommerce(request, nota?.empresa, { escrita: true });
  if ("erro" in a) return a.erro;
  if (!nota) return NextResponse.json({ error: "Dados da NF ausentes." }, { status: 400 });
  try {
    // RESPONSAVEL do romaneio (devolução) = usuário do Linx do login — nunca o que vem da tela.
    const responsavel = await resolveResponsavelLinx(a.auth.username);
    const data = await gravarNota({ ...nota, empresa: a.auth.empresa, responsavel }, { simular: Boolean(body.simular) });
    if (!data.simulacao) {
      console.info(
        `[faturamento-ecommerce] NF ${data.nf}/${data.serie} ${data.filial} gravada por ${a.auth.username} (pedido ${data.pedido}, R$ ${data.total})`
      );
    }
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/notas POST]", err);
    return erroJson(err, 400);
  }
}
