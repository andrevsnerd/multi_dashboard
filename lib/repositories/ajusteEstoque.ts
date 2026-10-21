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

/** Lista os 30 ajustes mais recentes do responsável (para "desfazer"/consultar). Exclui estornos. */
export async function listarAjustesRecentes(responsavel: string): Promise<AjusteRecente[]> {
  const respEsc = esc(responsavel.trim());
  const rows = await query<{
    NOME: string;
    FILIAL: string;
    EMISSAO: Date;
    ITENS: number;
    SOMA: number;
  }>(`
    SELECT TOP 30 RTRIM(c.NOME_CONTAGEM) AS NOME, RTRIM(c.FILIAL) AS FILIAL, c.EMISSAO,
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
  /** Saldo logo antes/depois do ajuste (reconstruído por movimento); null = sem dado. */
  saldoAnterior?: number | null;
  saldoFinal?: number | null;
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

export interface ContagemFisicaResumo {
  itens: number;
  saldoAtualTotal: number;
  saldoFinalTotal: number;
  itensSaldoNegativo: number;
}

/** Filial gravada no cabeçalho da contagem (ESTOQUE_PROD_CONTAGEM). */
export async function filialDaContagem(nomeContagem: string): Promise<string | null> {
  const nomeEsc = esc(nomeContagem.trim());
  const rows = await query<{ FILIAL: string }>(`
    SELECT TOP 1 RTRIM(FILIAL) AS FILIAL FROM ESTOQUE_PROD_CONTAGEM WITH (NOLOCK)
    WHERE RTRIM(LTRIM(NOME_CONTAGEM)) = '${nomeEsc}'
  `);
  return rows[0]?.FILIAL?.trim() ?? null;
}

/**
 * Contagem física de um inventário feito pela tela nativa do Linx
 * (ESTOQUE_PROD_CTG_ITENS: SALDO_CONTAGEM = o que o sistema dizia, QTDE_CONTAGEM
 * = o que foi contado). Ajustes feitos pelo dashboard não gravam essa tabela —
 * aí devolve null.
 */
export async function resumirContagemFisica(
  nomeContagem: string
): Promise<ContagemFisicaResumo | null> {
  const nomeEsc = esc(nomeContagem.trim());
  const rows = await query<{ ITENS: number; SALDO: number; CONTAGEM: number; NEG: number }>(`
    SELECT COUNT(*) AS ITENS, ISNULL(SUM(S), 0) AS SALDO, ISNULL(SUM(Q), 0) AS CONTAGEM,
           ISNULL(SUM(CASE WHEN S < 0 THEN 1 ELSE 0 END), 0) AS NEG
    FROM (
      SELECT PRODUTO, COR_PRODUTO,
             SUM(ISNULL(SALDO_CONTAGEM, 0)) AS S, SUM(ISNULL(QTDE_CONTAGEM, 0)) AS Q
      FROM ESTOQUE_PROD_CTG_ITENS WITH (NOLOCK)
      WHERE RTRIM(LTRIM(NOME_CONTAGEM)) = '${nomeEsc}'
      GROUP BY PRODUTO, COR_PRODUTO
    ) t
  `);
  const r = rows[0];
  const itens = Number(r?.ITENS) || 0;
  if (itens === 0) return null;
  return {
    itens,
    saldoAtualTotal: Number(r.SALDO) || 0,
    saldoFinalTotal: Number(r.CONTAGEM) || 0,
    itensSaldoNegativo: Number(r.NEG) || 0,
  };
}

/** Ajustes a partir desta data têm o saldo antes/depois reconstruído por movimento. */
export const RECONSTRUCAO_SALDO_DESDE = '2026-10-01';

/** Acima disso a busca de movimentos não filtra produto (o IN ficaria grande demais). */
const MAX_PRODUTOS_FILTRO = 400;

export interface SaldoReconstruido {
  saldoAnterior: number;
  saldoFinal: number;
}

export interface ReconstrucaoAjuste {
  /** Instante tomado como a hora do ajuste (ISO, relógio do Linx). */
  momento: string;
  /** Chave = chaveItemAjuste(produto, cor). */
  porItem: Record<string, SaldoReconstruido>;
}

function normCor(cor: string): string {
  const c = (cor ?? '').trim();
  return /^\d+$/.test(c) ? String(Number(c)) : c.toUpperCase();
}

/** Produto × cor tolerante ao formato da cor ('06' = '6'). */
export function chaveItemAjuste(produto: string, cor: string): string {
  return `${(produto ?? '').trim().toUpperCase()}|${normCor(cor)}`;
}

/**
 * Mesmo critério do Extrato de Produto (app/api/extrato-produto/route.ts): primeiro
 * carimbo que caia no dia da emissão e tenha hora de verdade.
 */
function momentoNoDia(
  emissao: Date | null | undefined,
  ...candidatos: Array<Date | null | undefined>
): string | null {
  if (!emissao) return null;
  const dia = new Date(emissao).toISOString().slice(0, 10);
  for (const c of candidatos) {
    if (!c) continue;
    const iso = new Date(c).toISOString();
    if (iso.slice(0, 10) === dia && iso.slice(11, 19) !== '00:00:00') return iso;
  }
  return null;
}

interface MovRow {
  PRODUTO: string;
  COR: string;
  Q: number;
  EMISSAO: Date;
  M1: Date | null;
  M2: Date | null;
}

/**
 * Saldo de cada item ajustado logo antes e logo depois do ajuste.
 *
 * O Linx não guarda o saldo da hora do ajuste, então ele é rebobinado a partir do
 * estoque atual: saldo após = ESTOQUE_PRODUTOS.ESTOQUE − tudo que mexeu no item
 * depois do ajuste, pelas 8 fontes canônicas do CLAUDE.md (cópia das queries do
 * Extrato de Produto, inclusive a ordem do dia pela hora real). Saldo antes =
 * saldo após − o que o ajuste aplicou.
 *
 * Só para ajustes desde RECONSTRUCAO_SALDO_DESDE (null antes disso). Qualquer
 * consulta que falhe derruba a reconstrução inteira — saldo parcial seria errado.
 */
export async function reconstruirSaldosAjuste(
  nomeContagem: string
): Promise<ReconstrucaoAjuste | null> {
  const nomeEsc = esc(nomeContagem.trim());
  const cab = await query<{
    FILIAL: string;
    COD_FILIAL: string | null;
    EMISSAO: Date;
    DPT: Date | null;
    DPT_ITEM: Date | null;
  }>(`
    SELECT TOP 1 RTRIM(c.FILIAL) AS FILIAL, c.EMISSAO, c.DATA_PARA_TRANSFERENCIA AS DPT,
      (SELECT MIN(a.DATA_PARA_TRANSFERENCIA) FROM ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK)
        WHERE a.NOME_CONTAGEM = c.NOME_CONTAGEM) AS DPT_ITEM,
      (SELECT TOP 1 LTRIM(RTRIM(f.COD_FILIAL)) FROM FILIAIS f WITH (NOLOCK)
        WHERE f.FILIAL = c.FILIAL) AS COD_FILIAL
    FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
    WHERE RTRIM(LTRIM(c.NOME_CONTAGEM)) = '${nomeEsc}' AND c.ESTOQUE_AJUSTADO = 1
  `);
  const h = cab[0];
  if (!h?.EMISSAO || !h.FILIAL) return null;

  // Hora em que o trigger moveu o estoque (o dashboard grava EMISSAO à meia-noite).
  const momento =
    momentoNoDia(h.EMISSAO, h.DPT_ITEM, h.DPT) ??
    (h.DPT_ITEM ? new Date(h.DPT_ITEM).toISOString() : null) ??
    new Date(h.EMISSAO).toISOString();
  const dia = momento.slice(0, 10);
  if (dia < RECONSTRUCAO_SALDO_DESDE) return null;

  const itens = await query<{ PRODUTO: string; COR: string; Q: number }>(`
    SELECT RTRIM(PRODUTO) AS PRODUTO, RTRIM(ISNULL(COR_PRODUTO, '')) AS COR,
           SUM(ISNULL(QTDE_AJUSTE, 0)) AS Q
    FROM ESTOQUE_PROD_CTG_AJUSTE WITH (NOLOCK)
    WHERE RTRIM(LTRIM(NOME_CONTAGEM)) = '${nomeEsc}'
    GROUP BY RTRIM(PRODUTO), RTRIM(ISNULL(COR_PRODUTO, ''))
  `);
  if (itens.length === 0) return null;

  const f = esc(h.FILIAL);
  const cod = esc((h.COD_FILIAL ?? '').trim());
  const produtos = [...new Set(itens.map((i) => i.PRODUTO.trim()))];
  const filtroProd = (col: string) =>
    produtos.length <= MAX_PRODUTOS_FILTRO
      ? `AND ${col} IN (${produtos.map((p) => `'${esc(p)}'`).join(',')})`
      : '';

  const [estoque, ...fontes] = await Promise.all([
    query<{ PRODUTO: string; COR: string; ESTOQUE: number }>(`
      SELECT RTRIM(PRODUTO) AS PRODUTO, RTRIM(ISNULL(COR_PRODUTO, '')) AS COR, ESTOQUE
      FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
      WHERE FILIAL = '${f}' ${filtroProd('PRODUTO')}
    `),
    // + ESTOQUE_PROD_ENT/ESTOQUE_PROD1_ENT
    query<MovRow>(`
      SELECT RTRIM(p.PRODUTO) AS PRODUTO, RTRIM(ISNULL(p.COR_PRODUTO, '')) AS COR, p.QTDE AS Q,
             e.EMISSAO, e.DATA_DIGITACAO AS M1, e.DATA_PARA_TRANSFERENCIA AS M2
      FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
      JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
        ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
        AND (p.FILIAL IS NULL OR LTRIM(RTRIM(p.FILIAL)) = '' OR p.FILIAL = e.FILIAL)
      WHERE e.FILIAL = '${f}' AND e.EMISSAO >= '${dia}' ${filtroProd('p.PRODUTO')}
    `),
    // − ESTOQUE_PROD_SAI/ESTOQUE_PROD1_SAI
    query<MovRow>(`
      SELECT RTRIM(p.PRODUTO) AS PRODUTO, RTRIM(ISNULL(p.COR_PRODUTO, '')) AS COR, -p.QTDE AS Q,
             s.EMISSAO, s.DATA_DIGITACAO AS M1, s.DATA_PARA_TRANSFERENCIA AS M2
      FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
      JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK)
        ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
        AND (p.FILIAL IS NULL OR LTRIM(RTRIM(p.FILIAL)) = '' OR p.FILIAL = s.FILIAL)
      WHERE s.FILIAL = '${f}' AND s.EMISSAO >= '${dia}' ${filtroProd('p.PRODUTO')}
    `),
    // + ESTOQUE_PROD_CTG_AJUSTE (outros ajustes; este fica de fora)
    query<MovRow>(`
      SELECT RTRIM(a.PRODUTO) AS PRODUTO, RTRIM(ISNULL(a.COR_PRODUTO, '')) AS COR,
             a.QTDE_AJUSTE AS Q, c.EMISSAO,
             a.DATA_PARA_TRANSFERENCIA AS M1, c.DATA_PARA_TRANSFERENCIA AS M2
      FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
      JOIN ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK) ON c.NOME_CONTAGEM = a.NOME_CONTAGEM
      WHERE c.FILIAL = '${f}' AND c.ESTOQUE_AJUSTADO = 1 AND c.EMISSAO >= '${dia}'
        AND RTRIM(LTRIM(c.NOME_CONTAGEM)) <> '${nomeEsc}' ${filtroProd('a.PRODUTO')}
    `),
    // + LOJA_ENTRADAS/LOJA_ENTRADAS_PRODUTO
    query<MovRow>(`
      SELECT RTRIM(lep.PRODUTO) AS PRODUTO, RTRIM(ISNULL(lep.COR_PRODUTO, '')) AS COR,
             lep.QTDE_ENTRADA AS Q, le.EMISSAO, le.DATA_PARA_TRANSFERENCIA AS M1, NULL AS M2
      FROM LOJA_ENTRADAS le WITH (NOLOCK)
      JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
        ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
      WHERE le.FILIAL = '${f}' AND le.EMISSAO >= '${dia}' ${filtroProd('lep.PRODUTO')}
    `),
    // − LOJA_SAIDAS/LOJA_SAIDAS_PRODUTO
    query<MovRow>(`
      SELECT RTRIM(lsp.PRODUTO) AS PRODUTO, RTRIM(ISNULL(lsp.COR_PRODUTO, '')) AS COR,
             -lsp.QTDE_SAIDA AS Q, ls.EMISSAO, ls.DATA_PARA_TRANSFERENCIA AS M1, NULL AS M2
      FROM LOJA_SAIDAS ls WITH (NOLOCK)
      JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
        ON ls.FILIAL = lsp.FILIAL AND ls.ROMANEIO_PRODUTO = lsp.ROMANEIO_PRODUTO
      WHERE ls.FILIAL = '${f}' AND ls.EMISSAO >= '${dia}' ${filtroProd('lsp.PRODUTO')}
    `),
    // − LOJA_VENDA_PRODUTO: QTDE, e só (nunca QTDE_CANCELADA — ver CLAUDE.md)
    cod
      ? query<MovRow>(`
          SELECT RTRIM(vp.PRODUTO) AS PRODUTO, RTRIM(ISNULL(vp.COR_PRODUTO, '')) AS COR,
                 -vp.QTDE AS Q, v.DATA_VENDA AS EMISSAO, v.DATA_DIGITACAO AS M1, NULL AS M2
          FROM LOJA_VENDA v WITH (NOLOCK)
          JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
          WHERE vp.CODIGO_FILIAL = '${cod}' AND v.DATA_VENDA >= '${dia}'
            AND vp.QTDE > 0 AND ISNULL(vp.NAO_MOVIMENTA_ESTOQUE, 0) = 0
            ${filtroProd('vp.PRODUTO')}
        `)
      : Promise.resolve([] as MovRow[]),
    // + LOJA_VENDA_TROCA (devolução volta ao estoque)
    cod
      ? query<MovRow>(`
          SELECT RTRIM(t.PRODUTO) AS PRODUTO, RTRIM(ISNULL(t.COR_PRODUTO, '')) AS COR,
                 t.QTDE AS Q, t.DATA_VENDA AS EMISSAO, v.DATA_DIGITACAO AS M1, NULL AS M2
          FROM LOJA_VENDA_TROCA t WITH (NOLOCK)
          LEFT JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = t.CODIGO_FILIAL AND v.TICKET = t.TICKET
          WHERE t.CODIGO_FILIAL = '${cod}' AND t.DATA_VENDA >= '${dia}'
            AND t.QTDE > 0 AND ISNULL(t.NAO_MOVIMENTA_ESTOQUE, 0) = 0
            ${filtroProd('t.PRODUTO')}
        `)
      : Promise.resolve([] as MovRow[]),
    // − FATURAMENTO/FATURAMENTO_PROD (qualquer natureza: é estoque, não dinheiro)
    query<MovRow>(`
      SELECT RTRIM(fp.PRODUTO) AS PRODUTO, RTRIM(ISNULL(fp.COR_PRODUTO, '')) AS COR,
             -fp.QTDE AS Q, fa.EMISSAO, fa.DATA_HORA_EMISSAO AS M1, fa.DATA_PARA_TRANSFERENCIA AS M2
      FROM FATURAMENTO fa WITH (NOLOCK)
      JOIN FATURAMENTO_PROD fp WITH (NOLOCK)
        ON fa.FILIAL = fp.FILIAL AND fa.NF_SAIDA = fp.NF_SAIDA AND fa.SERIE_NF = fp.SERIE_NF
      WHERE fa.FILIAL = '${f}' AND fa.EMISSAO >= '${dia}'
        AND ISNULL(fa.NOTA_CANCELADA, 0) = 0 AND fp.QTDE > 0 ${filtroProd('fp.PRODUTO')}
    `),
  ]);

  const atual = new Map<string, number>();
  for (const r of estoque) {
    const k = chaveItemAjuste(r.PRODUTO, r.COR);
    atual.set(k, (atual.get(k) ?? 0) + (Number(r.ESTOQUE) || 0));
  }

  // Movimento sem hora fica na meia-noite da emissão (mesma régua do extrato).
  const depois = new Map<string, number>();
  for (const rows of fontes) {
    for (const r of rows) {
      const quando = momentoNoDia(r.EMISSAO, r.M1, r.M2) ?? new Date(r.EMISSAO).toISOString();
      if (quando <= momento) continue;
      const k = chaveItemAjuste(r.PRODUTO, r.COR);
      depois.set(k, (depois.get(k) ?? 0) + (Number(r.Q) || 0));
    }
  }

  const porItem: Record<string, SaldoReconstruido> = {};
  for (const it of itens) {
    const k = chaveItemAjuste(it.PRODUTO, it.COR);
    const saldoFinal = (atual.get(k) ?? 0) - (depois.get(k) ?? 0);
    porItem[k] = { saldoFinal, saldoAnterior: saldoFinal - (Number(it.Q) || 0) };
  }
  return { momento, porItem };
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

/**
 * Quantidade por tamanho: posição da grade no Linx (1..48 = ES1..ES48 / A1..A48)
 * → quantidade. Esparso: só as posições diferentes de zero.
 */
export type QtdPorTamanho = Record<string, number>;

const ES_COLS = Array.from({ length: 48 }, (_, i) => `ep.ES${i + 1}`).join(', ');

function tamanhosDaLinha(row: Record<string, unknown>): QtdPorTamanho {
  const out: QtdPorTamanho = {};
  for (let i = 1; i <= 48; i++) {
    const v = Number(row[`ES${i}`]) || 0;
    if (v !== 0) out[String(i)] = v;
  }
  return out;
}

function mesmosTamanhos(a: QtdPorTamanho, b: QtdPorTamanho): boolean {
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of chaves) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

export interface SaldoItem {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  estoque: number;
  /** Saldo por tamanho (ES1..ES48). */
  tamanhos: QtdPorTamanho;
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
    [es: string]: unknown;
  }>(`
    SELECT RTRIM(ep.PRODUTO) AS PRODUTO,
           RTRIM(ISNULL(ep.COR_PRODUTO, '')) AS COR,
           ep.ESTOQUE AS ESTOQUE, ${ES_COLS},
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
    tamanhos: tamanhosDaLinha(r),
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
  /**
   * Contagem por tamanho, vinda do TAMANHO do código de barra. null quando algum
   * código do item não tem tamanho válido — aí o executor distribui pelo saldo.
   */
  tamanhos: QtdPorTamanho | null;
}

/**
 * Resolve códigos de barra do arquivo → produto+cor+tamanho (PRODUTOS_BARRA) e
 * agrega a quantidade contada por (produto, cor), guardando a quebra por tamanho.
 * Retorna também o que não casou.
 */
export async function resolverContagemPorCodigoBarra(
  linhas: LinhaArquivo[]
): Promise<{ itens: ContagemItem[]; naoEncontrados: string[]; ambiguos: string[] }> {
  const naoEncontrados: string[] = [];
  const ambiguos: string[] = [];
  const porProdutoCor = new Map<string, number>();
  const porTamanho = new Map<string, QtdPorTamanho | null>();
  const somar = (key: string, tamanho: unknown, qtd: number) => {
    porProdutoCor.set(key, (porProdutoCor.get(key) ?? 0) + qtd);
    const t = Number(tamanho);
    const atual = porTamanho.has(key) ? porTamanho.get(key)! : {};
    if (atual === null || !Number.isInteger(t) || t < 1 || t > 48) {
      porTamanho.set(key, null);
      return;
    }
    atual[String(t)] = (atual[String(t)] ?? 0) + qtd;
    porTamanho.set(key, atual);
  };
  const qtdPorCodigo = new Map(linhas.map((l) => [l.codigo, l.qtd]));
  const codigos = [...qtdPorCodigo.keys()];
  const resolvidos = new Set<string>();

  // 1) Match exato (trim). Em chunks para não estourar o tamanho do IN.
  for (let i = 0; i < codigos.length; i += 500) {
    const chunk = codigos.slice(i, i + 500);
    const inList = chunk.map((c) => `'${esc(c)}'`).join(',');
    const rows = await query<{ CB: string; PRODUTO: string; COR: string; TAMANHO: number | null; N: number }>(`
      SELECT LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) AS CB,
             RTRIM(pb.PRODUTO) AS PRODUTO,
             RTRIM(ISNULL(pb.COR_PRODUTO, '')) AS COR,
             pb.TAMANHO AS TAMANHO,
             COUNT(*) OVER (PARTITION BY LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) AS N
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) IN (${inList})
    `);
    const byCb = new Map<string, { produto: string; cor: string; tamanho: number | null; n: number }>();
    for (const r of rows) {
      const cb = r.CB?.trim();
      if (!cb) continue;
      // Se o mesmo código mapeia para produtos/cores diferentes, marca ambíguo.
      const prev = byCb.get(cb);
      if (prev && (prev.produto !== r.PRODUTO?.trim() || prev.cor !== r.COR?.trim())) {
        prev.n = 2;
      } else if (!prev) {
        byCb.set(cb, {
          produto: r.PRODUTO?.trim() ?? '',
          cor: r.COR?.trim() ?? '',
          tamanho: r.TAMANHO,
          n: Number(r.N) || 1,
        });
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
      somar(`${hit.produto}|${hit.cor}`, hit.tamanho, qtdPorCodigo.get(cb) ?? 0);
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
    const rows = await query<{ CBNUM: string; PRODUTO: string; COR: string; TAMANHO: number | null }>(`
      SELECT CAST(TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) AS VARCHAR(100)) AS CBNUM,
             RTRIM(pb.PRODUTO) AS PRODUTO,
             RTRIM(ISNULL(pb.COR_PRODUTO, '')) AS COR,
             pb.TAMANHO AS TAMANHO
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) IN (${inList.join(',')})
    `);
    const byNum = new Map<string, { produto: string; cor: string; tamanho: number | null }[]>();
    for (const r of rows) {
      const k = String(r.CBNUM ?? '').trim();
      if (!k) continue;
      const arr = byNum.get(k) ?? [];
      arr.push({ produto: r.PRODUTO?.trim() ?? '', cor: r.COR?.trim() ?? '', tamanho: r.TAMANHO });
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
      // Mesmo produto×cor em tamanhos diferentes não dá para separar: sem tamanho.
      const tamanhosDistintos = new Set(hits.map((h) => h.tamanho));
      somar([...distinct][0], tamanhosDistintos.size === 1 ? hits[0].tamanho : null, qtdPorCodigo.get(c) ?? 0);
    }
  }

  const itens: ContagemItem[] = [...porProdutoCor.entries()].map(([key, qtd]) => {
    const [produto, cor] = key.split('|');
    return { produto, cor, qtdContada: qtd, tamanhos: porTamanho.get(key) ?? null };
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
  /** Saldo atual por tamanho. */
  saldoTamanhos: QtdPorTamanho;
  /**
   * Contagem por tamanho (alvo). {} = tudo zero (zerar / não contado). null =
   * tamanho desconhecido: o executor mantém a distribuição atual do saldo.
   */
  contagemTamanhos: QtdPorTamanho | null;
  /** Total bate, mas a quebra por tamanho difere — também precisa de ajuste. */
  ajustaTamanho: boolean;
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
  const contagemTamanhosMap = new Map<string, QtdPorTamanho | null>();

  if (modo === 'inventario') {
    const parsed = parseArquivoContagem(opts.arquivoTexto ?? '');
    invalidas = parsed.invalidas;
    const resolvido = await resolverContagemPorCodigoBarra(parsed.linhas);
    naoEncontrados = resolvido.naoEncontrados;
    ambiguos = resolvido.ambiguos;
    for (const it of resolvido.itens) {
      contagemMap.set(`${it.produto}|${it.cor}`, it.qtdContada);
      contagemTamanhosMap.set(`${it.produto}|${it.cor}`, it.tamanhos);
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
    const saldoTamanhos = s?.tamanhos ?? {};
    // Zerado ou não contado: alvo é zero em todos os tamanhos.
    const contagemTamanhos =
      modo === 'zerar' || !contagemTamanhosMap.has(chave) ? {} : contagemTamanhosMap.get(chave) ?? null;
    const ajustaTamanho =
      delta === 0 && contagemTamanhos !== null && !mesmosTamanhos(saldoTamanhos, contagemTamanhos);
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
      saldoTamanhos,
      contagemTamanhos,
      ajustaTamanho,
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

  const comDiferenca = linhas.filter((l) => l.delta !== 0 || l.ajustaTamanho);
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
 *  AJUSTAR ITEM — define o saldo de um ou mais itens (produto×cor) por filial
 *  para a quantidade escolhida. Zerar é só o caso quantidade = 0 (não existe
 *  fluxo separado). Cada filial vira uma contagem nativa independente (mesmo
 *  mecanismo/trigger do resto da tela), então cada ajuste aparece no extrato e
 *  pode ser desfeito individualmente.
 * ════════════════════════════════════════════════════════════════════════ */

/** true se a filial (por COD/nome) pertence à empresa e está operacional (não desativada). */
function filialPertenceEmpresa(cod: string, nome: string, company: CompanyKey): boolean {
  const def = getFilialById(cod);
  // Filial desativada (modules vazio, ex.: IBIRAPUERA) fica fora — coerente com o app.
  if (def && def.modules.length === 0) return false;
  const empresa = def?.company ?? adivinharEmpresaPorNome(nome);
  return empresa === company;
}

export interface AjusteItemFilial {
  cod: string;
  nome: string;
  estoque: number;
}

export interface AjusteItemCandidato {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  /** Soma dos saldos positivos nas filiais da empresa (referência de exibição). */
  estoquePositivo: number;
  /** Filiais (da empresa) onde o item tem linha de estoque. */
  filiais: AjusteItemFilial[];
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
 * barra) e devolve, para cada um, as filiais da empresa com linha de estoque.
 *
 * `incluirZerados` traz também as linhas com saldo 0 — a aba de ajuste precisa
 * delas, porque o item pode estar zerado e a intenção ser subir a quantidade.
 */
export async function buscarItensParaAjuste(
  company: CompanyKey,
  termo: string,
  opts: { limite?: number; incluirZerados?: boolean } = {}
): Promise<AjusteItemCandidato[]> {
  const limite = opts.limite ?? 400;
  const filtroEstoque = opts.incluirZerados ? '' : 'AND ep.ESTOQUE <> 0';
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

  // 2) Estoque por filial/cor para esses produtos.
  const porItem = new Map<string, AjusteItemCandidato>();
  for (let i = 0; i < produtos.length; i += 400) {
    const chunk = produtos.slice(i, i + 400);
    const inList = chunk.map((p) => `'${esc(p)}'`).join(',');
    const rows = await query<EstoqueItemRow>(`
      ${ESTOQUE_ITENS_SELECT}
      WHERE ep.PRODUTO IN (${inList}) ${filtroEstoque}
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

export interface SaldoItemFilialLinha {
  produto: string;
  cor: string;
  filialCod: string;
  filialNome: string;
  estoque: number;
}

/**
 * Saldo ATUAL dos itens em TODAS as filiais da empresa, incluindo saldo 0 e
 * negativo — é a matriz item × filial que a aba de ajuste edita.
 */
export async function saldoItensTodasFiliais(
  itens: Array<{ produto: string; cor: string }>,
  company: CompanyKey
): Promise<SaldoItemFilialLinha[]> {
  if (!itens || itens.length === 0) return [];
  const produtos = [...new Set(itens.map((i) => (i.produto ?? '').trim()).filter(Boolean))];
  if (produtos.length === 0) return [];
  const keySet = new Set(itens.map((i) => `${(i.produto ?? '').trim()}|${(i.cor ?? '').trim()}`));

  const linhas: SaldoItemFilialLinha[] = [];
  for (let i = 0; i < produtos.length; i += 400) {
    const chunk = produtos.slice(i, i + 400);
    const inList = chunk.map((p) => `'${esc(p)}'`).join(',');
    const rows = await query<{
      PRODUTO: string;
      COR: string;
      ESTOQUE: number;
      COD: string;
      FILIAL: string;
    }>(`
      SELECT RTRIM(ep.PRODUTO) AS PRODUTO,
             RTRIM(ISNULL(ep.COR_PRODUTO, '')) AS COR,
             ep.ESTOQUE AS ESTOQUE,
             RTRIM(ISNULL(f.COD_FILIAL, '')) AS COD,
             RTRIM(ep.FILIAL) AS FILIAL
      FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      LEFT JOIN FILIAIS f WITH (NOLOCK) ON RTRIM(f.FILIAL) = RTRIM(ep.FILIAL)
      WHERE ep.PRODUTO IN (${inList})
    `);
    for (const r of rows) {
      const produto = r.PRODUTO?.trim() ?? '';
      const cor = r.COR?.trim() ?? '';
      if (!keySet.has(`${produto}|${cor}`)) continue;
      const cod = r.COD?.trim() ?? '';
      const filialNome = r.FILIAL?.trim() ?? '';
      if (!filialPertenceEmpresa(cod, filialNome, company)) continue;
      linhas.push({
        produto,
        cor,
        filialCod: cod,
        filialNome,
        estoque: Number(r.ESTOQUE) || 0,
      });
    }
  }
  return linhas;
}

/**
 * Resolve o alvo da escrita a partir do COD_FILIAL, garantindo que a filial
 * pertence à empresa e não está desativada. Devolve null se não servir.
 */
export async function resolverFilialAlvo(
  cod: string,
  company: CompanyKey
): Promise<{ cod: string; nome: string } | null> {
  const codLimpo = (cod ?? '').trim();
  if (!codLimpo) return null;
  const nome = await resolverNomeFilial(codLimpo);
  if (!nome) return null;
  if (!filialPertenceEmpresa(codLimpo, nome, company)) return null;
  return { cod: codLimpo, nome };
}
