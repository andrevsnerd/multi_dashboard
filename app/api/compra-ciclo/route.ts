import { NextResponse } from "next/server";

import { autorizarCompraCiclo, parseCompraCicloCompany } from "@/lib/auth/compra-ciclo-guard";
import {
  carregarConfigCiclo,
  listarPresetsCiclo,
  resetarConfigCiclo,
  salvarConfigCiclo,
} from "@/lib/config/compra-ciclo-store";
import { configCicloFabrica } from "@/lib/config/compra-ciclo-tipos";

export const dynamic = "force-dynamic";

/** Config de ciclo da empresa + presets disponíveis + a de fábrica (para o "voltar ao padrão"). */
export async function GET(request: Request) {
  const autorizacao = await autorizarCompraCiclo(request);
  if ("erro" in autorizacao) return autorizacao.erro;

  const url = new URL(request.url);
  const company = parseCompraCicloCompany(url.searchParams.get("company"));
  if (!company) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  try {
    const [config, presets] = await Promise.all([
      carregarConfigCiclo(company),
      listarPresetsCiclo(),
    ]);
    return NextResponse.json({
      config,
      fabrica: configCicloFabrica(company),
      presets,
      podeEditar: autorizacao.auth.podeEditar,
    });
  } catch (error) {
    console.error("[compra-ciclo] erro ao carregar", error);
    return NextResponse.json({ error: "Erro ao carregar a configuração." }, { status: 500 });
  }
}

/** Salva os prazos da empresa (ou volta para a config de fábrica com `resetar`). */
export async function PUT(request: Request) {
  const autorizacao = await autorizarCompraCiclo(request, { exigirEdicao: true });
  if ("erro" in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as {
      company?: string;
      config?: unknown;
      resetar?: boolean;
    };
    const company = parseCompraCicloCompany(body.company);
    if (!company) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

    const config = body.resetar
      ? await resetarConfigCiclo(company)
      : await salvarConfigCiclo(company, body.config, autorizacao.auth.username);

    return NextResponse.json({ config });
  } catch (error) {
    console.error("[compra-ciclo] erro ao salvar", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar a configuração." },
      { status: 500 }
    );
  }
}
