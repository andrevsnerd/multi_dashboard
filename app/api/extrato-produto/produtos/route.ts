import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { userHasPagePermission } from "@/lib/auth/permissions";
import type { UserSession } from "@/types/auth";
import { query } from "@/lib/db/connection";

/** Acesso ao Extrato de Produto: admin sempre; logistica se a pagina for liberada. */
async function canAccessExtrato(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  if (!user) return false;
  return userHasPagePermission(user as unknown as UserSession, "extrato-produto");
}

function sqlText(value: string) {
  return value.replace(/'/g, "''");
}

function trimValue(value: unknown) {
  return value == null ? "" : String(value).trim();
}

export interface ProdutoAtivoItem {
  produto: string;
  cor: string;
  descProduto: string | null;
  ultimoMovimento: string; // ISO
}

export interface ProdutosAtivosResponse {
  filial: string;
  page: number;
  pageSize: number;
  total: number;
  items: ProdutoAtivoItem[];
}

export async function GET(request: NextRequest) {
  const username = request.headers.get("x-auth-username");
  if (!username || !(await canAccessExtrato(username))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filial = trimValue(searchParams.get("filial"));
  const q = trimValue(searchParams.get("q"));
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSizeRaw = Number(searchParams.get("pageSize") ?? 20) || 20;
  const pageSize = Math.min(50, Math.max(5, pageSizeRaw));

  if (!filial) {
    return NextResponse.json(
      { error: "Parâmetro 'filial' é obrigatório" },
      { status: 400 }
    );
  }

  const filialSql = sqlText(filial);
  const qSql = q ? sqlText(q) : "";
  const offset = (page - 1) * pageSize;

  const qFilter = qSql
    ? `
      AND (
        a.PRODUTO LIKE '%${qSql}%'
        OR UPPER(ISNULL(p.DESC_PRODUTO, '')) LIKE '%${qSql.toUpperCase()}%'
      )
    `
    : "";

  try {
    const rows = await query<{
      PRODUTO: string;
      COR: string;
      DESC_PRODUTO: string | null;
      ULTIMO_MOVIMENTO: Date;
      TOTAL: number;
    }>(`
      ;WITH base AS (
        -- Entradas (estoque)
        SELECT
          RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
          RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR,
          MAX(e.EMISSAO) AS DT
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
          ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
          AND e.FILIAL = p.FILIAL
        WHERE RTRIM(LTRIM(CAST(e.FILIAL AS VARCHAR(120)))) = '${filialSql}'
          AND p.PRODUTO IS NOT NULL
        GROUP BY
          RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))),
          RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)), '')))

        UNION ALL

        -- Saídas (estoque)
        SELECT
          RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
          RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR,
          MAX(s.EMISSAO) AS DT
        FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
        JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK)
          ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
          AND s.FILIAL = p.FILIAL
        WHERE RTRIM(LTRIM(CAST(s.FILIAL AS VARCHAR(120)))) = '${filialSql}'
          AND p.PRODUTO IS NOT NULL
        GROUP BY
          RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))),
          RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)), '')))

        UNION ALL

        -- Loja entradas
        SELECT
          RTRIM(LTRIM(CAST(lep.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
          RTRIM(LTRIM(ISNULL(CAST(lep.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR,
          MAX(le.EMISSAO) AS DT
        FROM LOJA_ENTRADAS le WITH (NOLOCK)
        JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
          ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
        WHERE RTRIM(LTRIM(CAST(le.FILIAL AS VARCHAR(120)))) = '${filialSql}'
          AND lep.PRODUTO IS NOT NULL
        GROUP BY
          RTRIM(LTRIM(CAST(lep.PRODUTO AS VARCHAR(50)))),
          RTRIM(LTRIM(ISNULL(CAST(lep.COR_PRODUTO AS VARCHAR(20)), '')))

        UNION ALL

        -- Loja saídas
        SELECT
          RTRIM(LTRIM(CAST(lsp.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
          RTRIM(LTRIM(ISNULL(CAST(lsp.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR,
          MAX(ls.EMISSAO) AS DT
        FROM LOJA_SAIDAS ls WITH (NOLOCK)
        JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
          ON ls.FILIAL = lsp.FILIAL AND ls.ROMANEIO_PRODUTO = lsp.ROMANEIO_PRODUTO
        WHERE RTRIM(LTRIM(CAST(ls.FILIAL AS VARCHAR(120)))) = '${filialSql}'
          AND lsp.PRODUTO IS NOT NULL
        GROUP BY
          RTRIM(LTRIM(CAST(lsp.PRODUTO AS VARCHAR(50)))),
          RTRIM(LTRIM(ISNULL(CAST(lsp.COR_PRODUTO AS VARCHAR(20)), '')))

        UNION ALL

        -- Vendas (mapear código de filial -> nome)
        SELECT
          RTRIM(LTRIM(CAST(vp.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
          RTRIM(LTRIM(ISNULL(CAST(vp.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR,
          MAX(v.DATA_VENDA) AS DT
        FROM LOJA_VENDA v WITH (NOLOCK)
        JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
        WHERE RTRIM(LTRIM(CAST(ISNULL(f.FILIAL, '') AS VARCHAR(120)))) = '${filialSql}'
          AND vp.QTDE_CANCELADA = 0
          AND ISNULL(vp.NAO_MOVIMENTA_ESTOQUE, 0) = 0
          AND vp.PRODUTO IS NOT NULL
        GROUP BY
          RTRIM(LTRIM(CAST(vp.PRODUTO AS VARCHAR(50)))),
          RTRIM(LTRIM(ISNULL(CAST(vp.COR_PRODUTO AS VARCHAR(20)), '')))
      ),
      ranked AS (
        SELECT
          b.PRODUTO,
          b.COR,
          b.DT,
          ROW_NUMBER() OVER (PARTITION BY b.PRODUTO ORDER BY b.DT DESC) AS RN
        FROM base b
      )
      SELECT
        r.PRODUTO,
        r.COR,
        p.DESC_PRODUTO,
        r.DT AS ULTIMO_MOVIMENTO,
        COUNT(*) OVER() AS TOTAL
      FROM ranked r
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = r.PRODUTO
      WHERE r.RN = 1
        ${qFilter}
      ORDER BY r.DT DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${pageSize} ROWS ONLY
    `);

    const total = rows.length > 0 ? Number(rows[0].TOTAL ?? 0) : 0;
    const items: ProdutoAtivoItem[] = rows.map((r) => ({
      produto: trimValue(r.PRODUTO),
      cor: trimValue(r.COR),
      descProduto: trimValue(r.DESC_PRODUTO) || null,
      ultimoMovimento: r.ULTIMO_MOVIMENTO
        ? new Date(r.ULTIMO_MOVIMENTO).toISOString()
        : "",
    }));

    const response: ProdutosAtivosResponse = {
      filial,
      page,
      pageSize,
      total,
      items,
    };

    return NextResponse.json(
      response,
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Erro ao listar produtos: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

