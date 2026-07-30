import { NextResponse } from "next/server";

import { resolveCompany } from "@/lib/config/company";
import { escopoPermiteFilial, resolveVmEscopo } from "@/lib/server/vm-escopo";
import { montarPreviewVm, type VmSkuRef } from "@/lib/server/vm-movimento";
import { isVmCompany } from "@/lib/utils/vm";

export const dynamic = "force-dynamic";

interface PreviewBody {
  company?: string;
  filial?: string;
  entrando?: VmSkuRef[];
  saindo?: VmSkuRef[];
}

/**
 * Prévia do widget de confirmação: o que sai e o que entra no estoque, com o saldo antes
 * e depois. Não move nada — o confirmar recalcula tudo.
 */
export async function POST(request: Request) {
  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const company = resolveCompany(body.company ?? "");
  if (!company) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  }
  if (!isVmCompany(company.key)) {
    return NextResponse.json(
      { error: "A lista de VM está disponível apenas para NERD por enquanto." },
      { status: 400 }
    );
  }

  const filial = (body.filial ?? "").trim();
  if (!filial) {
    return NextResponse.json({ error: "Informe a filial." }, { status: 400 });
  }

  const { escopo, error } = await resolveVmEscopo(request.headers.get("x-auth-username"));
  if (error) return error;

  if (!escopoPermiteFilial(escopo, filial)) {
    return NextResponse.json(
      { error: "Você não tem acesso a essa filial." },
      { status: 403 }
    );
  }

  const entrando = body.entrando ?? [];
  const saindo = body.saindo ?? [];
  if (entrando.length === 0 && saindo.length === 0) {
    return NextResponse.json({ error: "Nenhuma alteração para revisar." }, { status: 400 });
  }

  try {
    const preview = await montarPreviewVm({
      company: company.key,
      filialCod: filial,
      entrando,
      saindo,
    });
    return NextResponse.json({ data: preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Erro ao montar a prévia.";
    console.error("[vm/preview] erro", cause);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
