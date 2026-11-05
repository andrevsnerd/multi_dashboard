import { NextResponse } from "next/server";

import { autorizarPrecos, parsePrecoCompany } from "@/lib/auth/precos-guard";
import { fetchItensBlackFriday, OBS_REBAIXA_PAINEL } from "@/lib/repositories/blackFriday";
import { campoKeyTabela, executarAlteracaoPrecos, type AlteracaoInput } from "@/lib/repositories/precos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  company?: string;
  itens?: Array<{ produto?: string; valor?: number }>;
}

/**
 * Rebaixa o preço de itens da Black pelo painel.
 *
 * Regras (conferidas AQUI, com o cadastro relido na hora — a tela só antecipa):
 *  - só item que está na Black (histórico de preço em vigor);
 *  - só para BAIXO (novo < preço atual);
 *  - nunca abaixo do custo (CUSTO_REPOSICAO1); sem custo cadastrado não baixa.
 *
 * Grava pelo mesmo `executarAlteracaoPrecos` do Alterar Custo / Programar Preços,
 * em todas as tabelas que a Black mexeu (hoje a 01), com o Preço Líquido acompanhando.
 * O lote cai na NERD_PRECO_HISTORICO com OBS da Black → volta a aparecer no painel
 * como rebaixa e pode ser revertido pelo histórico do Programar Preços.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ("erro" in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parsePrecoCompany(body.company);
    if (!company) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

    const pedidos = (Array.isArray(body.itens) ? body.itens : [])
      .map((i) => ({ produto: String(i?.produto ?? "").trim(), valor: Number(i?.valor) }))
      .filter((i) => i.produto);
    if (pedidos.length === 0) {
      return NextResponse.json({ error: "Nenhum item informado." }, { status: 400 });
    }

    const { itens } = await fetchItensBlackFriday(company);
    const mapa = new Map(itens.map((i) => [i.produto, i]));

    const rejeitados: Array<{ produto: string; motivo: string }> = [];
    const alteracoes: AlteracaoInput[] = [];
    const vistos = new Set<string>();

    for (const pedido of pedidos) {
      if (vistos.has(pedido.produto)) continue;
      vistos.add(pedido.produto);
      const item = mapa.get(pedido.produto);
      if (!item) {
        rejeitados.push({ produto: pedido.produto, motivo: "não está na Black Friday" });
        continue;
      }
      const valor = Math.round(pedido.valor * 100) / 100;
      if (!Number.isFinite(valor) || valor <= 0) {
        rejeitados.push({ produto: pedido.produto, motivo: "preço inválido" });
        continue;
      }
      if (!(item.custo > 0)) {
        rejeitados.push({ produto: pedido.produto, motivo: "sem custo cadastrado (não há piso para conferir)" });
        continue;
      }
      if (valor < item.custo - 0.005) {
        rejeitados.push({
          produto: pedido.produto,
          motivo: `abaixo do custo (custo R$ ${item.custo.toFixed(2)})`,
        });
        continue;
      }
      if (item.precoAtual === null || valor >= item.precoAtual - 0.005) {
        rejeitados.push({ produto: pedido.produto, motivo: "o painel só baixa preço (novo ≥ atual)" });
        continue;
      }
      for (const tab of item.tabelas) {
        alteracoes.push({ produto: item.produto, campoKey: campoKeyTabela(tab, "PRECO1"), valor });
      }
    }

    if (alteracoes.length === 0) {
      return NextResponse.json({ resultado: null, rejeitados }, { status: rejeitados.length ? 422 : 400 });
    }

    const resultado = await executarAlteracaoPrecos({
      company,
      usuario: autorizacao.auth.username,
      alteracoes,
      sincronizarPrecoLiquido: true,
      sincronizarPrecoAVista: false,
      obs: OBS_REBAIXA_PAINEL,
    });

    return NextResponse.json({ resultado, rejeitados });
  } catch (error) {
    console.error("[black-friday/rebaixar] erro", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao rebaixar preços." },
      { status: 500 }
    );
  }
}
