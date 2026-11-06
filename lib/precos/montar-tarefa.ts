import "server-only";

/**
 * Monta as alterações de uma tarefa do Programar Preços a partir de uma lista
 * "código → preço (ou % sobre o atual)". É o que a tela faz ao digitar na grade, sem a
 * grade: lê o PRECO1 atual de cada produto em cada tabela, calcula o novo com a mesma
 * regra de arredondamento e descarta o que não muda. Não grava nada.
 */

import {
  LIMITE_PRODUTOS,
  campoKeyTabela,
  fetchProdutosPrecos,
  mapearCodigosOuBarras,
  type PrecoCompany,
} from "@/lib/repositories/precos";
import type { TarefaAlteracao, TarefaProduto } from "@/lib/precos/tarefas-store";

export interface ItemPreco {
  /** Código do produto ou código de barras. */
  codigo: string;
  /** Preço novo absoluto (R$). */
  preco?: number | null;
  /** Ajuste sobre o preço ATUAL de cada tabela: -30 = 30% de desconto, +10 = 10% de aumento. */
  ajustePct?: number | null;
  /** Tabelas só deste item (senão valem as tabelas gerais). */
  tabelas?: string[] | null;
}

export interface MontagemTarefa {
  alteracoes: TarefaAlteracao[];
  produtos: TarefaProduto[];
  avisos: {
    naoEncontrados: string[];
    /** Produto sem linha na tabela de preço: a tela também não deixa alterar. */
    semRegistroNaTabela: Array<{ codigo: string; produto: string; tabela: string }>;
    /** Já está no valor pedido. */
    semMudanca: Array<{ produto: string; tabela: string; preco: number | null }>;
    /** Ajuste % sobre um preço vazio. */
    semPrecoAtual: Array<{ produto: string; tabela: string }>;
    /** Mesmo produto/tabela pedido com valores diferentes (ex.: dois códigos de barras dele). */
    conflitos: Array<{ produto: string; tabela: string; valores: number[] }>;
    itensInvalidos: Array<{ codigo: string; motivo: string }>;
  };
  tabelas: Array<{ codigo: string; descricao: string; inativa: boolean }>;
}

const TABELA_RE = /^[A-Z0-9]{1,2}$/;

function limpar(v: unknown): string {
  return String(v ?? "").trim();
}

function mesmoValor(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.005;
}

/** Mesma conta da tela (`calcular` do ProgramarPrecosPage). */
function calcular(item: ItemPreco, atual: number | null): number | null {
  if (item.preco !== null && item.preco !== undefined) return Math.round(item.preco * 100) / 100;
  if (atual === null || item.ajustePct === null || item.ajustePct === undefined) return null;
  return Math.round(atual * (1 + item.ajustePct / 100) * 100) / 100;
}

function normalizarTabelas(lista: string[] | null | undefined): string[] {
  return [...new Set((lista ?? []).map((t) => limpar(t).toUpperCase()).filter(Boolean))];
}

export async function montarTarefaPrecos(params: {
  company: PrecoCompany;
  itens: ItemPreco[];
  tabelas: string[];
}): Promise<MontagemTarefa> {
  const avisos: MontagemTarefa["avisos"] = {
    naoEncontrados: [],
    semRegistroNaTabela: [],
    semMudanca: [],
    semPrecoAtual: [],
    conflitos: [],
    itensInvalidos: [],
  };

  const tabelasGerais = normalizarTabelas(params.tabelas);

  // 1. Itens válidos, cada um com as tabelas que valem para ele.
  const itens: Array<ItemPreco & { codigo: string; tabelasItem: string[] }> = [];
  for (const raw of params.itens) {
    const codigo = limpar(raw.codigo);
    if (!codigo) continue;
    const temPreco = raw.preco !== null && raw.preco !== undefined;
    const temPct = raw.ajustePct !== null && raw.ajustePct !== undefined;
    if (temPreco === temPct) {
      avisos.itensInvalidos.push({ codigo, motivo: "Informe OU preco OU ajustePct (um dos dois)." });
      continue;
    }
    if (temPreco && (!Number.isFinite(raw.preco) || (raw.preco as number) < 0)) {
      avisos.itensInvalidos.push({ codigo, motivo: `Preço inválido: ${raw.preco}.` });
      continue;
    }
    if (temPct && (!Number.isFinite(raw.ajustePct) || (raw.ajustePct as number) <= -100)) {
      avisos.itensInvalidos.push({ codigo, motivo: `Ajuste % inválido: ${raw.ajustePct}.` });
      continue;
    }
    const tabelasItem = raw.tabelas && raw.tabelas.length > 0 ? normalizarTabelas(raw.tabelas) : tabelasGerais;
    const invalida = tabelasItem.find((t) => !TABELA_RE.test(t));
    if (tabelasItem.length === 0 || invalida) {
      avisos.itensInvalidos.push({
        codigo,
        motivo: invalida ? `Tabela inválida: ${invalida}.` : "Nenhuma tabela de preço informada.",
      });
      continue;
    }
    itens.push({ ...raw, codigo, tabelasItem });
  }

  const vazio: MontagemTarefa = { alteracoes: [], produtos: [], avisos, tabelas: [] };
  if (itens.length === 0) return vazio;

  // 2. Código digitado → produto (aceita código de barras, como a tela).
  const mapa = await mapearCodigosOuBarras(itens.map((i) => i.codigo));
  avisos.naoEncontrados = [...new Set(itens.filter((i) => !mapa.has(i.codigo)).map((i) => i.codigo))];
  const resolvidos = itens.filter((i) => mapa.has(i.codigo));
  if (resolvidos.length === 0) return vazio;

  // 3. Valores atuais: mesma leitura da tela (com inativos e sem escopo de empresa,
  //    para nenhum código colado sumir calado).
  const produtosUnicos = [...new Set(resolvidos.map((i) => mapa.get(i.codigo)!))];
  const todasTabelas = [...new Set(resolvidos.flatMap((i) => i.tabelasItem))];
  const atuais = new Map<string, { existe: boolean; valor: number | null }>();
  const descricoes = new Map<string, string>();
  const tabelasInfo = new Map<string, { codigo: string; descricao: string; inativa: boolean }>();

  for (let i = 0; i < produtosUnicos.length; i += LIMITE_PRODUTOS) {
    const lote = produtosUnicos.slice(i, i + LIMITE_PRODUTOS);
    const r = await fetchProdutosPrecos({
      company: params.company,
      codigos: lote,
      incluirInativos: true,
      todoCadastro: true,
      tabelas: todasTabelas,
      camposCadastro: ["PRECO_REPOSICAO_1"],
    });
    for (const t of r.tabelas) tabelasInfo.set(t.codigo, { codigo: t.codigo, descricao: t.descricao, inativa: t.inativa });
    const indice = new Map(r.campos.map((c, idx) => [c.key, idx] as const));
    for (const row of r.rows) {
      descricoes.set(row.produto, row.descricao);
      for (const tabela of todasTabelas) {
        const key = campoKeyTabela(tabela, "PRECO1");
        const idx = indice.get(key);
        const existe = idx !== undefined && !row.sr.includes(idx);
        atuais.set(`${row.produto}||${key}`, { existe, valor: existe ? row.v[idx!] ?? null : null });
      }
    }
  }

  // 4. Uma alteração por produto × tabela, só onde muda.
  const pedidos = new Map<string, { produto: string; tabela: string; valores: number[]; atual: number | null }>();
  for (const item of resolvidos) {
    const produto = mapa.get(item.codigo)!;
    for (const tabela of item.tabelasItem) {
      const key = campoKeyTabela(tabela, "PRECO1");
      const atual = atuais.get(`${produto}||${key}`);
      if (!atual?.existe) {
        avisos.semRegistroNaTabela.push({ codigo: item.codigo, produto, tabela });
        continue;
      }
      const novo = calcular(item, atual.valor);
      if (novo === null) {
        avisos.semPrecoAtual.push({ produto, tabela });
        continue;
      }
      const chave = `${produto}||${key}`;
      const p = pedidos.get(chave) ?? { produto, tabela, valores: [], atual: atual.valor };
      if (!p.valores.some((v) => mesmoValor(v, novo))) p.valores.push(novo);
      pedidos.set(chave, p);
    }
  }

  const alteracoes: TarefaAlteracao[] = [];
  for (const p of pedidos.values()) {
    if (p.valores.length > 1) {
      avisos.conflitos.push({ produto: p.produto, tabela: p.tabela, valores: p.valores });
      continue;
    }
    const novo = p.valores[0];
    if (mesmoValor(p.atual, novo)) {
      avisos.semMudanca.push({ produto: p.produto, tabela: p.tabela, preco: p.atual });
      continue;
    }
    alteracoes.push({
      produto: p.produto,
      campoKey: campoKeyTabela(p.tabela, "PRECO1"),
      valor: novo,
      atual: p.atual,
      tabela: p.tabela,
      tabelaDesc: (tabelasInfo.get(p.tabela)?.descricao ?? p.tabela).slice(0, 120),
    });
  }

  const comAlteracao = new Set(alteracoes.map((a) => a.produto));
  const produtos: TarefaProduto[] = produtosUnicos
    .filter((p) => comAlteracao.has(p))
    .map((p) => ({ produto: p, descricao: (descricoes.get(p) ?? "").slice(0, 200) }));

  return {
    alteracoes,
    produtos,
    avisos,
    tabelas: [...tabelasInfo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)),
  };
}
