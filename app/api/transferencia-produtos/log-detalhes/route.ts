import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import sql from 'mssql';

interface LogDetalheItem {
  produto: string;
  corProduto: string | null;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  qtde: number;
  estoqueOrigem: number;
  estoqueDestino: number;
  filialOrigem?: string;
  filialDestino?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get('tipo'); // 'saida' | 'entrada'
  const romaneio = searchParams.get('romaneio')?.trim();
  const filialOrigem = searchParams.get('filialOrigem')?.trim();
  const filialDestino = searchParams.get('filialDestino')?.trim();

  if (!tipo || !romaneio || !filialOrigem || !filialDestino) {
    return NextResponse.json(
      { error: 'Parâmetros obrigatórios: tipo, romaneio, filialOrigem, filialDestino' },
      { status: 400 }
    );
  }

  if (tipo !== 'saida' && tipo !== 'entrada') {
    return NextResponse.json({ error: 'tipo deve ser "saida" ou "entrada"' }, { status: 400 });
  }

  try {
    const fo = filialOrigem.trim();
    const fd = filialDestino.trim();

    const filiaisMap = await withRequest(async (reqF) => {
      const q = `
        SELECT LTRIM(RTRIM(COD_FILIAL)) AS COD_FILIAL, LTRIM(RTRIM(FILIAL)) AS FILIAL
        FROM FILIAIS WITH (NOLOCK)
        WHERE LTRIM(RTRIM(COD_FILIAL)) IN (@fo, @fd)
           OR LTRIM(RTRIM(FILIAL)) IN (@fo, @fd)
      `;
      reqF.input('fo', sql.VarChar, fo);
      reqF.input('fd', sql.VarChar, fd);
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

    const nomeOrigem = filiaisMap.get(fo) ?? fo;
    const nomeDestino = filiaisMap.get(fd) ?? fd;

    const items = await withRequest(async (req) => {
      let itemsQuery: string;
      if (tipo === 'saida') {
        itemsQuery = `
          SELECT
            sp.PRODUTO,
            sp.COR_PRODUTO,
            sp.QTDE_SAIDA AS QTDE,
            ISNULL(p.DESC_PRODUTO, '') AS DESC_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            (SELECT TOP 1 pb2.CODIGO_BARRA FROM PRODUTOS_BARRA pb2 WITH (NOLOCK)
             WHERE pb2.PRODUTO = sp.PRODUTO AND (ISNULL(pb2.COR_PRODUTO,'') = ISNULL(sp.COR_PRODUTO,''))) AS CODIGO_BARRA
          FROM LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = sp.PRODUTO
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = sp.COR_PRODUTO
          WHERE sp.ROMANEIO_PRODUTO = @romaneio AND sp.FILIAL = @filialOrigem
        `;
      } else {
        itemsQuery = `
          SELECT
            ep.PRODUTO,
            ep.COR_PRODUTO,
            ep.QTDE,
            ISNULL(p.DESC_PRODUTO, '') AS DESC_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            (SELECT TOP 1 pb2.CODIGO_BARRA FROM PRODUTOS_BARRA pb2 WITH (NOLOCK)
             WHERE pb2.PRODUTO = ep.PRODUTO AND (ISNULL(pb2.COR_PRODUTO,'') = ISNULL(ep.COR_PRODUTO,''))) AS CODIGO_BARRA
          FROM ESTOQUE_PROD1_ENT ep WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = ep.PRODUTO
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = ep.COR_PRODUTO
          WHERE ep.ROMANEIO_PRODUTO = @romaneio AND ep.FILIAL = @filialDestino
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
      }>(itemsQuery);

      return itemsResult.recordset;
    });

    const stockData = await withRequest(async (reqStock) => {
      reqStock.input('fo', sql.VarChar, fo);
      reqStock.input('fd', sql.VarChar, fd);
      const q = `
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
    }>;

    if (rows.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const detalhes: LogDetalheItem[] = rows.map((row) => {
      const produto = row.PRODUTO?.toString().trim() ?? '';
      const corRaw = row.COR_PRODUTO?.toString().trim();
      const cor = corRaw || '';
      const keyOrigemNome = `${produto}|${cor}|${nomeOrigem}`;
      const keyDestinoNome = `${produto}|${cor}|${nomeDestino}`;
      const keyOrigemCod = `${produto}|${cor}|${fo}`;
      const keyDestinoCod = `${produto}|${cor}|${fd}`;
      const estoqueOrigem = stockMap.get(keyOrigemNome) ?? stockMap.get(keyOrigemCod) ?? 0;
      const estoqueDestino = stockMap.get(keyDestinoNome) ?? stockMap.get(keyDestinoCod) ?? 0;
      return {
        produto,
        corProduto: cor || null,
        descProduto: row.DESC_PRODUTO?.toString().trim() ?? '',
        descCor: row.DESC_COR?.toString().trim() ?? '',
        codigoBarra: row.CODIGO_BARRA?.toString().trim() || null,
        qtde: Number(row.QTDE) || 0,
        estoqueOrigem,
        estoqueDestino,
        filialOrigem: nomeOrigem,
        filialDestino: nomeDestino,
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
