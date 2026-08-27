import sql from "mssql";

import { withRequest } from "@/lib/db/connection";

/**
 * Resolução em LOTE de códigos colados → produto × cor.
 *
 * Existe para o fluxo "colo uma lista de códigos e quero a análise deles" (Projeção de
 * vendas no Gerador, mesmo hábito da Lista Loja). A Lista Loja resolve código por código
 * no cliente, com 2 requisições cada; aqui é UMA consulta para a lista inteira.
 *
 * Aceita as duas coisas que o usuário cola na prática:
 *  - CÓDIGO DE BARRA (o interno curto, ex.: "050341") → resolve produto E COR, porque a
 *    barra identifica a variação. A análise fica só naquela cor.
 *  - CÓDIGO DO PRODUTO (ex.: "N5.13.0003") → resolve o produto sem cor: a análise abre
 *    todas as cores dele.
 *
 * Casamento de barra: exato OU equivalência NUMÉRICA (tolera zero à esquerda omitido pelo
 * leitor). NUNCA por trecho/LIKE — "053199" não pode casar com o EAN "7898586053199".
 * É a mesma disciplina do casamento de barras em [lib/repositories/etiquetas.ts].
 *
 * Isto é consulta de CADASTRO (PRODUTOS / PRODUTOS_BARRA / PRODUTO_CORES). Não toca em
 * venda — a regra do CLAUDE.md sobre SQL de vendas não se aplica aqui.
 */

export interface ProdutoCodigoResolvido {
  /** O código exatamente como o usuário colou. */
  codigo: string;
  produto: string;
  /** Código de cor quando o código colado era uma BARRA; null quando era o produto. */
  cor: string | null;
  corDescricao: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  /** Como o código foi reconhecido. */
  via: "barra" | "produto";
}

export interface ResolverProdutosResult {
  itens: ProdutoCodigoResolvido[];
  /** Códigos que não casaram com nenhuma barra nem com nenhum produto. */
  naoEncontrados: string[];
}

/** Quantos códigos por consulta (evita estourar o limite de parâmetros do driver). */
const CHUNK = 400;

function limpar(codigos: string[]): string[] {
  return Array.from(
    new Set(
      (codigos ?? [])
        .map((c) => String(c ?? "").trim())
        .filter((c) => c.length > 0)
    )
  );
}

interface BarraRow {
  codigoBarra: string;
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
}

interface ProdutoRow {
  produto: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
}

export async function resolverProdutosPorCodigo(
  codigos: string[]
): Promise<ResolverProdutosResult> {
  const lista = limpar(codigos);
  if (lista.length === 0) return { itens: [], naoEncontrados: [] };

  const itens: ProdutoCodigoResolvido[] = [];
  const resolvidos = new Set<string>();

  for (let inicio = 0; inicio < lista.length; inicio += CHUNK) {
    const chunk = lista.slice(inicio, inicio + CHUNK);
    // Só o que é dígito puro pode entrar na comparação numérica (tolerância de zero à esquerda).
    const numericos = chunk.filter((c) => /^\d+$/.test(c));

    const { barras, produtos } = await withRequest(async (request) => {
      chunk.forEach((c, i) => request.input(`rc${i}`, sql.VarChar, c));
      const phChunk = chunk.map((_, i) => `@rc${i}`).join(", ");
      numericos.forEach((c, i) => request.input(`rn${i}`, sql.VarChar, c));

      const barraExpr = `LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))`;
      const condicaoNumerica =
        numericos.length > 0
          ? `OR TRY_CONVERT(BIGINT, ${barraExpr}) IN (SELECT TRY_CONVERT(BIGINT, v) FROM (VALUES ${numericos
              .map((_, i) => `(@rn${i})`)
              .join(", ")}) AS t(v))`
          : "";

      const barraQuery = `
        SELECT DISTINCT
          ${barraExpr} AS codigoBarra,
          LTRIM(RTRIM(pb.PRODUTO)) AS produto,
          LTRIM(RTRIM(ISNULL(CAST(pb.COR_PRODUTO AS VARCHAR(20)), ''))) AS cor,
          UPPER(LTRIM(RTRIM(ISNULL(c.DESC_COR, '')))) AS corDescricao,
          UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS descricao,
          UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) AS grupo,
          UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) AS subgrupo,
          UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS linha
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
        LEFT JOIN (
          SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
          FROM PRODUTO_CORES WITH (NOLOCK)
          GROUP BY PRODUTO, COR_PRODUTO
        ) c
          ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(pb.PRODUTO))
          AND (
            RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20))))
            OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, pb.COR_PRODUTO)
          )
        WHERE pb.CODIGO_BARRA IS NOT NULL
          AND (${barraExpr} IN (${phChunk}) ${condicaoNumerica})
      `;

      const produtoQuery = `
        SELECT
          LTRIM(RTRIM(p.PRODUTO)) AS produto,
          UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS descricao,
          UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) AS grupo,
          UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) AS subgrupo,
          UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS linha
        FROM PRODUTOS p WITH (NOLOCK)
        WHERE LTRIM(RTRIM(p.PRODUTO)) IN (${phChunk})
      `;

      const [barraResult, produtoResult] = await Promise.all([
        request.query<BarraRow>(barraQuery),
        request.query<ProdutoRow>(produtoQuery),
      ]);
      return { barras: barraResult.recordset, produtos: produtoResult.recordset };
    });

    // ── Índices de casamento ──
    // Barra por texto exato e por valor numérico (para o código com zero à esquerda omitido).
    const barraPorTexto = new Map<string, BarraRow[]>();
    const barraPorNumero = new Map<string, BarraRow[]>();
    for (const row of barras) {
      const texto = (row.codigoBarra ?? "").trim();
      if (!texto) continue;
      barraPorTexto.set(texto, [...(barraPorTexto.get(texto) ?? []), row]);
      if (/^\d+$/.test(texto)) {
        const num = String(BigInt(texto));
        barraPorNumero.set(num, [...(barraPorNumero.get(num) ?? []), row]);
      }
    }
    const produtoPorCodigo = new Map<string, ProdutoRow>();
    for (const row of produtos) {
      const key = (row.produto ?? "").trim();
      if (key) produtoPorCodigo.set(key, row);
    }

    for (const codigo of chunk) {
      // 1º) barra exata; 2º) barra por valor numérico; 3º) o código é o próprio produto.
      let matches = barraPorTexto.get(codigo) ?? [];
      if (matches.length === 0 && /^\d+$/.test(codigo)) {
        matches = barraPorNumero.get(String(BigInt(codigo))) ?? [];
      }
      if (matches.length > 0) {
        // A barra identifica produto × cor (× tamanho). Colapsa os tamanhos: a análise é
        // por produto × cor, então uma barra por tamanho não deve virar linhas repetidas.
        const vistos = new Set<string>();
        for (const m of matches) {
          const chave = `${m.produto}|${m.cor}`;
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          itens.push({
            codigo,
            produto: m.produto,
            cor: m.cor || null,
            corDescricao: m.corDescricao ?? "",
            descricao: m.descricao ?? "",
            grupo: m.grupo ?? "",
            subgrupo: m.subgrupo ?? "",
            linha: m.linha ?? "",
            via: "barra",
          });
        }
        resolvidos.add(codigo);
        continue;
      }

      const p = produtoPorCodigo.get(codigo);
      if (p) {
        itens.push({
          codigo,
          produto: p.produto,
          cor: null, // sem cor: a análise abre todas as cores do produto
          corDescricao: "",
          descricao: p.descricao ?? "",
          grupo: p.grupo ?? "",
          subgrupo: p.subgrupo ?? "",
          linha: p.linha ?? "",
          via: "produto",
        });
        resolvidos.add(codigo);
      }
    }
  }

  return {
    itens,
    naoEncontrados: lista.filter((c) => !resolvidos.has(c)),
  };
}
