import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import {
  getConfirmados,
  confirmarItem,
  desconfirmarItem,
} from "@/lib/utils/romaneio-confirmacao-store";

/**
 * GET /api/romaneio-confirmar-entrada?company=X&romaneio=Y&filialDestino=Z
 * Retorna objeto { "produto|cor": qtdeConfirmada } para o romaneio+filial.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get("company") || "";
    const romaneio = searchParams.get("romaneio") || "";
    const filialDestino = searchParams.get("filialDestino") || "";

    if (!company || !romaneio || !filialDestino) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios: company, romaneio, filialDestino" },
        { status: 400 }
      );
    }

    const map = await getConfirmados(company, romaneio, filialDestino);
    // Serializa Map para objeto plain
    const data: Record<string, number> = {};
    for (const [chave, qtde] of map.entries()) {
      data[chave] = qtde;
    }
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error("GET romaneio-confirmar-entrada:", err);
    return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 });
  }
}

/**
 * POST /api/romaneio-confirmar-entrada
 * Body: { companyKey, romaneioId, filialDestino, produto, corProduto, qtdeConfirmada, acao: "confirmar"|"desconfirmar" }
 */
export async function POST(request: Request) {
  try {
    const username = request.headers.get("x-auth-username")?.trim();
    if (!username) {
      return NextResponse.json(
        { error: "Usuário não identificado. Faça login novamente." },
        { status: 401 }
      );
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 403 });
    }

    const body = (await request.json()) as {
      companyKey: string;
      romaneioId: string;
      filialDestino: string;
      produto: string;
      corProduto: string;
      qtdeConfirmada?: number;
      acao: "confirmar" | "desconfirmar";
    };

    const { companyKey, romaneioId, filialDestino, produto, corProduto, qtdeConfirmada = 0, acao } = body;

    if (!companyKey || !romaneioId || !filialDestino || !produto) {
      return NextResponse.json(
        { error: "Campos obrigatórios: companyKey, romaneioId, filialDestino, produto" },
        { status: 400 }
      );
    }

    if (acao === "confirmar" && qtdeConfirmada <= 0) {
      return NextResponse.json(
        { error: "A quantidade confirmada deve ser maior que zero." },
        { status: 400 }
      );
    }

    // Verifica permissão da filialDestino
    if (user.role !== "admin") {
      const permissao = await getPermissaoByUsername(username);
      if (!permissao) {
        return NextResponse.json({ error: "Sem permissão configurada." }, { status: 403 });
      }
      const fd = (filialDestino || "").trim();
      const filialOk =
        !permissao.filialAtribuida ||
        permissao.filialAtribuida === "TODAS" ||
        permissao.filialAtribuida === fd ||
        permissao.filiaisDestino.length === 0 ||
        permissao.filiaisDestino.some((f) => (f || "").trim() === fd);
      if (!filialOk) {
        return NextResponse.json({ error: "Sem permissão para esta filial." }, { status: 403 });
      }
    }

    if (acao === "desconfirmar") {
      await desconfirmarItem(companyKey, romaneioId, filialDestino, produto, corProduto ?? "");
    } else {
      await confirmarItem(
        companyKey,
        romaneioId,
        filialDestino,
        produto,
        corProduto ?? "",
        qtdeConfirmada,
        username
      );
    }

    return NextResponse.json({ success: true, acao });
  } catch (err: any) {
    console.error("POST romaneio-confirmar-entrada:", err);
    return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 });
  }
}
