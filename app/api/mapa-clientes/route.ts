import { NextResponse } from 'next/server';
import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import { resolveCompanyLive } from '@/lib/server/company-live';

export const maxDuration = 60;

export interface StateData {
  uf: string;
  totalCompradores: number;
  totalQtd: number;
  percentTotal: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  if (!company) {
    return NextResponse.json({ error: 'company required' }, { status: 400 });
  }

  const companyConfig = await resolveCompanyLive(company);
  if (!companyConfig) {
    return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 });
  }

  // Usa todas as filiais conhecidas da empresa (vendas + ecommerce), sem duplicatas.
  // O filtro de e-commerce é feito via NATUREZA_SAIDA, igual ao exportar_todos_relatorios.py.
  const allFilials = Array.from(
    new Set([
      ...(companyConfig.filialFilters?.sales ?? []),
      ...(companyConfig.ecommerceFilials ?? []),
    ])
  );

  if (allFilials.length === 0) {
    return NextResponse.json({ error: 'Sem filiais configuradas para esta empresa' }, { status: 400 });
  }

  const start = startParam ? new Date(startParam) : new Date(new Date().getFullYear(), 0, 1);
  const end = endParam ? new Date(endParam) : new Date();

  try {
    const result = await withRequest(async (req) => {
      req.input('startDate', sql.DateTime, start);
      req.input('endDate', sql.DateTime, end);

      allFilials.forEach((f, i) => req.input(`filial${i}`, sql.VarChar, f));
      const filialParams = allFilials.map((_, i) => `@filial${i}`).join(', ');

      // Lógica idêntica ao exportar_todos_relatorios.py:
      // - Filtra por filiais da empresa
      // - NATUREZA_SAIDA IN ('100.02', '100.022') identifica vendas e-commerce
      // - fp.UF é o estado do cliente (não da filial)
      // - Conta NFs distintas por UF como "compradores"
      const query = `
        SELECT
          LTRIM(RTRIM(fp.UF)) AS UF,
          COUNT(DISTINCT f.FILIAL + '|' + CAST(f.NF_SAIDA AS VARCHAR(20)) + '|' + f.SERIE_NF) AS totalCompradores,
          SUM(fp.QTDE) AS totalQtd
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL
         AND f.NF_SAIDA = fp.NF_SAIDA
         AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
          AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL IN (${filialParams})
          AND fp.UF IS NOT NULL
          AND LTRIM(RTRIM(fp.UF)) != ''
        GROUP BY LTRIM(RTRIM(fp.UF))
        ORDER BY totalCompradores DESC
      `;

      return req.query(query);
    });

    const rows = result.recordset as Array<{ UF: string; totalCompradores: number; totalQtd: number }>;
    const total = rows.reduce((sum, r) => sum + Number(r.totalCompradores), 0); // soma dos COUNT DISTINCT por UF — correto pois UF é do cliente e cada pedido tem um UF

    const data: StateData[] = rows.map((r) => ({
      uf: String(r.UF).trim().toUpperCase(),
      totalCompradores: Number(r.totalCompradores),
      totalQtd: Number(r.totalQtd),
      percentTotal:
        total > 0 ? Math.round((Number(r.totalCompradores) / total) * 1000) / 10 : 0,
    }));

    return NextResponse.json({ data, total });
  } catch (error) {
    console.error('[mapa-clientes] Erro ao buscar dados:', error);
    return NextResponse.json({ error: 'Falha ao buscar dados' }, { status: 500 });
  }
}
