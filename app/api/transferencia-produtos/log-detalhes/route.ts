import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import sql from 'mssql';

interface LogDetalheItem {
  produto: string;
  corProduto: string | null;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  subgrupo: string;
  grade: string;
  qtde: number;
  estoqueOrigem: number;
  estoqueDestino: number;
  filialOrigem?: string;
  filialDestino?: string;
  destino?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get('tipo'); // 'saida' | 'entrada' | 'transito'
  const romaneio = searchParams.get('romaneio')?.trim();
  const filialOrigem = searchParams.get('filialOrigem')?.trim();
  const filialDestino = searchParams.get('filialDestino')?.trim();

  if (!tipo || !romaneio) {
    return NextResponse.json(
      { error: 'Parâmetros obrigatórios: tipo, romaneio' },
      { status: 400 }
    );
  }
  
  // Para entradas isoladas, filialOrigem pode estar vazio
  // Para saídas isoladas, filialDestino pode estar vazio (representado como '—')
  const isEntradaLike = tipo === 'entrada' || tipo === 'transito';
  const isEntradaIsolada = isEntradaLike && (!filialOrigem || filialOrigem.trim() === '' || filialOrigem === '—');
  const isSaidaIsolada = tipo === 'saida' && (!filialDestino || filialDestino.trim() === '' || filialDestino === '—');
  
  // Validação: para entradas, filialDestino é obrigatório; para saídas, filialOrigem é obrigatório
  if (isEntradaLike && !filialDestino) {
    return NextResponse.json(
      { error: 'Parâmetro obrigatório para entrada: filialDestino' },
      { status: 400 }
    );
  }
  if (tipo === 'saida' && !filialOrigem) {
    return NextResponse.json(
      { error: 'Parâmetro obrigatório para saída: filialOrigem' },
      { status: 400 }
    );
  }

  if (tipo !== 'saida' && tipo !== 'entrada' && tipo !== 'transito') {
    return NextResponse.json({ error: 'tipo deve ser "saida", "entrada" ou "transito"' }, { status: 400 });
  }

  try {
    // Para entradas isoladas, filialOrigem pode estar vazio
    // Para saídas isoladas, filialDestino pode estar vazio (representado como '—')
    const fo = (filialOrigem || '').trim();
    const fd = (filialDestino || '').trim();

    const filiaisMap = await withRequest(async (reqF) => {
      // Para entradas isoladas, só buscar filialDestino
      // Para saídas isoladas, só buscar filialOrigem
      let q: string;
      if (isEntradaIsolada) {
        q = `
          SELECT LTRIM(RTRIM(COD_FILIAL)) AS COD_FILIAL, LTRIM(RTRIM(FILIAL)) AS FILIAL
          FROM FILIAIS WITH (NOLOCK)
          WHERE LTRIM(RTRIM(COD_FILIAL)) = @fd
             OR LTRIM(RTRIM(FILIAL)) = @fd
        `;
        reqF.input('fd', sql.VarChar, fd);
      } else if (isSaidaIsolada) {
        q = `
          SELECT LTRIM(RTRIM(COD_FILIAL)) AS COD_FILIAL, LTRIM(RTRIM(FILIAL)) AS FILIAL
          FROM FILIAIS WITH (NOLOCK)
          WHERE LTRIM(RTRIM(COD_FILIAL)) = @fo
             OR LTRIM(RTRIM(FILIAL)) = @fo
        `;
        reqF.input('fo', sql.VarChar, fo);
      } else {
        q = `
          SELECT LTRIM(RTRIM(COD_FILIAL)) AS COD_FILIAL, LTRIM(RTRIM(FILIAL)) AS FILIAL
          FROM FILIAIS WITH (NOLOCK)
          WHERE LTRIM(RTRIM(COD_FILIAL)) IN (@fo, @fd)
             OR LTRIM(RTRIM(FILIAL)) IN (@fo, @fd)
        `;
        reqF.input('fo', sql.VarChar, fo);
        reqF.input('fd', sql.VarChar, fd);
      }
      const res = await reqF.query<{ COD_FILIAL: string; FILIAL: string }>(q);
      const m = new Map<string, string>();
      for (const r of res.recordset) {
        const cod = r.COD_FILIAL?.toString().trim() ?? '';
        const nom = r.FILIAL?.toString().trim() ?? '';
        if (cod) m.set(cod, nom);
        if (nom) m.set(nom, nom);
      }
      return m;
    });

    // Para entradas isoladas, não há filialOrigem
    // Para saídas isoladas, não há filialDestino
    const nomeOrigem = isEntradaIsolada ? '—' : (filiaisMap.get(fo) ?? fo);
    const nomeDestino = isSaidaIsolada ? '—' : (filiaisMap.get(fd) ?? fd);

    const items = await withRequest(async (req) => {
      let itemsQuery: string;
      if (tipo === 'saida') {
        // Para saídas, usar UNION para buscar de LOJA_SAIDAS_PRODUTO ou ESTOQUE_PROD1_SAI
        itemsQuery = `
          SELECT
            sp.PRODUTO,
            sp.COR_PRODUTO,
            sp.QTDE_SAIDA AS QTDE,
            ISNULL(p.DESC_PRODUTO, '') AS DESC_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            (SELECT TOP 1 pb2.CODIGO_BARRA FROM PRODUTOS_BARRA pb2 WITH (NOLOCK)
             WHERE pb2.PRODUTO = sp.PRODUTO AND (ISNULL(pb2.COR_PRODUTO,'') = ISNULL(sp.COR_PRODUTO,''))) AS CODIGO_BARRA,
            ISNULL(p.SUBGRUPO_PRODUTO, '') AS SUBGRUPO,
            ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS GRADE
          FROM LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = sp.PRODUTO
          LEFT JOIN (
            SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
            FROM PRODUTO_CORES WITH (NOLOCK)
            GROUP BY PRODUTO, COR_PRODUTO
          ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(sp.PRODUTO))
             AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(sp.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, sp.COR_PRODUTO))
          WHERE sp.ROMANEIO_PRODUTO = @romaneio AND sp.FILIAL = @filialOrigem
          UNION ALL
          SELECT
            ep.PRODUTO,
            ep.COR_PRODUTO,
            ep.QTDE AS QTDE,
            ISNULL(p2.DESC_PRODUTO, '') AS DESC_PRODUTO,
            ISNULL(c2.DESC_COR, '') AS DESC_COR,
            (SELECT TOP 1 pb3.CODIGO_BARRA FROM PRODUTOS_BARRA pb3 WITH (NOLOCK)
             WHERE pb3.PRODUTO = ep.PRODUTO AND (ISNULL(pb3.COR_PRODUTO,'') = ISNULL(ep.COR_PRODUTO,''))) AS CODIGO_BARRA,
            ISNULL(p2.SUBGRUPO_PRODUTO, '') AS SUBGRUPO,
            ISNULL(CONVERT(VARCHAR, p2.GRADE), '') AS GRADE
          FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
          LEFT JOIN PRODUTOS p2 WITH (NOLOCK) ON p2.PRODUTO = ep.PRODUTO
          LEFT JOIN (
            SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
            FROM PRODUTO_CORES WITH (NOLOCK)
            GROUP BY PRODUTO, COR_PRODUTO
          ) c2 ON RTRIM(LTRIM(c2.PRODUTO)) = RTRIM(LTRIM(ep.PRODUTO))
             AND (RTRIM(LTRIM(CAST(c2.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c2.COR_PRODUTO) = TRY_CONVERT(INT, ep.COR_PRODUTO))
          WHERE ep.ROMANEIO_PRODUTO = @romaneio AND ep.FILIAL = @filialOrigem
            AND NOT EXISTS (
              SELECT 1 FROM LOJA_SAIDAS_PRODUTO sp2 WITH (NOLOCK)
              WHERE sp2.ROMANEIO_PRODUTO = ep.ROMANEIO_PRODUTO 
                AND sp2.FILIAL = ep.FILIAL
                AND sp2.PRODUTO = ep.PRODUTO
                AND ISNULL(sp2.COR_PRODUTO, '') = ISNULL(ep.COR_PRODUTO, '')
            )
        `;
      } else {
        // Para entradas: ESTOQUE_PROD1_ENT + itens que existem só em LOJA_ENTRADAS_PRODUTO
        itemsQuery = `
          SELECT
            ep.PRODUTO,
            ep.COR_PRODUTO,
            ep.QTDE,
            ISNULL(p.DESC_PRODUTO, '') AS DESC_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            (SELECT TOP 1 pb2.CODIGO_BARRA FROM PRODUTOS_BARRA pb2 WITH (NOLOCK)
             WHERE pb2.PRODUTO = ep.PRODUTO AND (ISNULL(pb2.COR_PRODUTO,'') = ISNULL(ep.COR_PRODUTO,''))) AS CODIGO_BARRA,
            ISNULL(p.SUBGRUPO_PRODUTO, '') AS SUBGRUPO,
            ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS GRADE
          FROM ESTOQUE_PROD1_ENT ep WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = ep.PRODUTO
          LEFT JOIN (
            SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
            FROM PRODUTO_CORES WITH (NOLOCK)
            GROUP BY PRODUTO, COR_PRODUTO
          ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(ep.PRODUTO))
             AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, ep.COR_PRODUTO))
          WHERE ep.ROMANEIO_PRODUTO = @romaneio AND ep.FILIAL = @filialDestino
          UNION ALL
          SELECT
            lep.PRODUTO,
            lep.COR_PRODUTO,
            ISNULL(lep.QTDE_ENTRADA, 0) AS QTDE,
            ISNULL(p2.DESC_PRODUTO, '') AS DESC_PRODUTO,
            ISNULL(c2.DESC_COR, '') AS DESC_COR,
            (SELECT TOP 1 pb3.CODIGO_BARRA FROM PRODUTOS_BARRA pb3 WITH (NOLOCK)
             WHERE pb3.PRODUTO = lep.PRODUTO AND (ISNULL(pb3.COR_PRODUTO,'') = ISNULL(lep.COR_PRODUTO,''))) AS CODIGO_BARRA,
            ISNULL(p2.SUBGRUPO_PRODUTO, '') AS SUBGRUPO,
            ISNULL(CONVERT(VARCHAR, p2.GRADE), '') AS GRADE
          FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
          LEFT JOIN PRODUTOS p2 WITH (NOLOCK) ON p2.PRODUTO = lep.PRODUTO
          LEFT JOIN (
            SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
            FROM PRODUTO_CORES WITH (NOLOCK)
            GROUP BY PRODUTO, COR_PRODUTO
          ) c2 ON RTRIM(LTRIM(c2.PRODUTO)) = RTRIM(LTRIM(lep.PRODUTO))
             AND (RTRIM(LTRIM(CAST(c2.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(lep.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c2.COR_PRODUTO) = TRY_CONVERT(INT, lep.COR_PRODUTO))
          WHERE lep.ROMANEIO_PRODUTO = @romaneio AND lep.FILIAL = @filialDestino
            AND NOT EXISTS (
              SELECT 1 FROM ESTOQUE_PROD1_ENT ep2 WITH (NOLOCK)
              WHERE ep2.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO AND ep2.FILIAL = lep.FILIAL
                AND ep2.PRODUTO = lep.PRODUTO AND ISNULL(ep2.COR_PRODUTO, '') = ISNULL(lep.COR_PRODUTO, '')
            )
        `;
      }

      req.input('romaneio', sql.VarChar, romaneio);
      req.input('filialOrigem', sql.VarChar, filialOrigem);
      req.input('filialDestino', sql.VarChar, filialDestino);

      const itemsResult = await req.query<{
        PRODUTO: string;
        COR_PRODUTO: string | null;
        QTDE: number;
        DESC_PRODUTO: string;
        DESC_COR: string;
        CODIGO_BARRA: string | null;
        SUBGRUPO: string;
        GRADE: string;
      }>(itemsQuery);

      return itemsResult.recordset;
    });

    const stockData = await withRequest(async (reqStock) => {
      // Para entradas isoladas, só buscar estoque da filialDestino
      // Para saídas isoladas, só buscar estoque da filialOrigem
      let q: string;
      if (isEntradaIsolada) {
        q = `
          SELECT
            ep.PRODUTO,
            LTRIM(RTRIM(ISNULL(ep.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(f.FILIAL)) AS FILIAL,
            LTRIM(RTRIM(f.COD_FILIAL)) AS COD_FILIAL,
            SUM(ISNULL(ep.ESTOQUE, 0)) AS ESTOQUE
          FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
          INNER JOIN FILIAIS f WITH (NOLOCK)
            ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
          WHERE LTRIM(RTRIM(f.COD_FILIAL)) = @fd
             OR LTRIM(RTRIM(f.FILIAL)) = @fd
          GROUP BY ep.PRODUTO, ep.COR_PRODUTO, f.FILIAL, f.COD_FILIAL
        `;
        reqStock.input('fd', sql.VarChar, fd);
      } else if (isSaidaIsolada) {
        q = `
          SELECT
            ep.PRODUTO,
            LTRIM(RTRIM(ISNULL(ep.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(f.FILIAL)) AS FILIAL,
            LTRIM(RTRIM(f.COD_FILIAL)) AS COD_FILIAL,
            SUM(ISNULL(ep.ESTOQUE, 0)) AS ESTOQUE
          FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
          INNER JOIN FILIAIS f WITH (NOLOCK)
            ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
          WHERE LTRIM(RTRIM(f.COD_FILIAL)) = @fo
             OR LTRIM(RTRIM(f.FILIAL)) = @fo
          GROUP BY ep.PRODUTO, ep.COR_PRODUTO, f.FILIAL, f.COD_FILIAL
        `;
        reqStock.input('fo', sql.VarChar, fo);
      } else {
        q = `
          SELECT
            ep.PRODUTO,
            LTRIM(RTRIM(ISNULL(ep.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(f.FILIAL)) AS FILIAL,
            LTRIM(RTRIM(f.COD_FILIAL)) AS COD_FILIAL,
            SUM(ISNULL(ep.ESTOQUE, 0)) AS ESTOQUE
          FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
          INNER JOIN FILIAIS f WITH (NOLOCK)
            ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
          WHERE LTRIM(RTRIM(f.COD_FILIAL)) IN (@fo, @fd)
             OR LTRIM(RTRIM(f.FILIAL)) IN (@fo, @fd)
          GROUP BY ep.PRODUTO, ep.COR_PRODUTO, f.FILIAL, f.COD_FILIAL
        `;
        reqStock.input('fo', sql.VarChar, fo);
        reqStock.input('fd', sql.VarChar, fd);
      }
      const res = await reqStock.query<{ PRODUTO: string; COR_PRODUTO: string; FILIAL: string; COD_FILIAL: string; ESTOQUE: number }>(q);
      return res.recordset;
    });

    const stockMap = new Map<string, number>();
    for (const s of stockData) {
      const prod = (s.PRODUTO ?? '').toString().trim();
      const cor = (s.COR_PRODUTO ?? '').toString().trim();
      const fil = (s.FILIAL ?? '').toString().trim();
      const cod = (s.COD_FILIAL ?? '').toString().trim();
      const est = Number(s.ESTOQUE) || 0;
      const pkFil = `${prod}|${cor}|${fil}`;
      const pkCod = `${prod}|${cor}|${cod}`;
      stockMap.set(pkFil, (stockMap.get(pkFil) ?? 0) + est);
      if (cod) stockMap.set(pkCod, (stockMap.get(pkCod) ?? 0) + est);
    }

    const rows = items as Array<{
      PRODUTO?: string;
      COR_PRODUTO?: string | null;
      QTDE?: number;
      DESC_PRODUTO?: string;
      DESC_COR?: string;
      CODIGO_BARRA?: string | null;
      SUBGRUPO?: string;
      GRADE?: string;
    }>;

    if (rows.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const detalhes: LogDetalheItem[] = rows.map((row) => {
      const produto = row.PRODUTO?.toString().trim() ?? '';
      const corRaw = row.COR_PRODUTO?.toString().trim();
      const cor = corRaw || '';
      // Para entradas isoladas, não há filialOrigem, então estoqueOrigem = 0
      // Para saídas isoladas, não há filialDestino, então estoqueDestino = 0
      const keyOrigemNome = isEntradaIsolada ? '' : `${produto}|${cor}|${nomeOrigem}`;
      const keyDestinoNome = isSaidaIsolada ? '' : `${produto}|${cor}|${nomeDestino}`;
      const keyOrigemCod = isEntradaIsolada ? '' : `${produto}|${cor}|${fo}`;
      const keyDestinoCod = isSaidaIsolada ? '' : `${produto}|${cor}|${fd}`;
      const estoqueOrigem = isEntradaIsolada ? 0 : (stockMap.get(keyOrigemNome) ?? stockMap.get(keyOrigemCod) ?? 0);
      const estoqueDestino = isSaidaIsolada ? 0 : (stockMap.get(keyDestinoNome) ?? stockMap.get(keyDestinoCod) ?? 0);
      const destinoDisplay = nomeDestino && nomeDestino !== '—' ? nomeDestino : '';
      return {
        produto,
        corProduto: cor || null,
        descProduto: row.DESC_PRODUTO?.toString().trim() ?? '',
        descCor: row.DESC_COR?.toString().trim() ?? '',
        codigoBarra: row.CODIGO_BARRA?.toString().trim() || null,
        subgrupo: row.SUBGRUPO?.toString().trim() ?? '',
        grade: row.GRADE?.toString().trim() ?? '',
        qtde: Number(row.QTDE) || 0,
        estoqueOrigem,
        estoqueDestino,
        filialOrigem: nomeOrigem,
        filialDestino: nomeDestino,
        destino: destinoDisplay,
      };
    });

    return NextResponse.json({ data: detalhes });
  } catch (error) {
    console.error('Erro ao buscar detalhes do log', error);
    return NextResponse.json(
      { error: 'Erro ao buscar detalhes do log' },
      { status: 500 }
    );
  }
}
