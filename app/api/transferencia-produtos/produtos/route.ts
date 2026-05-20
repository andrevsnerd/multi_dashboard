import { NextResponse } from 'next/server';
import { getPublicDatabaseErrorMessage, isDatabaseConnectionError, withRequest } from '@/lib/db/connection';
import sql from 'mssql';
import { getMappedColorDescription } from '@/lib/utils/colorMapping';
import { getActiveFilial, resolveCompany } from '@/lib/config/company';

export const maxDuration = 60;

function normalizeBarcode(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function barcodeMatchesSearch(barcode: string | null | undefined, searchTerm: string): boolean {
  const barcodeNorm = normalizeBarcode(barcode);
  const searchNorm = normalizeBarcode(searchTerm);

  if (!barcodeNorm || !searchNorm) {
    return false;
  }

  if (barcodeNorm === searchNorm) {
    return true;
  }

  const barcodeNum = Number(barcodeNorm);
  const searchNum = Number(searchNorm);

  return Number.isFinite(barcodeNum) && Number.isFinite(searchNum) && barcodeNum === searchNum;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const searchTerm = searchParams.get('q') || '';
  const barcodeHint = searchParams.get('barcodeHint') || '';
  const filialOrigem = searchParams.get('filialOrigem');
  const company = resolveCompany(searchParams.get('company') || undefined);
  const filialOperacional = filialOrigem ? getActiveFilial(company, filialOrigem) : null;
  const corProduto = searchParams.get('corProduto'); // Para filtrar quando encontrado por código de barras
  const isEntrada = searchParams.get('entrada') === 'true';
  const porColecao = searchParams.get('porColecao') === 'true';
  const colecaoFiltro = (searchParams.get('colecao') || '').trim();
  const porGrade = searchParams.get('porGrade') === 'true';
  const gradeFiltro = (searchParams.get('grade') || '').trim();

  if ((porColecao || porGrade) && company?.key !== 'scarfme') {
    return NextResponse.json(
      { error: 'Importação por coleção/grade disponível apenas para ScarfMe.' },
      { status: 400 }
    );
  }

  if (porColecao && company?.key === 'scarfme' && !colecaoFiltro) {
    return NextResponse.json({ data: [] });
  }

  if (porGrade && company?.key === 'scarfme' && !gradeFiltro) {
    return NextResponse.json({ data: [] });
  }

  if (!porColecao && !porGrade && (!searchTerm || searchTerm.trim().length < 2)) {
    return NextResponse.json({ data: [] });
  }

  try {
    const produtos = await withRequest(async (req) => {
      const searchTermTrimmed = searchTerm.trim();
      const barcodePriorityTerm = normalizeBarcode(barcodeHint) || searchTermTrimmed;
      const incluirEstoqueZero = isEntrada || porColecao || porGrade;
      
      // Buscar por código de barras primeiro, depois por produto/nome
      // Igual ao Python: busca código de barras, depois busca estoques do produto encontrado
      let query: string;
      
      if (porColecao && company?.key === 'scarfme') {
        query = `
          ;WITH base_produtos AS (
            SELECT DISTINCT p.PRODUTO
            FROM PRODUTOS p WITH (NOLOCK)
            WHERE UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = UPPER(LTRIM(RTRIM(@colecaoFiltro)))
          ),
          base_cores AS (
            SELECT DISTINCT
              pb.PRODUTO,
              RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
            FROM PRODUTOS_BARRA pb WITH (NOLOCK)
            INNER JOIN base_produtos bp ON bp.PRODUTO = pb.PRODUTO
            WHERE pb.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''

            UNION

            SELECT DISTINCT
              e.PRODUTO,
              RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
            FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
            INNER JOIN base_produtos bp ON bp.PRODUTO = e.PRODUTO
            WHERE e.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) <> ''
          )
          SELECT DISTINCT TOP 2500
            p.PRODUTO,
            bc.COR_PRODUTO,
            ${filialOperacional ? `@filialOrigemParam` : `ISNULL(es.FILIAL, '')`} AS FILIAL,
            ISNULL(es.ESTOQUE, 0) AS ESTOQUE,
            p.DESC_PRODUTO,
            ISNULL(p.LINHA, '') AS LINHA,
            ISNULL(p.SUBGRUPO_PRODUTO, '') AS SUBGRUPO,
            ISNULL(p.TIPO_PRODUTO, '') AS TIPO_PRODUTO,
            ISNULL(p.COLECAO, '') AS COLECAO,
            '' AS DESC_COLECAO,
            ISNULL(CONVERT(VARCHAR(50), p.GRADE), '') AS GRADE,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            ${filialOperacional ? `@filialOrigemParam` : `ISNULL(es.FILIAL, '')`} AS NOME_FILIAL,
            pb.CODIGO_BARRA
          FROM base_produtos bp
          INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = bp.PRODUTO
          LEFT JOIN base_cores bc ON bc.PRODUTO = p.PRODUTO
          LEFT JOIN ESTOQUE_PRODUTOS es WITH (NOLOCK)
            ON es.PRODUTO = p.PRODUTO
            AND (
              (bc.COR_PRODUTO IS NULL AND es.COR_PRODUTO IS NULL)
              OR RTRIM(LTRIM(CAST(es.COR_PRODUTO AS VARCHAR(20)))) = ISNULL(bc.COR_PRODUTO, RTRIM(LTRIM(CAST(es.COR_PRODUTO AS VARCHAR(20)))))
            )
            ${filialOperacional ? `AND RTRIM(LTRIM(CAST(es.FILIAL AS VARCHAR(100)))) = RTRIM(LTRIM(@filialOrigem))` : ``}
          LEFT JOIN PRODUTOS_BARRA pb WITH (NOLOCK)
            ON pb.PRODUTO = p.PRODUTO
            AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) = ISNULL(bc.COR_PRODUTO, RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))))
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = bc.COR_PRODUTO
        `;
        req.input('colecaoFiltro', sql.VarChar, colecaoFiltro);
        req.input('filialOrigemParam', sql.VarChar, filialOperacional?.trim() || '');
        if (filialOperacional) {
          req.input('filialOrigem', sql.VarChar, filialOperacional.trim());
        }
      } else if (porGrade && company?.key === 'scarfme') {
        query = `
          ;WITH base_produtos AS (
            SELECT DISTINCT p.PRODUTO
            FROM PRODUTOS p WITH (NOLOCK)
            WHERE UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(50), p.GRADE), '')))) = UPPER(LTRIM(RTRIM(@gradeFiltro)))
          ),
          base_cores AS (
            SELECT DISTINCT
              pb.PRODUTO,
              RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
            FROM PRODUTOS_BARRA pb WITH (NOLOCK)
            INNER JOIN base_produtos bp ON bp.PRODUTO = pb.PRODUTO
            WHERE pb.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''

            UNION

            SELECT DISTINCT
              e.PRODUTO,
              RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
            FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
            INNER JOIN base_produtos bp ON bp.PRODUTO = e.PRODUTO
            WHERE e.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) <> ''
          )
          SELECT DISTINCT TOP 2500
            p.PRODUTO,
            bc.COR_PRODUTO,
            ${filialOperacional ? `@filialOrigemParam` : `ISNULL(es.FILIAL, '')`} AS FILIAL,
            ISNULL(es.ESTOQUE, 0) AS ESTOQUE,
            p.DESC_PRODUTO,
            ISNULL(p.LINHA, '') AS LINHA,
            ISNULL(p.SUBGRUPO_PRODUTO, '') AS SUBGRUPO,
            ISNULL(p.TIPO_PRODUTO, '') AS TIPO_PRODUTO,
            ISNULL(p.COLECAO, '') AS COLECAO,
            '' AS DESC_COLECAO,
            ISNULL(CONVERT(VARCHAR(50), p.GRADE), '') AS GRADE,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            ${filialOperacional ? `@filialOrigemParam` : `ISNULL(es.FILIAL, '')`} AS NOME_FILIAL,
            pb.CODIGO_BARRA
          FROM base_produtos bp
          INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = bp.PRODUTO
          LEFT JOIN base_cores bc ON bc.PRODUTO = p.PRODUTO
          LEFT JOIN ESTOQUE_PRODUTOS es WITH (NOLOCK)
            ON es.PRODUTO = p.PRODUTO
            AND (
              (bc.COR_PRODUTO IS NULL AND es.COR_PRODUTO IS NULL)
              OR RTRIM(LTRIM(CAST(es.COR_PRODUTO AS VARCHAR(20)))) = ISNULL(bc.COR_PRODUTO, RTRIM(LTRIM(CAST(es.COR_PRODUTO AS VARCHAR(20)))))
            )
            ${filialOperacional ? `AND RTRIM(LTRIM(CAST(es.FILIAL AS VARCHAR(100)))) = RTRIM(LTRIM(@filialOrigem))` : ``}
          LEFT JOIN PRODUTOS_BARRA pb WITH (NOLOCK)
            ON pb.PRODUTO = p.PRODUTO
            AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) = ISNULL(bc.COR_PRODUTO, RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))))
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = bc.COR_PRODUTO
        `;
        req.input('gradeFiltro', sql.VarChar, gradeFiltro);
        req.input('filialOrigemParam', sql.VarChar, filialOperacional?.trim() || '');
        if (filialOperacional) {
          req.input('filialOrigem', sql.VarChar, filialOperacional.trim());
        }
      } else if (corProduto) {
        // Quando tem cor (do código de barras), buscar direto por produto e cor (igual ao Python)
        // O Python mostra TODAS as filiais, não filtra por filial origem
        // Usar RTRIM para evitar falha quando PRODUTO/COR são CHAR com espaços
        query = `
          SELECT
            e.PRODUTO,
            e.COR_PRODUTO,
            e.FILIAL AS FILIAL,
            e.ESTOQUE,
            p.DESC_PRODUTO,
            ISNULL(p.LINHA, '') AS LINHA,
            ISNULL(p.SUBGRUPO_PRODUTO, '') AS SUBGRUPO,
            ISNULL(p.TIPO_PRODUTO, '') AS TIPO_PRODUTO,
            ISNULL(p.COLECAO, '') AS COLECAO,
            '' AS DESC_COLECAO,
            ISNULL(CONVERT(VARCHAR(50), p.GRADE), '') AS GRADE,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            e.FILIAL AS NOME_FILIAL,
            pb.CODIGO_BARRA
          FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = e.PRODUTO
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = e.COR_PRODUTO
          LEFT JOIN PRODUTOS_BARRA pb WITH (NOLOCK) ON pb.PRODUTO = e.PRODUTO AND pb.COR_PRODUTO = e.COR_PRODUTO
          WHERE RTRIM(LTRIM(CAST(e.PRODUTO AS VARCHAR(50)))) = RTRIM(LTRIM(@searchTerm))
            AND RTRIM(LTRIM(ISNULL(CAST(e.COR_PRODUTO AS VARCHAR(20)), ''))) = RTRIM(LTRIM(ISNULL(@corProduto, '')))
        `;
        req.input('searchTerm', sql.VarChar, searchTermTrimmed);
        req.input('corProduto', sql.VarChar, corProduto);
        // NÃO filtrar por filial quando tem corProduto - mostrar TODAS as filiais (igual ao Python)
      } else if (isEntrada) {
        // Para entrada: mostrar cores cadastradas mesmo sem estoque.
        // Regra: a origem confiável de "cores cadastradas" é `PRODUTOS_BARRA` (produto+cor),
        // e o estoque é opcional (LEFT JOIN) apenas para exibir saldo na filial selecionada.
        const searchPattern = `%${searchTermTrimmed}%`;
        query = `
          ;WITH base_produtos AS (
            SELECT DISTINCT TOP 80
              p.PRODUTO
            FROM PRODUTOS p WITH (NOLOCK)
            LEFT JOIN PRODUTOS_BARRA pb0 WITH (NOLOCK) ON pb0.PRODUTO = p.PRODUTO
            WHERE (
              p.DESC_PRODUTO LIKE @searchPattern
              OR RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) LIKE @searchPattern
              OR LTRIM(RTRIM(CAST(pb0.CODIGO_BARRA AS VARCHAR(100)))) = LTRIM(RTRIM(@searchTermExato))
              OR (
                TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb0.CODIGO_BARRA AS VARCHAR(100))))) IS NOT NULL
                AND TRY_CONVERT(BIGINT, LTRIM(RTRIM(@searchTermExato))) IS NOT NULL
                AND TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb0.CODIGO_BARRA AS VARCHAR(100))))) = TRY_CONVERT(BIGINT, LTRIM(RTRIM(@searchTermExato)))
              )
            )
          ),
          base_cores AS (
            -- cores cadastradas (prioridade)
            SELECT DISTINCT
              pb.PRODUTO,
              RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
            FROM PRODUTOS_BARRA pb WITH (NOLOCK)
            INNER JOIN base_produtos bp ON bp.PRODUTO = pb.PRODUTO
            WHERE pb.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''

            UNION

            -- fallback: cores que existem em estoque (mesmo zeradas)
            SELECT DISTINCT
              e.PRODUTO,
              RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
            FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
            INNER JOIN base_produtos bp ON bp.PRODUTO = e.PRODUTO
            WHERE e.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) <> ''
          )
          SELECT DISTINCT TOP 200
            p.PRODUTO,
            bc.COR_PRODUTO,
            ${filialOperacional ? `@filialOrigemParam` : `ISNULL(es.FILIAL, '')`} AS FILIAL,
            ISNULL(es.ESTOQUE, 0) AS ESTOQUE,
            p.DESC_PRODUTO,
            ISNULL(p.LINHA, '') AS LINHA,
            ISNULL(p.SUBGRUPO_PRODUTO, '') AS SUBGRUPO,
            ISNULL(p.TIPO_PRODUTO, '') AS TIPO_PRODUTO,
            ISNULL(p.COLECAO, '') AS COLECAO,
            '' AS DESC_COLECAO,
            ISNULL(CONVERT(VARCHAR(50), p.GRADE), '') AS GRADE,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            ${filialOperacional ? `@filialOrigemParam` : `ISNULL(es.FILIAL, '')`} AS NOME_FILIAL,
            pb.CODIGO_BARRA
          FROM base_produtos bp
          INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = bp.PRODUTO
          LEFT JOIN base_cores bc ON bc.PRODUTO = p.PRODUTO
          LEFT JOIN ESTOQUE_PRODUTOS es WITH (NOLOCK)
            ON es.PRODUTO = p.PRODUTO
            AND (
              (bc.COR_PRODUTO IS NULL AND es.COR_PRODUTO IS NULL)
              OR RTRIM(LTRIM(CAST(es.COR_PRODUTO AS VARCHAR(20)))) = ISNULL(bc.COR_PRODUTO, RTRIM(LTRIM(CAST(es.COR_PRODUTO AS VARCHAR(20)))))
            )
            ${filialOperacional ? `AND RTRIM(LTRIM(CAST(es.FILIAL AS VARCHAR(100)))) = RTRIM(LTRIM(@filialOrigem))` : ``}
          LEFT JOIN PRODUTOS_BARRA pb WITH (NOLOCK)
            ON pb.PRODUTO = p.PRODUTO
            AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) = ISNULL(bc.COR_PRODUTO, RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))))
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = bc.COR_PRODUTO
        `;
        req.input('searchPattern', sql.VarChar, searchPattern);
        req.input('searchTermExato', sql.VarChar, searchTermTrimmed);
        req.input('filialOrigemParam', sql.VarChar, filialOperacional?.trim() || '');
        if (filialOperacional) {
          req.input('filialOrigem', sql.VarChar, filialOperacional.trim());
        }
      } else {
        // Buscar por código de barras OU nome/código do produto
        // Usar RTRIM/LTRIM e CAST para garantir match com campos CHAR ou numéricos no banco
        const searchPattern = `%${searchTermTrimmed}%`;
        query = `
          SELECT DISTINCT TOP 50
            e.PRODUTO,
            e.COR_PRODUTO,
            e.FILIAL AS FILIAL,
            e.ESTOQUE,
            p.DESC_PRODUTO,
            ISNULL(p.LINHA, '') AS LINHA,
            ISNULL(p.SUBGRUPO_PRODUTO, '') AS SUBGRUPO,
            ISNULL(p.TIPO_PRODUTO, '') AS TIPO_PRODUTO,
            ISNULL(p.COLECAO, '') AS COLECAO,
            '' AS DESC_COLECAO,
            ISNULL(CONVERT(VARCHAR(50), p.GRADE), '') AS GRADE,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            e.FILIAL AS NOME_FILIAL,
            pb.CODIGO_BARRA
          FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = e.PRODUTO
          LEFT JOIN PRODUTOS_BARRA pb WITH (NOLOCK) ON pb.PRODUTO = e.PRODUTO AND pb.COR_PRODUTO = e.COR_PRODUTO
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = e.COR_PRODUTO
          WHERE (
            p.DESC_PRODUTO LIKE @searchPattern
            OR RTRIM(LTRIM(CAST(e.PRODUTO AS VARCHAR(50)))) LIKE @searchPattern
            OR LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = LTRIM(RTRIM(@searchTermExato))
            OR (
              TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) IS NOT NULL
              AND TRY_CONVERT(BIGINT, LTRIM(RTRIM(@searchTermExato))) IS NOT NULL
              AND TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) = TRY_CONVERT(BIGINT, LTRIM(RTRIM(@searchTermExato)))
            )
          )
          AND e.ESTOQUE > 0
        `;
        req.input('searchPattern', sql.VarChar, searchPattern);
        req.input('searchTermExato', sql.VarChar, searchTermTrimmed);

        if (filialOperacional) {
          query += ` AND RTRIM(LTRIM(CAST(e.FILIAL AS VARCHAR(100)))) = RTRIM(LTRIM(@filialOrigem))`;
          req.input('filialOrigem', sql.VarChar, filialOperacional.trim());
        }
      }

      query += ` ORDER BY FILIAL, COR_PRODUTO`;

      console.log(`[PRODUTOS DEBUG] Query completa:`, query);
      console.log(`[PRODUTOS DEBUG] Params:`, { 
        searchTermTrimmed, 
        corProduto, 
        filialOrigem: filialOperacional || filialOrigem,
        searchTermLen: searchTermTrimmed.length,
        corProdutoLen: corProduto?.length,
        porColecao,
        colecaoFiltro: porColecao ? colecaoFiltro : undefined,
      });

      const result = await req.query<{
        PRODUTO: string;
        DESC_PRODUTO: string | null;
        LINHA: string | null;
        SUBGRUPO: string | null;
        TIPO_PRODUTO: string | null;
        COLECAO: string | null;
        DESC_COLECAO: string | null;
        GRADE: string | null;
        CODIGO_BARRA: string | null;
        COR_PRODUTO: string | null;
        FILIAL: string | null;
        ESTOQUE: number | null;
        DESC_COR: string | null;
        NOME_FILIAL: string | null;
      }>(query);

        console.log(`[PRODUTOS DEBUG] Resultados brutos: ${result.recordset.length} linhas`);
        if (result.recordset.length > 0) {
          console.log(`[PRODUTOS DEBUG] Primeira linha:`, {
            PRODUTO: result.recordset[0].PRODUTO,
            COR_PRODUTO: result.recordset[0].COR_PRODUTO,
            FILIAL: result.recordset[0].FILIAL,
            FILIAL_LEN: result.recordset[0].FILIAL?.toString().length,
            FILIAL_TRIM: result.recordset[0].FILIAL?.toString().trim(),
            NOME_FILIAL: result.recordset[0].NOME_FILIAL,
            ESTOQUE: result.recordset[0].ESTOQUE
          });
          // Log das primeiras 5 linhas para ver padrões
          console.log(`[PRODUTOS DEBUG] Primeiras 5 linhas FILIAL:`, 
            result.recordset.slice(0, 5).map(r => ({
              FILIAL: r.FILIAL?.toString().trim(),
              NOME_FILIAL: r.NOME_FILIAL?.toString().trim() || '(null)'
            }))
          );
        }

      // Agrupar por produto e cor, somando estoques
      const produtosMap = new Map<string, {
        produto: string;
        descProduto: string;
        linha: string | null;
        subgrupo: string | null;
        tipoProduto: string | null;
        colecao: string | null;
        descColecao: string | null;
        codigoBarra: string | null;
        corProduto: string | null;
        descCor: string;
        grade: string | null;
        estoquesMap: Map<string, {
          filial: string;
          nomeFilial: string;
          estoque: number;
        }>;
      }>();

      for (const row of result.recordset) {
        const produto = row.PRODUTO?.toString().trim() || '';
        const cor = row.COR_PRODUTO?.toString().trim() || '';
        const key = `${produto}::${cor}`;

        if (!produtosMap.has(key)) {
          const descCorResolvida = getMappedColorDescription(cor || undefined);
          produtosMap.set(key, {
            produto,
            descProduto: row.DESC_PRODUTO?.toString().trim() || '',
            linha: row.LINHA?.toString().trim() || null,
            subgrupo: row.SUBGRUPO?.toString().trim() || null,
            tipoProduto: row.TIPO_PRODUTO?.toString().trim() || null,
            colecao: row.COLECAO?.toString().trim() || null,
            descColecao: row.DESC_COLECAO?.toString().trim() || null,
            codigoBarra: normalizeBarcode(row.CODIGO_BARRA) || null,
            corProduto: cor || null,
            descCor: descCorResolvida,
            grade: row.GRADE?.toString().trim() || null,
            estoquesMap: new Map(),
          });
        }

        const produtoData = produtosMap.get(key)!;
        const codigoBarraLinha = normalizeBarcode(row.CODIGO_BARRA) || null;
        if (
          codigoBarraLinha &&
          (!produtoData.codigoBarra ||
            (barcodeMatchesSearch(codigoBarraLinha, barcodePriorityTerm) &&
              !barcodeMatchesSearch(produtoData.codigoBarra, barcodePriorityTerm)))
        ) {
          produtoData.codigoBarra = codigoBarraLinha;
        }
        // Quando tem corProduto (do código de barras) ou é entrada, mostrar TODOS os estoques (incluindo 0)
        // Quando não tem corProduto e não é entrada, só mostrar estoques > 0
        if (row.FILIAL) {
          const estoque = row.ESTOQUE !== null ? row.ESTOQUE : 0;
          if (corProduto || incluirEstoqueZero || estoque > 0) {
            // Usar COD_FILIAL se disponível, senão usar FILIAL (que deve ser o código)
            const codFilial = row.FILIAL?.toString().trim() || '';
            const estoqueExistente = produtoData.estoquesMap.get(codFilial);
            produtoData.estoquesMap.set(codFilial, {
              filial: codFilial,
              nomeFilial: row.NOME_FILIAL?.toString().trim() || estoqueExistente?.nomeFilial || codFilial,
              estoque: estoqueExistente ? Math.max(estoqueExistente.estoque, estoque) : estoque,
            });
          }
        }
      }

      const produtosArray = Array.from(produtosMap.values()).map((produto) => ({
        produto: produto.produto,
        descProduto: produto.descProduto,
        linha: produto.linha,
        subgrupo: produto.subgrupo,
        tipoProduto: produto.tipoProduto,
        colecao: produto.colecao,
        descColecao: produto.descColecao,
        codigoBarra: produto.codigoBarra,
        corProduto: produto.corProduto,
        descCor: produto.descCor,
        grade: produto.grade,
        estoques: Array.from(produto.estoquesMap.values()),
      }));
      console.log(`[PRODUTOS] Busca: "${searchTermTrimmed}", corProduto: ${corProduto || 'null'}, filialOrigem: ${filialOperacional || filialOrigem || 'null'}, encontrados: ${produtosArray.length}`);
      if (produtosArray.length > 0) {
        console.log(`[PRODUTOS] Primeiro produto:`, {
          produto: produtosArray[0].produto,
          cor: produtosArray[0].corProduto,
          estoques: produtosArray[0].estoques.length
        });
      }

      return produtosArray;
    });

    return NextResponse.json({ data: produtos });
  } catch (error) {
    console.error('Erro ao buscar produtos', error);
    const isDbUnavailable = isDatabaseConnectionError(error);
    return NextResponse.json(
      {
        error: isDbUnavailable ? getPublicDatabaseErrorMessage(error) : 'Erro ao buscar produtos',
      },
      { status: isDbUnavailable ? 503 : 500 }
    );
  }
}
