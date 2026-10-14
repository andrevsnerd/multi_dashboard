/**
 * Textos do OBS dos romaneios (puro, sem banco). A gravação fica em
 * lib/server/obs-operacao.ts — ver lá a regra completa.
 */

/** "14/10/2026 18:04" no horário de Brasília. */
export function agoraBrasil(): string {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', '');
}

export interface ObsOperacaoParams {
  operacao: 'saida' | 'entrada';
  tipoRomaneio: string;
  /** Filial onde o romaneio é gravado. */
  filial: string;
  /** Saída: para onde vai (rótulo do destino). */
  filialDestino?: string | null;
  /** Entrada que confirma uma saída: de onde veio + romaneio de saída. */
  origem?: string | null;
  romaneioSaida?: string | null;
  itens: Array<{ produto: string; corProduto?: string | null; quantidade: number }>;
  /** Tela do dashboard que fez a operação. */
  tela: string;
  /** Login do dashboard. */
  usuario: string;
  /** Usuário do Linx gravado em RESPONSAVEL. */
  responsavelLinx?: string | null;
  /** Texto livre digitado pelo operador (vem primeiro). */
  obsUsuario?: string | null;
}

/** Bloco padrão do OBS de um romaneio novo. */
export function montarObsOperacao(p: ObsOperacaoParams): string {
  const produtos = new Set(p.itens.map((i) => `${(i.produto || '').trim()}|${(i.corProduto ?? '').toString().trim()}`)).size;
  const pecas = p.itens.reduce((s, i) => s + (Math.floor(Number(i.quantidade)) || 0), 0);
  const tipo = (p.tipoRomaneio || '').trim().toUpperCase();
  const quem = `${p.usuario}${p.responsavelLinx && p.responsavelLinx.toUpperCase() !== p.usuario.toUpperCase() ? ` (${p.responsavelLinx})` : ''}`;

  let cabecalho: string;
  if (p.operacao === 'entrada' && p.romaneioSaida) {
    cabecalho = `ENTRADA POR CONFIRMACAO DA SAIDA ${p.romaneioSaida.trim()} | DE: ${p.origem || '-'} | PARA: ${p.filial}`;
  } else if (p.operacao === 'entrada') {
    cabecalho = `ENTRADA ${tipo || 'AVULSA'} | EM: ${p.filial}`;
  } else {
    cabecalho = `SAIDA ${tipo || 'AVULSA'} | DE: ${p.filial} | PARA: ${p.filialDestino || 'sem destino (saida avulsa)'}`;
  }

  const linhas = [
    (p.obsUsuario || '').trim(),
    cabecalho,
    `${produtos} produto(s), ${pecas} peca(s) | VIA DASHBOARD: ${p.tela} | POR: ${quem} | ${agoraBrasil()}`,
  ].filter(Boolean);
  return linhas.join('\n');
}

/**
 * "N4.24.0250 cor 23: 2; 96.03.0142 cor 03 tam. M: 1" — lista curta para uma
 * linha de OBS. `rotuloTamanho` traduz a posição da grade (peça P/M/G).
 */
export function descreverItens(
  itens: Array<{ produto: string; corProduto?: string | null; quantidade: number; tamanho?: number | null }>,
  rotuloTamanho?: (produto: string, tamanho: number) => string | null
): string {
  const partes = itens.map((it) => {
    const cor = (it.corProduto ?? '').toString().trim();
    const tam = it.tamanho && rotuloTamanho ? rotuloTamanho(it.produto, it.tamanho) : null;
    return `${it.produto.trim()}${cor ? ` cor ${cor}` : ''}${tam ? ` tam. ${tam}` : ''}: ${Math.floor(Number(it.quantidade)) || 0}`;
  });
  return partes.length > 30 ? `${partes.slice(0, 30).join('; ')}; +${partes.length - 30} item(ns)` : partes.join('; ');
}
