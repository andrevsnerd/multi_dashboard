import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { query } from "@/lib/db/connection";

async function isAdmin(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  return user?.role === "admin";
}

export interface ExtratoLinha {
  emissao: string;
  tipo: string;
  tipoRomaneio: string | null;
  doc: string;
  filialOrigem: string | null;
  filialDestino: string | null;
  romaneio: string | null; // romaneio pedido/saída origem
  qtde: number;           // campo QTDE (total declarado)
  qtdeGrade: number;      // campo EN_1 ou SA_1 (grade 90x90)
  valor: number;
  preco: number;
  obs: string | null;
  atualizouEstoque: boolean | null;
  statusTransito: number | null;
}

export interface ExtratoResponse {
  produto: string;
  descProduto: string | null;
  cor: string;
  descCor: string | null;
  grade: string | null;
  filial: string;
  estoqueAtual: number;
  linhas: ExtratoLinha[];
  erros: string[];
}

export async function GET(request: NextRequest) {
  const username = request.headers.get("x-auth-username");
  if (!username || !(await isAdmin(username))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const produto = searchParams.get("produto")?.trim();
  const cor = searchParams.get("cor")?.trim();
  const filial = searchParams.get("filial")?.trim(); // pode ser parte do nome

  if (!produto || !cor) {
    return NextResponse.json(
      { error: "Parâmetros 'produto' e 'cor' são obrigatórios" },
      { status: 400 }
    );
  }

  const erros: string[] = [];
  const linhas: ExtratoLinha[] = [];

  // Filtro de filial para queries
  const filialFilter = filial ? `AND le.FILIAL LIKE '%${filial.replace(/'/g, "''")}%'` : "";
  const filialFilterSai = filial ? `AND s.FILIAL LIKE '%${filial.replace(/'/g, "''")}%'` : "";
  const filialFilterLs = filial ? `AND ls.FILIAL LIKE '%${filial.replace(/'/g, "''")}%'` : "";
  const filialFilterV = filial ? `AND vp.CODIGO_FILIAL IN (SELECT CODIGO_FILIAL FROM LOJA_VENDA WHERE FILIAL LIKE '%${filial.replace(/'/g, "''")}%')` : "";

  // ── Info do produto ──
  let descProduto: string | null = null;
  let descCor: string | null = null;
  let grade: string | null = null;
  let estoqueAtual = 0;

  try {
    const prodInfo = await query<{
      DESC_PRODUTO: string;
      GRADE: string;
      DESC_COR: string;
      ESTOQUE: number;
    }>(`
      SELECT TOP 1
        p.DESC_PRODUTO,
        p.GRADE,
        c.DESC_COR,
        ISNULL(ep.ESTOQUE, 0) AS ESTOQUE
      FROM PRODUTOS p WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = '${cor.replace(/'/g, "''")}'
      LEFT JOIN ESTOQUE_PRODUTOS ep WITH (NOLOCK)
        ON ep.PRODUTO = p.PRODUTO AND ep.COR_PRODUTO = '${cor.replace(/'/g, "''")}' ${filial ? `AND ep.FILIAL LIKE '%${filial.replace(/'/g, "''")}%'` : ""}
      WHERE p.PRODUTO = '${produto.replace(/'/g, "''")}'
    `);
    if (prodInfo.length > 0) {
      descProduto = prodInfo[0].DESC_PRODUTO?.trim() ?? null;
      grade = prodInfo[0].GRADE?.trim() ?? null;
      descCor = prodInfo[0].DESC_COR?.trim() ?? null;
      estoqueAtual = prodInfo[0].ESTOQUE ?? 0;
    }
  } catch (e) {
    erros.push(`Info produto: ${(e as Error).message}`);
  }

  // ── 1. LOJA ENTRADAS (romaneios de chegada de fornecedor/transferência confirmada) ──
  try {
    const rows = await query<{
      EMISSAO: Date;
      FILIAL: string;
      FILIAL_ORIGEM: string | null;
      ROMANEIO_PRODUTO: string;
      QTDE_ENTRADA: number;
      EN1: number;
      VALOR: number;
      PRECO1: number;
      STATUS_TRANSITO: number | null;
      ATUALIZOU_ESTOQUE: boolean | null;
      OBS: string | null;
      TIPO_ENTRADA_SAIDA: string | null;
      DESC_TIPO: string | null;
    }>(`
      SELECT
        le.EMISSAO,
        le.FILIAL,
        le.FILIAL_ORIGEM,
        lep.ROMANEIO_PRODUTO,
        lep.QTDE_ENTRADA,
        lep.EN1,
        lep.VALOR,
        lep.PRECO1,
        le.STATUS_TRANSITO,
        lep.ATUALIZOU_ESTOQUE,
        CAST(le.OBS AS varchar(500)) AS OBS,
        le.TIPO_ENTRADA_SAIDA,
        t.DESC_TIPO_ENTRADA_SAIDA AS DESC_TIPO
      FROM LOJA_ENTRADAS le WITH (NOLOCK)
      JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
        ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
      LEFT JOIN LOJA_TIPOS_ENTRADA_SAIDA t WITH (NOLOCK)
        ON t.TIPO_ENTRADA_SAIDA = le.TIPO_ENTRADA_SAIDA
      WHERE lep.PRODUTO = '${produto.replace(/'/g, "''")}'
        AND lep.COR_PRODUTO = '${cor.replace(/'/g, "''")}'
        ${filialFilter}
      ORDER BY le.EMISSAO
    `);
    for (const r of rows) {
      linhas.push({
        emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : "",
        tipo: "LOJA ENTRADAS",
        tipoRomaneio: r.DESC_TIPO ?? r.TIPO_ENTRADA_SAIDA ?? null,
        doc: r.ROMANEIO_PRODUTO?.trim() ?? "",
        filialOrigem: r.FILIAL_ORIGEM?.trim() ?? null,
        filialDestino: r.FILIAL?.trim() ?? null,
        romaneio: null,
        qtde: r.QTDE_ENTRADA ?? 0,
        qtdeGrade: r.EN1 ?? 0,
        valor: r.VALOR ?? 0,
        preco: r.PRECO1 ?? 0,
        obs: r.OBS?.trim() ?? null,
        atualizouEstoque: r.ATUALIZOU_ESTOQUE ?? null,
        statusTransito: r.STATUS_TRANSITO ?? null,
      });
    }
  } catch (e) {
    erros.push(`LOJA ENTRADAS: ${(e as Error).message}`);
  }

  // ── 2. ENTRADA NORMAL (ESTOQUE_PROD_ENT) - ajustes, transferências, produção etc ──
  try {
    const rows = await query<{
      EMISSAO: Date;
      FILIAL: string;
      FILIAL_DESTINO: string | null;
      ROMANEIO_PRODUTO: string;
      TIPO_ROMANEIO: string | null;
      TIPO_ENTRADA: number | null;
      QTDE: number;
      EN_1: number;
      CUSTO1: number;
      ROMANEIO_ORIGEM: string | null;
      OBS: string | null;
    }>(`
      SELECT
        e.EMISSAO,
        e.FILIAL,
        e.FILIAL_DESTINO,
        e.ROMANEIO_PRODUTO,
        e.TIPO_ROMANEIO,
        e.TIPO_ENTRADA,
        p.QTDE,
        p.EN_1,
        p.CUSTO1,
        e.ROMANEIO_ORIGEM,
        CAST(e.OBS AS varchar(500)) AS OBS
      FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
      JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK) ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
      WHERE p.PRODUTO = '${produto.replace(/'/g, "''")}'
        AND p.COR_PRODUTO = '${cor.replace(/'/g, "''")}'
        ${filialFilter.replace('le.FILIAL', 'e.FILIAL')}
      ORDER BY e.EMISSAO
    `);
    for (const r of rows) {
      linhas.push({
        emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : "",
        tipo: "ENTRADA NORMAL",
        tipoRomaneio: r.TIPO_ROMANEIO?.trim() ?? null,
        doc: r.ROMANEIO_PRODUTO?.trim() ?? "",
        filialOrigem: null,
        filialDestino: r.FILIAL_DESTINO?.trim() ?? r.FILIAL?.trim() ?? null,
        romaneio: r.ROMANEIO_ORIGEM?.trim() ?? null,
        qtde: r.QTDE ?? 0,
        qtdeGrade: r.EN_1 ?? 0,
        valor: 0,
        preco: r.CUSTO1 ?? 0,
        obs: r.OBS?.trim() ?? null,
        atualizouEstoque: null,
        statusTransito: null,
      });
    }
  } catch (e) {
    erros.push(`ENTRADA NORMAL: ${(e as Error).message}`);
  }

  // ── 3. SAIDA NORMAL (ESTOQUE_PROD_SAI) - transferências, ajustes etc ──
  try {
    const rows = await query<{
      EMISSAO: Date;
      FILIAL: string;
      FILIAL_DESTINO: string | null;
      ROMANEIO_PRODUTO: string;
      TIPO_ROMANEIO: string | null;
      ROMANEIO_DESTINO: string | null;
      QTDE: number;
      SA_1: number;
      CUSTO1: number;
      OBS: string | null;
    }>(`
      SELECT
        s.EMISSAO,
        s.FILIAL,
        s.FILIAL_DESTINO,
        s.ROMANEIO_PRODUTO,
        s.TIPO_ROMANEIO,
        s.ROMANEIO_DESTINO,
        p.QTDE,
        p.SA_1,
        p.CUSTO1,
        CAST(s.OBS AS varchar(500)) AS OBS
      FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
      JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK) ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
      WHERE p.PRODUTO = '${produto.replace(/'/g, "''")}'
        AND p.COR_PRODUTO = '${cor.replace(/'/g, "''")}'
        ${filialFilterSai}
      ORDER BY s.EMISSAO
    `);
    for (const r of rows) {
      linhas.push({
        emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : "",
        tipo: "SAIDA NORMAL",
        tipoRomaneio: r.TIPO_ROMANEIO?.trim() ?? null,
        doc: r.ROMANEIO_PRODUTO?.trim() ?? "",
        filialOrigem: r.FILIAL?.trim() ?? null,
        filialDestino: r.FILIAL_DESTINO?.trim() ?? null,
        romaneio: r.ROMANEIO_DESTINO?.trim() ?? null,
        qtde: -(r.QTDE ?? 0),
        qtdeGrade: -(r.SA_1 ?? 0),
        valor: 0,
        preco: r.CUSTO1 ?? 0,
        obs: r.OBS?.trim() ?? null,
        atualizouEstoque: null,
        statusTransito: null,
      });
    }
  } catch (e) {
    erros.push(`SAIDA NORMAL: ${(e as Error).message}`);
  }

  // ── 4. LOJA VENDAS ──
  try {
    // LOJA_VENDA usa CODIGO_FILIAL (código numérico, sem nome).
    // Vendas são retornadas sem filtro de filial — o CODIGO_FILIAL é mostrado na tela.
    const rows = await query<{
      DATA_VENDA: Date;
      CODIGO_FILIAL: string;
      TICKET: string;
      QTDE: number;
      PRECO_LIQUIDO: number;
      QTDE_CANCELADA: number;
    }>(`
      SELECT
        v.DATA_VENDA,
        v.CODIGO_FILIAL,
        v.TICKET,
        vp.QTDE,
        vp.PRECO_LIQUIDO,
        vp.QTDE_CANCELADA
      FROM LOJA_VENDA v WITH (NOLOCK)
      JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
      WHERE vp.PRODUTO = '${produto.replace(/'/g, "''")}'
        AND vp.COR_PRODUTO = '${cor.replace(/'/g, "''")}'
        AND vp.QTDE_CANCELADA = 0
        AND ISNULL(vp.NAO_MOVIMENTA_ESTOQUE, 0) = 0
      ORDER BY v.DATA_VENDA
    `);
    for (const r of rows) {
      const qtdeLiquida = (r.QTDE ?? 0) - (r.QTDE_CANCELADA ?? 0);
      linhas.push({
        emissao: r.DATA_VENDA ? new Date(r.DATA_VENDA).toISOString() : "",
        tipo: "LOJA VENDAS",
        tipoRomaneio: null,
        doc: r.TICKET?.trim() ?? "",
        filialOrigem: r.CODIGO_FILIAL?.trim() ?? null,
        filialDestino: null,
        romaneio: null,
        qtde: -qtdeLiquida,
        qtdeGrade: -qtdeLiquida, // vendas não têm campo de grade separado
        valor: -(r.PRECO_LIQUIDO ?? 0) * qtdeLiquida,
        preco: r.PRECO_LIQUIDO ?? 0,
        obs: null,
        atualizouEstoque: true,
        statusTransito: null,
      });
    }
  } catch (e) {
    erros.push(`LOJA VENDAS: ${(e as Error).message}`);
  }

  // ── 5. LOJA SAIDAS (romaneios de saída via loja) ──
  try {
    const rows = await query<{
      EMISSAO: Date;
      FILIAL: string;
      FILIAL_DESTINO: string | null;
      ROMANEIO_PRODUTO: string;
      TIPO_ENTRADA_SAIDA: string | null;
      DESC_TIPO: string | null;
      QTDE_SAIDA: number;
      EN1: number;
      OBS: string | null;
    }>(`
      SELECT
        ls.EMISSAO,
        ls.FILIAL,
        ls.FILIAL_DESTINO,
        ls.ROMANEIO_PRODUTO,
        ls.TIPO_ENTRADA_SAIDA,
        t.DESC_TIPO_ENTRADA_SAIDA AS DESC_TIPO,
        lsp.QTDE_SAIDA,
        lsp.EN1,
        CAST(ls.OBS AS varchar(500)) AS OBS
      FROM LOJA_SAIDAS ls WITH (NOLOCK)
      JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
        ON ls.FILIAL = lsp.FILIAL AND ls.ROMANEIO_PRODUTO = lsp.ROMANEIO_PRODUTO
      LEFT JOIN LOJA_TIPOS_ENTRADA_SAIDA t WITH (NOLOCK)
        ON t.TIPO_ENTRADA_SAIDA = ls.TIPO_ENTRADA_SAIDA
      WHERE lsp.PRODUTO = '${produto.replace(/'/g, "''")}'
        AND lsp.COR_PRODUTO = '${cor.replace(/'/g, "''")}'
        ${filialFilterLs}
      ORDER BY ls.EMISSAO
    `);
    for (const r of rows) {
      linhas.push({
        emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : "",
        tipo: "LOJA SAIDAS",
        tipoRomaneio: r.DESC_TIPO ?? r.TIPO_ENTRADA_SAIDA ?? null,
        doc: r.ROMANEIO_PRODUTO?.trim() ?? "",
        filialOrigem: r.FILIAL?.trim() ?? null,
        filialDestino: r.FILIAL_DESTINO?.trim() ?? null,
        romaneio: null,
        qtde: -(r.QTDE_SAIDA ?? 0),
        qtdeGrade: -(r.EN1 ?? 0),
        valor: 0,
        preco: 0,
        obs: r.OBS?.trim() ?? null,
        atualizouEstoque: null,
        statusTransito: null,
      });
    }
  } catch (e) {
    erros.push(`LOJA SAIDAS: ${(e as Error).message}`);
  }

  // Ordenar por data
  linhas.sort((a, b) => a.emissao.localeCompare(b.emissao));

  const response: ExtratoResponse = {
    produto,
    descProduto,
    cor,
    descCor,
    grade,
    filial: filial ?? "Todas",
    estoqueAtual,
    linhas,
    erros,
  };

  return NextResponse.json(response);
}
