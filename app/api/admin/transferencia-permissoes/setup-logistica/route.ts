import { NextRequest, NextResponse } from 'next/server';
import { savePermissao } from '@/lib/utils/transferencia-permissoes-store';
import { findUserByUsername } from '@/lib/auth/users-store';
import { withRequest } from '@/lib/db/connection';

async function isAdmin(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  return user?.role === 'admin';
}

/**
 * POST /api/admin/transferencia-permissoes/setup-logistica
 * Configura as permissões padrão para o usuário "logistica"
 * Apenas admin pode executar
 */
export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username');
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Verificar se o usuário logistica existe
    const logisticaUser = await findUserByUsername('logistica');
    if (!logisticaUser) {
      return NextResponse.json(
        { error: 'Usuário "logistica" não encontrado' },
        { status: 404 }
      );
    }

    // Buscar filiais do banco
    const filiais = await withRequest(async (req) => {
      const query = `
        SELECT DISTINCT
          COD_FILIAL,
          FILIAL
        FROM FILIAIS WITH (NOLOCK)
        WHERE FILIAL LIKE '%SCARF%' OR FILIAL LIKE '%SCARFME%'
        ORDER BY FILIAL
      `;
      
      const result = await req.query<{
        COD_FILIAL: string;
        FILIAL: string;
      }>(query);
      
      return result.recordset.map(row => ({
        codFilial: row.COD_FILIAL?.toString().trim() || '',
        filial: row.FILIAL?.toString().trim() || '',
      }));
    });

    // Encontrar filiais por nome
    const filialOrigem = filiais.find(f => 
      f.filial.toUpperCase().includes('SCARF ME - MATRIZ') &&
      !f.filial.toUpperCase().includes('LLL') &&
      !f.filial.toUpperCase().includes('CMS')
    );
    
    const filialDestino = filiais.find(f => 
      f.filial.toUpperCase().includes('SCARF ME - PAULISTA RSR') ||
      (f.filial.toUpperCase().includes('PAULISTA RSR') && !f.filial.toUpperCase().includes('FFF'))
    );

    if (!filialOrigem) {
      return NextResponse.json(
        { 
          error: 'Filial origem "SCARF ME - MATRIZ" não encontrada',
          filiaisDisponiveis: filiais.map(f => ({ codFilial: f.codFilial, filial: f.filial }))
        },
        { status: 404 }
      );
    }

    if (!filialDestino) {
      return NextResponse.json(
        { 
          error: 'Filial destino "SCARF ME - PAULISTA RSR" não encontrada',
          filiaisDisponiveis: filiais.map(f => ({ codFilial: f.codFilial, filial: f.filial }))
        },
        { status: 404 }
      );
    }

    // Buscar tipos de romaneio diretamente do banco
    const tiposRomaneioPermitidos = await withRequest(async (req) => {
      const tiposSet = new Set<string>();
      
      try {
        const querySaidas = `
          SELECT DISTINCT TIPO_ROMANEIO
          FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
          WHERE TIPO_ROMANEIO IS NOT NULL AND TIPO_ROMANEIO != ''
        `;
        const resultSaidas = await req.query<{ TIPO_ROMANEIO: string }>(querySaidas);
        for (const row of resultSaidas.recordset) {
          const tipo = row.TIPO_ROMANEIO?.toString().trim();
          if (tipo) tiposSet.add(tipo);
        }
      } catch (error) {
        console.error('Erro ao buscar tipos de saída', error);
      }

      try {
        const queryEntradas = `
          SELECT DISTINCT TIPO_ROMANEIO
          FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
          WHERE TIPO_ROMANEIO IS NOT NULL AND TIPO_ROMANEIO != ''
        `;
        const resultEntradas = await req.query<{ TIPO_ROMANEIO: string }>(queryEntradas);
        for (const row of resultEntradas.recordset) {
          const tipo = row.TIPO_ROMANEIO?.toString().trim();
          if (tipo) tiposSet.add(tipo);
        }
      } catch (error) {
        console.error('Erro ao buscar tipos de entrada', error);
      }

      return Array.from(tiposSet);
    });

    // Configurar permissões
    await savePermissao({
      username: 'logistica',
      filiaisOrigem: [filialOrigem.codFilial],
      filiaisDestino: [filialDestino.codFilial],
      tiposRomaneioPermitidos: tiposRomaneioPermitidos.length > 0 ? tiposRomaneioPermitidos : [], // Vazio = todos permitidos
      responsavelPadrao: 'LOGISTICA',
      tipoRomaneioPadrao: 'TRANSFERENCIA ENTRE LOJAS',
      responsavelFixo: true,
      tipoRomaneioFixo: true,
    });

    return NextResponse.json({
      success: true,
      message: 'Permissões configuradas com sucesso',
      configuracao: {
        username: 'logistica',
        filialOrigem: {
          codFilial: filialOrigem.codFilial,
          filial: filialOrigem.filial,
        },
        filialDestino: {
          codFilial: filialDestino.codFilial,
          filial: filialDestino.filial,
        },
        responsavelPadrao: 'LOGISTICA',
        tipoRomaneioPadrao: 'TRANSFERENCIA ENTRE LOJAS',
        responsavelFixo: true,
        tipoRomaneioFixo: true,
      },
    });
  } catch (error) {
    console.error('Erro ao configurar permissões do logistica', error);
    return NextResponse.json(
      { error: 'Erro ao configurar permissões' },
      { status: 500 }
    );
  }
}
