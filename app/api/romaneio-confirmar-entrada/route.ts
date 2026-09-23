import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { isReadOnlyRole, canConfirmarEntradaDefeito } from "@/lib/auth/permissions";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { operaNaFilial } from "@/lib/utils/transferencia-permissoes-filiais";
import {
  getConfirmados,
  confirmarItem,
  desconfirmarItem,
} from "@/lib/utils/romaneio-confirmacao-store";
import { withRequest, getConnectionPool } from "@/lib/db/connection";
import sql from "mssql";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { shouldUseProxy, ProxyPool } from "@/lib/db/proxy";
import { resolveResponsavelLinx } from "@/lib/server/responsavel-linx";
import { inserirAjuste } from "@/lib/repositories/ajuste-historico";
import { executeItemQtdeSet } from "@/lib/saida-entrada-executor";

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
      /**
       * Filial de ORIGEM do romaneio de saída. Quando vem, confirmar menos do
       * que saiu devolve a diferença ao estoque dela (ver o bloco de correção).
       */
      filialOrigem?: string;
      /**
       * Romaneio de ENTRADA gerado no destino nesta conferência. Guardado junto
       * com a confirmação porque o Linx não liga a entrada avulsa à saída, e sem
       * esse vínculo não há como corrigir o destino depois.
       */
      romaneioEntrada?: string;
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

    // Verifica permissão da filialDestino.
    // Exceção: a filial de DEFEITO (NERD DEFEITOS / BAZAR SCARF ME) é aprovada pela
    // MATRIZ, então a logística confirma entrada nela mesmo estando atribuída a outra
    // filial — e mesmo sem registro em transferencia_permissoes.
    const fd = (filialDestinoAtiva || "").trim();
    const ehDefeitoAprovadoPelaMatriz = canConfirmarEntradaDefeito(user, companyKey, fd);

    if (user.role !== "admin" && !ehDefeitoAprovadoPelaMatriz) {
      const permissao = await getPermissaoByUsername(username);
      if (!permissao) {
        return NextResponse.json({ error: "Sem permissão configurada." }, { status: 403 });
      }
      const filialOk =
        !permissao.filialAtribuida ||
        permissao.filialAtribuida === "TODAS" ||
        permissao.filialAtribuida === fd ||
        // Filiais adicionais de operação (ex.: logística que também recebe em NERD DEFEITOS).
        operaNaFilial(permissao, companyConfig, fd) ||
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
      // CONFERIU MENOS DO QUE SAIU → a peça que não chegou volta para a loja.
      //
      // Antes, confirmar 2 de uma saída de 3 dava entrada de 2 no destino e
      // deixava a loja de origem 1 peça a menos para sempre: a divergência
      // desaparecia sem que ninguém devolvesse nada. Aqui a saída passa a valer
      // a quantidade conferida e o trigger do Linx devolve a diferença.
      //
      // Só vale para saída AVULSA: o executor recusa romaneio pareado com
      // entrada/nota de transferência, porque lá o outro lado é amarrado pelo
      // ERP e a diferença é assunto de conferência, não de correção. Por isso a
      // falha aqui NÃO derruba a confirmação — ela só volta descrita na resposta.
      let origem: { corrigido: boolean; detalhe: string } | null = null;
      const filialOrigem = (body.filialOrigem ?? "").trim();

      if (filialOrigem && qtdeConfirmada > 0) {
        try {
          const qtdeSaida = await withRequest(async (req) => {
            req.input("romaneio", sql.VarChar, romaneioId.trim());
            req.input("filial", sql.VarChar, filialOrigem);
            req.input("produto", sql.VarChar, produto.trim());
            req.input("cor", sql.VarChar, (corProduto ?? "").trim());
            const r = await req.query<{ qtde: number | null }>(`
              SELECT TOP 1 ISNULL(i.QTDE, 0) AS qtde
                FROM ESTOQUE_PROD1_SAI i WITH (NOLOCK)
               WHERE LTRIM(RTRIM(i.ROMANEIO_PRODUTO)) = @romaneio
                 AND LTRIM(RTRIM(i.FILIAL)) = LTRIM(RTRIM(@filial))
                 AND LTRIM(RTRIM(i.PRODUTO)) = @produto
                 AND (
                   ISNULL(LTRIM(RTRIM(CAST(i.COR_PRODUTO AS VARCHAR(20)))), '') = @cor
                   OR TRY_CONVERT(INT, i.COR_PRODUTO) = TRY_CONVERT(INT, @cor)
                 )
            `);
            return Number(r.recordset[0]?.qtde ?? 0);
          });

          if (qtdeSaida > qtdeConfirmada) {
            const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
            const res = await executeItemQtdeSet(pool, {
              tipo: "saida",
              romaneio: romaneioId,
              filial: filialOrigem,
              produto,
              corProduto: corProduto ?? "",
              qtdeNova: qtdeConfirmada,
            });
            const devolvido = -res.delta;
            origem = {
              corrigido: true,
              detalhe: `${devolvido} peça(s) devolvida(s) ao estoque de ${res.filial}: a saída ${romaneioId} passou de ${res.qtdeAnterior} para ${qtdeConfirmada}.`,
            };
            inserirAjuste({
              filial: res.filial,
              itens: [{ produto, cor: (corProduto ?? "").trim(), qtde: devolvido }],
              romaneioRef: romaneioId,
              tipoAjuste: "CORRECAO_CONFERENCIA_SAIDA",
              responsavel: await resolveResponsavelLinx(username),
              obs: `Conferência de ${fd}: ${res.qtdeAnterior} → ${qtdeConfirmada}`,
            }).catch((e) =>
              console.error("[ajuste-historico] Falha ao registrar auditoria:", e)
            );
          }
        } catch (e) {
          origem = {
            corrigido: false,
            detalhe:
              e instanceof Error
                ? `O item foi confirmado, mas a saída não pôde ser corrigida: ${e.message}`
                : "O item foi confirmado, mas a saída não pôde ser corrigida.",
          };
        }
      }

      await confirmarItem(
        companyKey,
        romaneioId,
        filialDestinoAtiva,
        produto,
        corProduto ?? "",
        qtdeConfirmada,
        username,
        (body.romaneioEntrada ?? "").trim()
      );

      return NextResponse.json({ success: true, acao, origem });
    }

    return NextResponse.json({ success: true, acao });
  } catch (err: any) {
    console.error("POST romaneio-confirmar-entrada:", err);
    return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 });
  }
}
