import { NextResponse } from "next/server";

import { readOnlyBlock } from "@/lib/auth/route-guards";
import { EMBALAGENS_VISIVEIS } from "@/lib/config/embalagens";
import { AVIAMENTOS } from "@/lib/config/aviamentos";
import {
  ITENS_CORPORATIVO,
  REDES_INSUMO,
  TIPOS_INSUMO,
  carregarEstoqueInsumos,
  salvarEstoqueInsumos,
  type EstoqueInsumos,
  type RedeInsumo,
  type TipoInsumo,
} from "@/lib/utils/insumos-estoque-store";

/**
 * Estoque digitado de EMBALAGENS e AVIAMENTOS — a tela "Embalagens e Aviamentos".
 *
 * É a única tela que altera esse estoque. A Projeção Compra só lê o da Rede ScarfMe, que é
 * o mesmo registro — ver [insumos-estoque-store.ts](@/lib/utils/insumos-estoque-store).
 *
 * O GET devolve as duas redes de uma vez (são quatro linhas pequenas), para a troca de
 * rede na tela ser instantânea.
 */
export async function GET() {
  try {
    const itensScarfme = {
      embalagens: EMBALAGENS_VISIVEIS.map((e) => ({ id: e.id, nome: e.nome })),
      // O id do aviamento é o código do produto no Linx (X5.*).
      aviamentos: AVIAMENTOS.map((a) => ({ id: a.id, nome: a.nome })),
    };
    const estoque = Object.fromEntries(
      await Promise.all(
        REDES_INSUMO.map(async (rede) => [
          rede,
          Object.fromEntries(
            await Promise.all(
              TIPOS_INSUMO.map(async (tipo) => [tipo, await carregarEstoqueInsumos(tipo, rede)])
            )
          ),
        ])
      )
    ) as Record<RedeInsumo, Record<TipoInsumo, EstoqueInsumos>>;

    return NextResponse.json(
      {
        itens: {
          // Rede ScarfMe: os mesmos itens que a Projeção Compra mostra em cada aba.
          scarfme: itensScarfme,
          // Corporativo: só o subconjunto que ele usa, na mesma ordem da rede.
          corporativo: {
            embalagens: itensScarfme.embalagens.filter((i) =>
              ITENS_CORPORATIVO.embalagens.includes(i.id)
            ),
            aviamentos: itensScarfme.aviamentos.filter((i) =>
              ITENS_CORPORATIVO.aviamentos.includes(i.id)
            ),
          },
        },
        estoque,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Erro em /api/embalagens-aviamentos:", error);
    return NextResponse.json({ error: "Erro ao carregar o estoque" }, { status: 500 });
  }
}

/** Salva o estoque de uma rede × tipo (aceita só as linhas alteradas). */
export async function PUT(request: Request) {
  try {
    const usuario = request.headers.get("x-auth-username") ?? "";
    const bloqueado = await readOnlyBlock(usuario);
    if (bloqueado) return bloqueado;

    const body = (await request.json()) as { rede?: string; tipo?: string; estoque?: unknown };
    const rede = String(body?.rede ?? "").trim() as RedeInsumo;
    const tipo = String(body?.tipo ?? "").trim() as TipoInsumo;
    if (!REDES_INSUMO.includes(rede)) {
      return NextResponse.json({ error: "Rede inválida." }, { status: 400 });
    }
    if (!TIPOS_INSUMO.includes(tipo)) {
      return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
    }

    const estoque = await salvarEstoqueInsumos(tipo, rede, body?.estoque ?? {}, usuario);
    return NextResponse.json({ rede, tipo, estoque });
  } catch (error) {
    console.error("Erro ao salvar estoque de embalagens/aviamentos:", error);
    return NextResponse.json({ error: "Erro ao salvar o estoque" }, { status: 500 });
  }
}
