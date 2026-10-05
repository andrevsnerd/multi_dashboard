import { query } from '@/lib/db/connection';
import { getSaidasDasEntradas } from '@/lib/utils/romaneio-confirmacao-store';
import { parseRomaneioDateTime } from '@/lib/utils/romaneios-date';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TRAVA DE ENTRADA DUPLICADA — uma saída só vira entrada uma vez no destino.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Confirmar um romaneio de saída são dois passos: (1) gravar a entrada no Linx e
 * (2) marcar cada item como confirmado no Neon. Quando (1) grava mas a resposta
 * não volta para a tela (proxy lento, erro falso), nada fica marcado, o botão
 * continua ativo e o próximo clique gerava OUTRA entrada com os mesmos itens.
 * Foi o que inflou o estoque da Morumbi em set/2026 (saída 033398 entrou 2x,
 * 033505 entrou 3x) — e de Leblon, Villa Lobos e RDRRX desde julho.
 *
 * Duas provas, nesta ordem:
 *   1. VÍNCULO — toda entrada gerada a partir de uma saída leva no OBS o marcador
 *      `REF SAIDA <romaneio>/<origem>` (ver `marcadorReferenciaSaida`). Se uma
 *      entrada com o marcador já recebeu algum dos itens pedidos, é repetição.
 *   2. ASSINATURA — para entradas gravadas antes do marcador existir: entrada na
 *      mesma filial, desde a data da saída, com EXATAMENTE os mesmos itens e
 *      quantidades, que não esteja ligada (Neon) a outra saída.
 *
 * Quando a entrada existente cobre todos os itens pedidos (`completa`), a tela
 * não precisa gravar nada: só termina a confirmação apontando para ela. É isso
 * que transforma o "tentar de novo" num conserto em vez de numa duplicata.
 */

export interface ItemEntradaPedido {
  produto: string;
  corProduto: string | null;
  quantidade: number;
}

export interface EntradaJaFeita {
  /** Romaneio de entrada que já recebeu esta saída. */
  romaneio: string;
  /** A entrada existente cobre todos os itens e quantidades pedidos. */
  completa: boolean;
  /** "PRODUTO/COR" dos itens pedidos que já tiveram entrada. */
  itensRepetidos: string[];
  /** Como foi reconhecida: marcador no OBS ou itens idênticos. */
  prova: 'vinculo' | 'assinatura';
}

const PREFIXO_MARCADOR = 'REF SAIDA';
/** Janela da prova por assinatura (entradas antigas, sem marcador). */
const DIAS_ASSINATURA = 15;

function normTexto(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Cor vem '06' de uma fonte e '6' de outra — compara pelo número quando é número. */
function normCor(value: string | null | undefined): string {
  const cor = (value || '').trim().toUpperCase();
  return /^\d+$/.test(cor) ? String(parseInt(cor, 10)) : cor;
}

function chaveItem(produto: string, cor: string | null | undefined): string {
  return `${(produto || '').trim().toUpperCase()}|${normCor(cor)}`;
}

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Literal para dentro de LIKE: escapa aspas e os curingas do SQL Server. */
function likeLiteral(value: string): string {
  return sqlLiteral(value).replace(/[[%_]/g, (c) => `[${c}]`);
}

/** Marcador gravado no OBS da entrada que confirma a saída `romaneio` de `filialOrigem`. */
export function marcadorReferenciaSaida(romaneio: string, filialOrigem: string): string {
  return `${PREFIXO_MARCADOR} ${(romaneio || '').trim()}/${normTexto(filialOrigem)}`;
}

/** OBS final da entrada: o texto da tela (se houver) + o marcador. */
export function observacaoComReferencia(
  observacao: string | null | undefined,
  romaneio: string,
  filialOrigem: string
): string {
  const marcador = marcadorReferenciaSaida(romaneio, filialOrigem);
  const texto = (observacao || '').trim();
  return texto ? `${texto} | ${marcador}` : marcador;
}

/** Dia (YYYY-MM-DD, Brasília) da data de romaneio que a tela manda; '' se inválida. */
function diaDoRomaneio(value: string | null | undefined): string {
  const parsed = parseRomaneioDateTime(value || '');
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function diaMenos(dias: number): string {
  const d = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

async function nomeFilialLinx(filial: string): Promise<string> {
  const f = sqlLiteral((filial || '').trim());
  const rows = await query<{ FILIAL: string }>(`
    SELECT TOP 1 FILIAL FROM FILIAIS WITH (NOLOCK)
    WHERE COD_FILIAL = '${f}' OR RTRIM(FILIAL) = '${f}'
  `);
  return (rows[0]?.FILIAL || filial || '').trim();
}

interface EntradaCandidata {
  romaneio: string;
  obs: string;
  itens: Map<string, number>;
}

/**
 * Procura uma entrada que já tenha recebido (parte de) esta saída no destino.
 * `null` = pode gravar. Erro de consulta propaga: quem chama decide (a rota segue
 * fail-open, como as outras travas).
 */
export async function buscarEntradaJaFeita(params: {
  companyKey: string;
  filialDestino: string;
  romaneioSaida: string;
  filialOrigem: string;
  dataRomaneio?: string | null;
  itens: ItemEntradaPedido[];
}): Promise<EntradaJaFeita | null> {
  const romaneioSaida = (params.romaneioSaida || '').trim();
  if (!romaneioSaida || params.itens.length === 0) return null;

  const pedido = new Map<string, number>();
  for (const item of params.itens) {
    const k = chaveItem(item.produto, item.corProduto);
    pedido.set(k, (pedido.get(k) ?? 0) + Math.max(0, Math.round(item.quantidade)));
  }

  const filialNome = await nomeFilialLinx(params.filialDestino);
  const marcador = marcadorReferenciaSaida(romaneioSaida, params.filialOrigem);
  // A tela Defeitos já gravava "DEFEITO ROMANEIO <saida> - <origem>" antes do marcador.
  const legadoDefeito = `ROMANEIO ${romaneioSaida} - ${normTexto(params.filialOrigem)}`;

  // Entrada não pode ser anterior à saída que ela confirma.
  const diaSaida = diaDoRomaneio(params.dataRomaneio) || diaMenos(60);
  const diaAssinatura = [diaSaida, diaMenos(DIAS_ASSINATURA)].sort().pop()!;

  const rows = await query<{ ROM: string; OBS: string | null; PRODUTO: string; COR: string | null; QTDE: number }>(`
    SELECT
      RTRIM(e.ROMANEIO_PRODUTO) AS ROM,
      CAST(e.OBS AS VARCHAR(1000)) AS OBS,
      RTRIM(p.PRODUTO) AS PRODUTO,
      RTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)), '')) AS COR,
      p.QTDE
    FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
    JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
      ON p.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO
     AND (p.FILIAL IS NULL OR LTRIM(RTRIM(p.FILIAL)) = '' OR p.FILIAL = e.FILIAL)
    WHERE RTRIM(e.FILIAL) = '${sqlLiteral(filialNome)}'
      AND e.EMISSAO >= '${diaSaida}'
      AND (
        UPPER(CAST(e.OBS AS VARCHAR(1000))) LIKE '%${likeLiteral(marcador)}%'
        OR UPPER(CAST(e.OBS AS VARCHAR(1000))) LIKE '%${likeLiteral(legadoDefeito)}%'
        OR e.EMISSAO >= '${diaAssinatura}'
      )
  `);

  const entradas = new Map<string, EntradaCandidata>();
  for (const r of rows) {
    const rom = (r.ROM || '').trim();
    if (!entradas.has(rom)) entradas.set(rom, { romaneio: rom, obs: normTexto(r.OBS), itens: new Map() });
    const e = entradas.get(rom)!;
    const k = chaveItem(r.PRODUTO, r.COR);
    e.itens.set(k, (e.itens.get(k) ?? 0) + (Number(r.QTDE) || 0));
  }
  const ordenadas = [...entradas.values()].sort((a, b) => a.romaneio.localeCompare(b.romaneio));

  // ── 1. VÍNCULO ──
  const vinculadas = ordenadas.filter((e) => e.obs.includes(marcador) || e.obs.includes(legadoDefeito));
  if (vinculadas.length > 0) {
    const recebido = new Map<string, number>();
    for (const e of vinculadas) {
      for (const [k, q] of e.itens) recebido.set(k, (recebido.get(k) ?? 0) + q);
    }
    const repetidos = [...pedido.keys()].filter((k) => (recebido.get(k) ?? 0) > 0);
    if (repetidos.length > 0) {
      // Só dá para "reaproveitar" se UMA entrada já cobre tudo o que foi pedido.
      const cobre = vinculadas.find((e) =>
        [...pedido].every(([k, q]) => (e.itens.get(k) ?? 0) >= q)
      );
      return {
        romaneio: (cobre ?? vinculadas[vinculadas.length - 1]).romaneio,
        completa: !!cobre,
        itensRepetidos: repetidos.map((k) => k.replace('|', '/')),
        prova: 'vinculo',
      };
    }
  }

  // ── 2. ASSINATURA (entradas sem marcador) ──
  const identicas = ordenadas.filter((e) => {
    if (e.obs.includes(PREFIXO_MARCADOR)) return false; // já é vínculo de outra saída
    if (e.itens.size !== pedido.size) return false;
    for (const [k, q] of pedido) if (e.itens.get(k) !== q) return false;
    return true;
  });
  if (identicas.length === 0) return null;

  const donos = await getSaidasDasEntradas(params.companyKey, identicas.map((e) => e.romaneio));
  const repeticao = identicas.find((e) => {
    const saidas = donos.get(e.romaneio);
    // Sem dono = gravada e nunca confirmada (o caso da resposta perdida);
    // dono = esta saída → repetição. Dono = outra saída → não é com ela.
    return !saidas || saidas.size === 0 || saidas.has(romaneioSaida);
  });
  if (!repeticao) return null;

  return {
    romaneio: repeticao.romaneio,
    completa: true,
    itensRepetidos: [...pedido.keys()].map((k) => k.replace('|', '/')),
    prova: 'assinatura',
  };
}

export function mensagemEntradaDuplicada(entrada: EntradaJaFeita, romaneioSaida: string): string {
  if (entrada.completa) {
    return `A saída ${romaneioSaida} já deu entrada neste destino (romaneio ${entrada.romaneio}). Nada foi lançado de novo.`;
  }
  const lista = entrada.itensRepetidos.slice(0, 5).join(', ');
  const resto = entrada.itensRepetidos.length > 5 ? ` e mais ${entrada.itensRepetidos.length - 5}` : '';
  return `A saída ${romaneioSaida} já deu entrada neste destino (romaneio ${entrada.romaneio}) para ${lista}${resto}. Para não duplicar o estoque, nada foi lançado — confira o romaneio de entrada antes de seguir.`;
}
