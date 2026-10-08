import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import {
  AVIAMENTOS,
  GRUPO_PASHMINA,
  LINHAS_SEM_PECA,
  LINHA_FASHION,
  LINHA_INDIA,
  VENDA_HORIZONTE_DIAS,
  VENDA_JANELA_DIAS,
  type ItemComprado,
  type VendaProjetada,
} from "@/lib/config/aviamentos";
import { listComprasTransitoPendentes } from "@/lib/server/compra-transito-reconciliacao";
import { fetchSalesTotals } from "@/lib/services/salesTotals";
import { normalizeRangeForQuery } from "@/lib/utils/date";

/**
 * Necessidade de AVIAMENTO a partir do que foi comprado e ainda não chegou.
 *
 * Não é projeção de venda: cada peça comprada vai precisar dos seus aviamentos (tag,
 * etiqueta…), então a base é o TRÂNSITO. A fonte é `listComprasTransitoPendentes`, a mesma
 * das outras telas: só compra confirmada (rascunho fica fora) e a quantidade de cada item
 * já vem reconciliada contra as entradas reais na matriz — o que chegou sai da conta, o que
 * chegou em parte conta só o restante, o atrasado conta inteiro.
 *
 * O cadastro do produto (LINHA e GRUPO) decide a peculiaridade de cada peça: se é peça da
 * marca, Fashion, Índia ou pashmina.
 *
 * Os aviamentos gastos NA VENDA (etiqueta presente, remetente, caixa de presente) somam a
 * venda projetada: o ritmo dos últimos 90 dias, medido pela função canônica de venda
 * (`fetchSalesTotals`, lojas + site, com trocas), esticado pelos próximos 90. As regras moram em [aviamentos.ts](@/lib/config/aviamentos).
 */

export interface AviamentoNecessidade {
  id: string;
  nome: string;
  nota?: string;
  /** false = aviamento ainda sem regra; a tela mostra "sem regra" em vez de zero. */
  temRegra: boolean;
  /** Unidades que as peças em trânsito vão consumir. */
  necessidadeCompras: number;
  /** Unidades que a venda projetada vai consumir. */
  necessidadeVenda: number;
  /** Soma das duas, antes de abater o estoque. */
  necessidade: number;
}

export interface NecessidadeAviamentos {
  itens: AviamentoNecessidade[];
  resumo: {
    /** Compras confirmadas com algo ainda a chegar. */
    compras: number;
    /** Peças a chegar (todas as linhas, inclusive as que não são peça da marca). */
    pecas: number;
    /** Dessas, as que são peça da marca (as que levam tag/etiqueta). */
    pecasDaMarca: number;
    /** Venda projetada usada pelos aviamentos gastos na venda. */
    venda: VendaProjetada & { janelaDias: number; horizonteDias: number };
  };
}

/** Lote de códigos por consulta — longe do limite de 2.100 parâmetros do SQL Server. */
const LOTE = 800;

interface CadastroProduto {
  linha: string;
  grupo: string;
}

/** LINHA e GRUPO de cada produto, em maiúsculas. Produto sem cadastro não aparece no mapa. */
async function fetchCadastroPorProduto(produtos: string[]): Promise<Map<string, CadastroProduto>> {
  const out = new Map<string, CadastroProduto>();
  for (let i = 0; i < produtos.length; i += LOTE) {
    const lote = produtos.slice(i, i + LOTE);
    const linhas = await withRequest(async (request) => {
      lote.forEach((p, j) => request.input(`p${j}`, sql.VarChar, p));
      const res = await request.query<{
        PRODUTO: string;
        LINHA: string | null;
        GRUPO_PRODUTO: string | null;
      }>(`
        SELECT LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO, p.LINHA, p.GRUPO_PRODUTO
        FROM PRODUTOS p WITH (NOLOCK)
        WHERE p.PRODUTO IN (${lote.map((_, j) => `@p${j}`).join(", ")})
      `);
      return res.recordset ?? [];
    });
    linhas.forEach((l) => {
      out.set(String(l.PRODUTO ?? "").trim(), {
        linha: String(l.LINHA ?? "").trim().toUpperCase(),
        grupo: String(l.GRUPO_PRODUTO ?? "").trim().toUpperCase(),
      });
    });
  }
  return out;
}

/** 'yyyy-MM-dd' de hoje + `deltaDias`, no calendário do Brasil (UTC−3). */
function diaBrasil(deltaDias: number): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + deltaDias);
  return d.toISOString().slice(0, 10);
}

/**
 * Venda dos últimos `VENDA_JANELA_DIAS` dias (até ontem) projetada pelos próximos
 * `VENDA_HORIZONTE_DIAS`. Venda pela função canônica — nunca SQL nova de venda.
 */
async function fetchVendaProjetada(companyKey: string): Promise<VendaProjetada> {
  const range = normalizeRangeForQuery({
    start: diaBrasil(-VENDA_JANELA_DIAS),
    end: diaBrasil(-1),
  });
  const [total, fashion] = await Promise.all([
    fetchSalesTotals({ company: companyKey, range, filial: null }),
    fetchSalesTotals({ company: companyKey, range, filial: null, linhasCadastro: [LINHA_FASHION] }),
  ]);
  const fator = VENDA_HORIZONTE_DIAS / VENDA_JANELA_DIAS;
  return {
    tickets: Math.round(Math.max(0, total.tickets) * fator),
    pecasFashion: Math.round(Math.max(0, fashion.qtde) * fator),
  };
}

export async function fetchNecessidadeAviamentos(companyKey: string): Promise<NecessidadeAviamentos> {
  const [compras, venda] = await Promise.all([
    listComprasTransitoPendentes(companyKey),
    fetchVendaProjetada(companyKey),
  ]);

  /** produto → peças a chegar (a cor não muda nenhuma regra, então soma por produto). */
  const porProduto = new Map<string, number>();
  let comprasComPeca = 0;
  for (const compra of compras) {
    let temPeca = false;
    for (const item of compra.items ?? []) {
      const produto = String(item.produto ?? "").trim();
      const quantidade = Math.max(0, Math.round(Number(item.quantidade ?? 0) || 0));
      if (!produto || quantidade <= 0) continue;
      porProduto.set(produto, (porProduto.get(produto) ?? 0) + quantidade);
      temPeca = true;
    }
    if (temPeca) comprasComPeca += 1;
  }

  const cadastro = await fetchCadastroPorProduto(Array.from(porProduto.keys()));
  const semPeca = new Set(LINHAS_SEM_PECA);

  const itens: ItemComprado[] = Array.from(porProduto, ([produto, quantidade]) => {
    const { linha, grupo } = cadastro.get(produto) ?? { linha: "", grupo: "" };
    return {
      produto,
      quantidade,
      linha,
      grupo,
      pecaDaMarca: !semPeca.has(linha),
      fashion: linha === LINHA_FASHION,
      india: linha === LINHA_INDIA,
      pashmina: grupo === GRUPO_PASHMINA || linha === GRUPO_PASHMINA,
    };
  });

  return {
    itens: AVIAMENTOS.map((av) => {
      const necessidadeCompras = av.regra
        ? itens.reduce((soma, item) => soma + av.regra!(item), 0)
        : 0;
      const necessidadeVenda = av.regraVenda ? av.regraVenda(venda) : 0;
      return {
        id: av.id,
        nome: av.nome,
        nota: av.nota,
        temRegra: Boolean(av.regra || av.regraVenda),
        necessidadeCompras,
        necessidadeVenda,
        necessidade: necessidadeCompras + necessidadeVenda,
      };
    }),
    resumo: {
      compras: comprasComPeca,
      pecas: itens.reduce((s, i) => s + i.quantidade, 0),
      pecasDaMarca: itens.reduce((s, i) => s + (i.pecaDaMarca ? i.quantidade : 0), 0),
      venda: { ...venda, janelaDias: VENDA_JANELA_DIAS, horizonteDias: VENDA_HORIZONTE_DIAS },
    },
  };
}
