import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import {
  AVIAMENTOS,
  LINHAS_SEM_PECA,
  LINHA_FASHION,
  type AviamentoCanal,
  type ContextoAviamento,
} from "@/lib/config/aviamentos";

/**
 * Consumo de AVIAMENTO por mês, reconstruído ticket a ticket.
 *
 * Cópia da consulta das embalagens ([projecaoEmbalagens.ts](@/lib/repositories/projecaoEmbalagens)),
 * com a mesma venda "com trocas" medindo QUANTIDADE. A diferença é o que o ticket carrega:
 * em vez das categorias de caixa/sacola, só duas contagens — peças da marca (`PECAS`, tudo
 * menos `LINHAS_SEM_PECA`) e, dessas, as da linha Fashion (`FASHION`). É o que as regras de
 * aviamento leem ("1 por peça", "1 por peça Fashion", "1 por compra", "1 por pedido do site").
 *
 * O SQL devolve a assinatura do ticket (PECAS, FASHION) já agrupada com a contagem de
 * tickets; as regras rodam em TypeScript, uma vez por assinatura × contagem.
 *
 * Piso 0 no par ticket × tipo de peça, como nas embalagens: devolução pura não consome
 * aviamento, e "menos uma tag" não existe. Contagem física, não faturamento.
 */

/** Janelas de ritmo em dias — as mesmas da Projeção Compra. */
export const JANELAS_DIAS = [30, 60, 90, 120, 365] as const;

export interface AviamentoMes {
  /** 'yyyy-MM' */
  mes: string;
  qtde: number;
  qtdeAnoAnterior: number;
  parcial: boolean;
  futuro: boolean;
}

export interface AviamentoSerie {
  id: string;
  nome: string;
  nota?: string;
  /** false = aviamento ainda sem regra; a tela mostra "sem regra" em vez de zero. */
  temRegra: boolean;
  /** Consumo nas janelas de N dias anteriores à data base. */
  janelas: Record<number, number>;
  mensal: AviamentoMes[];
}

export interface ProjecaoAviamentosParams {
  companyKey: string;
  /** Nomes VIVOS das filiais de loja física no escopo. */
  posFilialNames: string[];
  /** Nomes VIVOS das filiais de e-commerce no escopo. */
  ecommerceFilialNames: string[];
  /** Data base 'yyyy-MM-dd'. As janelas fecham no dia anterior a ela. */
  base: string;
}

/* ───────────────────────────── classificação em SQL ───────────────────────────── */

/** Collation sem caixa e sem acento — para o nome da linha casar com ou sem acento. */
const CI_AI = "COLLATE Latin1_General_CI_AI";

const EXPR = {
  linha: `UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, ''))))`,
};

/** Literal SQL seguro (os valores vêm da config, mas escapar é barato). */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Igualdade por valor exato, ignorando acento e caixa. */
function inList(expr: string, values: string[]): string {
  return `${expr} ${CI_AI} IN (${values.map((v) => lit(v)).join(", ")})`;
}

/** Tipo do item: −1 = não é peça da marca, 1 = peça Fashion, 0 = qualquer outra peça. */
function tipoPecaExpr(): string {
  return `CASE WHEN ${inList(EXPR.linha, LINHAS_SEM_PECA)} THEN -1
            WHEN ${inList(EXPR.linha, [LINHA_FASHION])} THEN 1
            ELSE 0 END`;
}

/* ───────────────────────────── consulta ───────────────────────────── */

/** Uma assinatura de ticket, como o banco devolve. */
interface LinhaAssinatura {
  MESCHAVE: string;
  /** Menor janela de dias que contém a data (0 = fora de todas). */
  FAIXA: number;
  /** Peças da marca no ticket. */
  PECAS: number;
  /** Dessas, as da linha Fashion. */
  FASHION: number;
  TICKETS: number;
}

/** Peças por tipo, já com piso 0 no par ticket × tipo. */
function pivotSelect(): string {
  return [
    `SUM(CASE WHEN ic.TIPO >= 0 AND ic.QTDE > 0 THEN ic.QTDE ELSE 0 END) AS PECAS`,
    `SUM(CASE WHEN ic.TIPO = 1 AND ic.QTDE > 0 THEN ic.QTDE ELSE 0 END) AS FASHION`,
  ].join(",\n          ");
}

/**
 * Monta o trecho comum: classifica os itens, pivota por ticket e agrupa por assinatura.
 * `movCte` é o corpo da CTE `mov`, que cada canal escreve do seu jeito e que precisa
 * devolver as colunas CHAVE, DATA, CODIGO_FILIAL, PRODUTO e QTDE.
 */
function montarQuery(movCte: string): string {
  const faixaCase = JANELAS_DIAS.map((dias) => `WHEN pv.DATA_TICKET >= @janela${dias} THEN ${dias}`).join(
    "\n              "
  );
  const faixaExpr = `CASE ${faixaCase} ELSE 0 END`;
  const mesExpr = `CONVERT(CHAR(7), pv.DATA_TICKET, 126)`;

  return `
    WITH mov AS (
${movCte}
    ),
    itemcat AS (
      SELECT
        m.CHAVE,
        CAST(m.DATA AS DATE) AS DATA,
        ${tipoPecaExpr()} AS TIPO,
        CAST(ROUND(SUM(m.QTDE), 0) AS INT) AS QTDE
      FROM mov m
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = m.PRODUTO
      GROUP BY m.CHAVE, CAST(m.DATA AS DATE), ${tipoPecaExpr()}
    ),
    piv AS (
      SELECT
        ic.CHAVE,
        MIN(ic.DATA) AS DATA_TICKET,
        ${pivotSelect()}
      FROM itemcat ic
      GROUP BY ic.CHAVE
    )
    SELECT
      ${mesExpr} AS MESCHAVE,
      ${faixaExpr} AS FAIXA,
      pv.PECAS,
      pv.FASHION,
      COUNT(*) AS TICKETS
    FROM piv pv
    GROUP BY
      ${mesExpr},
      ${faixaExpr},
      pv.PECAS,
      pv.FASHION
  `;
}

/** Parâmetros de data das janelas (base − N dias), comuns às duas consultas. */
function inputJanelas(request: { input: (n: string, t: unknown, v: unknown) => unknown }, base: Date) {
  JANELAS_DIAS.forEach((dias) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - dias);
    request.input(`janela${dias}`, sql.Date, d);
  });
}

async function consultarPos(
  filiais: string[],
  inicio: Date,
  fim: Date,
  base: Date
): Promise<LinhaAssinatura[]> {
  if (filiais.length === 0) return [];
  return withRequest(async (request) => {
    request.input("inicio", sql.DateTime, inicio);
    request.input("fim", sql.DateTime, fim);
    inputJanelas(request, base);
    filiais.forEach((f, i) => request.input(`pf${i}`, sql.VarChar, f));
    const placeholders = filiais.map((_, i) => `@pf${i}`).join(", ");

    const movCte = `
      SELECT
        vn.CHAVE,
        vn.DATA,
        vn.CODIGO_FILIAL,
        vn.PRODUTO,
        (vn.QTDE - CASE WHEN vn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE
      FROM (
        SELECT
          LTRIM(RTRIM(CAST(vb.CODIGO_FILIAL AS VARCHAR(20)))) + '|'
            + LTRIM(RTRIM(CAST(vb.TICKET AS VARCHAR(30)))) AS CHAVE,
          vb.DATA_VENDA AS DATA,
          LTRIM(RTRIM(CAST(vb.CODIGO_FILIAL AS VARCHAR(20)))) AS CODIGO_FILIAL,
          vb.TICKET,
          vb.PRODUTO,
          vb.COR_PRODUTO,
          vb.TAMANHO,
          vb.QTDE,
          ROW_NUMBER() OVER (
            PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
            ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
          ) AS RN
        FROM (
          SELECT
            vp.TICKET,
            vp.CODIGO_FILIAL,
            vp.PRODUTO,
            ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
            ISNULL(vp.TAMANHO, 0) AS TAMANHO,
            vp.QTDE,
            vp.DATA_VENDA
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
          WHERE vp.DATA_VENDA >= @inicio
            AND vp.DATA_VENDA < @fim
            AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
            AND f.FILIAL IN (${placeholders})
        ) vb
      ) vn
      LEFT JOIN (
        SELECT
          vt.TICKET,
          vt.CODIGO_FILIAL,
          vt.PRODUTO,
          ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
          ISNULL(vt.TAMANHO, 0) AS TAMANHO,
          SUM(vt.QTDE) AS QTDE_TROCA
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vt.CODIGO_FILIAL
        WHERE vt.QTDE_CANCELADA = 0
          AND v.DATA_VENDA >= @inicio
          AND v.DATA_VENDA < @fim
          AND f.FILIAL IN (${placeholders})
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO,
                 ISNULL(vt.COR_PRODUTO, ''), ISNULL(vt.TAMANHO, 0)
      ) ti
        ON ti.TICKET = vn.TICKET
        AND ti.CODIGO_FILIAL = vn.CODIGO_FILIAL
        AND ti.PRODUTO = vn.PRODUTO
        AND ti.COR_PRODUTO = vn.COR_PRODUTO
        AND ti.TAMANHO = vn.TAMANHO

      UNION ALL

      -- Trocas puras (devolução sem venda casada no mesmo ticket): movimento negativo.
      SELECT
        LTRIM(RTRIM(CAST(vt.CODIGO_FILIAL AS VARCHAR(20)))) + '|'
          + LTRIM(RTRIM(CAST(vt.TICKET AS VARCHAR(30)))) AS CHAVE,
        v.DATA_VENDA AS DATA,
        LTRIM(RTRIM(CAST(vt.CODIGO_FILIAL AS VARCHAR(20)))) AS CODIGO_FILIAL,
        vt.PRODUTO,
        (0 - vt.QTDE) AS QTDE
      FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
      INNER JOIN LOJA_VENDA v WITH (NOLOCK)
        ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vt.CODIGO_FILIAL
      WHERE vt.QTDE_CANCELADA = 0
        AND v.DATA_VENDA >= @inicio
        AND v.DATA_VENDA < @fim
        AND f.FILIAL IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM LOJA_VENDA_PRODUTO vp2 WITH (NOLOCK)
          WHERE vp2.TICKET = vt.TICKET
            AND vp2.CODIGO_FILIAL = vt.CODIGO_FILIAL
            AND vp2.PRODUTO = vt.PRODUTO
            AND ISNULL(vp2.COR_PRODUTO, '') = ISNULL(vt.COR_PRODUTO, '')
            AND ISNULL(vp2.TAMANHO, 0) = ISNULL(vt.TAMANHO, 0)
            AND ISNULL(vp2.QTDE_CANCELADA, 0) = 0
        )`;

    const res = await request.query<LinhaAssinatura>(montarQuery(movCte));
    return res.recordset ?? [];
  });
}

async function consultarEcommerce(
  filiais: string[],
  inicio: Date,
  fim: Date,
  base: Date
): Promise<LinhaAssinatura[]> {
  if (filiais.length === 0) return [];
  return withRequest(async (request) => {
    request.input("inicio", sql.DateTime, inicio);
    request.input("fim", sql.DateTime, fim);
    inputJanelas(request, base);
    filiais.forEach((f, i) => request.input(`ef${i}`, sql.VarChar, f));
    const placeholders = filiais.map((_, i) => `@ef${i}`).join(", ");

    // O "ticket" do site é a nota: FILIAL + NF + série identificam o pedido.
    const movCte = `
      SELECT
        LTRIM(RTRIM(CAST(f.FILIAL AS VARCHAR(60)))) + '|'
          + LTRIM(RTRIM(CAST(f.NF_SAIDA AS VARCHAR(30)))) + '|'
          + LTRIM(RTRIM(CAST(f.SERIE_NF AS VARCHAR(10)))) AS CHAVE,
        f.EMISSAO AS DATA,
        '' AS CODIGO_FILIAL,
        fp.PRODUTO,
        fp.QTDE
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE f.EMISSAO >= @inicio
        AND f.EMISSAO < @fim
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND f.FILIAL IN (${placeholders})`;

    const res = await request.query<LinhaAssinatura>(montarQuery(movCte));
    return res.recordset ?? [];
  });
}

/* ───────────────────────────── agregação ───────────────────────────── */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Data 'yyyy-MM-dd' como Date UTC (meia-noite). */
function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Consumo de aviamento por mês e por janela, no escopo pedido.
 *
 * Devolve 12 meses do ano da data base (com o mesmo mês do ano anterior ao lado, que é a
 * base da projeção por curva) e o consumo das janelas de 30/60/90/120/365 dias.
 */
export async function fetchProjecaoAviamentos(
  params: ProjecaoAviamentosParams
): Promise<AviamentoSerie[]> {
  const { posFilialNames, ecommerceFilialNames, base } = params;
  const anoBase = Number(base.slice(0, 4));
  const mesBase = Number(base.slice(5, 7));
  const baseDate = ymdToUtc(base);

  // A consulta cobre do 1º de janeiro do ano ANTERIOR até o dia anterior à data base:
  // é o que a série mensal precisa e já contém, por dentro, a janela de 365 dias.
  const inicio = new Date(Date.UTC(anoBase - 1, 0, 1));

  // Um pedaço por ANO e por canal: quatro consultas leves em paralelo em vez de uma
  // varredura de vinte meses.
  const cortes: Array<{ inicio: Date; fim: Date }> = [
    { inicio, fim: new Date(Date.UTC(anoBase, 0, 1)) },
    { inicio: new Date(Date.UTC(anoBase, 0, 1)), fim: baseDate },
  ].filter((c) => c.inicio < c.fim);

  const blocos = await Promise.all(
    cortes.flatMap((corte) => [
      consultarPos(posFilialNames, corte.inicio, corte.fim, baseDate).then(
        (linhas) => ({ canal: "loja" as AviamentoCanal, linhas })
      ),
      consultarEcommerce(ecommerceFilialNames, corte.inicio, corte.fim, baseDate).then(
        (linhas) => ({ canal: "site" as AviamentoCanal, linhas })
      ),
    ])
  );

  // ── Aplica as regras: uma vez por assinatura, multiplicando pela contagem de tickets ──
  const comRegra = AVIAMENTOS.filter((e) => e.regra);
  /** id do aviamento → 'yyyy-MM' → quantidade. */
  const porMes = new Map<string, Map<string, number>>();
  /** id do aviamento → faixa de dias → quantidade (faixas ainda não acumuladas). */
  const porFaixa = new Map<string, Map<number, number>>();
  comRegra.forEach((e) => {
    porMes.set(e.id, new Map());
    porFaixa.set(e.id, new Map());
  });

  blocos.forEach(({ canal, linhas }) => {
    linhas.forEach((linha) => {
      const tickets = Number(linha.TICKETS) || 0;
      if (tickets <= 0) return;

      const ctx: ContextoAviamento = {
        pecas: Number(linha.PECAS) || 0,
        pecasFashion: Number(linha.FASHION) || 0,
        canal,
      };

      const mes = String(linha.MESCHAVE ?? "").slice(0, 7);
      const faixa = Number(linha.FAIXA) || 0;

      comRegra.forEach((emb) => {
        const porTicket = emb.regra ? emb.regra(ctx) : 0;
        if (!porTicket) return;
        const total = porTicket * tickets;

        const mapaMes = porMes.get(emb.id)!;
        mapaMes.set(mes, (mapaMes.get(mes) ?? 0) + total);

        if (faixa > 0) {
          const mapaFaixa = porFaixa.get(emb.id)!;
          mapaFaixa.set(faixa, (mapaFaixa.get(faixa) ?? 0) + total);
        }
      });
    });
  });

  // ── Monta a série de cada aviamento (os sem regra também: a tela mostra "sem regra") ──
  return AVIAMENTOS.map((emb) => {
    const mapaMes = porMes.get(emb.id) ?? new Map<string, number>();
    const mapaFaixa = porFaixa.get(emb.id) ?? new Map<number, number>();

    // As faixas são encaixadas (30 ⊂ 60 ⊂ 90 ⊂ …), então a janela de N dias é a soma de
    // todas as faixas até N.
    const janelas: Record<number, number> = {};
    let acumulado = 0;
    JANELAS_DIAS.forEach((dias) => {
      acumulado += mapaFaixa.get(dias) ?? 0;
      janelas[dias] = Math.round(acumulado);
    });

    const mensal: AviamentoMes[] = Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      return {
        mes: `${anoBase}-${pad2(mes)}`,
        qtde: Math.round(mapaMes.get(`${anoBase}-${pad2(mes)}`) ?? 0),
        qtdeAnoAnterior: Math.round(mapaMes.get(`${anoBase - 1}-${pad2(mes)}`) ?? 0),
        /** Mês em curso: fechado só até a data base, não serve de base de crescimento. */
        parcial: mes === mesBase,
        futuro: mes > mesBase,
      };
    });

    return {
      id: emb.id,
      nome: emb.nome,
      nota: emb.nota,
      temRegra: Boolean(emb.regra),
      janelas,
      mensal,
    };
  });
}
