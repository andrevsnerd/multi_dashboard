import 'server-only';

import { query } from '@/lib/db/connection';
import { getFilialById, normalizeFilialId } from '@/lib/config/filial-registry';
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

function normNome(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function adivinharEmpresaPorNome(nome: string): CompanyKey {
  return normNome(nome).startsWith('NERD') ? 'nerd' : 'scarfme';
}

export interface FilialAjuste {
  cod: string;
  nome: string; // FILIAIS.FILIAL exato (chave de escrita e exibição)
  display: string; // = nome real (mantido por compat com o front)
  apelido: string | null; // apelido curto do registry, se houver
  estoquePositivo: number;
  linhas: number;
  company: CompanyKey | null;
  vendaRecente: boolean;
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

/** Nomes (FILIAIS.FILIAL) com venda nos últimos `dias` — varejo (LOJA_VENDA) + e-commerce (FATURAMENTO). */
async function carregarFiliaisComVendaRecente(dias = 7): Promise<Set<string>> {
  const rows = await query<{ NOME: string }>(`
    SELECT DISTINCT RTRIM(fil.FILIAL) AS NOME
    FROM FILIAIS fil WITH (NOLOCK)
    INNER JOIN LOJA_VENDA v WITH (NOLOCK) ON v.CODIGO_FILIAL = fil.COD_FILIAL
    WHERE v.DATA_VENDA >= DATEADD(DAY, -${dias}, GETDATE())
    UNION
    SELECT DISTINCT RTRIM(f.FILIAL) AS NOME
    FROM FATURAMENTO f WITH (NOLOCK)
    WHERE f.EMISSAO >= DATEADD(DAY, -${dias}, GETDATE())
      AND f.NOTA_CANCELADA = 0
      AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
  `);
  return new Set(rows.map((r) => normNome(r.NOME)));
}

/**
 * Lista filiais para a tela de ajuste:
 *  - ativas: filiais da empresa EM USO = com venda nos últimos 7 dias. Inclui também
 *    depósito/MATRIZ (registry inventory-only, não vende mas é operacional).
 *    Membros de grupo obsoletos (sem venda recente) caem em "não utilizadas".
 *  - inativas: TODO o restante (não-ativo desta empresa), inclusive sem estoque.
 *  Nome exibido = nome REAL (FILIAIS.FILIAL).
 */
export async function listarFiliaisParaAjuste(
  company: CompanyKey
): Promise<{ ativas: FilialAjuste[]; inativas: FilialAjuste[] }> {
  const [rows, vendaRecenteSet] = await Promise.all([
    carregarFiliaisComEstoque(),
    carregarFiliaisComVendaRecente().catch(() => new Set<string>()),
  ]);
  const ativas: FilialAjuste[] = [];
  const inativas: FilialAjuste[] = [];

  for (const r of rows) {
    const def = getFilialById(r.cod);
    const empresaDaFilial = def?.company ?? adivinharEmpresaPorNome(r.nome);
    const vendaRecente = vendaRecenteSet.has(normNome(r.nome));
    // Depósito/MATRIZ: no registry, operacional só em inventory (não vende).
    const inventoryOnly = !!def && def.modules.length > 0 && !def.modules.includes('sales');
    // Em uso (globalmente): vende recente OU é depósito operacional.
    const emUso = vendaRecente || inventoryOnly;

    const item: FilialAjuste = {
      cod: r.cod,
      nome: r.nome,
      display: r.nome, // nome real
      apelido: def?.display ?? null,
      estoquePositivo: r.estPos,
      linhas: r.linhas,
      company: def?.company ?? null,
      vendaRecente,
    };
    if (emUso && empresaDaFilial === company) {
      ativas.push(item); // ativa desta empresa
    } else if (!emUso) {
      inativas.push(item); // não utilizada (ninguém usa mais), inclusive sem estoque
    }
    // emUso de OUTRA empresa: fica fora (pertence à outra empresa).
  }

  ativas.sort((a, b) => a.nome.localeCompare(b.nome));
  // Não utilizadas: com estoque primeiro (mais úteis p/ zerar), depois por nome.
  inativas.sort((a, b) =>
    b.estoquePositivo - a.estoquePositivo || a.nome.localeCompare(b.nome)
  );
  return { ativas, inativas };
}

export interface AjusteRecente {
  nome: string;
  filial: string;
  emissao: string;
  itens: number;
  soma: number;
}

/** Lista os 10 ajustes mais recentes do responsável (para "desfazer"/consultar). Exclui estornos. */
export async function listarAjustesRecentes(responsavel: string): Promise<AjusteRecente[]> {
  const respEsc = esc(responsavel.trim());
  const rows = await query<{
    NOME: string;
    FILIAL: string;
    EMISSAO: Date;
    ITENS: number;
    SOMA: number;
  }>(`
    SELECT TOP 10 RTRIM(c.NOME_CONTAGEM) AS NOME, RTRIM(c.FILIAL) AS FILIAL, c.EMISSAO,
           ISNULL(s.ITENS, 0) AS ITENS, ISNULL(s.SOMA, 0) AS SOMA
    FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
    LEFT JOIN (
      SELECT NOME_CONTAGEM, COUNT(*) AS ITENS, SUM(ISNULL(QTDE_AJUSTE, 0)) AS SOMA
      FROM ESTOQUE_PROD_CTG_AJUSTE WITH (NOLOCK) GROUP BY NOME_CONTAGEM
    ) s ON s.NOME_CONTAGEM = c.NOME_CONTAGEM
    WHERE c.ESTOQUE_AJUSTADO = 1
      AND RTRIM(LTRIM(c.RESPONSAVEL)) = '${respEsc}'
      AND (c.OBS IS NULL OR CAST(c.OBS AS VARCHAR(60)) NOT LIKE 'ESTORNO%')
    ORDER BY c.DATA_PARA_TRANSFERENCIA DESC, c.EMISSAO DESC
  `);
  return rows.map((r) => ({
    nome: r.NOME?.trim() ?? '',
    filial: r.FILIAL?.trim() ?? '',
    emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : '',
    itens: Number(r.ITENS) || 0,
    soma: Number(r.SOMA) || 0,
  }));
}

export interface AjusteDetalheItem {
  produto: string;
  descProduto: string;
  cor: string;
  descCor: string;
  qtde: number;
}

/** Itens de um ajuste (contagem) — o que foi ajustado e quanto. */
export async function detalharAjuste(nomeContagem: string): Promise<AjusteDetalheItem[]> {
  const nomeEsc = esc(nomeContagem.trim());
  const rows = await query<{
    PRODUTO: string;
    COR: string;
    QTD: number;
    DESC_PRODUTO: string;
    DESC_COR: string;
  }>(`
    SELECT RTRIM(a.PRODUTO) AS PRODUTO, RTRIM(ISNULL(a.COR_PRODUTO, '')) AS COR,
           ISNULL(a.QTDE_AJUSTE, 0) AS QTD,
           RTRIM(ISNULL(p.DESC_PRODUTO, '')) AS DESC_PRODUTO,
           RTRIM(ISNULL(cb.DESC_COR, '')) AS DESC_COR
    FROM ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = a.PRODUTO
    LEFT JOIN (
      SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
      FROM PRODUTO_CORES WITH (NOLOCK)
      GROUP BY PRODUTO, COR_PRODUTO
    ) cb ON RTRIM(LTRIM(cb.PRODUTO)) = RTRIM(LTRIM(a.PRODUTO))
       AND (RTRIM(LTRIM(CAST(cb.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(a.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, cb.COR_PRODUTO) = TRY_CONVERT(INT, a.COR_PRODUTO))
    WHERE RTRIM(LTRIM(a.NOME_CONTAGEM)) = '${nomeEsc}'
    ORDER BY a.PRODUTO, a.COR_PRODUTO
  `);
  return rows.map((r) => ({
    produto: r.PRODUTO?.trim() ?? '',
    descProduto: r.DESC_PRODUTO?.trim() ?? '',
    cor: r.COR?.trim() ?? '',
    descCor: r.DESC_COR?.trim() ?? '',
    qtde: Number(r.QTD) || 0,
  }));
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
    LEFT JOIN (
      SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
      FROM PRODUTO_CORES WITH (NOLOCK)
      GROUP BY PRODUTO, COR_PRODUTO
    ) cb ON RTRIM(LTRIM(cb.PRODUTO)) = RTRIM(LTRIM(ep.PRODUTO))
       AND (RTRIM(LTRIM(CAST(cb.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, cb.COR_PRODUTO) = TRY_CONVERT(INT, ep.COR_PRODUTO))
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
    /** Soma dos saldos atuais no escopo (pode incluir negativos). */
    saldoAtualTotal: number;
    /** Soma dos saldos finais após o ajuste (= soma das contagens). */
    saldoFinalTotal: number;
    /** Quantos itens do escopo têm saldo atual negativo. */
    itensSaldoNegativo: number;
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
    saldoAtualTotal: linhas.reduce((s, l) => s + l.saldo, 0),
    saldoFinalTotal: linhas.reduce((s, l) => s + l.contagem, 0),
    itensSaldoNegativo: linhas.filter((l) => l.saldo < 0).length,
  };

  return { linhas, totais, naoEncontrados, ambiguos, invalidas };
}

/* ════════════════════════════════════════════════════════════════════════
 *  ZERAR ITEM — zerar um ou mais itens (produto×cor) em todas as filiais
 *  onde há estoque (ou numa filial específica). Cada filial vira uma contagem
 *  nativa independente (mesmo mecanismo/trigger do resto da tela), então cada
 *  ajuste aparece no extrato e pode ser desfeito individualmente.
 * ════════════════════════════════════════════════════════════════════════ */

/** true se a filial (por COD/nome) pertence à empresa e está operacional (não desativada). */
function filialPertenceEmpresa(cod: string, nome: string, company: CompanyKey): boolean {
  const def = getFilialById(cod);
  // Filial desativada (modules vazio, ex.: IBIRAPUERA) fica fora — coerente com o app.
  if (def && def.modules.length === 0) return false;
  const empresa = def?.company ?? adivinharEmpresaPorNome(nome);
  return empresa === company;
}

export interface ZerarItemFilial {
  cod: string;
  nome: string;
  estoque: number;
}

export interface ZerarItemCandidato {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  /** Soma dos saldos positivos nas filiais da empresa (referência de exibição). */
  estoquePositivo: number;
  /** Filiais (da empresa) onde o item tem estoque ≠ 0. */
  filiais: ZerarItemFilial[];
}

interface EstoqueItemRow {
  PRODUTO: string;
  COR: string;
  ESTOQUE: number;
  COD: string;
  FILIAL: string;
  DESC_PRODUTO: string;
  DESC_COR: string;
  CODIGO_BARRA: string | null;
}

const ESTOQUE_ITENS_SELECT = `
  SELECT RTRIM(ep.PRODUTO) AS PRODUTO,
         RTRIM(ISNULL(ep.COR_PRODUTO, '')) AS COR,
         ep.ESTOQUE AS ESTOQUE,
         RTRIM(ISNULL(f.COD_FILIAL, '')) AS COD,
         RTRIM(ep.FILIAL) AS FILIAL,
         RTRIM(ISNULL(p.DESC_PRODUTO, '')) AS DESC_PRODUTO,
         RTRIM(ISNULL(cb.DESC_COR, '')) AS DESC_COR,
         bc.CODIGO_BARRA AS CODIGO_BARRA
  FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
  LEFT JOIN FILIAIS f WITH (NOLOCK) ON RTRIM(f.FILIAL) = RTRIM(ep.FILIAL)
  LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = ep.PRODUTO
  LEFT JOIN (
    SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
    FROM PRODUTO_CORES WITH (NOLOCK)
    GROUP BY PRODUTO, COR_PRODUTO
  ) cb ON RTRIM(LTRIM(cb.PRODUTO)) = RTRIM(LTRIM(ep.PRODUTO))
     AND (RTRIM(LTRIM(CAST(cb.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, cb.COR_PRODUTO) = TRY_CONVERT(INT, ep.COR_PRODUTO))
  OUTER APPLY (
    SELECT MIN(RTRIM(pb.CODIGO_BARRA)) AS CODIGO_BARRA
    FROM PRODUTOS_BARRA pb WITH (NOLOCK)
    WHERE pb.PRODUTO = ep.PRODUTO
      AND RTRIM(ISNULL(pb.COR_PRODUTO, '')) = RTRIM(ISNULL(ep.COR_PRODUTO, ''))
  ) bc`;

/**
 * Busca itens (produto×cor) pelo termo (código do produto, descrição ou código de
 * barra) e devolve, para cada um, as filiais da empresa onde há estoque ≠ 0.
 */
export async function buscarItensParaZerar(
  company: CompanyKey,
  termo: string,
  limite = 400
): Promise<ZerarItemCandidato[]> {
  const t = (termo ?? '').trim();
  if (t.length < 2) return [];
  const tEsc = esc(t);
  const tUpper = esc(t.toUpperCase());
  const soDigitos = t.replace(/\D/g, '');

  // 1) Resolver os produtos que casam com o termo.
  const produtoRows = await query<{ PRODUTO: string }>(`
    SELECT DISTINCT PRODUTO FROM (
      SELECT RTRIM(p.PRODUTO) AS PRODUTO
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE RTRIM(p.PRODUTO) = '${tEsc}'
         OR RTRIM(p.PRODUTO) LIKE '${tEsc}%'
         OR UPPER(p.DESC_PRODUTO) LIKE '%${tUpper}%'
      ${
        soDigitos.length >= 4
          ? `UNION
      SELECT RTRIM(pb.PRODUTO) AS PRODUTO
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = '${tEsc}'
         OR TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) = TRY_CONVERT(BIGINT, '${esc(soDigitos)}')`
          : ''
      }
    ) x
  `);
  const produtos = [...new Set(produtoRows.map((r) => r.PRODUTO?.trim()).filter(Boolean) as string[])].slice(0, 150);
  if (produtos.length === 0) return [];

  // 2) Estoque por filial/cor para esses produtos (só saldos ≠ 0).
  const porItem = new Map<string, ZerarItemCandidato>();
  for (let i = 0; i < produtos.length; i += 400) {
    const chunk = produtos.slice(i, i + 400);
    const inList = chunk.map((p) => `'${esc(p)}'`).join(',');
    const rows = await query<EstoqueItemRow>(`
      ${ESTOQUE_ITENS_SELECT}
      WHERE ep.PRODUTO IN (${inList}) AND ep.ESTOQUE <> 0
      ORDER BY ep.PRODUTO, ep.COR_PRODUTO
    `);
    for (const r of rows) {
      const produto = r.PRODUTO?.trim() ?? '';
      const cor = r.COR?.trim() ?? '';
      const cod = r.COD?.trim() ?? '';
      const filialNome = r.FILIAL?.trim() ?? '';
      if (!filialPertenceEmpresa(cod, filialNome, company)) continue;
      const key = `${produto}|${cor}`;
      let item = porItem.get(key);
      if (!item) {
        item = {
          produto,
          cor,
          descProduto: r.DESC_PRODUTO?.trim() ?? '',
          descCor: r.DESC_COR?.trim() ?? '',
          codigoBarra: r.CODIGO_BARRA?.toString().trim() ?? null,
          estoquePositivo: 0,
          filiais: [],
        };
        porItem.set(key, item);
      }
      const estoque = Number(r.ESTOQUE) || 0;
      item.filiais.push({ cod, nome: filialNome, estoque });
      if (estoque > 0) item.estoquePositivo += estoque;
    }
  }

  const candidatos = [...porItem.values()].filter((c) => c.filiais.length > 0);
  for (const c of candidatos) c.filiais.sort((a, b) => a.nome.localeCompare(b.nome));
  candidatos.sort((a, b) =>
    a.produto === b.produto ? a.cor.localeCompare(b.cor) : a.produto.localeCompare(b.produto)
  );
  return candidatos.slice(0, limite);
}

export interface FilialItensZerar {
  cod: string;
  nome: string;
  itens: Array<{ produto: string; cor: string; estoque: number }>;
}

/**
 * Saldo ATUAL (≠ 0) dos itens selecionados por filial (da empresa). Se `filialCod`
 * for informado, restringe àquela filial. É a fonte autoritativa para a execução.
 */
export async function estoqueDeItensPorFilial(
  itens: Array<{ produto: string; cor: string }>,
  company: CompanyKey,
  filialCod?: string | null
): Promise<FilialItensZerar[]> {
  if (!itens || itens.length === 0) return [];
  const produtos = [...new Set(itens.map((i) => (i.produto ?? '').trim()).filter(Boolean))];
  if (produtos.length === 0) return [];
  const keySet = new Set(itens.map((i) => `${(i.produto ?? '').trim()}|${(i.cor ?? '').trim()}`));
  const alvoNorm = filialCod ? normalizeFilialId(filialCod) : null;

  const porFilial = new Map<string, FilialItensZerar>();
  for (let i = 0; i < produtos.length; i += 400) {
    const chunk = produtos.slice(i, i + 400);
    const inList = chunk.map((p) => `'${esc(p)}'`).join(',');
    const rows = await query<{ PRODUTO: string; COR: string; ESTOQUE: number; COD: string; FILIAL: string }>(`
      SELECT RTRIM(ep.PRODUTO) AS PRODUTO,
             RTRIM(ISNULL(ep.COR_PRODUTO, '')) AS COR,
             ep.ESTOQUE AS ESTOQUE,
             RTRIM(ISNULL(f.COD_FILIAL, '')) AS COD,
             RTRIM(ep.FILIAL) AS FILIAL
      FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      LEFT JOIN FILIAIS f WITH (NOLOCK) ON RTRIM(f.FILIAL) = RTRIM(ep.FILIAL)
      WHERE ep.PRODUTO IN (${inList}) AND ep.ESTOQUE <> 0
    `);
    for (const r of rows) {
      const produto = r.PRODUTO?.trim() ?? '';
      const cor = r.COR?.trim() ?? '';
      if (!keySet.has(`${produto}|${cor}`)) continue;
      const cod = r.COD?.trim() ?? '';
      const filialNome = r.FILIAL?.trim() ?? '';
      if (alvoNorm && normalizeFilialId(cod) !== alvoNorm) continue;
      if (!filialPertenceEmpresa(cod, filialNome, company)) continue;
      let f = porFilial.get(filialNome);
      if (!f) {
        f = { cod, nome: filialNome, itens: [] };
        porFilial.set(filialNome, f);
      }
      f.itens.push({ produto, cor, estoque: Number(r.ESTOQUE) || 0 });
    }
  }
  return [...porFilial.values()];
}
