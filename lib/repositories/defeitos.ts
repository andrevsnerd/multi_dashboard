/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TELA DEFEITOS — romaneios que vão para a filial de defeito e o que entrou lá
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Dois lados, duas fontes:
 *
 *  ESQUERDA (romaneios) — os romaneios de SAÍDA cujo destino é a filial de
 *  defeito da empresa (NERD DEFEITOS / BAZAR SCARF ME), confirmados ou não.
 *  Mesmo recorte de `fetchDefeitos` em `logSaidas.ts`: `TIPO_ROMANEIO = 'DEFEITO'`
 *  OU `FILIAL_DESTINO` = a filial de defeito. O recorte por TIPO é obrigatório
 *  porque essas saídas nascem com `FILIAL_DESTINO` NULL (ver o executor: gravar
 *  o destino com `CM_OPERACAO 011` some o romaneio das telas do ERP).
 *
 *  DIREITA (entradas) — o que de fato ENTROU na filial de defeito, que é outra
 *  pergunta: só conta item CONFIRMADO, e pela quantidade confirmada. A fonte é a
 *  confirmação no Neon, não o Linx, porque o romaneio de entrada criado na
 *  confirmação é avulso e não guarda a loja de origem (nem FILIAL_ORIGEM, nem
 *  ROMANEIO_DESTINO) — só voltando pela confirmação ao romaneio de saída se sabe
 *  de onde a peça veio, que é justamente a quebra que a tela mostra.
 *
 * Custo: `PRODUTO_CORES.CUSTO_REPOSICAO1` com fallback em
 * `PRODUTOS.CUSTO_REPOSICAO1` — a MESMA regra que o executor usa para valorar a
 * entrada (`montarCustoEntradaSql`), então o custo da tela bate com o `CUSTO1`
 * gravado no romaneio. Custo é do cadastro, não da venda (ver a regra do Gerador).
 *
 * Nada aqui calcula faturamento: defeito é peça e custo, não venda.
 */

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import {
  getConfirmacoesPorPeriodo,
  getConfirmadoAgregadoPorRomaneio,
  getConfirmadosComEntrada,
  type ConfirmacaoDetalhada,
} from '@/lib/utils/romaneio-confirmacao-store';

/**
 * Cor do Linx normalizada para casar em JavaScript.
 *
 * `COR_PRODUTO` vem ora '06' ora '6' conforme a tabela de origem. O SQL do
 * projeto tolera isso com `TRY_CONVERT(INT, ...)`; em JS, comparar string pura
 * perde a linha. Toda chave montada aqui passa por esta função.
 */
export function normalizarCorChave(cor: string | null | undefined): string {
  const bruto = (cor ?? '').toString().trim();
  if (!bruto) return '';
  const n = Number(bruto);
  return Number.isFinite(n) && /^\d+$/.test(bruto) ? String(n) : bruto.toUpperCase();
}

function chaveItem(produto: string, cor: string | null | undefined): string {
  return `${(produto || '').trim()}|${normalizarCorChave(cor)}`;
}

/** Custo de reposição do produto × cor — mesma regra do executor de entrada. */
const CUSTO_EXPR = `
  ISNULL(NULLIF((
    SELECT TOP 1 pc.CUSTO_REPOSICAO1
      FROM PRODUTO_CORES pc WITH (NOLOCK)
     WHERE LTRIM(RTRIM(pc.PRODUTO)) = LTRIM(RTRIM(i.PRODUTO))
       AND (
         LTRIM(RTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(ISNULL(i.COR_PRODUTO, '') AS VARCHAR(20))))
         OR TRY_CONVERT(INT, pc.COR_PRODUTO) = TRY_CONVERT(INT, i.COR_PRODUTO)
       )
  ), 0), ISNULL(pr.CUSTO_REPOSICAO1, 0))`;

// ───────────────────────────── ESQUERDA: romaneios ─────────────────────────────

export interface DefeitoRomaneio {
  romaneio: string;
  filialOrigem: string;
  emissao: string | null;
  responsavel: string;
  tipoRomaneio: string;
  /** Linhas de item no romaneio (inclui as zeradas por correção). */
  linhas: number;
  /** Soma de QTDE dos itens — o que a loja diz ter mandado. */
  qtdeSaida: number;
  /** Soma das quantidades confirmadas na chegada (0 = nada conferido ainda). */
  qtdeConfirmada: number;
  /** Linhas com confirmação registrada. */
  linhasConfirmadas: number;
  cancelado: boolean;
}

export interface DefeitoRomaneiosParams {
  companyKey: string;
  /** Filiais de ORIGEM válidas da empresa (escopo inventory) — não vaza entre empresas. */
  filiaisOrigem: string[];
  /** Nome da filial de defeito (destino). */
  defeitoFilial: string;
  range: { start: Date; end: Date };
  /** Busca por número de romaneio, filial de origem ou responsável. */
  search?: string;
  limit?: number;
}

/**
 * Romaneios de defeito do período, com o estado de conferência de cada um.
 *
 * O estado vem da confirmação no Neon e não do Linx: a entrada gerada na
 * confirmação é um romaneio separado, sem ligação com esta saída.
 */
export async function fetchDefeitoRomaneios(
  params: DefeitoRomaneiosParams
): Promise<DefeitoRomaneio[]> {
  const { companyKey, filiaisOrigem, defeitoFilial, range, search, limit = 500 } = params;

  const escopo = Array.from(
    new Set((filiaisOrigem || []).map((f) => (f || '').trim().toUpperCase()).filter(Boolean))
  );
  const topClamp = Math.min(Math.max(limit || 500, 1), 2000);

  const romaneios = await withRequest(async (req) => {
    req.input('startDate', sql.DateTime, range.start);
    req.input('endDate', sql.DateTime, range.end);
    req.input('defeitoDestino', sql.VarChar, (defeitoFilial || '').trim().toUpperCase());

    let escopoFilter = '';
    if (escopo.length > 0) {
      escopo.forEach((f, i) => req.input(`org${i}`, sql.VarChar, f));
      escopoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(s.FILIAL, '')))) IN (${escopo
        .map((_, i) => `@org${i}`)
        .join(', ')})`;
    }

    let searchFilter = '';
    const termo = (search || '').trim();
    if (termo) {
      req.input('search', sql.VarChar, `%${termo}%`);
      searchFilter = `AND (
        LTRIM(RTRIM(s.ROMANEIO_PRODUTO)) LIKE @search
        OR LTRIM(RTRIM(ISNULL(s.FILIAL, ''))) LIKE @search
        OR LTRIM(RTRIM(ISNULL(s.RESPONSAVEL, ''))) LIKE @search
      )`;
    }

    const result = await req.query<{
      romaneio: string;
      filialOrigem: string;
      emissao: Date | null;
      responsavel: string;
      tipoRomaneio: string;
      linhas: number | null;
      qtdeSaida: number | null;
      cancelado: number | null;
    }>(`
      SELECT TOP (${topClamp})
        LTRIM(RTRIM(s.ROMANEIO_PRODUTO)) AS romaneio,
        LTRIM(RTRIM(ISNULL(s.FILIAL, ''))) AS filialOrigem,
        s.EMISSAO AS emissao,
        LTRIM(RTRIM(ISNULL(s.RESPONSAVEL, ''))) AS responsavel,
        LTRIM(RTRIM(ISNULL(s.TIPO_ROMANEIO, ''))) AS tipoRomaneio,
        (SELECT COUNT(*) FROM ESTOQUE_PROD1_SAI i WITH (NOLOCK)
          WHERE i.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND i.FILIAL = s.FILIAL) AS linhas,
        (SELECT ISNULL(SUM(ISNULL(i.QTDE, 0)), 0) FROM ESTOQUE_PROD1_SAI i WITH (NOLOCK)
          WHERE i.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND i.FILIAL = s.FILIAL) AS qtdeSaida,
        (SELECT COUNT(*) FROM LOJA_SAIDAS ls WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ls.ROMANEIO_PRODUTO)) = LTRIM(RTRIM(s.ROMANEIO_PRODUTO))
            AND LTRIM(RTRIM(ls.FILIAL)) = LTRIM(RTRIM(s.FILIAL))
            AND ISNULL(ls.SAIDA_CANCELADA, 0) = 1) AS cancelado
      FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
      WHERE s.EMISSAO >= @startDate
        AND s.EMISSAO < @endDate
        AND (
          UPPER(LTRIM(RTRIM(ISNULL(s.TIPO_ROMANEIO, '')))) = 'DEFEITO'
          OR UPPER(LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, '')))) = @defeitoDestino
        )
        ${escopoFilter}
        ${searchFilter}
      ORDER BY s.EMISSAO DESC, s.ROMANEIO_PRODUTO DESC
    `);

    return result.recordset;
  });

  // Estado de conferência de TODOS os romaneios em uma leitura agregada.
  const confirmado = await getConfirmadoAgregadoPorRomaneio(companyKey, defeitoFilial);

  return romaneios.map((r) => {
    const conf = confirmado.get(r.romaneio);
    return {
      romaneio: r.romaneio,
      filialOrigem: r.filialOrigem,
      emissao: r.emissao ? new Date(r.emissao).toISOString() : null,
      responsavel: r.responsavel,
      tipoRomaneio: r.tipoRomaneio,
      linhas: Number(r.linhas) || 0,
      qtdeSaida: Number(r.qtdeSaida) || 0,
      qtdeConfirmada: conf?.qtde ?? 0,
      linhasConfirmadas: conf?.linhas ?? 0,
      cancelado: Number(r.cancelado) > 0,
    };
  });
}

// ────────────────────────── ESQUERDA: itens do romaneio ──────────────────────────

export interface DefeitoRomaneioItem {
  produto: string;
  corProduto: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  grade: string;
  /** Dimensões do cadastro — é por elas que a tabela agrupa (ver romaneio-agrupamento). */
  grupo: string;
  subgrupo: string;
  linha: string;
  /** Quantidade lançada no romaneio de saída. */
  qtde: number;
  /** Quantidade confirmada na chegada (null = ainda não conferido). */
  qtdeConfirmada: number | null;
  /** Romaneio de entrada gerado no destino, quando houver. */
  romaneioEntrada: string;
  custoUnitario: number;
  /** Estoque atual do item na loja de ORIGEM — o que sobra se a peça voltar. */
  estoqueOrigem: number;
}

/**
 * Itens de um romaneio de defeito, já cruzados com a confirmação.
 *
 * Traz as linhas com `QTDE = 0` de propósito: item corrigido para zero continua
 * no romaneio (apagar dispararia o trigger LXD e duplicaria a devolução de
 * estoque), então a tela precisa mostrá-lo para que dê para voltar atrás.
 */
export async function fetchDefeitoRomaneioItens(params: {
  companyKey: string;
  romaneio: string;
  filialOrigem: string;
  defeitoFilial: string;
}): Promise<DefeitoRomaneioItem[]> {
  const { companyKey, romaneio, filialOrigem, defeitoFilial } = params;

  const itens = await withRequest(async (req) => {
    req.input('romaneio', sql.VarChar, (romaneio || '').trim());
    req.input('filial', sql.VarChar, (filialOrigem || '').trim());

    const result = await req.query<{
      produto: string;
      corProduto: string;
      descProduto: string;
      descCor: string;
      codigoBarra: string | null;
      grade: string;
      grupo: string;
      subgrupo: string;
      linha: string;
      qtde: number | null;
      custoUnitario: number | null;
      estoqueOrigem: number | null;
    }>(`
      SELECT
        LTRIM(RTRIM(i.PRODUTO)) AS produto,
        LTRIM(RTRIM(ISNULL(CAST(i.COR_PRODUTO AS VARCHAR(20)), ''))) AS corProduto,
        LTRIM(RTRIM(ISNULL(pr.DESC_PRODUTO, ''))) AS descProduto,
        -- Subconsulta, não JOIN: a cor existe gravada em dois formatos ('06' e '6')
        -- e um JOIN que casa os dois duplicaria a linha do item — item duplicado
        -- na tela seria item corrigido duas vezes.
        LTRIM(RTRIM(ISNULL((
          SELECT TOP 1 pc.DESC_COR_PRODUTO
            FROM PRODUTO_CORES pc WITH (NOLOCK)
           WHERE LTRIM(RTRIM(pc.PRODUTO)) = LTRIM(RTRIM(i.PRODUTO))
             AND (
               LTRIM(RTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(ISNULL(i.COR_PRODUTO, '') AS VARCHAR(20))))
               OR TRY_CONVERT(INT, pc.COR_PRODUTO) = TRY_CONVERT(INT, i.COR_PRODUTO)
             )
        ), ''))) AS descCor,
        (SELECT TOP 1 LTRIM(RTRIM(pb.CODIGO_BARRA))
           FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE LTRIM(RTRIM(pb.PRODUTO)) = LTRIM(RTRIM(i.PRODUTO))
            AND (
              LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(ISNULL(i.COR_PRODUTO, '') AS VARCHAR(20))))
              OR TRY_CONVERT(INT, pb.COR_PRODUTO) = TRY_CONVERT(INT, i.COR_PRODUTO)
            )
          ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) ASC, pb.CODIGO_BARRA ASC) AS codigoBarra,
        LTRIM(RTRIM(ISNULL(pr.GRADE, ''))) AS grade,
        LTRIM(RTRIM(ISNULL(pr.GRUPO_PRODUTO, ''))) AS grupo,
        LTRIM(RTRIM(ISNULL(pr.SUBGRUPO_PRODUTO, ''))) AS subgrupo,
        LTRIM(RTRIM(ISNULL(pr.LINHA, ''))) AS linha,
        ISNULL(i.QTDE, 0) AS qtde,
        ${CUSTO_EXPR} AS custoUnitario,
        ISNULL((
          SELECT TOP 1 ep.ESTOQUE
            FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
           WHERE LTRIM(RTRIM(ep.PRODUTO)) = LTRIM(RTRIM(i.PRODUTO))
             AND LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(@filial))
             AND (
               LTRIM(RTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(ISNULL(i.COR_PRODUTO, '') AS VARCHAR(20))))
               OR TRY_CONVERT(INT, ep.COR_PRODUTO) = TRY_CONVERT(INT, i.COR_PRODUTO)
             )
        ), 0) AS estoqueOrigem
      FROM ESTOQUE_PROD1_SAI i WITH (NOLOCK)
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON LTRIM(RTRIM(pr.PRODUTO)) = LTRIM(RTRIM(i.PRODUTO))
      WHERE LTRIM(RTRIM(i.ROMANEIO_PRODUTO)) = @romaneio
        AND LTRIM(RTRIM(i.FILIAL)) = LTRIM(RTRIM(@filial))
      ORDER BY pr.DESC_PRODUTO, i.PRODUTO, i.COR_PRODUTO
    `);

    return result.recordset;
  });

  const confirmados = await getConfirmadosComEntrada(companyKey, romaneio, defeitoFilial);

  // Chave normalizada da confirmação: a cor gravada lá pode estar em formato
  // diferente do que veio do Linx ('06' vs '6') e o item apareceria como "não
  // conferido" sem isso.
  const confirmadosNorm = new Map<string, { qtde: number; romaneioEntrada: string }>();
  for (const [chave, valor] of confirmados.entries()) {
    const [produto, cor] = chave.split('|');
    confirmadosNorm.set(chaveItem(produto, cor), valor);
  }

  return itens.map((item) => {
    const conf = confirmadosNorm.get(chaveItem(item.produto, item.corProduto));
    return {
      produto: item.produto,
      corProduto: item.corProduto,
      descProduto: item.descProduto,
      descCor: item.descCor,
      codigoBarra: item.codigoBarra,
      grade: item.grade,
      grupo: item.grupo,
      subgrupo: item.subgrupo,
      linha: item.linha,
      qtde: Number(item.qtde) || 0,
      qtdeConfirmada: conf ? conf.qtde : null,
      romaneioEntrada: conf?.romaneioEntrada ?? '',
      custoUnitario: Number(item.custoUnitario) || 0,
      estoqueOrigem: Number(item.estoqueOrigem) || 0,
    };
  });
}

// ───────────────────────────── DIREITA: entradas ─────────────────────────────

export interface DefeitoEntradaItem {
  produto: string;
  corProduto: string;
  descProduto: string;
  descCor: string;
  grade: string;
  linha: string;
  grupo: string;
  subgrupo: string;
  romaneio: string;
  romaneioEntrada: string;
  confirmadoEm: string;
  confirmadoPor: string;
  qtde: number;
  custoUnitario: number;
  custoTotal: number;
}

export interface DefeitoEntradaFilial {
  filialOrigem: string;
  qtde: number;
  custoTotal: number;
  itens: DefeitoEntradaItem[];
}

export interface DefeitoEntradasResult {
  filiais: DefeitoEntradaFilial[];
  totalQtde: number;
  totalCusto: number;
  /** Itens confirmados cujo romaneio de saída não está no escopo da empresa/período. */
  ignorados: number;
  /**
   * Itens cujo número de romaneio existe em mais de uma filial da empresa: a
   * confirmação guarda só o número, então a loja de origem é indeterminada e o
   * item fica fora dos totais em vez de ser atribuído à loja errada.
   */
  ambiguos: number;
}

/**
 * O que ENTROU na filial de defeito no período — só item confirmado, pela
 * quantidade confirmada, quebrado por loja de ORIGEM com custo por item.
 *
 * O caminho é: confirmação (Neon, pela data da conferência) → romaneio de saída
 * (Linx) para descobrir a loja de origem → cadastro para descrição e custo.
 *
 * Duas consultas agregadas, nunca uma por item: são centenas de confirmações por
 * mês e, via proxy, um request por linha derruba a tela (ver a "conexão perdida"
 * da compra sugerida ABC).
 */
export async function fetchDefeitoEntradas(params: {
  companyKey: string;
  filiaisOrigem: string[];
  defeitoFilial: string;
  range: { start: Date; end: Date };
}): Promise<DefeitoEntradasResult> {
  const { companyKey, filiaisOrigem, defeitoFilial, range } = params;

  const confirmacoes: ConfirmacaoDetalhada[] = await getConfirmacoesPorPeriodo(
    companyKey,
    defeitoFilial,
    range
  );

  if (confirmacoes.length === 0) {
    return { filiais: [], totalQtde: 0, totalCusto: 0, ignorados: 0, ambiguos: 0 };
  }

  const escopo = new Set(
    (filiaisOrigem || []).map((f) => (f || '').trim().toUpperCase()).filter(Boolean)
  );
  const romaneiosUnicos = Array.from(new Set(confirmacoes.map((c) => c.romaneioId).filter(Boolean)));
  const produtosUnicos = Array.from(new Set(confirmacoes.map((c) => c.produto).filter(Boolean)));

  // 1) Romaneio → loja de origem.
  //
  //    A confirmação guarda só o NÚMERO do romaneio, mas no Linx a chave da saída
  //    é romaneio + filial: o mesmo número pode existir em duas lojas (6 casos em
  //    2026, um deles entre duas filiais da mesma empresa). Por isso o recorte é
  //    duplo — filiais da empresa E romaneio de defeito — e, se ainda sobrar mais
  //    de uma origem possível, o item é contado como ambíguo em vez de ser
  //    atribuído por sorte a uma das lojas.
  const { origemPorRomaneio, ambiguos: romaneiosAmbiguos } = await withRequest(async (req) => {
    req.input('defeitoDestino', sql.VarChar, (defeitoFilial || '').trim().toUpperCase());
    const candidatos = new Map<string, Set<string>>();

    for (let i = 0; i < romaneiosUnicos.length; i += 500) {
      const lote = romaneiosUnicos.slice(i, i + 500);
      lote.forEach((rom, idx) => req.input(`rom${i}_${idx}`, sql.VarChar, rom));
      const result = await req.query<{ romaneio: string; filial: string }>(`
        SELECT LTRIM(RTRIM(s.ROMANEIO_PRODUTO)) AS romaneio,
               LTRIM(RTRIM(ISNULL(s.FILIAL, ''))) AS filial
          FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
         WHERE LTRIM(RTRIM(s.ROMANEIO_PRODUTO)) IN (${lote
           .map((_, idx) => `@rom${i}_${idx}`)
           .join(', ')})
           AND (
             UPPER(LTRIM(RTRIM(ISNULL(s.TIPO_ROMANEIO, '')))) = 'DEFEITO'
             OR UPPER(LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, '')))) = @defeitoDestino
           )
      `);
      for (const row of result.recordset) {
        const filial = (row.filial || '').trim();
        if (escopo.size > 0 && !escopo.has(filial.toUpperCase())) continue;
        const chave = (row.romaneio || '').trim();
        const atual = candidatos.get(chave) ?? new Set<string>();
        atual.add(filial);
        candidatos.set(chave, atual);
      }
    }

    const mapa = new Map<string, string>();
    const ambiguos = new Set<string>();
    for (const [romaneioId, filiais] of candidatos.entries()) {
      if (filiais.size === 1) mapa.set(romaneioId, [...filiais][0]);
      else ambiguos.add(romaneioId);
    }
    return { origemPorRomaneio: mapa, ambiguos };
  });

  // 2) Cadastro: descrição, dimensões e custo de cada produto × cor.
  const cadastroPorItem = await withRequest(async (req) => {
    const mapa = new Map<
      string,
      {
        descProduto: string;
        descCor: string;
        grade: string;
        linha: string;
        grupo: string;
        subgrupo: string;
        custo: number;
      }
    >();
    for (let i = 0; i < produtosUnicos.length; i += 400) {
      const lote = produtosUnicos.slice(i, i + 400);
      lote.forEach((p, idx) => req.input(`prod${i}_${idx}`, sql.VarChar, p));
      const result = await req.query<{
        produto: string;
        corProduto: string;
        descProduto: string;
        descCor: string;
        grade: string;
        linha: string;
        grupo: string;
        subgrupo: string;
        custo: number | null;
      }>(`
        SELECT
          LTRIM(RTRIM(i.PRODUTO)) AS produto,
          LTRIM(RTRIM(ISNULL(CAST(i.COR_PRODUTO AS VARCHAR(20)), ''))) AS corProduto,
          LTRIM(RTRIM(ISNULL(pr.DESC_PRODUTO, ''))) AS descProduto,
          LTRIM(RTRIM(ISNULL(i.DESC_COR_PRODUTO, ''))) AS descCor,
          LTRIM(RTRIM(ISNULL(pr.GRADE, ''))) AS grade,
          LTRIM(RTRIM(ISNULL(pr.LINHA, ''))) AS linha,
          LTRIM(RTRIM(ISNULL(pr.GRUPO_PRODUTO, ''))) AS grupo,
          LTRIM(RTRIM(ISNULL(pr.SUBGRUPO_PRODUTO, ''))) AS subgrupo,
          ${CUSTO_EXPR} AS custo
        FROM PRODUTO_CORES i WITH (NOLOCK)
        LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON LTRIM(RTRIM(pr.PRODUTO)) = LTRIM(RTRIM(i.PRODUTO))
        WHERE LTRIM(RTRIM(i.PRODUTO)) IN (${lote.map((_, idx) => `@prod${i}_${idx}`).join(', ')})
      `);
      for (const row of result.recordset) {
        mapa.set(chaveItem(row.produto, row.corProduto), {
          descProduto: row.descProduto,
          descCor: row.descCor,
          grade: row.grade,
          linha: row.linha,
          grupo: row.grupo,
          subgrupo: row.subgrupo,
          custo: Number(row.custo) || 0,
        });
      }
    }
    return mapa;
  });

  // 3) Monta a quebra por filial de origem.
  const porFilial = new Map<string, DefeitoEntradaFilial>();
  let ignorados = 0;
  let ambiguos = 0;

  for (const conf of confirmacoes) {
    if (romaneiosAmbiguos.has(conf.romaneioId)) {
      // Duas lojas da empresa com o mesmo número de romaneio: não há como saber
      // de qual veio, e chutar poria o custo na loja errada.
      ambiguos += 1;
      continue;
    }
    const filialOrigem = origemPorRomaneio.get(conf.romaneioId);
    if (!filialOrigem) {
      // Romaneio de outra empresa, ou saída já excluída: fora do recorte.
      ignorados += 1;
      continue;
    }

    const cadastro = cadastroPorItem.get(chaveItem(conf.produto, conf.corProduto));
    const custoUnitario = cadastro?.custo ?? 0;
    const qtde = conf.qtdeConfirmada;

    const item: DefeitoEntradaItem = {
      produto: conf.produto,
      corProduto: conf.corProduto,
      descProduto: cadastro?.descProduto ?? '',
      descCor: cadastro?.descCor ?? '',
      grade: cadastro?.grade ?? '',
      linha: cadastro?.linha ?? '',
      grupo: cadastro?.grupo ?? '',
      subgrupo: cadastro?.subgrupo ?? '',
      romaneio: conf.romaneioId,
      romaneioEntrada: conf.romaneioEntrada,
      confirmadoEm: conf.confirmedAt,
      confirmadoPor: conf.confirmedBy,
      qtde,
      custoUnitario,
      // Centavos exatos por linha; o arredondamento é só na exibição (ver a
      // regra do Produto Giro: round-then-sum diverge do total).
      custoTotal: qtde * custoUnitario,
    };

    const atual = porFilial.get(filialOrigem) ?? {
      filialOrigem,
      qtde: 0,
      custoTotal: 0,
      itens: [],
    };
    atual.qtde += qtde;
    atual.custoTotal += item.custoTotal;
    atual.itens.push(item);
    porFilial.set(filialOrigem, atual);
  }

  const filiais = Array.from(porFilial.values()).sort((a, b) => b.custoTotal - a.custoTotal);
  for (const f of filiais) {
    f.itens.sort(
      (a, b) => b.custoTotal - a.custoTotal || a.descProduto.localeCompare(b.descProduto)
    );
  }

  return {
    filiais,
    totalQtde: filiais.reduce((acc, f) => acc + f.qtde, 0),
    totalCusto: filiais.reduce((acc, f) => acc + f.custoTotal, 0),
    ignorados,
    ambiguos,
  };
}
