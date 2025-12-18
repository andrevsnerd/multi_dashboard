import { NextResponse } from 'next/server';

import {
  processarProdutos,
  processarEstoque,
  processarVendas,
  processarEcommerce,
  processarEntradas,
} from '@/lib/utils/processRelatorios';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { tipo, dados, dadosAuxiliares } = body;

    if (!tipo || !dados) {
      return NextResponse.json(
        { error: 'Parâmetros tipo e dados são obrigatórios' },
        { status: 400 }
      );
    }

    let resultado: Record<string, any>[] = [];

    switch (tipo) {
      case 'produtos':
        if (!dadosAuxiliares?.codigosBarra) {
          return NextResponse.json(
            { error: 'Dados auxiliares (codigosBarra) são obrigatórios para produtos' },
            { status: 400 }
          );
        }
        resultado = processarProdutos(dados, dadosAuxiliares.codigosBarra);
        break;

      case 'estoque':
        if (!dadosAuxiliares?.produtos || !dadosAuxiliares?.codigosBarra) {
          return NextResponse.json(
            { error: 'Dados auxiliares (produtos, codigosBarra) são obrigatórios para estoque' },
            { status: 400 }
          );
        }
        resultado = processarEstoque(
          dados,
          dadosAuxiliares.produtos,
          dadosAuxiliares.codigosBarra
        );
        break;

      case 'vendas':
        if (!dadosAuxiliares?.codigosBarra) {
          return NextResponse.json(
            { error: 'Dados auxiliares (codigosBarra) são obrigatórios para vendas' },
            { status: 400 }
          );
        }
        resultado = processarVendas(dados, dadosAuxiliares.codigosBarra);
        break;

      case 'ecommerce':
        resultado = processarEcommerce(dados);
        break;

      case 'entradas':
        if (!dadosAuxiliares?.produtos || !dadosAuxiliares?.cores) {
          return NextResponse.json(
            { error: 'Dados auxiliares (produtos, cores) são obrigatórios para entradas' },
            { status: 400 }
          );
        }
        resultado = processarEntradas(
          dados,
          dadosAuxiliares.produtos,
          dadosAuxiliares.cores
        );
        break;

      case 'produtos_barra':
      case 'cores':
        // Não precisam processamento
        resultado = dados;
        break;

      default:
        return NextResponse.json(
          { error: `Tipo de relatório inválido: ${tipo}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      tipo,
      registros: resultado.length,
      data: resultado,
    });
  } catch (error) {
    console.error('Erro ao processar relatório:', error);
    
    return NextResponse.json(
      {
        error: 'Erro ao processar relatório',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}







