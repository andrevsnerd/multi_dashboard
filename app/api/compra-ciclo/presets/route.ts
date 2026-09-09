import { NextResponse } from "next/server";

import { autorizarCompraCiclo } from "@/lib/auth/compra-ciclo-guard";
import { excluirPresetCiclo, listarPresetsCiclo, salvarPresetCiclo } from "@/lib/config/compra-ciclo-store";

export const dynamic = "force-dynamic";

/** Presets de fábrica + os salvos pelo time. */
export async function GET(request: Request) {
  const autorizacao = await autorizarCompraCiclo(request);
  if ("erro" in autorizacao) return autorizacao.erro;

  try {
    return NextResponse.json({ presets: await listarPresetsCiclo() });
  } catch (error) {
    console.error("[compra-ciclo/presets] erro ao listar", error);
    return NextResponse.json({ error: "Erro ao carregar os presets." }, { status: 500 });
  }
}

/**
 * Cria um preset a partir da config que está na tela. Preset é só um molde: salvar não muda
 * nada no cálculo — só depois de aplicar e salvar a empresa é que os prazos passam a valer.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarCompraCiclo(request, { exigirEdicao: true });
  if ("erro" in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as { nome?: string; descricao?: string; config?: unknown };
    const preset = await salvarPresetCiclo({
      nome: String(body.nome ?? ""),
      descricao: body.descricao ? String(body.descricao) : "",
      config: body.config,
      usuario: autorizacao.auth.username,
    });
    return NextResponse.json({ preset, presets: await listarPresetsCiclo() });
  } catch (error) {
    console.error("[compra-ciclo/presets] erro ao salvar", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar o preset." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const autorizacao = await autorizarCompraCiclo(request, { exigirEdicao: true });
  if ("erro" in autorizacao) return autorizacao.erro;

  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "Preset não informado." }, { status: 400 });

    await excluirPresetCiclo(id);
    return NextResponse.json({ presets: await listarPresetsCiclo() });
  } catch (error) {
    console.error("[compra-ciclo/presets] erro ao excluir", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao excluir o preset." },
      { status: 500 }
    );
  }
}
