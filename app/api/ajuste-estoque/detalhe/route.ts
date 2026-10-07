import { NextResponse } from 'next/server';

import {
  detalharAjuste,
  filialDaContagem,
  resumirContagemFisica,
  type AjusteDetalheItem,
} from '@/lib/repositories/ajusteEstoque';
import { obterKpisAjuste } from '@/lib/utils/ajuste-estoque-kpis-store';

export const dynamic = 'force-dynamic';

/**
 * KPIs de um ajuste já feito — os mesmos quadros do "Calcular diferenças".
 *
 * O que foi aplicado (com diferença, entradas, saídas, variação) sai sempre das
 * linhas reais do Linx (CTG_AJUSTE). Saldo antes/depois e itens no escopo não
 * ficam no Linx; vêm de:
 *   - 'snapshot': gravado pelo dashboard ao executar o ajuste;
 *   - 'contagem': contagem física nativa do Linx (CTG_ITENS), se bater com os deltas;
 *   - 'ajuste':   nenhum dos dois — esses quadros ficam vazios.
 */
interface AjusteKpis {
  fonte: 'snapshot' | 'contagem' | 'ajuste';
  modo: 'zerar' | 'inventario' | null;
  totais: {
    itens: number | null;
    comDiferenca: number;
    positivos: number;
    negativos: number;
    somaDelta: number;
    saldoAtualTotal: number | null;
    saldoFinalTotal: number | null;
    itensSaldoNegativo: number | null;
  };
  unidadesEntrada: number;
  unidadesSaida: number;
  naoEncontrados: number;
  ambiguos: number;
  invalidas: number;
}

async function montarKpis(nome: string, itens: AjusteDetalheItem[]): Promise<AjusteKpis> {
  const comDif = itens.filter((it) => it.qtde !== 0);
  const somaDelta = comDif.reduce((s, it) => s + it.qtde, 0);
  const kpis: AjusteKpis = {
    fonte: 'ajuste',
    modo: null,
    totais: {
      itens: null,
      comDiferenca: comDif.length,
      positivos: comDif.filter((it) => it.qtde > 0).length,
      negativos: comDif.filter((it) => it.qtde < 0).length,
      somaDelta,
      saldoAtualTotal: null,
      saldoFinalTotal: null,
      itensSaldoNegativo: null,
    },
    unidadesEntrada: comDif.reduce((s, it) => s + (it.qtde > 0 ? it.qtde : 0), 0),
    unidadesSaida: comDif.reduce((s, it) => s + (it.qtde < 0 ? -it.qtde : 0), 0),
    naoEncontrados: 0,
    ambiguos: 0,
    invalidas: 0,
  };

  const [snapshot, filial] = await Promise.all([
    obterKpisAjuste(nome).catch((err) => {
      console.error('[ajuste-estoque/detalhe] snapshot', err);
      return null;
    }),
    filialDaContagem(nome).catch(() => null),
  ]);

  // Snapshot só vale para a mesma contagem (nome reaproveitado em outra filial = descarta).
  if (snapshot && (!filial || snapshot.filialNome.trim() === filial)) {
    kpis.fonte = 'snapshot';
    kpis.modo = snapshot.modo;
    kpis.totais.itens = snapshot.itens;
    kpis.totais.saldoFinalTotal = snapshot.saldoFinalTotal;
    // Saldo antes = final − o que foi de fato aplicado (o executor recalcula o delta).
    kpis.totais.saldoAtualTotal = snapshot.saldoFinalTotal - somaDelta;
    kpis.totais.itensSaldoNegativo = snapshot.itensSaldoNegativo;
    kpis.naoEncontrados = snapshot.naoEncontrados;
    kpis.ambiguos = snapshot.ambiguos;
    kpis.invalidas = snapshot.invalidas;
    return kpis;
  }

  const fisica = await resumirContagemFisica(nome).catch((err) => {
    console.error('[ajuste-estoque/detalhe] contagem física', err);
    return null;
  });
  // Só usa se a contagem física explica exatamente o que foi ajustado.
  if (fisica && fisica.saldoFinalTotal - fisica.saldoAtualTotal === somaDelta) {
    kpis.fonte = 'contagem';
    kpis.modo = 'inventario';
    kpis.totais.itens = fisica.itens;
    kpis.totais.saldoAtualTotal = fisica.saldoAtualTotal;
    kpis.totais.saldoFinalTotal = fisica.saldoFinalTotal;
    kpis.totais.itensSaldoNegativo = fisica.itensSaldoNegativo;
  }
  return kpis;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const nome = searchParams.get('nome')?.trim();
    if (!nome) {
      return NextResponse.json({ error: 'Informe a contagem.' }, { status: 400 });
    }
    const itens = await detalharAjuste(nome);
    const kpis = await montarKpis(nome, itens);
    return NextResponse.json({ nome, itens, kpis });
  } catch (error) {
    console.error('[ajuste-estoque/detalhe] erro', error);
    return NextResponse.json({ error: 'Erro ao carregar detalhe.' }, { status: 500 });
  }
}
