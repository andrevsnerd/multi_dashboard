/**
 * "Orçamento do mês" (pedido do Hélio): por linha de despesa do budget,
 *
 *   MTD             = o que saiu do caixa no mês até a data de posição (inclusive);
 *   Saldo do mês    = orçado do mês − MTD (negativo = estourou);
 *   Saldo por dia   = saldo do mês ÷ dias que faltam depois da posição.
 *
 * O realizado são os lançamentos das abas da planilha da Débora pela DATA CAIXA,
 * qualquer status. A tela usa como posição a data da própria planilha (célula C4 das
 * abas, `dataReferencia`): depois dela não há dado real. O que vence depois da posição
 * volta como "agendado", só informativo — não entra no saldo.
 *
 * Só lê `financeiro_registros`; o orçado vem de lib/config/orcamento-despesas.ts.
 */

import { getNeonSql, hasPostgres } from "@/lib/db/neon";
import {
  type GrupoOrcamento,
  LINHAS_ORCAMENTO,
  indiceMesOrcado,
} from "@/lib/config/orcamento-despesas";

import { FinanceiroSemBancoError, ensureTables } from "./store";

export interface ItemOrcamento {
  aba: string;
  classificacao: string;
  mtd: number;
  agendado: number;
  n: number;
}

export interface LinhaOrcamentoMes {
  key: string;
  label: string;
  grupo: GrupoOrcamento;
  referencia: string;
  ressalva: string | null;
  /** null = o budget não cobre o mês. */
  orcado: number | null;
  mtd: number;
  agendado: number;
  itens: ItemOrcamento[];
}

export interface OrcamentoMes {
  mes: string;
  posicao: string;
  /** Data da planilha da Débora (C4 das abas de lançamento): último dia com dado real. */
  dataReferencia: string | null;
  diasNoMes: number;
  /** Dias do mês depois da posição. */
  diasRestantes: number;
  temOrcado: boolean;
  linhas: LinhaOrcamentoMes[];
  /** Saídas que não caem em nenhuma linha do budget (ex.: classificação vazia). */
  fora: ItemOrcamento[];
}

/** "Transporte / Estacionamento" e "transporte/estacionamento" são a mesma chave. */
const chave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const porClassificacao = new Map<string, string>();
const porAba = new Map<string, string>();
for (const l of LINHAS_ORCAMENTO) {
  for (const c of l.classificacoes ?? []) porClassificacao.set(chave(c), l.key);
  for (const a of l.abas ?? []) porAba.set(chave(a), l.key);
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/** Hoje no fuso de Brasília (o servidor roda em UTC). */
const hojeBrasil = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Sem `posicao`, usa a data da planilha (depois dela não há dado real); sem ela, hoje. */
export async function obterOrcamentoMes(empresa: string, posicaoPedida?: string): Promise<OrcamentoMes> {
  if (!hasPostgres()) throw new FinanceiroSemBancoError();
  await ensureTables();
  const sql = getNeonSql();

  const ref = (await sql.query(
    `SELECT to_char(max(data_referencia), 'YYYY-MM-DD') AS d FROM financeiro_abas
     WHERE empresa = $1 AND tipo = 'lancamento'`,
    [empresa]
  )) as Record<string, unknown>[];
  const dataReferencia = (ref[0]?.d as string | null) ?? null;
  const posicao = posicaoPedida ?? dataReferencia ?? hojeBrasil();

  const [ano, mes, dia] = posicao.split("-").map(Number);
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const inicio = `${posicao.slice(0, 7)}-01`;
  const fim = `${posicao.slice(0, 7)}-${String(diasNoMes).padStart(2, "0")}`;

  const rows = (await sql.query(
    `SELECT aba, COALESCE(classificacao_fmt, classificacao, '') AS classificacao,
            COALESCE(sum(valor) FILTER (WHERE data_caixa <= $4::date), 0) AS ate,
            COALESCE(sum(valor) FILTER (WHERE data_caixa > $4::date), 0) AS depois,
            count(*)::int AS n
     FROM financeiro_registros
     WHERE empresa = $1 AND tipo = 'lancamento' AND valor IS NOT NULL
       AND data_caixa BETWEEN $2::date AND $3::date
     GROUP BY 1, 2`,
    [empresa, inicio, fim, posicao]
  )) as Record<string, unknown>[];

  const idx = indiceMesOrcado(inicio);
  const linhas = new Map<string, LinhaOrcamentoMes>(
    LINHAS_ORCAMENTO.map((l) => [
      l.key,
      {
        key: l.key,
        label: l.label,
        grupo: l.grupo,
        referencia: l.referencia,
        ressalva: l.ressalva ?? null,
        orcado: idx >= 0 ? l.orcado[idx] : null,
        mtd: 0,
        agendado: 0,
        itens: [],
      },
    ])
  );
  const fora: ItemOrcamento[] = [];

  for (const r of rows) {
    const classificacao = String(r.classificacao ?? "");
    const item: ItemOrcamento = {
      aba: String(r.aba),
      classificacao,
      // Despesa vem negativa na planilha; aqui gasto é positivo (estorno abate).
      mtd: centavos(-Number(r.ate)),
      agendado: centavos(-Number(r.depois)),
      n: Number(r.n),
    };
    const key = porClassificacao.get(chave(classificacao)) ?? porAba.get(chave(item.aba));
    const linha = key ? linhas.get(key) : undefined;
    if (!linha) {
      if (item.mtd + item.agendado > 0) fora.push(item);
      continue;
    }
    linha.mtd = centavos(linha.mtd + item.mtd);
    linha.agendado = centavos(linha.agendado + item.agendado);
    linha.itens.push(item);
  }
  for (const l of linhas.values()) l.itens.sort((a, b) => b.mtd + b.agendado - (a.mtd + a.agendado));
  fora.sort((a, b) => b.mtd + b.agendado - (a.mtd + a.agendado));

  return {
    mes: inicio,
    posicao,
    dataReferencia,
    diasNoMes,
    diasRestantes: diasNoMes - dia,
    temOrcado: idx >= 0,
    linhas: [...linhas.values()],
    fora,
  };
}
