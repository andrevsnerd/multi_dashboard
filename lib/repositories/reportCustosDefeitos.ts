import { fetchMenorCodigoBarra, fetchProdutosCustoPrecoMestre } from "@/lib/repositories/products";
import { resolverProdutosPorCodigo } from "@/lib/repositories/produtoCodigos";
import { canonicalKey } from "@/lib/reports/keys";
import type { ReportResult, ReportRow } from "@/lib/reports/types";

/**
 * Análise "Custos de Defeitos" do Gerador de Relatórios.
 *
 * Entrada: a lista de códigos COLADA na tela (um por linha, código de barra interno ou
 * código do produto — mesmo hábito da Lista Loja). Cada ocorrência conta +1 na quantidade:
 * a lista das peças defeituosas é literalmente uma peça por linha, então repetir o código
 * três vezes significa três peças.
 *
 * Saída: uma linha por produto × cor, com o custo unitário do CADASTRO
 * (`CUSTO_REPOSICAO1`, via `fetchProdutosCustoPrecoMestre` — é o custo que existe para
 * todo item, independente de ter vendido) e o custo total = custo unit. × quantidade.
 *
 * Isto é consulta de CADASTRO. Não toca em venda — a regra do CLAUDE.md sobre SQL de
 * vendas não se aplica aqui.
 */

export interface CustosDefeitosInput {
  /** Os códigos exatamente como foram colados, COM repetições (a repetição é a quantidade). */
  codigos: string[];
}

/** Uma linha por produto × cor, acumulando a quantidade das repetições. */
interface Acumulado {
  produto: string;
  cor: string | null;
  corDescricao: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  /** A barra COLADA quando o código veio por barra; senão preenchida pelo cadastro. */
  codigoBarra: string;
  quantidade: number;
}

export async function fetchCustosDefeitos(input: CustosDefeitosInput): Promise<ReportResult> {
  const colados = (input.codigos ?? [])
    .map((c) => String(c ?? "").trim())
    .filter((c) => c.length > 0);

  if (colados.length === 0) {
    return { rows: [], total: 0, truncated: false, summary: [] };
  }

  // Resolve a lista ÚNICA de códigos (o resolver já deduplica internamente) e depois
  // aplica as repetições: quem colou 3× o mesmo código quer quantidade 3.
  const { itens, naoEncontrados } = await resolverProdutosPorCodigo(colados);

  const porCodigo = new Map<string, typeof itens>();
  for (const it of itens) {
    const lista = porCodigo.get(it.codigo) ?? [];
    lista.push(it);
    porCodigo.set(it.codigo, lista);
  }

  const acumulados = new Map<string, Acumulado>();
  for (const codigo of colados) {
    const resolvidos = porCodigo.get(codigo);
    if (!resolvidos || resolvidos.length === 0) continue;
    // Quase sempre 1 item por código (a barra identifica produto × cor; o código do produto
    // vem sem cor). Se a MESMA barra estiver cadastrada em duas cores, as duas aparecem — é
    // erro de cadastro, e mostrar as duas linhas é melhor do que escolher uma em silêncio.
    for (const it of resolvidos) {
      const chave = canonicalKey(it.produto, it.cor);
      const atual = acumulados.get(chave);
      if (atual) {
        atual.quantidade += 1;
        continue;
      }
      acumulados.set(chave, {
        produto: it.produto,
        cor: it.cor,
        corDescricao: it.corDescricao,
        descricao: it.descricao,
        grupo: it.grupo,
        subgrupo: it.subgrupo,
        linha: it.linha,
        // Código colado por BARRA já é a barra da peça — é o que está na etiqueta.
        codigoBarra: it.via === "barra" ? codigo : "",
        quantidade: 1,
      });
    }
  }

  const lista = [...acumulados.values()];
  if (lista.length === 0) {
    return {
      rows: [],
      total: 0,
      truncated: false,
      summary: buildSummary(0, 0, 0, naoEncontrados.length),
    };
  }

  const produtos = [...new Set(lista.map((a) => a.produto))];

  // Custo do cadastro (por PRODUTO) e barra preferencial (por produto × cor) para as
  // linhas que vieram pelo CÓDIGO DO PRODUTO e ainda estão sem barra.
  const precisaBarra = lista.some((a) => !a.codigoBarra);
  const [custos, barras] = await Promise.all([
    fetchProdutosCustoPrecoMestre(produtos),
    precisaBarra ? fetchMenorCodigoBarra(produtos) : Promise.resolve([]),
  ]);

  const barraPorChave = new Map<string, string>();
  const barraPorProduto = new Map<string, string>();
  for (const b of barras) {
    if (!b.codigoBarra) continue;
    const k = canonicalKey(b.produto, b.cor);
    if (!barraPorChave.has(k)) barraPorChave.set(k, b.codigoBarra);
    if (!barraPorProduto.has(b.produto)) barraPorProduto.set(b.produto, b.codigoBarra);
  }

  let pecas = 0;
  let custoTotalGeral = 0;

  const rows: ReportRow[] = lista.map((a) => {
    const custoUnitario = custos.get(a.produto)?.custo ?? 0;
    const custoTotal = custoUnitario * a.quantidade;
    pecas += a.quantidade;
    custoTotalGeral += custoTotal;

    const chave = canonicalKey(a.produto, a.cor);
    const codigoBarra =
      a.codigoBarra || barraPorChave.get(chave) || barraPorProduto.get(a.produto) || "";

    return {
      CODIGO_BARRA: codigoBarra,
      PRODUTO: a.produto,
      DESCRICAO: a.descricao,
      COR_DESCRICAO: a.corDescricao || (a.cor ? a.cor : ""),
      COR: a.cor ?? "",
      GRUPO: a.grupo,
      SUBGRUPO: a.subgrupo,
      LINHA: a.linha,
      QUANTIDADE: a.quantidade,
      CUSTO_UNITARIO: custoUnitario,
      CUSTO_TOTAL: custoTotal,
    };
  });

  rows.sort((a, b) => Number(b.CUSTO_TOTAL ?? 0) - Number(a.CUSTO_TOTAL ?? 0));

  return {
    rows,
    total: rows.length,
    truncated: false,
    summary: buildSummary(rows.length, pecas, custoTotalGeral, naoEncontrados.length),
    // Devolvido junto para a tela avisar QUAIS códigos não casaram — código colado que
    // não é reconhecido nunca pode sumir em silêncio.
    naoEncontrados,
  } as ReportResult & { naoEncontrados: string[] };
}

function buildSummary(itens: number, pecas: number, custoTotal: number, naoEncontrados: number) {
  const summary = [
    { label: "Itens (produto × cor)", value: itens, format: "int" as const },
    { label: "Peças", value: pecas, format: "int" as const },
    { label: "Custo total", value: custoTotal, format: "currency" as const },
  ];
  if (naoEncontrados > 0) {
    summary.push({ label: "Códigos não reconhecidos", value: naoEncontrados, format: "int" as const });
  }
  return summary;
}
