import 'server-only';

import { query } from '@/lib/db/connection';
import {
  trazerSaldo,
  type DiferencaLinha,
  type DiferencasResultado,
  type QtdPorTamanho,
} from '@/lib/repositories/ajusteEstoque';
import { carregarGrades } from '@/lib/server/grade-produto';

/* ════════════════════════════════════════════════════════════════════════
 *  Inventário por bipagem — o mesmo "Calcular diferenças" do Inventário
 *  (arquivo) da tela de Ajuste de Estoque, mas a contagem vem da lista
 *  bipada na tela (produto × cor × tamanho) em vez de um arquivo.
 *  A escrita continua no executor do ajuste (lib/ajuste-estoque-executor.ts).
 * ════════════════════════════════════════════════════════════════════════ */

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

/** '06' e '6' são a mesma cor (PRODUTOS_BARRA × ESTOQUE_PRODUTOS divergem no formato). */
function normCor(cor: string): string {
  const c = (cor ?? '').trim();
  return /^\d+$/.test(c) ? String(Number(c)) : c.toUpperCase();
}

function chaveNorm(produto: string, cor: string): string {
  return `${(produto ?? '').trim().toUpperCase()}|${normCor(cor)}`;
}

function mesmosTamanhos(a: QtdPorTamanho, b: QtdPorTamanho): boolean {
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of chaves) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/** Uma linha da lista bipada (cada tamanho de peça P/M/G é uma linha). */
export interface LinhaBipada {
  produto: string;
  cor: string;
  quantidade: number;
  /** Posição da grade (1..48); obrigatória em peça P/M/G. */
  tamanho: number | null;
}

export interface DiferencasBipagem extends DiferencasResultado {
  /** Peças P/M/G sem tamanho (ou com tamanho fora da grade) — bloqueiam a gravação. */
  pendenciasTamanho: string[];
  /** Itens com saldo que não foram bipados (viram 0 no inventário completo). */
  naoBipados: number;
}

/**
 * Diferenças (contagem bipada − saldo atual) da filial.
 *  - zerarNaoContados (inventário completo): item com saldo que NÃO foi bipado vira 0;
 *  - parcial: só os itens bipados entram.
 * Peça P/M/G leva a contagem por tamanho (o executor acerta tamanho a tamanho);
 * as demais vão só pelo total (o executor mantém a distribuição atual).
 */
export async function calcularDiferencasBipagem(opts: {
  filialNome: string;
  linhas: LinhaBipada[];
  zerarNaoContados: boolean;
}): Promise<DiferencasBipagem> {
  const { filialNome, zerarNaoContados } = opts;
  const saldo = await trazerSaldo(filialNome, false);
  const saldoMap = new Map(saldo.map((s) => [`${s.produto}|${s.cor}`, s]));
  const saldoPorNorm = new Map(saldo.map((s) => [chaveNorm(s.produto, s.cor), s]));

  const linhas = opts.linhas
    .map((l) => ({
      produto: String(l.produto ?? '').trim(),
      cor: String(l.cor ?? '').trim(),
      quantidade: Math.trunc(Number(l.quantidade) || 0),
      tamanho: Number.isInteger(Number(l.tamanho)) && Number(l.tamanho) > 0 ? Number(l.tamanho) : null,
    }))
    .filter((l) => l.produto && l.quantidade > 0);

  const grades = await carregarGrades(linhas.map((l) => l.produto));

  const contagemMap = new Map<string, number>();
  const contagemTamanhosMap = new Map<string, QtdPorTamanho | null>();
  const pendenciasTamanho: string[] = [];

  for (const l of linhas) {
    // A cor do saldo manda: gravar a contagem em '6' com o estoque em '06' criaria
    // outra linha e deixaria a original sem ajuste.
    const s = saldoPorNorm.get(chaveNorm(l.produto, l.cor));
    const chave = s ? `${s.produto}|${s.cor}` : `${l.produto}|${l.cor}`;
    contagemMap.set(chave, (contagemMap.get(chave) ?? 0) + l.quantidade);

    const grade = grades.get(l.produto);
    if (!grade?.exigeTamanho) {
      contagemTamanhosMap.set(chave, null);
      continue;
    }
    const valido = l.tamanho != null && grade.tamanhos.some((t) => t.ordinal === l.tamanho);
    if (!valido) {
      pendenciasTamanho.push(`${l.produto}${l.cor ? ` cor ${l.cor}` : ''}`);
      contagemTamanhosMap.set(chave, null);
      continue;
    }
    const atual = contagemTamanhosMap.has(chave) ? contagemTamanhosMap.get(chave)! : {};
    if (atual === null) continue;
    atual[String(l.tamanho)] = (atual[String(l.tamanho)] ?? 0) + l.quantidade;
    contagemTamanhosMap.set(chave, atual);
  }

  const chaves = zerarNaoContados
    ? new Set<string>([...saldoMap.keys(), ...contagemMap.keys()])
    : new Set<string>(contagemMap.keys());

  const resultado: DiferencaLinha[] = [];
  const semDescricao: string[] = [];
  let naoBipados = 0;

  for (const chave of chaves) {
    const [produto, cor] = chave.split('|');
    const s = saldoMap.get(chave);
    const saldoQtd = s?.estoque ?? 0;
    const contado = contagemMap.has(chave);
    const contagem = contagemMap.get(chave) ?? 0;
    if (!contado) naoBipados += 1;
    const delta = contagem - saldoQtd;
    const saldoTamanhos = s?.tamanhos ?? {};
    // Não bipado: alvo zero em todos os tamanhos.
    const contagemTamanhos = contado ? contagemTamanhosMap.get(chave) ?? null : {};
    const ajustaTamanho =
      delta === 0 && contagemTamanhos !== null && !mesmosTamanhos(saldoTamanhos, contagemTamanhos);
    if (!s) semDescricao.push(produto);
    resultado.push({
      produto,
      cor,
      descProduto: s?.descProduto ?? '',
      descCor: s?.descCor ?? '',
      codigoBarra: s?.codigoBarra ?? null,
      saldo: saldoQtd,
      contagem,
      delta,
      saldoTamanhos,
      contagemTamanhos,
      ajustaTamanho,
    });
  }

  if (semDescricao.length > 0) {
    const unicos = [...new Set(semDescricao)];
    for (let i = 0; i < unicos.length; i += 500) {
      const inList = unicos
        .slice(i, i + 500)
        .map((p) => `'${esc(p)}'`)
        .join(',');
      const rows = await query<{ PRODUTO: string; DESC_PRODUTO: string }>(`
        SELECT RTRIM(PRODUTO) AS PRODUTO, RTRIM(ISNULL(DESC_PRODUTO, '')) AS DESC_PRODUTO
        FROM PRODUTOS WITH (NOLOCK) WHERE RTRIM(PRODUTO) IN (${inList})
      `);
      const desc = new Map(rows.map((r) => [r.PRODUTO?.trim(), r.DESC_PRODUTO?.trim() ?? '']));
      for (const l of resultado) {
        if (!l.descProduto && desc.has(l.produto)) l.descProduto = desc.get(l.produto) ?? '';
      }
    }
  }

  resultado.sort((a, b) =>
    a.produto === b.produto ? a.cor.localeCompare(b.cor) : a.produto.localeCompare(b.produto)
  );

  const comDiferenca = resultado.filter((l) => l.delta !== 0 || l.ajustaTamanho);
  const totais = {
    itens: resultado.length,
    comDiferenca: comDiferenca.length,
    positivos: comDiferenca.filter((l) => l.delta > 0).length,
    negativos: comDiferenca.filter((l) => l.delta < 0).length,
    somaDelta: comDiferenca.reduce((s, l) => s + l.delta, 0),
    saldoAtualTotal: resultado.reduce((s, l) => s + l.saldo, 0),
    saldoFinalTotal: resultado.reduce((s, l) => s + l.contagem, 0),
    itensSaldoNegativo: resultado.filter((l) => l.saldo < 0).length,
  };

  return {
    linhas: resultado,
    totais,
    naoEncontrados: [],
    ambiguos: [],
    invalidas: [],
    pendenciasTamanho: [...new Set(pendenciasTamanho)],
    naoBipados,
  };
}
