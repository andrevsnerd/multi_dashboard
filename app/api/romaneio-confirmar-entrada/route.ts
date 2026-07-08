import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { isReadOnlyRole } from "@/lib/auth/permissions";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import {
  getConfirmados,
  confirmarItem,
  desconfirmarItem,
} from "@/lib/utils/romaneio-confirmacao-store";
import { withRequest } from "@/lib/db/connection";
import sql from "mssql";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";

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
    const companyConfig = await resolveCompanyDynamic(company);

    if (!company || !romaneio || !filialDestino) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios: company, romaneio, filialDestino" },
        { status: 400 }
      );
    }

    const filialDestinoAtiva = getActiveFilial(companyConfig, filialDestino);
    const map = await getConfirmados(company, romaneio, filialDestinoAtiva);
    if (filialDestinoAtiva !== filialDestino.trim()) {
      const legacyMap = await getConfirmados(company, romaneio, filialDestino);
      for (const [chave, qtde] of legacyMap.entries()) {
        if (!map.has(chave)) map.set(chave, qtde);
      }
    }
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
    if (isReadOnlyRole(user.role)) {
      return NextResponse.json(
        { error: "Acesso somente leitura: esta função não pode confirmar entradas." },
        { status: 403 }
      );
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
    const companyConfig = await resolveCompanyDynamic(companyKey);
    const filialDestinoAtiva = getActiveFilial(companyConfig, filialDestino);

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
      const fd = (filialDestinoAtiva || "").trim();
      const filialOk =
        !permissao.filialAtribuida ||
        permissao.filialAtribuida === "TODAS" ||
        permissao.filialAtribuida === fd ||
        permissao.filiaisDestino.length === 0 ||
        permissao.filiaisDestino.some((f) => getActiveFilial(companyConfig, f || "").trim() === fd);
      if (!filialOk) {
        return NextResponse.json({ error: "Sem permissão para esta filial." }, { status: 403 });
      }
    }

    if (acao === "desconfirmar") {
      // Busca a qtde confirmada antes de deletar para reverter o estoque
      const confirmadosMap = await getConfirmados(companyKey, romaneioId, filialDestinoAtiva);
      const chave = `${produto}|${(corProduto ?? "").trim()}`;
      const qtdeConfirmada = confirmadosMap.get(chave) ?? 0;

      await desconfirmarItem(companyKey, romaneioId, filialDestinoAtiva, produto, corProduto ?? "");

      // Reverte o estoque do destino se havia quantidade confirmada
      if (qtdeConfirmada > 0) {
        const fd = (filialDestinoAtiva || "").trim();
        const p = (produto || "").trim();
        const cor = (corProduto ?? "").trim();
        await withRequest(async (req) => {
          req.input("qtde", sql.Int, qtdeConfirmada);
          req.input("produto", sql.VarChar, p);
          req.input("cor", sql.VarChar, cor);
          req.input("filialDestino", sql.VarChar, fd);
          await req.query(`
            UPDATE ep
            SET ep.ESTOQUE = ep.ESTOQUE - @qtde
            FROM ESTOQUE_PRODUTOS ep
            INNER JOIN FILIAIS f WITH (NOLOCK) ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
            WHERE ep.PRODUTO = @produto
              AND ISNULL(ep.COR_PRODUTO, '') = @cor
              AND (LTRIM(RTRIM(f.COD_FILIAL)) = LTRIM(RTRIM(@filialDestino))
                   OR LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(@filialDestino)))
          `);
        });
      }
    } else {
      await confirmarItem(
        companyKey,
        romaneioId,
        filialDestinoAtiva,
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
