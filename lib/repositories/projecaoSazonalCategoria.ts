/**
 * A CURVA SAZONAL de cada categoria — a base da regra "Sazonal da categoria" da
 * Projeção Compra.
 *
 * A pergunta que este arquivo responde é "quanto CETIM DE SEDA 90X90 cresce em novembro e
 * dezembro contra os outros meses", e ela só tem resposta confiável na CATEGORIA: um
 * produto sozinho vive 18 meses, muda de coleção e não tem dezembro suficiente para provar
 * nada. O subgrupo tem anos de histórico e centenas de códigos.
 *
 * Como o recorte é montado — e o que ele DESCARTA de propósito:
 *
 *   - **fica** a classificação de cadastro que o usuário está olhando (grupo, linha,
 *     subgrupo, grade). É ela que define a categoria: um lenço 90X90 de cetim de seda e um
 *     twilly 8X130 do mesmo tecido não têm a mesma curva.
 *   - **fica** o recorte de FILIAL. A sazonalidade de uma loja de rua não é a de um
 *     aeroporto, e a tela já sabe escolher a loja.
 *   - **sai** todo recorte de ITEM: produto escolhido, busca por nome, coleção, cor e tipo.
 *     Manter qualquer um deles devolveria a curva do próprio escopo — que é exatamente a
 *     amostra pequena de que se está tentando fugir.
 *
 * Vendas vêm de `fetchFilialProdutoSales`, a mesma função canônica de venda líquida com
 * trocas que o resto da Projeção Compra usa. Nada de SQL nova (regra do CLAUDE.md).
 */

import { fetchFilialProdutoSales } from '@/lib/repositories/performance';
import { normalizeRangeForQuery } from '@/lib/utils/date';
import {
  ANOS_CURVA,
  montarCurvaSazonal,
  type AnoCategoria,
  type CurvaSazonal,
} from '@/lib/utils/projecao-sazonal';
import type { CompanyKey } from '@/lib/config/company';

/** Dimensão do cadastro que define a categoria, da mais específica para a mais ampla. */
export type DimCategoria = 'subgrupo' | 'linha' | 'grupo';
export const DIMS_CATEGORIA: DimCategoria[] = ['subgrupo', 'linha', 'grupo'];

/** Total do escopo, somando todas as categorias — a curva de quem ficou sem categoria. */
export const CHAVE_ESCOPO_TODO = '__ESCOPO__';

/** O mínimo que um item precisa ter para a dimensão valer como categoria do escopo. */
const COBERTURA_MINIMA = 0.5;

export interface ItemCategorizavel {
  subgrupo?: string | null;
  linha?: string | null;
  grupo?: string | null;
}

/** Valor da dimensão num item, já normalizado (o cadastro do Linx vem com padding). */
export function valorDaDim(item: ItemCategorizavel, dim: DimCategoria): string {
  const bruto = dim === 'subgrupo' ? item.subgrupo : dim === 'linha' ? item.linha : item.grupo;
  return (bruto ?? '').trim().toUpperCase();
}

/**
 * Qual dimensão serve de categoria para ESTE escopo.
 *
 * A mais específica que a maioria dos itens de fato preenche. Na Scarf Me isso dá SUBGRUPO
 * ("CETIM DE SEDA"); na NERD, onde subgrupo vem vazio, cai sozinho para LINHA ou GRUPO —
 * sem gate por empresa espalhado pelo código.
 */
export function escolherDimCategoria(itens: ItemCategorizavel[]): DimCategoria {
  if (itens.length === 0) return 'subgrupo';
  for (const dim of DIMS_CATEGORIA) {
    const preenchidos = itens.filter((i) => valorDaDim(i, dim).length > 0).length;
    if (preenchidos / itens.length >= COBERTURA_MINIMA) return dim;
  }
  return 'grupo';
}

export interface CurvasCategoriaParams {
  company: CompanyKey;
  /** Filiais de loja física do recorte (as mesmas das outras consultas da tela). */
  posMembers: string[];
  /** Filiais de e-commerce do recorte. */
  ecomMembers: string[];
  /** Ano da data base. A curva olha os anos COMPLETOS anteriores a ele. */
  anoBase: number;
  /** Dimensão que define a categoria. */
  dim: DimCategoria;
  /** Categorias presentes no escopo (valores da dimensão acima). */
  categorias: string[];
  /**
   * Recortes de classificação que o usuário aplicou e que continuam valendo na curva
   * (grupo/linha/subgrupo/grade). Coleção, cor, tipo, produto e busca NÃO entram.
   */
  dimensoesFixas: {
    grupos?: string[] | null;
    linhas?: string[] | null;
    subgrupos?: string[] | null;
    grades?: string[] | null;
  };
  /** Chave do recorte de filial, só para compor a chave de cache. */
  filialKey: string;
}

export interface CurvasCategoriaResultado {
  dim: DimCategoria;
  /** Curva de cada categoria + a curva agregada em `CHAVE_ESCOPO_TODO`. */
  curvas: Record<string, CurvaSazonal>;
  /** Anos-calendário completos que entraram na medição. */
  anos: number[];
}

/** Cache em processo: a curva olha só anos FECHADOS, então ela não muda durante o dia. */
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { expiraEm: number; valor: Promise<CurvasCategoriaResultado> }>();

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ultimoDiaDoMes(ano: number, mes: number): string {
  const dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${pad2(mes)}-${pad2(dia)}`;
}

/** Roda `fn` sobre a lista com no máximo `limite` chamadas simultâneas. */
async function mapLimit<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function orNull(values: string[] | null | undefined): string[] | null {
  const lista = (values ?? []).map((v) => v.trim()).filter(Boolean);
  return lista.length > 0 ? lista : null;
}

/**
 * Mede a curva sazonal de cada categoria do escopo.
 *
 * São 12 consultas por ano-calendário (`ANOS_CURVA` anos = 36), UMA rodada para TODAS as
 * categorias juntas: a consulta filtra a dimensão inteira e as linhas voltam com o subgrupo
 * /linha/grupo de cada produto, então a separação por categoria é feita aqui, de graça.
 * Quantas categorias o escopo tem não muda o custo.
 */
export async function fetchCurvasSazonaisCategoria(
  params: CurvasCategoriaParams
): Promise<CurvasCategoriaResultado> {
  const categorias = Array.from(
    new Set(params.categorias.map((c) => c.trim().toUpperCase()).filter(Boolean))
  ).sort();

  const chaveCache = JSON.stringify([
    params.company,
    params.filialKey,
    params.anoBase,
    params.dim,
    categorias,
    params.dimensoesFixas,
  ]);
  const emCache = cache.get(chaveCache);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.valor;

  const promessa = medirCurvas(params, categorias);
  cache.set(chaveCache, { expiraEm: Date.now() + CACHE_TTL_MS, valor: promessa });
  // Falha não fica cacheada — a próxima geração tenta de novo.
  promessa.catch(() => cache.delete(chaveCache));
  return promessa;
}

async function medirCurvas(
  params: CurvasCategoriaParams,
  categorias: string[]
): Promise<CurvasCategoriaResultado> {
  const { company, posMembers, ecomMembers, anoBase, dim } = params;
  // Só anos COMPLETOS: o ano corrente entra na conta do PATAMAR, não na da curva. Meia
  // amostra de um ano (Jan–Set) não sabe nada sobre novembro e dezembro, que é justamente
  // o que se está perguntando.
  const anos = Array.from({ length: ANOS_CURVA }, (_, i) => anoBase - 1 - i);

  // A dimensão da categoria entra como filtro; os recortes que o usuário já aplicou nessa
  // mesma dimensão são absorvidos por ela (a lista de categorias veio do escopo filtrado).
  const dimensoes = {
    grupos: orNull(params.dimensoesFixas.grupos),
    linhas: orNull(params.dimensoesFixas.linhas),
    subgrupos: orNull(params.dimensoesFixas.subgrupos),
    grades: orNull(params.dimensoesFixas.grades),
    colecoes: null,
    cores: null,
    tipos: null,
  };
  if (categorias.length > 0) {
    if (dim === 'subgrupo') dimensoes.subgrupos = categorias;
    else if (dim === 'linha') dimensoes.linhas = categorias;
    else dimensoes.grupos = categorias;
  }

  const consultas: Array<{ ano: number; mes: number }> = [];
  anos.forEach((ano) => {
    for (let mes = 1; mes <= 12; mes += 1) consultas.push({ ano, mes });
  });

  /** categoria → ano → mês (1-based) → quantidade. */
  const porCategoria = new Map<string, Map<number, number[]>>();
  const somaEscopo = new Map<number, number[]>();

  const garantir = (mapa: Map<number, number[]>, ano: number): number[] => {
    let meses = mapa.get(ano);
    if (!meses) {
      meses = new Array<number>(13).fill(0);
      mapa.set(ano, meses);
    }
    return meses;
  };

  await mapLimit(consultas, 4, async ({ ano, mes }) => {
    const range = normalizeRangeForQuery({
      start: `${ano}-${pad2(mes)}-01`,
      end: ultimoDiaDoMes(ano, mes),
    });
    const rows = await fetchFilialProdutoSales(company, posMembers, ecomMembers, range, 'month', {
      groupByCor: false,
      includePrevious: false,
      limit: 0,
      dimensoes,
    });
    rows.forEach((r) => {
      const qtde = Number(r.qtde ?? 0) || 0;
      const chave = valorDaDim(r, dim) || CHAVE_ESCOPO_TODO;
      let doAno = porCategoria.get(chave);
      if (!doAno) {
        doAno = new Map<number, number[]>();
        porCategoria.set(chave, doAno);
      }
      garantir(doAno, ano)[mes] += qtde;
      garantir(somaEscopo, ano)[mes] += qtde;
    });
  });

  const curvas: Record<string, CurvaSazonal> = {};
  const montar = (chave: string, porAno: Map<number, number[]>) => {
    const entradas: AnoCategoria[] = anos.map((ano) => ({
      ano,
      meses: porAno.get(ano) ?? new Array<number>(13).fill(0),
    }));
    curvas[chave] = montarCurvaSazonal(chave, entradas);
  };
  porCategoria.forEach((porAno, chave) => montar(chave, porAno));
  // A curva do escopo inteiro é o fallback de item sem categoria e a curva que a visão
  // agregada usa quando o recorte mistura categorias.
  montar(CHAVE_ESCOPO_TODO, somaEscopo);

  return { dim, curvas, anos };
}
