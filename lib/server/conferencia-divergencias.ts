import { query } from '@/lib/db/connection';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { executeEntradaLote, executeSaidaLote } from '@/lib/saida-entrada-executor';
import { carregarGradeDaSaida, carregarGrades, chaveSku } from '@/lib/server/grade-produto';
import { mensagemTravaEstoqueNegativo, verificarSaldoSaida } from '@/lib/server/trava-estoque-negativo';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { calcularDivergenciaItem } from '@/lib/utils/conferencia-divergencia-calculo';
import { agoraBrasil } from '@/lib/server/obs-operacao';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  CONFERÊNCIA COM DIVERGÊNCIA — registra na ORIGEM, nunca reescreve a saída.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Decisão do dono (14/10/2026): a saída original fica como foi lançada. O que a
 * conferência achou de diferente vira romaneio NOVO na loja de origem, com a
 * referência da saída e o motivo item a item no OBS:
 *
 *  - FALTOU (chegou menos do que saiu, por tamanho) → ENTRADA na origem, tipo
 *    'DEVOLUCAO TRANSFERENCIA': a peça que não veio volta para a loja.
 *  - TAMANHO TROCADO (saiu P, chegou M) → além da entrada do P, SAÍDA do M na
 *    origem, tipo 'AJUSTE DE ESTOQUE': a origem passa a refletir o que saiu de fato.
 *  - CHEGOU A MAIS sem faltar nada → nada na origem (fora do escopo).
 *
 * Antes disto a saída era editada para a quantidade conferida (2 → 1): o estoque
 * voltava, mas o romaneio passava a dizer que só tinha saído 1 e não sobrava
 * registro do que não veio. E a edição era recusada quando a origem tinha
 * ajuste/inventário depois da saída — o romaneio novo nasce com data de hoje.
 *
 * Idempotente por ITEM: os romaneios gerados levam um marcador no OBS
 * ("NAO RECEBIDO DA SAIDA <rom>/<origem>"); produto×cor que já está num deles
 * não é lançado de novo — repetir a confirmação não devolve em dobro.
 */

export interface ItemConferido {
  produto: string;
  corProduto: string;
  /** Quantidade conferida (total). */
  qtdeConfirmada: number;
  /** Peça P/M/G: o que chegou em cada tamanho {posição: qtd}. */
  tamanhosConfirmados?: Record<number, number> | null;
}

export interface ResultadoDivergencias {
  /** Romaneio de entrada (devolução) gerado na origem, se houve falta. */
  romaneioDevolucao: string | null;
  /** Romaneio de saída (tamanho trocado) gerado na origem, se houve troca. */
  romaneioTroca: string | null;
  /** Mensagens para a tela (uma por fato relevante). */
  mensagens: string[];
}

const MARCA_FALTA = 'NAO RECEBIDO DA SAIDA';
const MARCA_TROCA = 'TAMANHO TROCADO DA SAIDA';

function lit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** produto|cor já lançados em romaneios desta conferência (OBS com o marcador). */
async function jaLancados(
  tabelaCab: 'ESTOQUE_PROD_ENT' | 'ESTOQUE_PROD_SAI',
  tabelaItem: 'ESTOQUE_PROD1_ENT' | 'ESTOQUE_PROD1_SAI',
  marcador: string,
  filialOrigem: string
): Promise<{ itens: Set<string>; romaneio: string | null }> {
  const rows = await query<{ R: string; P: string; C: string }>(`
    SELECT LTRIM(RTRIM(h.ROMANEIO_PRODUTO)) AS R, LTRIM(RTRIM(i.PRODUTO)) AS P, LTRIM(RTRIM(ISNULL(i.COR_PRODUTO, ''))) AS C
      FROM ${tabelaCab} h WITH (NOLOCK)
      JOIN ${tabelaItem} i WITH (NOLOCK) ON i.ROMANEIO_PRODUTO = h.ROMANEIO_PRODUTO AND i.FILIAL = h.FILIAL
     WHERE h.FILIAL = (SELECT TOP 1 FILIAL FROM FILIAIS WITH (NOLOCK)
                        WHERE LTRIM(RTRIM(FILIAL)) = ${lit(filialOrigem)} OR LTRIM(RTRIM(COD_FILIAL)) = ${lit(filialOrigem)})
       AND CAST(h.OBS AS VARCHAR(MAX)) LIKE ${lit(`%${marcador}%`)}
  `);
  return {
    itens: new Set(rows.map((r) => chaveSku(r.P, r.C))),
    romaneio: rows[0]?.R ?? null,
  };
}

/**
 * Compara o que saiu (SA_n da saída) com o que chegou e lança na origem a
 * devolução do que faltou e a saída do tamanho trocado. Lança erro só se a
 * gravação no Linx falhar (a tela mostra e o operador repete — idempotente).
 */
export async function registrarDivergenciasNaOrigem(p: {
  romaneioSaida: string;
  filialOrigem: string;
  filialDestino: string;
  itens: ItemConferido[];
  username: string;
  /** Conexão/transação para as gravações (teste com rollback). Padrão: a do app. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool?: any;
}): Promise<ResultadoDivergencias> {
  const { romaneioSaida, filialOrigem, filialDestino, username } = p;
  const resultado: ResultadoDivergencias = { romaneioDevolucao: null, romaneioTroca: null, mensagens: [] };
  if (!romaneioSaida || !filialOrigem || p.itens.length === 0) return resultado;

  const produtos = p.itens.map((it) => it.produto);
  const [gradeSaida, grades] = await Promise.all([
    carregarGradeDaSaida(romaneioSaida, filialOrigem, produtos),
    carregarGrades(produtos),
  ]);
  const rotulo = (produto: string, t: number) =>
    grades.get(produto.trim())?.exigeTamanho
      ? ` tam. ${grades.get(produto.trim())!.tamanhos.find((g) => g.ordinal === t)?.label ?? t}`
      : '';

  const faltas: Array<{ produto: string; corProduto: string; quantidade: number; tamanho: number }> = [];
  const trocas: Array<{ produto: string; corProduto: string; quantidade: number; tamanho: number }> = [];
  const linhasFalta: string[] = [];
  const linhasTroca: string[] = [];

  for (const it of p.itens) {
    const saiu = gradeSaida.get(chaveSku(it.produto, it.corProduto));
    if (!saiu) continue;
    const d = calcularDivergenciaItem(saiu, it.qtdeConfirmada, it.tamanhosConfirmados);
    if (d.totalFalta === 0) continue; // chegou tudo (ou a mais): nada na origem

    const desc = `${it.produto}${it.corProduto ? ` cor ${it.corProduto}` : ''}`;
    d.falta.forEach((q, i) => {
      if (q > 0) faltas.push({ produto: it.produto, corProduto: it.corProduto, quantidade: q, tamanho: i + 1 });
    });
    // "saiu P:2 → chegou M:1 → volta P:2" (peça P/M/G) ou "saiu 2 → chegou 1 → volta 1".
    const porTam = (arr: number[]) =>
      grades.get(it.produto.trim())?.exigeTamanho
        ? arr.map((q, i) => (q > 0 ? `${rotulo(it.produto, i + 1).replace(' tam. ', '')}:${q}` : '')).filter(Boolean).join(' ') || '0'
        : String(arr.reduce((s, x) => s + x, 0));
    linhasFalta.push(`${desc}: saiu ${porTam(saiu)} -> chegou ${porTam(d.chegou)} -> volta ${porTam(d.falta)}`);
    // Tamanho trocado: sai da origem no tamanho que de fato saiu.
    d.troca.forEach((q, i) => {
      if (q > 0) {
        trocas.push({ produto: it.produto, corProduto: it.corProduto, quantidade: q, tamanho: i + 1 });
        linhasTroca.push(`${desc}${rotulo(it.produto, i + 1)}: chegou no lugar do tamanho registrado (${q})`);
      }
    });
  }

  if (faltas.length === 0) return resultado;

  const ref = `${romaneioSaida.trim()}/${filialOrigem.trim()}`;
  const pool = p.pool ?? (shouldUseProxy() ? new ProxyPool() : await getConnectionPool());
  const responsavel = await resolveResponsavelLinx(username);

  // 1) DEVOLUÇÃO — entrada na origem do que não chegou.
  const jaDevolvidos = await jaLancados('ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT', `${MARCA_FALTA} ${ref}`, filialOrigem);
  const devolver = faltas.filter((f) => !jaDevolvidos.itens.has(chaveSku(f.produto, f.corProduto)));
  if (devolver.length > 0) {
    const obs =
      `${MARCA_FALTA} ${ref} -> ${filialDestino}\n` +
      `ITENS NAO RECEBIDOS NO DESTINO (voltam ao estoque da origem):\n` +
      linhasFalta.map((l) => `- ${l}`).join('\n') +
      `\nVIA DASHBOARD: conferencia de romaneio | POR: ${username} (${responsavel}) | ${agoraBrasil()}`;
    const r = await executeEntradaLote(pool, {
      itens: devolver,
      filial: filialOrigem,
      tipoRomaneio: 'DEVOLUCAO TRANSFERENCIA',
      gravarTipoRomaneio: true,
      responsavel,
      observacao: obs,
    });
    resultado.romaneioDevolucao = r.romaneio;
    resultado.mensagens.push(
      `${devolver.reduce((s, f) => s + f.quantidade, 0)} peça(s) que não chegaram voltaram para ${filialOrigem} ` +
        `no romaneio ${r.romaneio} (DEVOLUCAO TRANSFERENCIA).`
    );
  } else {
    resultado.romaneioDevolucao = jaDevolvidos.romaneio;
  }

  // 2) TAMANHO TROCADO — saída na origem do tamanho que chegou no lugar.
  if (trocas.length > 0) {
    const jaTrocados = await jaLancados('ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI', `${MARCA_TROCA} ${ref}`, filialOrigem);
    const sair = trocas.filter((t) => !jaTrocados.itens.has(chaveSku(t.produto, t.corProduto)));
    if (sair.length > 0) {
      const travaSaldo = await verificarSaldoSaida(filialOrigem, sair);
      if (travaSaldo) {
        resultado.mensagens.push(
          `Tamanho trocado não lançado em ${filialOrigem}: ${mensagemTravaEstoqueNegativo(travaSaldo)}`
        );
      } else {
        const obs =
          `${MARCA_TROCA} ${ref} -> ${filialDestino}\n` +
          `TAMANHO TROCADO NA CONFERENCIA (saiu este tamanho, registrado como outro):\n` +
          linhasTroca.map((l) => `- ${l}`).join('\n') +
          `\nVIA DASHBOARD: conferencia de romaneio | POR: ${username} (${responsavel}) | ${agoraBrasil()}`;
        const r = await executeSaidaLote(pool, {
          itens: sair,
          filial: filialOrigem,
          tipoRomaneio: 'AJUSTE DE ESTOQUE',
          responsavel,
          observacao: obs,
        });
        resultado.romaneioTroca = r.romaneio;
        resultado.mensagens.push(
          `Tamanho trocado: saída de ${sair.reduce((s, t) => s + t.quantidade, 0)} peça(s) em ${filialOrigem} ` +
            `no romaneio ${r.romaneio} (AJUSTE DE ESTOQUE).`
        );
      }
    } else {
      resultado.romaneioTroca = jaTrocados.romaneio;
    }
  }

  return resultado;
}
