import { NextResponse } from 'next/server';
import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import { getActiveFilial } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { getMappedColorDescription } from '@/lib/utils/colorMapping';

export const maxDuration = 30;

/**
 * BIPAGEM — resolve um código de barras direto no item pronto para entrar na lista
 * de saída/entrada, em UMA única ida ao banco.
 *
 * O modal de "Adicionar Produto" resolve o código em dois passos no cliente
 * (`produto-por-codigo-barras` → `produtos`), o que é aceitável quando se digita,
 * mas lento demais quando o operador está bipando peça atrás de peça. Aqui a
 * consulta já devolve produto + cor + descrição + saldo NA FILIAL da operação.
 *
 * A operação (romaneio) é por produto × cor — o TAMANHO do código de barras não
 * entra. Por isso o desempate de ambiguidade é feito sobre produto+cor: dois
 * tamanhos do mesmo produto/cor com o mesmo código NÃO são ambíguos.
 *
 * GET /api/transferencia-produtos/bipar?codigoBarras=044428&filial=NERD%20TIJUCA&company=nerd
 *
 * Respostas (sempre HTTP 200, o status vem no corpo):
 *  - { status: 'ok', item }              → pronto para adicionar
 *  - { status: 'sem_estoque', item }     → existe, mas saldo 0 na filial (bloqueia saída)
 *  - { status: 'ambiguo', opcoes }       → o código cai em mais de um produto×cor
 *  - { status: 'nao_encontrado' }        → nenhum produto com esse código
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const codigoBarras = (searchParams.get('codigoBarras') || '').trim();
  const filialParam = (searchParams.get('filial') || '').trim();
  const company = await resolveCompanyDynamic(searchParams.get('company') || undefined);
  // Estoque mora sempre na perna ATIVA do grupo (rodízio fiscal): nunca no rótulo lógico.
  const filial = filialParam ? getActiveFilial(company, filialParam) : '';

  if (!codigoBarras) {
    return NextResponse.json({ status: 'nao_encontrado', item: null, opcoes: [] });
  }

  if (!filial) {
    return NextResponse.json({ error: 'Parâmetro "filial" é obrigatório.' }, { status: 400 });
  }

  try {
    const linhas = await withRequest(async (req) => {
      req.input('codigoBarras', sql.VarChar, codigoBarras);
      req.input('filial', sql.VarChar, filial);

      const query = `
        ;WITH barras AS (
          SELECT DISTINCT
            RTRIM(LTRIM(CAST(pb.PRODUTO AS VARCHAR(50))))     AS PRODUTO,
            RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
          FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = LTRIM(RTRIM(@codigoBarras))
             OR (
               TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) IS NOT NULL
               AND TRY_CONVERT(BIGINT, LTRIM(RTRIM(@codigoBarras))) IS NOT NULL
               AND TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))))
                   = TRY_CONVERT(BIGINT, LTRIM(RTRIM(@codigoBarras)))
             )
        )
        SELECT TOP 20
          b.PRODUTO,
          b.COR_PRODUTO,
          ISNULL(p.DESC_PRODUTO, '')                        AS DESC_PRODUTO,
          ISNULL(c.DESC_COR, '')                            AS DESC_COR,
          ISNULL(est.ESTOQUE, 0)                            AS ESTOQUE,
          ISNULL(CONVERT(VARCHAR(50), p.GRADE), '')         AS GRADE
        FROM barras b
        LEFT JOIN PRODUTOS p WITH (NOLOCK)
          ON RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) = b.PRODUTO
        LEFT JOIN (
          SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
          FROM PRODUTO_CORES WITH (NOLOCK)
          GROUP BY PRODUTO, COR_PRODUTO
        ) c
          ON RTRIM(LTRIM(CAST(c.PRODUTO AS VARCHAR(50)))) = b.PRODUTO
         AND (
           RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = b.COR_PRODUTO
           OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, b.COR_PRODUTO)
         )
        LEFT JOIN (
          SELECT
            RTRIM(LTRIM(CAST(e.PRODUTO AS VARCHAR(50))))     AS PRODUTO,
            RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO,
            SUM(ISNULL(e.ESTOQUE, 0))                        AS ESTOQUE
          FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
          WHERE RTRIM(LTRIM(CAST(e.FILIAL AS VARCHAR(100)))) = RTRIM(LTRIM(@filial))
          GROUP BY
            RTRIM(LTRIM(CAST(e.PRODUTO AS VARCHAR(50)))),
            RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20))))
        ) est
          ON est.PRODUTO = b.PRODUTO
         AND est.COR_PRODUTO = b.COR_PRODUTO
        ORDER BY b.PRODUTO, b.COR_PRODUTO
      `;

      const result = await req.query<{
        PRODUTO: string;
        COR_PRODUTO: string | null;
        DESC_PRODUTO: string | null;
        DESC_COR: string | null;
        ESTOQUE: number | null;
        GRADE: string | null;
      }>(query);

      return result.recordset;
    });

    const opcoes = linhas.map((row) => {
      const cor = row.COR_PRODUTO?.toString().trim() || '';
      // Descrição de cor é escopada POR PRODUTO (PRODUTO_CORES); o mapa global
      // só entra quando o cadastro do produto não traz descrição própria.
      const descCorBanco = row.DESC_COR?.toString().trim() || '';
      return {
        produto: row.PRODUTO?.toString().trim() || '',
        descProduto: row.DESC_PRODUTO?.toString().trim() || '',
        corProduto: cor || null,
        descCor: descCorBanco || getMappedColorDescription(cor || undefined),
        codigoBarra: codigoBarras,
        grade: row.GRADE?.toString().trim() || null,
        estoque: Number(row.ESTOQUE ?? 0) || 0,
        filial,
      };
    });

    if (opcoes.length === 0) {
      return NextResponse.json({ status: 'nao_encontrado', item: null, opcoes: [] });
    }

    if (opcoes.length > 1) {
      return NextResponse.json({ status: 'ambiguo', item: null, opcoes });
    }

    const item = opcoes[0];
    return NextResponse.json({
      status: item.estoque > 0 ? 'ok' : 'sem_estoque',
      item,
      opcoes,
    });
  } catch (error) {
    console.error('Erro ao bipar código de barras', error);
    return NextResponse.json({ error: 'Erro ao consultar o código de barras' }, { status: 500 });
  }
}
