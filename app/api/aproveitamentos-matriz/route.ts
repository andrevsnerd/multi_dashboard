import { NextResponse } from "next/server";

import { autorizarAproveitamentos } from "@/lib/auth/aproveitamentos-matriz-guard";
import {
  fetchCadastroAproveitamentos,
  type CadastroAproveitamento,
} from "@/lib/repositories/aproveitamentosMatriz";
import {
  carregarAproveitamentos,
  salvarAproveitamentos,
  type AproveitamentosSalvos,
} from "@/lib/utils/aproveitamentos-matriz-store";

/**
 * Tela "Aproveitamentos Matriz" (Scarf Me): estoque OFFLINE, contado à mão, de lenços 50x50
 * e twillys 8x130 que ainda não entraram no Linx. Não toca em ESTOQUE_PRODUTOS.
 *
 *   GET                 → itens salvos + cadastro do Linx de cada produto vinculado
 *   GET ?produto=CODIGO → só o cadastro de um código (a tela usa ao trocar o vínculo)
 *   PUT { itens }       → grava a lista inteira
 *
 * O cadastro é consultado ao vivo: custo e preço sugerido ficam sempre os do Linx. Se o
 * Linx falhar, a tela abre mesmo assim (o estoque é do Neon) com o aviso em `cadastroErro`.
 */

const COMPANY = "scarfme";

type CadastroResposta = Omit<CadastroAproveitamento, "custo"> & { custo: number | null };

async function cadastroDe(
  produtos: (string | null)[],
  podeVerCusto: boolean
): Promise<{ cadastro: Record<string, CadastroResposta>; cadastroErro: string | null }> {
  try {
    const mapa = await fetchCadastroAproveitamentos(produtos.filter((p): p is string => !!p));
    const cadastro: Record<string, CadastroResposta> = {};
    for (const [produto, c] of mapa) {
      cadastro[produto] = { ...c, custo: podeVerCusto ? c.custo : null };
    }
    return { cadastro, cadastroErro: null };
  } catch (error) {
    console.error("Erro ao ler cadastro dos aproveitamentos no Linx:", error);
    return {
      cadastro: {},
      cadastroErro: "Não foi possível ler o cadastro no Linx agora: custo e preço não aparecem.",
    };
  }
}

async function resposta(salvo: AproveitamentosSalvos, podeEditar: boolean, podeVerCusto: boolean) {
  const { cadastro, cadastroErro } = await cadastroDe(
    salvo.itens.map((i) => i.produto),
    podeVerCusto
  );
  return {
    ...salvo,
    cadastro,
    cadastroErro,
    podeEditar,
    podeVerCusto,
  };
}

export async function GET(request: Request) {
  const autorizado = await autorizarAproveitamentos(request);
  if ("erro" in autorizado) return autorizado.erro;
  const { podeEditar, podeVerCusto } = autorizado.auth;

  try {
    const produto = new URL(request.url).searchParams.get("produto")?.trim().toUpperCase();
    if (produto) {
      const { cadastro, cadastroErro } = await cadastroDe([produto], podeVerCusto);
      if (cadastroErro) return NextResponse.json({ error: cadastroErro }, { status: 502 });
      const item = cadastro[produto] ?? null;
      if (!item) {
        return NextResponse.json(
          { error: `Produto ${produto} não encontrado no Linx.` },
          { status: 404 }
        );
      }
      return NextResponse.json({ cadastro: item }, { headers: { "Cache-Control": "no-store" } });
    }

    const salvo = await carregarAproveitamentos(COMPANY);
    return NextResponse.json(await resposta(salvo, podeEditar, podeVerCusto), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Erro em /api/aproveitamentos-matriz:", error);
    return NextResponse.json({ error: "Erro ao carregar os aproveitamentos" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const autorizado = await autorizarAproveitamentos(request, { exigirEdicao: true });
  if ("erro" in autorizado) return autorizado.erro;
  const { username, podeEditar, podeVerCusto } = autorizado.auth;

  try {
    const body = (await request.json()) as { itens?: unknown };
    if (!Array.isArray(body?.itens)) {
      return NextResponse.json({ error: "Lista de itens inválida." }, { status: 400 });
    }
    const salvo = await salvarAproveitamentos(COMPANY, body.itens, username);
    return NextResponse.json(await resposta(salvo, podeEditar, podeVerCusto));
  } catch (error) {
    console.error("Erro ao salvar aproveitamentos da matriz:", error);
    return NextResponse.json({ error: "Erro ao salvar os aproveitamentos" }, { status: 500 });
  }
}
