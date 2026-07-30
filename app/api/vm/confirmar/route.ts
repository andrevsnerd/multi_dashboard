import { NextResponse } from "next/server";

import { resolveCompany } from "@/lib/config/company";
import { escopoPermiteFilial, resolveVmEscopo } from "@/lib/server/vm-escopo";
import { executarMovimentoVm, type VmSkuRef } from "@/lib/server/vm-movimento";
import { isVmCompany } from "@/lib/utils/vm";

export const dynamic = "force-dynamic";

interface ConfirmarBody {
  company?: string;
  filial?: string;
  entrando?: VmSkuRef[];
  saindo?: VmSkuRef[];
}

/**
 * Confirma o movimento: gera os romaneios (tipo VM) no Linx e só então
 * atualiza a lista. Recalcula o saldo no momento da execução — o preview é informativo.
 */
export async function POST(request: Request) {
  let body: ConfirmarBody;
  try {
    body = (await request.json()) as ConfirmarBody;
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

  if (!escopo.podeMutar) {
    return NextResponse.json(
      { error: "Acesso somente leitura: esta função não pode alterar a lista de VM." },
      { status: 403 }
    );
  }
  if (!escopoPermiteFilial(escopo, filial)) {
    return NextResponse.json({ error: "Você não tem acesso a essa filial." }, { status: 403 });
  }

  const entrando = body.entrando ?? [];
  const saindo = body.saindo ?? [];
  if (entrando.length === 0 && saindo.length === 0) {
    return NextResponse.json({ error: "Nenhuma alteração para confirmar." }, { status: 400 });
  }

  try {
    const resultado = await executarMovimentoVm(
      { company: company.key, filialCod: filial, entrando, saindo },
      escopo.username
    );
    return NextResponse.json({ data: resultado }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Erro ao confirmar o movimento de VM.";
    console.error("[vm/confirmar] erro", cause);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
