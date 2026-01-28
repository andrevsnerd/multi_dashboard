import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';

export async function GET() {
  try {
    const tipos = await withRequest(async (req) => {
      // Buscar tipos de saídas
      const querySaidas = `
        SELECT DISTINCT TIPO_ROMANEIO
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE TIPO_ROMANEIO IS NOT NULL
          AND TIPO_ROMANEIO != ''
      `;

      // Buscar tipos de entradas
      const queryEntradas = `
        SELECT DISTINCT TIPO_ROMANEIO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE TIPO_ROMANEIO IS NOT NULL
          AND TIPO_ROMANEIO != ''
      `;

      const tiposSet = new Set<string>();

      try {
        const resultSaidas = await req.query<{ TIPO_ROMANEIO: string }>(querySaidas);
        for (const row of resultSaidas.recordset) {
          const tipo = row.TIPO_ROMANEIO?.toString().trim();
          if (tipo) {
            tiposSet.add(tipo);
          }
        }
      } catch (error) {
        console.error('Erro ao buscar tipos de saída', error);
      }

      try {
        const resultEntradas = await req.query<{ TIPO_ROMANEIO: string }>(queryEntradas);
        for (const row of resultEntradas.recordset) {
          const tipo = row.TIPO_ROMANEIO?.toString().trim();
          if (tipo) {
            tiposSet.add(tipo);
          }
        }
      } catch (error) {
        console.error('Erro ao buscar tipos de entrada', error);
      }

      // Converter para lista e ordenar conforme especificado
      const tiposLista = Array.from(tiposSet);
      
      // Ordem prioritária: TRANSFERENCIA ENTRE LOJAS, AJUSTE DE ESTOQUE, DEFEITO, SAÍDA MKT, depois o resto alfabeticamente
      const ordemPrioritaria = [
        'TRANSFERENCIA ENTRE LOJAS',
        'AJUSTE DE ESTOQUE',
        'DEFEITO',
        'SAÍDA MKT'
      ];
      
      // Separar tipos prioritários e o resto
      const tiposPrioritarios: string[] = [];
      const tiposResto: string[] = [];
      
      tiposLista.forEach(tipo => {
        if (ordemPrioritaria.includes(tipo.toUpperCase())) {
          tiposPrioritarios.push(tipo);
        } else {
          tiposResto.push(tipo);
        }
      });
      
      // Ordenar tipos prioritários na ordem especificada
      tiposPrioritarios.sort((a, b) => {
        const indexA = ordemPrioritaria.indexOf(a.toUpperCase());
        const indexB = ordemPrioritaria.indexOf(b.toUpperCase());
        return indexA - indexB;
      });
      
      // Ordenar o resto alfabeticamente
      tiposResto.sort();
      
      // Combinar: prioritários primeiro, depois o resto
      const tiposOrdenados = [...tiposPrioritarios, ...tiposResto];

      // Se não encontrou nenhum, retornar tipos padrão
      if (tiposOrdenados.length === 0) {
        return ['TRANSFERENCIA ENTRE LOJAS', 'AJUSTE DE ESTOQUE', 'DEFEITO'];
      }

      return tiposOrdenados;
    });

    return NextResponse.json({ data: tipos });
  } catch (error) {
    console.error('Erro ao buscar tipos de romaneio', error);
    return NextResponse.json(
      { error: 'Erro ao buscar tipos de romaneio' },
      { status: 500 }
    );
  }
}
