import 'server-only';

import { query } from '@/lib/db/connection';
import { getFilialById } from '@/lib/config/filial-registry';
import type { CompanyKey } from '@/lib/config/company';

/* ════════════════════════════════════════════════════════════════════════
 *  Ajuste de Estoque — leitura/cálculo (sem escrita).
 *  A escrita fica no executor (lib/ajuste-estoque-executor.ts), que usa as
 *  tabelas nativas de contagem do Linx + trigger. Ver memória:
 *  ajuste-estoque-mecanismo-trigger.
 * ════════════════════════════════════════════════════════════════════════ */

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

export interface FilialAjuste {
  cod: string;
  nome: string; // FILIAIS.FILIAL exato (chave de escrita)
  display: string;
  estoquePositivo: number;
  linhas: number;
  company: CompanyKey | null;
}

interface FilialRow {
  cod: string;
  nome: string;
  estPos: number;
  linhas: number;
}

async function carregarFiliaisComEstoque(): Promise<FilialRow[]> {
  const rows = await query<{ COD: string; NOME: string; EST_POS: number; LINHAS: number }>(`
    SELECT f.COD_FILIAL AS COD, RTRIM(f.FILIAL) AS NOME,
           ISNULL(s.EST_POS, 0) AS EST_POS, ISNULL(s.LINHAS, 0) AS LINHAS
    FROM FILIAIS f WITH (NOLOCK)
    LEFT JOIN (
      SELECT RTRIM(FILIAL) AS FILIAL,
             SUM(CASE WHEN ESTOQUE > 0 THEN ESTOQUE ELSE 0 END) AS EST_POS,
             COUNT(*) AS LINHAS
      FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
      GROUP BY RTRIM(FILIAL)
    ) s ON s.FILIAL = RTRIM(f.FILIAL)
    WHERE f.FILIAL IS NOT NULL AND RTRIM(f.FILIAL) <> ''
  `);
  return rows.map((r) => ({
    cod: String(r.COD ?? '').trim(),
    nome: String(r.NOME ?? '').trim(),
    estPos: Number(r.EST_POS) || 0,
    linhas: Number(r.LINHAS) || 0,
  }));
}

/**
 * Lista filiais para a tela de ajuste:
 *  - ativas: filiais operacionais da empresa (registry, modules não-vazio);
 *  - inativas: demais filiais COM estoque positivo (úteis p/ zerar lojas desativadas).
 */
export async function listarFiliaisParaAjuste(
  company: CompanyKey
): Promise<{ ativas: FilialAjuste[]; inativas: FilialAjuste[] }> {
  const rows = await carregarFiliaisComEstoque();
  const ativas: FilialAjuste[] = [];
  const inativas: FilialAjuste[] = [];

  for (const r of rows) {
    const def = getFilialById(r.cod);
    const isAtivaDaEmpresa = !!def && def.company === company && def.modules.length > 0;
    const item: FilialAjuste = {
      cod: r.cod,
      nome: r.nome,
      display: def?.display ?? r.nome,
      estoquePositivo: r.estPos,
      linhas: r.linhas,
      company: def?.company ?? null,
    };
    if (isAtivaDaEmpresa) {
      ativas.push(item);
    } else if (r.estPos > 0) {
      // Não-utilizada / desativada / de outra empresa, mas ainda com estoque.
      inativas.push(item);
    }
  }

  ativas.sort((a, b) => a.display.localeCompare(b.display));
  inativas.sort((a, b) => b.estoquePositivo - a.estoquePositivo);
  return { ativas, inativas };
}

/** Resolve o nome EXATO da filial (FILIAIS.FILIAL) a partir do COD_FILIAL. */
export async function resolverNomeFilial(cod: string): Promise<string | null> {
  const codEsc = esc(cod.trim());
  const rows = await query<{ NOME: string }>(`
    SELECT TOP 1 RTRIM(FILIAL) AS NOME FROM FILIAIS WITH (NOLOCK)
    WHERE LTRIM(RTRIM(COD_FILIAL)) = '${codEsc}'
  `);
  return rows[0]?.NOME?.trim() ?? null;
}

export interface SaldoItem {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  estoque: number;
}

/** Saldo atual da filial (itens com estoque ≠ 0 por padrão). */
export async function trazerSaldo(
  filialNome: string,
  incluirZerados = false
): Promise<SaldoItem[]> {
  const nomeEsc = esc(filialNome.trim());
  const filtroEstoque = incluirZerados ? '' : 'AND ep.ESTOQUE <> 0';
  const rows = await query<{
    PRODUTO: string;
    COR: string;
    ESTOQUE: number;
    DESC_PRODUTO: string;
    DESC_COR: string;
    CODIGO_BARRA: string | null;
  }>(`
    SELECT RTRIM(ep.PRODUTO) AS PRODUTO,
           RTRIM(ISNULL(ep.COR_PRODUTO, '')) AS COR,
           ep.ESTOQUE AS ESTOQUE,
           RTRIM(ISNULL(p.DESC_PRODUTO, '')) AS DESC_PRODUTO,
           RTRIM(ISNULL(cb.DESC_COR, '')) AS DESC_COR,
           bc.CODIGO_BARRA AS CODIGO_BARRA
    FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = ep.PRODUTO
    LEFT JOIN CORES_BASICAS cb WITH (NOLOCK) ON cb.COR = ep.COR_PRODUTO
    OUTER APPLY (
      SELECT MIN(RTRIM(pb.CODIGO_BARRA)) AS CODIGO_BARRA
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE pb.PRODUTO = ep.PRODUTO
        AND RTRIM(ISNULL(pb.COR_PRODUTO, '')) = RTRIM(ISNULL(ep.COR_PRODUTO, ''))
    ) bc
    WHERE RTRIM(ep.FILIAL) = '${nomeEsc}' ${filtroEstoque}
    ORDER BY ep.PRODUTO, ep.COR_PRODUTO
  `);
  return rows.map((r) => ({
    produto: r.PRODUTO?.trim() ?? '',
    cor: r.COR?.trim() ?? '',
    descProduto: r.DESC_PRODUTO?.trim() ?? '',
    descCor: r.DESC_COR?.trim() ?? '',
    codigoBarra: r.CODIGO_BARRA?.toString().trim() ?? null,
    estoque: Number(r.ESTOQUE) || 0,
  }));
}

export interface LinhaArquivo {
  codigo: string;
  qtd: number;
}

/** Parseia o conteúdo do arquivo de inventário ("codigo;qtd" por linha). */
export function parseArquivoContagem(texto: string): {
  linhas: LinhaArquivo[];
  invalidas: string[];
} {
  const linhas: LinhaArquivo[] = [];
  const invalidas: string[] = [];
  const agregado = new Map<string, number>();
  for (const raw of texto.split(/\r?\n/)) {
    const linha = raw.trim();
    if (!linha) continue;
    const partes = linha.split(/[;,\t]+/);
    if (partes.length < 2) {
      invalidas.push(linha);
      continue;
    }
    const codigo = partes[0].trim();
    const qtd = parseInt(partes[1].trim(), 10);
    if (!codigo || Number.isNaN(qtd)) {
      invalidas.push(linha);
      continue;
    }
    agregado.set(codigo, (agregado.get(codigo) ?? 0) + qtd);
  }
  for (const [codigo, qtd] of agregado) linhas.push({ codigo, qtd });
  return { linhas, invalidas };
}

export interface ContagemItem {
  produto: string;
  cor: string;
  qtdContada: number;
}

/**
 * Resolve códigos de barra do arquivo → produto+cor (PRODUTOS_BARRA) e agrega
 * a quantidade contada por (produto, cor). Retorna também o que não casou.
 */
export async function resolverContagemPorCodigoBarra(
  linhas: LinhaArquivo[]
): Promise<{ itens: ContagemItem[]; naoEncontrados: string[]; ambiguos: string[] }> {
  const naoEncontrados: string[] = [];
  const ambiguos: string[] = [];
  const porProdutoCor = new Map<string, number>();
  const qtdPorCodigo = new Map(linhas.map((l) => [l.codigo, l.qtd]));
  const codigos = [...qtdPorCodigo.keys()];
  const resolvidos = new Set<string>();

  // 1) Match exato (trim). Em chunks para não estourar o tamanho do IN.
  for (let i = 0; i < codigos.length; i += 500) {
    const chunk = codigos.slice(i, i + 500);
    const inList = chunk.map((c) => `'${esc(c)}'`).join(',');
    const rows = await query<{ CB: string; PRODUTO: string; COR: string; N: number }>(`
      SELECT LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) AS CB,
             RTRIM(pb.PRODUTO) AS PRODUTO,
             RTRIM(ISNULL(pb.COR_PRODUTO, '')) AS COR,
             COUNT(*) OVER (PARTITION BY LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) AS N
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) IN (${inList})
    `);
    const byCb = new Map<string, { produto: string; cor: string; n: number }>();
    for (const r of rows) {
      const cb = r.CB?.trim();
      if (!cb) continue;
      // Se o mesmo código mapeia para produtos/cores diferentes, marca ambíguo.
      const prev = byCb.get(cb);
      if (prev && (prev.produto !== r.PRODUTO?.trim() || prev.cor !== r.COR?.trim())) {
        prev.n = 2;
      } else if (!prev) {
        byCb.set(cb, { produto: r.PRODUTO?.trim() ?? '', cor: r.COR?.trim() ?? '', n: Number(r.N) || 1 });
      }
    }
    for (const cb of chunk) {
      const hit = byCb.get(cb.trim());
      if (!hit) continue;
      if (hit.n > 1) {
        ambiguos.push(cb);
        resolvidos.add(cb);
        continue;
      }
      const key = `${hit.produto}|${hit.cor}`;
      porProdutoCor.set(key, (porProdutoCor.get(key) ?? 0) + (qtdPorCodigo.get(cb) ?? 0));
      resolvidos.add(cb);
    }
  }

  // 2) Match numérico (TRY_CONVERT BIGINT) para o que sobrou.
  const restantes = codigos.filter((c) => !resolvidos.has(c));
  for (let i = 0; i < restantes.length; i += 500) {
    const chunk = restantes.slice(i, i + 500);
    const inList = chunk
      .map((c) => c.replace(/\D/g, ''))
      .filter((c) => c.length > 0)
      .map((c) => `'${c}'`);
    if (inList.length === 0) {
      chunk.forEach((c) => naoEncontrados.push(c));
      continue;
    }
    const rows = await query<{ CBNUM: string; PRODUTO: string; COR: string }>(`
      SELECT CAST(TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) AS VARCHAR(100)) AS CBNUM,
             RTRIM(pb.PRODUTO) AS PRODUTO,
             RTRIM(ISNULL(pb.COR_PRODUTO, '')) AS COR
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) IN (${inList.join(',')})
    `);
    const byNum = new Map<string, { produto: string; cor: string }[]>();
    for (const r of rows) {
      const k = String(r.CBNUM ?? '').trim();
      if (!k) continue;
      const arr = byNum.get(k) ?? [];
      arr.push({ produto: r.PRODUTO?.trim() ?? '', cor: r.COR?.trim() ?? '' });
      byNum.set(k, arr);
    }
    for (const c of chunk) {
      const num = String(parseInt(c.replace(/\D/g, ''), 10));
      const hits = byNum.get(num);
      if (!hits || hits.length === 0) {
        naoEncontrados.push(c);
        continue;
      }
      const distinct = new Set(hits.map((h) => `${h.produto}|${h.cor}`));
      if (distinct.size > 1) {
        ambiguos.push(c);
        continue;
      }
      const key = [...distinct][0];
      porProdutoCor.set(key, (porProdutoCor.get(key) ?? 0) + (qtdPorCodigo.get(c) ?? 0));
    }
  }

  const itens: ContagemItem[] = [...porProdutoCor.entries()].map(([key, qtd]) => {
    const [produto, cor] = key.split('|');
    return { produto, cor, qtdContada: qtd };
  });
  return { itens, naoEncontrados, ambiguos };
}

export interface DiferencaLinha {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  saldo: number;
  contagem: number;
  delta: number;
}

export interface DiferencasResultado {
  linhas: DiferencaLinha[];
  totais: {
    itens: number;
    comDiferenca: number;
    positivos: number;
    negativos: number;
    somaDelta: number;
  };
  naoEncontrados: string[];
  ambiguos: string[];
  invalidas: string[];
}

/**
 * Calcula as diferenças (contagem − saldo atual) para um dos modos:
 *  - 'zerar': zera todo item com estoque (contagem = 0);
 *  - 'inventario': compara o arquivo com o saldo; item do saldo NÃO contado vira 0
 *    (inventário completo: o que não foi contado some).
 */
export async function calcularDiferencas(opts: {
  filialNome: string;
  modo: 'zerar' | 'inventario';
  arquivoTexto?: string;
  incluirZerados?: boolean;
  /** Inventário completo: itens do saldo não contados viram 0 (default true). */
  zerarNaoContados?: boolean;
}): Promise<DiferencasResultado> {
  const { filialNome, modo } = opts;
  const zerarNaoContados = opts.zerarNaoContados !== false;
  const saldo = await trazerSaldo(filialNome, false);
  const saldoMap = new Map(saldo.map((s) => [`${s.produto}|${s.cor}`, s]));

  let naoEncontrados: string[] = [];
  let ambiguos: string[] = [];
  let invalidas: string[] = [];
  const contagemMap = new Map<string, number>();

  if (modo === 'inventario') {
    const parsed = parseArquivoContagem(opts.arquivoTexto ?? '');
    invalidas = parsed.invalidas;
    const resolvido = await resolverContagemPorCodigoBarra(parsed.linhas);
    naoEncontrados = resolvido.naoEncontrados;
    ambiguos = resolvido.ambiguos;
    for (const it of resolvido.itens) {
      contagemMap.set(`${it.produto}|${it.cor}`, it.qtdContada);
    }
  }

  // Universo de chaves. Inventário completo (zerarNaoContados): saldo ∪ contagem
  // (itens não contados viram 0). Inventário parcial: apenas itens contados.
  const chaves =
    modo === 'inventario' && !zerarNaoContados
      ? new Set<string>(contagemMap.keys())
      : new Set<string>([...saldoMap.keys(), ...contagemMap.keys()]);
  const linhas: DiferencaLinha[] = [];

  // Para itens contados que não estão no saldo, buscamos descrição depois.
  const semDescricao: string[] = [];

  for (const chave of chaves) {
    const [produto, cor] = chave.split('|');
    const s = saldoMap.get(chave);
    const saldoQtd = s?.estoque ?? 0;
    const contagem = modo === 'zerar' ? 0 : contagemMap.get(chave) ?? 0;
    const delta = contagem - saldoQtd;
    if (!s) semDescricao.push(produto);
    linhas.push({
      produto,
      cor,
      descProduto: s?.descProduto ?? '',
      descCor: s?.descCor ?? '',
      codigoBarra: s?.codigoBarra ?? null,
      saldo: saldoQtd,
      contagem,
      delta,
    });
  }

  // Enriquecer descrição dos itens contados que não estavam no saldo.
  if (semDescricao.length > 0) {
    const unicos = [...new Set(semDescricao)];
    for (let i = 0; i < unicos.length; i += 500) {
      const chunk = unicos.slice(i, i + 500);
      const inList = chunk.map((p) => `'${esc(p)}'`).join(',');
      const rows = await query<{ PRODUTO: string; DESC_PRODUTO: string }>(`
        SELECT RTRIM(PRODUTO) AS PRODUTO, RTRIM(ISNULL(DESC_PRODUTO, '')) AS DESC_PRODUTO
        FROM PRODUTOS WITH (NOLOCK) WHERE RTRIM(PRODUTO) IN (${inList})
      `);
      const desc = new Map(rows.map((r) => [r.PRODUTO?.trim(), r.DESC_PRODUTO?.trim() ?? '']));
      for (const l of linhas) {
        if (!l.descProduto && desc.has(l.produto)) l.descProduto = desc.get(l.produto) ?? '';
      }
    }
  }

  linhas.sort((a, b) => {
    if (a.produto === b.produto) return a.cor.localeCompare(b.cor);
    return a.produto.localeCompare(b.produto);
  });

  const comDiferenca = linhas.filter((l) => l.delta !== 0);
  const totais = {
    itens: linhas.length,
    comDiferenca: comDiferenca.length,
    positivos: comDiferenca.filter((l) => l.delta > 0).length,
    negativos: comDiferenca.filter((l) => l.delta < 0).length,
    somaDelta: comDiferenca.reduce((s, l) => s + l.delta, 0),
  };

  return { linhas, totais, naoEncontrados, ambiguos, invalidas };
}
