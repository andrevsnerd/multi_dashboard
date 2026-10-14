import { query } from '@/lib/db/connection';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TRAVA DE ESTOQUE NEGATIVO — saída não passa do saldo onde o Linx não deixa.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Quem manda é o Linx: `FILIAIS.PERMITE_EST_NEGATIVO = 0` faz o trigger
 * LXU_ESTOQUE_PRODUTOS recusar qualquer UPDATE que deixe ESTOQUE ou um ESx < 0
 * ("Operacao Cancelada! O Estoque nao pode ser negativo!"). Vale para todas as
 * telas do ERP, para o PDV e para o dashboard. Hoje: NERD (matriz, 000069, desde
 * 14/10/2026) e SCARF ME - MATRIZ, entre outras.
 *
 * Por que conferir aqui também, se o Linx já recusa: via proxy o executor NÃO
 * roda em transação. Cabeçalho e itens são statements separados — o Linx recusa o
 * 3º item, mas o cabeçalho e os 2 primeiros já ficaram gravados (romaneio pela
 * metade). Conferir ANTES de gravar evita isso e devolve uma mensagem legível.
 *
 * A filial é lida do cadastro (não há lista fixa aqui): ligar/desligar o
 * parâmetro no Linx liga/desliga esta trava junto.
 *
 * Saldo disponível = menor entre ESTOQUE e o ES do TAMANHO_BASE, porque a saída
 * do dashboard sempre baixa na coluna do tamanho base (SA_n) e o trigger confere
 * as duas. Item sem linha em ESTOQUE_PRODUTOS tem saldo 0.
 */

export interface ItemSaidaSaldo {
  produto: string;
  corProduto?: string | null;
  quantidade: number;
}

export interface FaltaSaldo {
  produto: string;
  cor: string;
  pedido: number;
  disponivel: number;
}

export interface TravaEstoqueNegativo {
  filial: string;
  faltas: FaltaSaldo[];
}

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Confere se a saída cabe no saldo da filial. `null` = pode gravar (ou a filial
 * permite estoque negativo). Falha de consulta propaga: a gravação também iria
 * falhar no mesmo banco.
 */
export async function verificarSaldoSaida(
  filial: string,
  itens: ItemSaidaSaldo[]
): Promise<TravaEstoqueNegativo | null> {
  const filialTrim = (filial || '').trim();
  if (!filialTrim || !itens?.length) return null;

  const cad = await query<{ FILIAL: string; PERMITE: number | boolean | null }>(`
    SELECT TOP 1 RTRIM(FILIAL) AS FILIAL, PERMITE_EST_NEGATIVO AS PERMITE
    FROM FILIAIS WITH (NOLOCK)
    WHERE FILIAL = ${lit(filialTrim)} OR COD_FILIAL = ${lit(filialTrim)}
  `);
  const row = cad[0];
  if (!row || row.PERMITE === null || Number(row.PERMITE) === 1 || row.PERMITE === true) return null;
  const filialNome = row.FILIAL;

  // Soma por produto×cor: o mesmo SKU pode vir em mais de uma linha.
  const pedido = new Map<string, FaltaSaldo>();
  for (const it of itens) {
    const produto = (it.produto || '').trim();
    const cor = (it.corProduto ?? '').toString().trim();
    const qtd = Math.floor(Number(it.quantidade) || 0);
    if (!produto || qtd <= 0) continue;
    const key = `${produto}|${cor}`;
    const atual = pedido.get(key) ?? { produto, cor, pedido: 0, disponivel: 0 };
    atual.pedido += qtd;
    pedido.set(key, atual);
  }
  if (pedido.size === 0) return null;

  const produtos = [...new Set([...pedido.values()].map((p) => p.produto))];
  const esCase = Array.from({ length: 48 }, (_, i) => `WHEN ${i + 1} THEN e.ES${i + 1}`).join(' ');
  const saldos = await query<{ PRODUTO: string; COR: string; ESTOQUE: number; ES_BASE: number }>(`
    SELECT RTRIM(e.PRODUTO) AS PRODUTO, RTRIM(ISNULL(e.COR_PRODUTO,'')) AS COR,
           ISNULL(e.ESTOQUE,0) AS ESTOQUE,
           ISNULL(CASE ISNULL(p.TAMANHO_BASE,1) ${esCase} ELSE e.ES1 END, 0) AS ES_BASE
    FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = e.PRODUTO
    WHERE e.FILIAL = ${lit(filialNome)}
      AND e.PRODUTO IN (${produtos.map(lit).join(',')})
  `);
  const saldoPorSku = new Map<string, number>();
  for (const s of saldos) {
    saldoPorSku.set(`${s.PRODUTO}|${s.COR}`, Math.min(Number(s.ESTOQUE) || 0, Number(s.ES_BASE) || 0));
  }

  const faltas: FaltaSaldo[] = [];
  for (const [key, p] of pedido) {
    const disponivel = saldoPorSku.get(key) ?? 0;
    if (p.pedido > disponivel) faltas.push({ ...p, disponivel });
  }
  return faltas.length > 0 ? { filial: filialNome, faltas } : null;
}

export function mensagemTravaEstoqueNegativo(trava: TravaEstoqueNegativo): string {
  const lista = trava.faltas
    .slice(0, 10)
    .map((f) => `${f.produto}${f.cor ? ` cor ${f.cor}` : ''} (pedido ${f.pedido}, saldo ${Math.max(0, f.disponivel)})`)
    .join('; ');
  const resto = trava.faltas.length > 10 ? ` e mais ${trava.faltas.length - 10} item(ns)` : '';
  return (
    `Saldo insuficiente em ${trava.filial}: esta filial não pode ficar com estoque negativo. ` +
    `Sem saldo para: ${lista}${resto}. Nada foi gravado — lance a entrada que falta antes da saída.`
  );
}
