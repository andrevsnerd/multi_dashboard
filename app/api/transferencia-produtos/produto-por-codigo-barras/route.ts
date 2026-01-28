import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import sql from 'mssql';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const codigoBarras = searchParams.get('codigoBarras');

  if (!codigoBarras || !codigoBarras.trim()) {
    return NextResponse.json({ data: null });
  }

  try {
    const produto = await withRequest(async (req) => {
      const codigoLimpo = codigoBarras.trim();
      
      // Log para debug
      console.log(`[CÓDIGO BARRAS] Buscando: "${codigoLimpo}" (len=${codigoLimpo.length}, original="${codigoBarras}")`);
      
      // Buscar igual ao script Python: WHERE pb.CODIGO_BARRA = ? com codigo_limpo = str(codigo_barras).strip()
      // IMPORTANTE: O código no banco tem espaços à direita, então usar RTRIM para comparar
      const query = `
        SELECT DISTINCT
          pb.PRODUTO,
          p.DESC_PRODUTO,
          p.GRUPO_PRODUTO,
          p.SUBGRUPO_PRODUTO,
          p.LINHA,
          pb.COR_PRODUTO,
          pb.TAMANHO,
          pb.CODIGO_BARRA
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
        WHERE RTRIM(pb.CODIGO_BARRA) = @codigoBarras
           OR pb.CODIGO_BARRA = @codigoBarras
      `;

      req.input('codigoBarras', sql.VarChar, codigoLimpo);

      const result = await req.query<{
        PRODUTO: string;
        DESC_PRODUTO: string | null;
        GRUPO_PRODUTO: string | null;
        SUBGRUPO_PRODUTO: string | null;
        LINHA: string | null;
        COR_PRODUTO: string | null;
        TAMANHO: string | null;
        CODIGO_BARRA: string | null;
      }>(query);

      if (result.recordset.length === 0) {
        // Debug: tentar buscar com LIKE para ver se o código existe de outra forma
        const queryDebug = `
          SELECT TOP 10 
            pb.CODIGO_BARRA, 
            LEN(pb.CODIGO_BARRA) as LEN_CODIGO, 
            pb.PRODUTO,
            p.DESC_PRODUTO,
            ASCII(LEFT(pb.CODIGO_BARRA, 1)) as FIRST_CHAR_ASCII,
            ASCII(RIGHT(pb.CODIGO_BARRA, 1)) as LAST_CHAR_ASCII
          FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
          WHERE pb.CODIGO_BARRA LIKE '%' + @codigoBarras + '%'
             OR LTRIM(RTRIM(pb.CODIGO_BARRA)) LIKE '%' + LTRIM(RTRIM(@codigoBarras)) + '%'
             OR REPLACE(pb.CODIGO_BARRA, ' ', '') LIKE '%' + REPLACE(@codigoBarras, ' ', '') + '%'
          ORDER BY 
            CASE 
              WHEN pb.CODIGO_BARRA = @codigoBarras THEN 1
              WHEN LTRIM(RTRIM(pb.CODIGO_BARRA)) = LTRIM(RTRIM(@codigoBarras)) THEN 2
              WHEN REPLACE(pb.CODIGO_BARRA, ' ', '') = REPLACE(@codigoBarras, ' ', '') THEN 3
              ELSE 4
            END
        `;
        try {
          const debugResult = await req.query(queryDebug);
          if (debugResult.recordset.length > 0) {
            console.log(`[DEBUG CÓDIGO BARRAS] Busca exata não encontrou: "${codigoLimpo}" (len=${codigoLimpo.length})`);
            console.log(`[DEBUG CÓDIGO BARRAS] Códigos similares encontrados (${debugResult.recordset.length}):`);
            debugResult.recordset.forEach((r, idx) => {
              const codigo = r.CODIGO_BARRA?.toString() || '';
              console.log(`  ${idx + 1}. Código: "${codigo}" (len=${r.LEN_CODIGO}) | Produto: ${r.PRODUTO} | Desc: ${r.DESC_PRODUTO?.substring(0, 30)}`);
              console.log(`     Primeiro char ASCII: ${r.FIRST_CHAR_ASCII}, Último char ASCII: ${r.LAST_CHAR_ASCII}`);
            });
          } else {
            console.log(`[DEBUG CÓDIGO BARRAS] Nenhum código similar encontrado para: "${codigoLimpo}"`);
          }
        } catch (e) {
          console.error('[DEBUG CÓDIGO BARRAS] Erro ao fazer debug:', e);
        }
        return null;
      }

      // Retornar o primeiro produto encontrado (igual ao script)
      const row = result.recordset[0];
      return {
        produto: row.PRODUTO?.toString().trim() || '',
        descProduto: row.DESC_PRODUTO?.toString().trim() || '',
        grupoProduto: row.GRUPO_PRODUTO?.toString().trim() || null,
        subgrupoProduto: row.SUBGRUPO_PRODUTO?.toString().trim() || null,
        linha: row.LINHA?.toString().trim() || null,
        corProduto: row.COR_PRODUTO?.toString().trim() || null,
        tamanho: row.TAMANHO?.toString().trim() || null,
        codigoBarra: row.CODIGO_BARRA?.toString().trim() || null,
        produtosEncontrados: result.recordset.length, // Para avisar se há múltiplos
        todosProdutos: result.recordset.map(r => ({
          produto: r.PRODUTO?.toString().trim() || '',
          cor: r.COR_PRODUTO?.toString().trim() || '(sem cor)',
          tamanho: r.TAMANHO?.toString().trim() || '(sem tamanho)',
        })),
      };
    });

    return NextResponse.json({ data: produto });
  } catch (error) {
    console.error('Erro ao buscar produto por código de barras', error);
    return NextResponse.json(
      { error: 'Erro ao buscar produto por código de barras' },
      { status: 500 }
    );
  }
}
