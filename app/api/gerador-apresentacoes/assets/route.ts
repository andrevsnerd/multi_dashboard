import { NextResponse } from "next/server";

import {
  getPresentationAsset,
  listPresentationCoverRefs,
  spreadCoverToCodes,
  upsertPresentationAsset,
  type PresentationAssetKind,
} from "@/lib/utils/presentation-asset-store";

// Capa base64 pode passar de 1MB; deixamos folga mas evitamos abuso.
const MAX_DATA_URL_LENGTH = 12 * 1024 * 1024; // ~12MB de string base64
const VALID_KINDS: PresentationAssetKind[] = ["logo", "cover"];
// Logo vale p/ NERD e ScarfMe; capas por coleção seguem ScarfMe (fluxo de coleção).
const ALLOWED_COMPANIES = new Set(["scarfme", "nerd"]);

function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

/**
 * GET ?company=scarfme[&colecao=CODIGO][&list=covers]
 *
 * Retorna o logo da rede e (se `colecao` informado) a capa daquela coleção.
 * Com `list=covers`, devolve também os códigos das capas já enviadas — usado
 * pelos decks que não são de uma coleção (ex.: Top Produtos) para sortear/
 * escolher uma capa existente sem baixar todos os base64.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? "";
  const colecao = searchParams.get("colecao");
  const wantsCoverList = searchParams.get("list") === "covers";

  if (!ALLOWED_COMPANIES.has(company)) {
    return NextResponse.json(
      { error: "Gerador de Apresentações indisponível para esta empresa." },
      { status: 400 }
    );
  }

  if (wantsCoverList) {
    try {
      const covers = await listPresentationCoverRefs(company);
      return NextResponse.json({ covers }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Erro ao listar capas da apresentação", error);
      return NextResponse.json({ error: "Erro ao listar imagens." }, { status: 500 });
    }
  }

  try {
    const [logo, cover] = await Promise.all([
      getPresentationAsset(company, "logo"),
      colecao ? getPresentationAsset(company, "cover", colecao) : Promise.resolve(null),
    ]);

    return NextResponse.json(
      {
        logo: logo?.dataUrl ?? null,
        cover: cover?.dataUrl ?? null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Erro ao carregar assets da apresentação", error);
    return NextResponse.json({ error: "Erro ao carregar imagens." }, { status: 500 });
  }
}

/**
 * POST { company, kind: "logo"|"cover", ref?, dataUrl, spreadTo? }
 *
 * Insere ou substitui (upsert) a imagem. `spreadTo` só vale para capa e serve aos
 * agregados do Painel de Coleções: a mesma foto preenche os códigos membros que
 * ainda não têm capa própria (ver `spreadCoverToCodes`). Não é vínculo fixo —
 * subir foto direto num código faz ele descolar do agregado.
 */
export async function POST(request: Request) {
  let body: {
    company?: string;
    kind?: string;
    ref?: string | null;
    dataUrl?: string;
    spreadTo?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  if (!body.company || !ALLOWED_COMPANIES.has(body.company)) {
    return NextResponse.json(
      { error: "Gerador de Apresentações indisponível para esta empresa." },
      { status: 400 }
    );
  }

  const kind = body.kind as PresentationAssetKind;
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Tipo de imagem inválido." }, { status: 400 });
  }

  if (kind === "cover" && !body.ref?.trim()) {
    return NextResponse.json(
      { error: "Informe a coleção (ref) para a imagem de capa." },
      { status: 400 }
    );
  }

  if (!isDataUrl(body.dataUrl)) {
    return NextResponse.json(
      { error: "Envie uma imagem válida (data URL base64)." },
      { status: 400 }
    );
  }

  if (body.dataUrl.length > MAX_DATA_URL_LENGTH) {
    return NextResponse.json(
      { error: "Imagem muito grande. Envie um arquivo menor." },
      { status: 413 }
    );
  }

  try {
    const asset = await upsertPresentationAsset({
      companyKey: body.company,
      kind,
      ref: body.ref ?? null,
      dataUrl: body.dataUrl,
    });

    // Agregado (ex.: Coleções Galisteu): preenche os códigos membros sem capa própria.
    const spread =
      kind === "cover" && Array.isArray(body.spreadTo) && body.spreadTo.length > 0
        ? await spreadCoverToCodes({
            companyKey: body.company,
            sourceRef: asset.ref,
            codes: body.spreadTo,
            dataUrl: body.dataUrl,
          })
        : null;

    return NextResponse.json({
      ok: true,
      updatedAt: asset.updatedAt,
      applied: spread?.applied ?? [],
      skipped: spread?.skipped ?? [],
    });
  } catch (error) {
    console.error("Erro ao salvar asset da apresentação", error);
    return NextResponse.json({ error: "Erro ao salvar imagem." }, { status: 500 });
  }
}
