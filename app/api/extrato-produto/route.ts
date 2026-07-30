import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { userHasPagePermission } from "@/lib/auth/permissions";
import type { UserSession } from "@/types/auth";
import { query } from "@/lib/db/connection";
import { FILIAIS } from "@/lib/config/filial-registry";

/** Acesso ao Extrato de Produto: admin sempre; logistica se a pagina for liberada. */
async function canAccessExtrato(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  if (!user) return false;
  return userHasPagePermission(user as unknown as UserSession, "extrato-produto");
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
  /**
   * Quem fez o movimento. Romaneios e contagem trazem o RESPONSAVEL do Linx (login,
   * ex.: "ALECIO"); venda traz o apelido do vendedor (LOJA_VENDEDORES, mesmo join do
   * relatório de vendedores); ajuste manual traz o usuário do dashboard.
   */
  responsavel: string | null;
}

export interface ProdutoCorOption {
  cor: string;
  descCor: string | null;
  codigoBarra: string | null;
  estoqueAtual: number;
}

export interface ProdutoFilialOption {
  filial: string;
  estoqueAtual: number;
}

export interface ExtratoResponse {
  produto: string;
  descProduto: string | null;
  cor: string;
  descCor: string | null;
  codigoBarra: string | null;
  grade: string | null;
  filial: string;
  estoqueAtual: number;
  linha: string | null;
  subgrupo: string | null;
  grupo: string | null;
  tipoProduto: string | null;
  colecao: string | null;
  descColecao: string | null;
  coresDisponiveis: ProdutoCorOption[];
  filiaisDisponiveis: ProdutoFilialOption[];
  linhas: ExtratoLinha[];
  erros: string[];
}

export interface ProdutoLookupResponse {
  produto: string;
  descProduto: string | null;
  cor: string | null;
  descCor: string | null;
  codigoBarra: string | null;
  barcodeMatched: boolean;
  coresDisponiveis: ProdutoCorOption[];
  filiaisDisponiveis: ProdutoFilialOption[];
}

interface ProdutoResolvido {
  produto: string;
  descProduto: string | null;
  cor: string | null;
  descCor: string | null;
  codigoBarra: string | null;
  barcodeMatched: boolean;
}

function sqlText(value: string) {
  return value.replace(/'/g, "''");
}

function trimValue(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function buildOpPedOs(...fields: Array<string | null | undefined>): string | null {
  const labels = ["OP", "PED", "OS"];
  const parts = fields
    .slice(0, 3)
    .map((v, i) => (v?.trim() ? `${labels[i]}:${v.trim()}` : null))
    .filter(Boolean) as string[];
  return parts.length > 0 ? parts.join("/") : null;
}

function resolveLinxTipoMovimento(
  direction: "E" | "S",
  ...candidates: Array<string | number | null | undefined>
) {
  const lista = candidates
    .filter((v) => v != null && String(v).trim() !== "")
    .map((v) => String(v).trim().toUpperCase());
  const t = lista.join(" | ");

  // VM (peça em exposição): o tipo cadastrado no Linx é só 'VM' e é isso que aparece —
  // sem isto cairia no genérico "SAÍDA NORMAL" e o VM ficaria indistinguível. Entrada e
  // saída se diferenciam pelo sinal da QTDE, como nas outras linhas. Compara o candidato
  // inteiro (não substring) para não pegar tipo que só contenha essas letras.
  if (lista.includes("VM")) {
    return "VM";
  }

  const isAjuste =
    /AJUST/.test(t) ||
    /INVENT/.test(t) ||
    /ACERT/.test(t) ||
    /BALAN/.test(t) ||
    /CONTAG/.test(t) ||
    /AVULS/.test(t) ||
    /DEFEIT/.test(t) ||
    /MOV\.?\s*INTERNA/.test(t) ||
    /MOVIMENTA(C|Ç)(A|Ã)O\s+INTERNA/.test(t);

  if (isAjuste) return "AJUSTE";

  const isTransferencia = /TRANSFER/.test(t);
  if (isTransferencia) {
    return direction === "E"
      ? "ENTRADA POR TRANSFERENCIA"
      : "SAÍDA POR TRANSFERÊNCIA";
  }

  return direction === "E" ? "ENTRADA NORMAL" : "SAÍDA NORMAL";
}

function produtoEqualsSql(column: string, produto: string) {
  return `RTRIM(LTRIM(CAST(${column} AS VARCHAR(50)))) = '${sqlText(produto)}'`;
}

function corEqualsSql(column: string, cor: string) {
  return `RTRIM(LTRIM(ISNULL(CAST(${column} AS VARCHAR(20)), ''))) = '${sqlText(cor)}'`;
}

/** Filtro de filial por NOME exato (nunca LIKE — ver resolveFilialExata). */
function filialEqualsSql(column: string, valor: string) {
  return `RTRIM(LTRIM(CAST(${column} AS VARCHAR(120)))) = '${sqlText(valor)}'`;
}

/** Normaliza nome de filial p/ casamento tolerante (espaços, hífen unicode, acento). */
function normFilialKey(value: string) {
  return value
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

interface FilialResolvida {
  nome: string;
  codFilial: string | null;
}

/** Compara ignorando espaços e pontuação: "SCARF ME MATRIZ" = "SCARFME MATRIZ". */
function squeezeFilialKey(value: string) {
  return normFilialKey(value).replace(/[^A-Z0-9]/g, "");
}

/**
 * Traduz o apelido "EMPRESA DISPLAY" do registry (ex.: "NERD MATRIZ") nos COD_FILIAL
 * correspondentes. A matriz da NERD se chama só 'NERD' no banco, então quem digitava
 * "NERD MATRIZ" — o nome que todo mundo usa — não casava com nada e o extrato voltava
 * vazio sem dizer por quê. Devolve mais de um código quando o display é compartilhado
 * (E-COMMERCE, PAULISTA), para o chamador pedir a escolha em vez de adivinhar.
 */
function codFiliaisPorApelidoRegistry(termo: string): string[] {
  const chave = squeezeFilialKey(termo);
  if (!chave) return [];
  return FILIAIS.filter((f) => squeezeFilialKey(`${f.company} ${f.display}`) === chave).map((f) => f.id);
}

/**
 * Traduz o texto de filial (nome, nome parcial ou COD_FILIAL) para a UMA filial que
 * ele designa. O filtro do extrato é de IGUALDADE, não LIKE: a matriz da NERD se
 * chama só 'NERD' no banco, então `FILIAL LIKE '%NERD%'` casava também com NERD
 * LEBLON, NERD ELDORADO e todas as outras — o extrato da matriz vinha somado com a
 * rede inteira. Filial vazia = TODAS (sem filtro), e isso é explícito na tela.
 *
 * Texto parcial que casa com mais de uma filial devolve as candidatas para o chamador
 * pedir a escolha: somar filiais em silêncio é justamente o bug que isto corrige.
 */
async function resolveFilialExata(
  input: string
): Promise<{ filial: FilialResolvida | null; ambiguas: string[] }> {
  const termo = input.trim();
  if (!termo) return { filial: null, ambiguas: [] };

  let cadastradas: FilialResolvida[];
  try {
    const rows = await query<{ FILIAL: string | null; COD_FILIAL: string | null }>(`
      SELECT DISTINCT
        RTRIM(LTRIM(CAST(f.FILIAL AS VARCHAR(120)))) AS FILIAL,
        RTRIM(LTRIM(CAST(f.COD_FILIAL AS VARCHAR(50)))) AS COD_FILIAL
      FROM FILIAIS f WITH (NOLOCK)
      WHERE f.FILIAL IS NOT NULL
        AND RTRIM(LTRIM(CAST(f.FILIAL AS VARCHAR(120)))) <> ''
    `);
    cadastradas = rows
      .map((r) => ({
        nome: trimValue(r.FILIAL),
        codFilial: trimValue(r.COD_FILIAL) || null,
      }))
      .filter((r) => r.nome);
  } catch {
    // Sem a lista de filiais: trata o texto como nome exato, nunca como LIKE.
    return { filial: { nome: termo, codFilial: null }, ambiguas: [] };
  }

  const chave = normFilialKey(termo);

  const porNome = cadastradas.find((f) => normFilialKey(f.nome) === chave);
  if (porNome) return { filial: porNome, ambiguas: [] };

  const porCodigo = cadastradas.find((f) => f.codFilial === termo);
  if (porCodigo) return { filial: porCodigo, ambiguas: [] };

  // Apelido do registry ("NERD MATRIZ" → COD 000069, cujo nome no banco é só 'NERD').
  const codsApelido = codFiliaisPorApelidoRegistry(termo);
  if (codsApelido.length > 0) {
    const porApelido = cadastradas.filter((f) => f.codFilial && codsApelido.includes(f.codFilial));
    if (porApelido.length === 1) return { filial: porApelido[0], ambiguas: [] };
    if (porApelido.length > 1) {
      return { filial: null, ambiguas: porApelido.map((f) => f.nome).sort() };
    }
  }

  const parciais = cadastradas.filter((f) => normFilialKey(f.nome).includes(chave));
  if (parciais.length === 1) return { filial: parciais[0], ambiguas: [] };
  if (parciais.length > 1) {
    return { filial: null, ambiguas: parciais.map((f) => f.nome).sort() };
  }

  // Nome que não está (mais) em FILIAIS, mas pode existir em movimento histórico.
  return { filial: { nome: termo, codFilial: null }, ambiguas: [] };
}

async function resolveProdutoInput(input: string): Promise<ProdutoResolvido | null> {
  const term = input.trim();
  if (!term) return null;
  const termSql = sqlText(term);

  const barcodeRows = await query<{
    PRODUTO: string;
    DESC_PRODUTO: string | null;
    COR_PRODUTO: string | null;
    DESC_COR: string | null;
    CODIGO_BARRA: string | null;
  }>(`
    SELECT TOP 1
      pb.PRODUTO,
      p.DESC_PRODUTO,
      pb.COR_PRODUTO,
      c.DESC_COR,
      pb.CODIGO_BARRA
    FROM PRODUTOS_BARRA pb WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
    LEFT JOIN (
      SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
      FROM PRODUTO_CORES WITH (NOLOCK)
      GROUP BY PRODUTO, COR_PRODUTO
    ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(pb.PRODUTO))
       AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, pb.COR_PRODUTO))
    WHERE LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = '${termSql}'
    ORDER BY pb.PRODUTO, pb.COR_PRODUTO
  `);

  if (barcodeRows.length > 0) {
    const row = barcodeRows[0];
    return {
      produto: trimValue(row.PRODUTO),
      descProduto: trimValue(row.DESC_PRODUTO) || null,
      cor: trimValue(row.COR_PRODUTO) || null,
      descCor: trimValue(row.DESC_COR) || null,
      codigoBarra: trimValue(row.CODIGO_BARRA) || null,
      barcodeMatched: true,
    };
  }

  const productRows = await query<{
    PRODUTO: string;
    DESC_PRODUTO: string | null;
  }>(`
    SELECT TOP 1 p.PRODUTO, p.DESC_PRODUTO
    FROM PRODUTOS p WITH (NOLOCK)
    WHERE ${produtoEqualsSql("p.PRODUTO", term)}
    ORDER BY p.PRODUTO
  `);

  if (productRows.length > 0) {
    const row = productRows[0];
    return {
      produto: trimValue(row.PRODUTO),
      descProduto: trimValue(row.DESC_PRODUTO) || null,
      cor: null,
      descCor: null,
      codigoBarra: null,
      barcodeMatched: false,
    };
  }

  return null;
}

async function fetchCoresDisponiveis(produto: string, filial?: string | null): Promise<ProdutoCorOption[]> {
  const filialFilter = filial?.trim() ? `AND ${filialEqualsSql("ep.FILIAL", filial.trim())}` : "";

  const rows = await query<{
    COR_PRODUTO: string | null;
    DESC_COR: string | null;
    CODIGO_BARRA: string | null;
    ESTOQUE: number | null;
  }>(`
    ;WITH cores AS (
      SELECT DISTINCT
        RTRIM(LTRIM(CAST(pb.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
        RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE ${produtoEqualsSql("pb.PRODUTO", produto)}
        AND pb.COR_PRODUTO IS NOT NULL
        AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''

      UNION

      SELECT DISTINCT
        RTRIM(LTRIM(CAST(ep.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
        RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
      FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      WHERE ${produtoEqualsSql("ep.PRODUTO", produto)}
        AND ep.COR_PRODUTO IS NOT NULL
        AND RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) <> ''
    ),
    barras AS (
      SELECT
        RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO,
        MIN(NULLIF(RTRIM(LTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))), '')) AS CODIGO_BARRA
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE ${produtoEqualsSql("pb.PRODUTO", produto)}
      GROUP BY RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20))))
    ),
    estoque AS (
      SELECT
        RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO,
        SUM(ISNULL(ep.ESTOQUE, 0)) AS ESTOQUE
      FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      WHERE ${produtoEqualsSql("ep.PRODUTO", produto)}
        ${filialFilter}
      GROUP BY RTRIM(LTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20))))
    )
    SELECT
      cores.COR_PRODUTO,
      cb.DESC_COR,
      barras.CODIGO_BARRA,
      ISNULL(estoque.ESTOQUE, 0) AS ESTOQUE
    FROM cores
    LEFT JOIN (
      SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
      FROM PRODUTO_CORES WITH (NOLOCK)
      GROUP BY PRODUTO, COR_PRODUTO
    ) cb ON RTRIM(LTRIM(cb.PRODUTO)) = RTRIM(LTRIM(cores.PRODUTO))
       AND (RTRIM(LTRIM(CAST(cb.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(cores.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, cb.COR_PRODUTO) = TRY_CONVERT(INT, cores.COR_PRODUTO))
    LEFT JOIN barras ON barras.COR_PRODUTO = cores.COR_PRODUTO
    LEFT JOIN estoque ON estoque.COR_PRODUTO = cores.COR_PRODUTO
    ORDER BY cores.COR_PRODUTO
  `);

  return rows
    .map((row) => ({
      cor: trimValue(row.COR_PRODUTO),
      descCor: trimValue(row.DESC_COR) || null,
      codigoBarra: trimValue(row.CODIGO_BARRA) || null,
      estoqueAtual: Number(row.ESTOQUE ?? 0),
    }))
    .filter((row) => row.cor);
}

/**
 * Filiais onde o produto tem cadastro de estoque — INCLUINDO as de saldo zero.
 *
 * Filial com estoque 0 é exatamente o caso em que se precisa do extrato ("pra onde
 * foi tudo?"), então esconder era o pior default possível: a matriz da NERD (nome
 * 'NERD' no banco) sumia do seletor sempre que o item zerava. Quem tem saldo vem
 * primeiro na ordenação, porque o dropdown mostra só os primeiros da lista.
 */
async function fetchFiliaisDisponiveis(produto: string, cor?: string | null): Promise<ProdutoFilialOption[]> {
  const corFilter = cor ? `AND ${corEqualsSql("ep.COR_PRODUTO", cor)}` : "";

  const rows = await query<{
    FILIAL: string | null;
    ESTOQUE: number | null;
  }>(`
    SELECT
      RTRIM(LTRIM(CAST(ep.FILIAL AS VARCHAR(100)))) AS FILIAL,
      SUM(ISNULL(ep.ESTOQUE, 0)) AS ESTOQUE
    FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
    WHERE ${produtoEqualsSql("ep.PRODUTO", produto)}
      ${corFilter}
      AND ep.FILIAL IS NOT NULL
      AND RTRIM(LTRIM(CAST(ep.FILIAL AS VARCHAR(100)))) <> ''
    GROUP BY RTRIM(LTRIM(CAST(ep.FILIAL AS VARCHAR(100))))
    ORDER BY
      CASE WHEN SUM(ISNULL(ep.ESTOQUE, 0)) <> 0 THEN 0 ELSE 1 END,
      FILIAL
  `);

  return rows
    .map((row) => ({
      filial: trimValue(row.FILIAL),
      estoqueAtual: Number(row.ESTOQUE ?? 0),
    }))
    .filter((row) => row.filial);
}

export async function GET(request: NextRequest) {
  const username = request.headers.get("x-auth-username");
  if (!username || !(await canAccessExtrato(username))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const produtoInput = searchParams.get("produto")?.trim();
  const corInput = searchParams.get("cor")?.trim();
  const filial = searchParams.get("filial")?.trim(); // pode ser parte do nome
  const lookupOnly = searchParams.get("lookup") === "1";

  if (!produtoInput) {
    return NextResponse.json(
      { error: "Parâmetro 'produto' é obrigatório" },
      { status: 400 }
    );
  }

  let resolved: ProdutoResolvido | null = null;
  try {
    resolved = await resolveProdutoInput(produtoInput);
  } catch (e) {
    if (lookupOnly) {
      return NextResponse.json({ error: `Produto/código de barras: ${(e as Error).message}` }, { status: 500 });
    }
  }

  const produto = resolved?.produto || produtoInput;
  let coresDisponiveis: ProdutoCorOption[] = [];
  try {
    coresDisponiveis = await fetchCoresDisponiveis(produto);
  } catch (e) {
    if (lookupOnly) {
      return NextResponse.json({ error: `Cores disponíveis: ${(e as Error).message}` }, { status: 500 });
    }
  }

  const corResolvida =
    corInput ||
    resolved?.cor ||
    (coresDisponiveis.length === 1 ? coresDisponiveis[0].cor : undefined);
  const corOption = corResolvida
    ? coresDisponiveis.find((item) => item.cor === corResolvida) ?? null
    : null;
  let filiaisDisponiveis: ProdutoFilialOption[] = [];
  try {
    filiaisDisponiveis = await fetchFiliaisDisponiveis(produto, corResolvida);
  } catch (e) {
    if (lookupOnly) {
      return NextResponse.json({ error: `Filiais disponíveis: ${(e as Error).message}` }, { status: 500 });
    }
  }

  if (lookupOnly) {
    const response: ProdutoLookupResponse = {
      produto,
      descProduto: resolved?.descProduto ?? null,
      cor: corResolvida ?? null,
      descCor: resolved?.descCor ?? corOption?.descCor ?? null,
      codigoBarra: resolved?.codigoBarra ?? corOption?.codigoBarra ?? null,
      barcodeMatched: resolved?.barcodeMatched ?? false,
      coresDisponiveis,
      filiaisDisponiveis,
    };
    return NextResponse.json(response);
  }

  if (!corResolvida) {
    return NextResponse.json(
      {
        error:
          coresDisponiveis.length > 1
            ? "Selecione uma cor para este produto."
            : "Parâmetro 'cor' é obrigatório para este produto.",
        coresDisponiveis,
        filiaisDisponiveis,
      },
      { status: 400 }
    );
  }

  const cor = corResolvida;
  const produtoSql = sqlText(produto);
  const corSql = sqlText(cor);

  const { filial: filialResolvida, ambiguas } = await resolveFilialExata(filial ?? "");
  if (ambiguas.length > 0) {
    return NextResponse.json(
      {
        error:
          `"${filial}" casa com ${ambiguas.length} filiais (${ambiguas.join(", ")}). ` +
          `Escolha uma na lista ou deixe TODAS para ver a rede inteira.`,
        coresDisponiveis,
        filiaisDisponiveis,
      },
      { status: 400 }
    );
  }
  const filialNome = filialResolvida?.nome ?? "";

  const erros: string[] = [];
  const linhas: ExtratoLinha[] = [];

  // Filtro de filial para queries — igualdade exata; vazio = TODAS as filiais.
  const filialFilter = filialNome ? `AND ${filialEqualsSql("le.FILIAL", filialNome)}` : "";
  const filialFilterEnt = filialNome ? `AND ${filialEqualsSql("e.FILIAL", filialNome)}` : "";
  const filialFilterSai = filialNome ? `AND ${filialEqualsSql("s.FILIAL", filialNome)}` : "";
  const filialFilterLs = filialNome ? `AND ${filialEqualsSql("ls.FILIAL", filialNome)}` : "";
  // LOJA_VENDA guarda só CODIGO_FILIAL; o nome vem do join com FILIAIS. Quando a
  // filial tem código, casa pelos dois para não perder venda de nome divergente.
  const filialFilterV = filialNome
    ? `AND (${filialEqualsSql("f.FILIAL", filialNome)}${
        filialResolvida?.codFilial
          ? ` OR ${filialEqualsSql("vp.CODIGO_FILIAL", filialResolvida.codFilial)}`
          : ""
      })`
    : "";

  // ── Info do produto ──
  let descProduto: string | null = null;
  let descCor: string | null = null;
  let grade: string | null = null;
  let estoqueAtual = 0;
  let linhaClassif: string | null = null;
  let subgrupo: string | null = null;
  let grupo: string | null = null;
  let tipoProduto: string | null = null;
  let colecao: string | null = null;
  let descColecao: string | null = null;

  try {
    const prodInfo = await query<{
      DESC_PRODUTO: string;
      GRADE: string;
      DESC_COR: string;
      LINHA: string | null;
      SUBGRUPO: string | null;
      GRUPO: string | null;
      TIPO: string | null;
      COLECAO: string | null;
      DESC_COLECAO: string | null;
    }>(`
      SELECT TOP 1
        p.DESC_PRODUTO,
        p.GRADE,
        c.DESC_COR,
        LTRIM(RTRIM(ISNULL(p.LINHA, ''))) AS LINHA,
        LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))) AS SUBGRUPO,
        LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, ''))) AS GRUPO,
        LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, ''))) AS TIPO,
        LTRIM(RTRIM(ISNULL(p.COLECAO, ''))) AS COLECAO,
        LTRIM(RTRIM(ISNULL(col.DESC_COLECAO, ''))) AS DESC_COLECAO
      FROM PRODUTOS p WITH (NOLOCK)
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM('${corSql}')) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, '${corSql}'))
         AND RTRIM(LTRIM(CAST(c.PRODUTO AS VARCHAR(50)))) = RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50))))
      LEFT JOIN COLECOES col WITH (NOLOCK) ON col.COLECAO = p.COLECAO
      WHERE ${produtoEqualsSql("p.PRODUTO", produto)}
    `);
    const estoqueRows = await query<{ ESTOQUE: number }>(`
      SELECT ISNULL(SUM(ISNULL(ep.ESTOQUE, 0)), 0) AS ESTOQUE
      FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      WHERE ${produtoEqualsSql("ep.PRODUTO", produto)}
        AND ${corEqualsSql("ep.COR_PRODUTO", cor)}
        ${filialNome ? `AND ${filialEqualsSql("ep.FILIAL", filialNome)}` : ""}
    `);
    if (prodInfo.length > 0) {
      const r = prodInfo[0];
      descProduto = r.DESC_PRODUTO?.trim() ?? null;
      grade = r.GRADE?.trim() ?? null;
      descCor = r.DESC_COR?.trim() ?? null;
      linhaClassif = r.LINHA || null;
      subgrupo = r.SUBGRUPO || null;
      grupo = r.GRUPO || null;
      tipoProduto = r.TIPO || null;
      colecao = r.COLECAO || null;
      descColecao = r.DESC_COLECAO || null;
    }
    estoqueAtual = Number(estoqueRows[0]?.ESTOQUE ?? 0);
  } catch (e) {
    erros.push(`Info produto: ${(e as Error).message}`);
  }
  descProduto = descProduto ?? resolved?.descProduto ?? null;
  descCor = descCor ?? resolved?.descCor ?? corOption?.descCor ?? null;

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
      RESPONSAVEL: string | null;
    }>(`
      SELECT
        le.EMISSAO,
        le.FILIAL,
        le.FILIAL_ORIGEM,
        NULLIF(LTRIM(RTRIM(CAST(le.RESPONSAVEL AS VARCHAR(50)))), '') AS RESPONSAVEL,
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
      WHERE lep.PRODUTO = '${produtoSql}'
        AND lep.COR_PRODUTO = '${corSql}'
        ${filialFilter}
      ORDER BY le.EMISSAO
    `);
    for (const r of rows) {
      linhas.push({
        emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : "",
        tipo: resolveLinxTipoMovimento("E", r.DESC_TIPO, r.TIPO_ENTRADA_SAIDA, r.ROMANEIO_PRODUTO),
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
        responsavel: r.RESPONSAVEL?.trim() ?? null,
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
      OP: string | null;
      PEDIDO: string | null;
      OS: string | null;
      COMENTARIO: string | null;
      OBS: string | null;
      RESPONSAVEL: string | null;
    }>(`
      SELECT
        e.EMISSAO,
        e.FILIAL,
        e.FILIAL_DESTINO,
        NULLIF(LTRIM(RTRIM(CAST(e.RESPONSAVEL AS VARCHAR(50)))), '') AS RESPONSAVEL,
        e.ROMANEIO_PRODUTO,
        e.TIPO_ROMANEIO,
        e.TIPO_ENTRADA,
        p.QTDE,
        p.EN_1,
        p.CUSTO1,
        e.ROMANEIO_ORIGEM,
        NULLIF(RTRIM(LTRIM(CAST(e.ORDEM_PRODUCAO AS VARCHAR(50)))), '') AS OP,
        NULLIF(RTRIM(LTRIM(CAST(e.PEDIDO         AS VARCHAR(50)))), '') AS PEDIDO,
        NULLIF(RTRIM(LTRIM(CAST(e.ORDEM_SERVICO  AS VARCHAR(50)))), '') AS OS,
        NULLIF(RTRIM(LTRIM(CAST(e.COMENTARIO     AS VARCHAR(40)))), '') AS COMENTARIO,
        CAST(e.OBS AS varchar(500)) AS OBS
      FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
      JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
        ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
      WHERE p.PRODUTO = '${produtoSql}'
        AND p.COR_PRODUTO = '${corSql}'
        ${filialFilterEnt}
      ORDER BY e.EMISSAO
    `);
    for (const r of rows) {
      const opPedOs = `OP:${r.OP?.trim() ?? ""}/PED:${r.PEDIDO?.trim() ?? ""}/OS:${r.OS?.trim() ?? ""}`;
      const romEnt = r.ROMANEIO_ORIGEM?.trim() || r.COMENTARIO?.trim() || opPedOs;
      linhas.push({
        emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : "",
        tipo: resolveLinxTipoMovimento("E", r.TIPO_ROMANEIO, r.TIPO_ENTRADA, r.ROMANEIO_PRODUTO),
        tipoRomaneio: r.TIPO_ROMANEIO?.trim() ?? null,
        doc: r.ROMANEIO_PRODUTO?.trim() ?? "",
        filialOrigem: null,
        filialDestino: r.FILIAL_DESTINO?.trim() ?? r.FILIAL?.trim() ?? null,
        romaneio: romEnt || null,
        qtde: r.QTDE ?? 0,
        qtdeGrade: r.EN_1 ?? 0,
        valor: 0,
        preco: r.CUSTO1 ?? 0,
        obs: r.OBS?.trim() ?? null,
        atualizouEstoque: true,
        statusTransito: null,
        responsavel: r.RESPONSAVEL?.trim() ?? null,
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
      OP: string | null;
      COMENTARIO: string | null;
      OBS: string | null;
      RESPONSAVEL: string | null;
    }>(`
      SELECT
        s.EMISSAO,
        s.FILIAL,
        s.FILIAL_DESTINO,
        NULLIF(LTRIM(RTRIM(CAST(s.RESPONSAVEL AS VARCHAR(50)))), '') AS RESPONSAVEL,
        s.ROMANEIO_PRODUTO,
        s.TIPO_ROMANEIO,
        s.ROMANEIO_DESTINO,
        p.QTDE,
        p.SA_1,
        p.CUSTO1,
        NULLIF(RTRIM(LTRIM(CAST(s.ORDEM_PRODUCAO AS VARCHAR(50)))), '') AS OP,
        NULLIF(RTRIM(LTRIM(CAST(s.COMENTARIO     AS VARCHAR(40)))), '') AS COMENTARIO,
        CAST(s.OBS AS varchar(500)) AS OBS
      FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
      JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK)
        ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
      WHERE p.PRODUTO = '${produtoSql}'
        AND p.COR_PRODUTO = '${corSql}'
        ${filialFilterSai}
      ORDER BY s.EMISSAO
    `);
    for (const r of rows) {
      const romSai = r.ROMANEIO_DESTINO?.trim() || (r.OP?.trim() ? `OP:${r.OP.trim()}` : null) || r.COMENTARIO?.trim();
      linhas.push({
        emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : "",
        tipo: resolveLinxTipoMovimento("S", r.TIPO_ROMANEIO, r.ROMANEIO_PRODUTO),
        tipoRomaneio: r.TIPO_ROMANEIO?.trim() ?? null,
        doc: r.ROMANEIO_PRODUTO?.trim() ?? "",
        filialOrigem: r.FILIAL?.trim() ?? null,
        filialDestino: r.FILIAL_DESTINO?.trim() ?? null,
        romaneio: romSai || null,
        qtde: -(r.QTDE ?? 0),
        qtdeGrade: -(r.SA_1 ?? 0),
        valor: 0,
        preco: r.CUSTO1 ?? 0,
        obs: r.OBS?.trim() ?? null,
        atualizouEstoque: true,
        statusTransito: null,
        responsavel: r.RESPONSAVEL?.trim() ?? null,
      });
    }
  } catch (e) {
    erros.push(`SAIDA NORMAL: ${(e as Error).message}`);
  }

  // ── 4. LOJA VENDAS ──
  try {
    // LOJA_VENDA usa CODIGO_FILIAL (código numérico, sem nome); o nome sai do join
    // com FILIAIS e é por ele que o filtro de filial casa (ver filialFilterV).
    const rows = await query<{
      DATA_VENDA: Date;
      CODIGO_FILIAL: string;
      FILIAL_VENDA: string | null;
      TICKET: string;
      QTDE: number;
      PRECO_LIQUIDO: number;
      QTDE_CANCELADA: number;
      VENDEDOR_NOME: string | null;
    }>(`
      SELECT
        v.DATA_VENDA,
        v.CODIGO_FILIAL,
        f.FILIAL AS FILIAL_VENDA,
        v.TICKET,
        vp.QTDE,
        vp.PRECO_LIQUIDO,
        vp.QTDE_CANCELADA,
        NULLIF(ISNULL(
          LTRIM(RTRIM(CAST(lv.VENDEDOR_APELIDO AS VARCHAR(60)))),
          LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR(20))))
        ), '') AS VENDEDOR_NOME
      FROM LOJA_VENDA v WITH (NOLOCK)
      JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
      WHERE vp.PRODUTO = '${produtoSql}'
        AND vp.COR_PRODUTO = '${corSql}'
        AND ISNULL(vp.NAO_MOVIMENTA_ESTOQUE, 0) = 0
        ${filialFilterV}
      ORDER BY v.DATA_VENDA
    `);
    for (const r of rows) {
      const qtdeLiquida = (r.QTDE ?? 0) - (r.QTDE_CANCELADA ?? 0);
      if (qtdeLiquida === 0) continue; // ignora linhas com movimento líquido zero
      linhas.push({
        emissao: r.DATA_VENDA ? new Date(r.DATA_VENDA).toISOString() : "",
        tipo: "LOJA VENDAS",
        tipoRomaneio: null,
        doc: r.TICKET?.trim() ?? "",
        filialOrigem: r.FILIAL_VENDA?.trim() || r.CODIGO_FILIAL?.trim() || null,
        filialDestino: null,
        romaneio: null,
        qtde: -qtdeLiquida,
        qtdeGrade: -qtdeLiquida, // vendas não têm campo de grade separado
        valor: -(r.PRECO_LIQUIDO ?? 0) * qtdeLiquida,
        preco: r.PRECO_LIQUIDO ?? 0,
        obs: null,
        atualizouEstoque: true,
        statusTransito: null,
        responsavel: r.VENDEDOR_NOME?.trim() ?? null,
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
      RESPONSAVEL: string | null;
    }>(`
      SELECT
        ls.EMISSAO,
        ls.FILIAL,
        ls.FILIAL_DESTINO,
        NULLIF(LTRIM(RTRIM(CAST(ls.RESPONSAVEL AS VARCHAR(50)))), '') AS RESPONSAVEL,
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
      WHERE lsp.PRODUTO = '${produtoSql}'
        AND lsp.COR_PRODUTO = '${corSql}'
        ${filialFilterLs}
      ORDER BY ls.EMISSAO
    `);
    for (const r of rows) {
      linhas.push({
        emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : "",
        tipo: resolveLinxTipoMovimento("S", r.DESC_TIPO, r.TIPO_ENTRADA_SAIDA, r.ROMANEIO_PRODUTO),
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
        atualizouEstoque: true,
        statusTransito: null,
        responsavel: r.RESPONSAVEL?.trim() ?? null,
      });
    }
  } catch (e) {
    erros.push(`LOJA SAIDAS: ${(e as Error).message}`);
  }

  // ── 6. CONTAGEM / AJUSTE (ESTOQUE_PROD_CONTAGEM + ESTOQUE_PROD_CTG_AJUSTE) ──
  // Esses registros são ajustes gerados pelo módulo de contagem de estoque do Linx.
  // O "Documento" é NOME_CONTAGEM e o "Romaneio/Pedido" é RESPONSAVEL.
  try {
    const filialFilterCtg = filialNome ? `AND ${filialEqualsSql("c.FILIAL", filialNome)}` : "";
    const rows = await query<{
      EMISSAO: Date;
      FILIAL: string;
      NOME_CONTAGEM: string;
      RESPONSAVEL: string | null;
      TIPO: string | null;
      QTDE_AJUSTE: number;
      A1: number;
    }>(`
      SELECT
        c.EMISSAO,
        c.FILIAL,
        c.NOME_CONTAGEM,
        c.RESPONSAVEL,
        c.TIPO,
        a.QTDE_AJUSTE,
        a.A1
      FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
      JOIN ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK)
        ON c.NOME_CONTAGEM = a.NOME_CONTAGEM
      WHERE RTRIM(LTRIM(CAST(a.PRODUTO AS VARCHAR(50)))) = '${produtoSql}'
        AND RTRIM(LTRIM(ISNULL(CAST(a.COR_PRODUTO AS VARCHAR(20)), ''))) = '${corSql}'
        AND c.ESTOQUE_AJUSTADO = 1
        ${filialFilterCtg}
      ORDER BY c.EMISSAO
    `);
    for (const r of rows) {
      linhas.push({
        emissao: r.EMISSAO ? new Date(r.EMISSAO).toISOString() : "",
        tipo: "AJUSTE",
        tipoRomaneio: r.TIPO?.trim() ?? null,
        doc: r.NOME_CONTAGEM?.trim() ?? "",
        filialOrigem: r.FILIAL?.trim() ?? null,
        filialDestino: null,
        romaneio: r.RESPONSAVEL?.trim() ?? null,
        qtde: r.QTDE_AJUSTE ?? 0,
        qtdeGrade: r.A1 ?? 0,
        valor: 0,
        preco: 0,
        obs: null,
        atualizouEstoque: true,
        statusTransito: null,
        responsavel: r.RESPONSAVEL?.trim() ?? null,
      });
    }
  } catch (e) {
    erros.push(`CONTAGEM/AJUSTE: ${(e as Error).message}`);
  }

  // ── 7. AJUSTES MANUAIS (NERD_AJUSTE_HISTORICO) ──
  try {
    const filialFilterNerd = filialNome ? `AND ${filialEqualsSql("FILIAL", filialNome)}` : "";
    const ajustesNerd = await query<{
      ID: number;
      DATA_AJUSTE: Date;
      FILIAL: string;
      PRODUTO: string;
      COR_PRODUTO: string;
      QTDE_AJUSTE: number;
      ROMANEIO_REF: string | null;
      TIPO_AJUSTE: string | null;
      RESPONSAVEL: string | null;
      OBS: string | null;
    }>(`
      SELECT * FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
      WHERE PRODUTO = '${produtoSql}'
        AND COR_PRODUTO = '${corSql}'
        ${filialFilterNerd}
      ORDER BY DATA_AJUSTE
    `);
    for (const r of ajustesNerd) {
      linhas.push({
        emissao: r.DATA_AJUSTE ? new Date(r.DATA_AJUSTE).toISOString() : "",
        tipo: "AJUSTE",
        tipoRomaneio: r.TIPO_AJUSTE ?? null,
        doc: r.ROMANEIO_REF ?? "AJUSTE",
        filialOrigem: r.QTDE_AJUSTE < 0 ? r.FILIAL?.trim() ?? null : null,
        filialDestino: r.QTDE_AJUSTE >= 0 ? r.FILIAL?.trim() ?? null : null,
        romaneio: r.OBS?.trim() ?? r.RESPONSAVEL?.trim() ?? null,
        qtde: r.QTDE_AJUSTE,
        qtdeGrade: r.QTDE_AJUSTE,
        valor: 0,
        preco: 0,
        obs: r.OBS?.trim() ?? null,
        atualizouEstoque: true,
        statusTransito: null,
        responsavel: r.RESPONSAVEL?.trim() ?? null,
      });
    }
  } catch (e) {
    erros.push(`AJUSTE MANUAL: ${(e as Error).message}`);
  }

  // Ordenar por data
  linhas.sort((a, b) => a.emissao.localeCompare(b.emissao));

  const response: ExtratoResponse = {
    produto,
    descProduto,
    cor,
    descCor,
    codigoBarra: resolved?.codigoBarra ?? corOption?.codigoBarra ?? null,
    grade,
    filial: filialNome || "TODAS",
    estoqueAtual,
    linha: linhaClassif,
    subgrupo,
    grupo,
    tipoProduto,
    colecao,
    descColecao,
    coresDisponiveis,
    filiaisDisponiveis,
    linhas,
    erros,
  };

  return NextResponse.json(response);
}
