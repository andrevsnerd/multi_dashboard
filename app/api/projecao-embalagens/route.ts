import { NextResponse } from "next/server";

import { readOnlyBlock } from "@/lib/auth/route-guards";
import { fetchProjecaoEmbalagens, JANELAS_DIAS } from "@/lib/repositories/projecaoEmbalagens";
import {
  carregarEstoqueEmbalagens,
  salvarEstoqueEmbalagens,
} from "@/lib/utils/embalagens-estoque-store";
import { VAREJO_VALUE, getFilialGroupMembers, type CompanyKey } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";

export const maxDuration = 300;

/**
 * Projeção de EMBALAGEM: quanto de cada caixa/sacola o movimento de venda consome.
 *
 * A tela é a aba "Embalagens" da Projeção Compra. Ela cuida da projeção dos meses que
 * faltam (mesmo motor de curva × índice das outras métricas) e da sugestão de compra; aqui
 * só sai o REALIZADO por mês e por janela, mais o estoque digitado de cada embalagem.
 */

/** A Matriz não vende — fica fora do ritmo, igual à Projeção Compra. */
const MATRIZ_FILIAIS: Record<string, string[]> = {
  scarfme: ["SCARF ME - MATRIZ"],
  nerd: ["NERD"],
};

function isValidYmd(value: string | null): value is string {
  if (!value) return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return !Number.isNaN(dt.getTime());
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") as CompanyKey;
  const baseParam = searchParams.get("base");
  const filialParam = searchParams.get("filial")?.trim() || null;

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" obrigatório' }, { status: 400 });
  }
  if (!isValidYmd(baseParam)) {
    return NextResponse.json({ error: 'Parâmetro "base" (yyyy-MM-dd) inválido' }, { status: 400 });
  }
  // As regras de embalagem são as da ScarfMe. As outras empresas ainda não têm mapa próprio,
  // e projetar com o mapa errado seria pior do que não projetar.
  if (companyKey !== "scarfme") {
    return NextResponse.json(
      { error: "A projeção de embalagens hoje só existe para a Scarf Me." },
      { status: 400 }
    );
  }

  const company = await resolveCompanyDynamic(companyKey);
  if (!company) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
  }

  // Escopo de vendas = rede inteira (loja + e-commerce), com nomes VIVOS de filial.
  const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
  const matrizSet = new Set(MATRIZ_FILIAIS[companyKey] ?? []);
  const todasFiliais = (company.filialFilters.sales ?? []).filter((f) => !matrizSet.has(f));

  // Recorte por filial. Uma loja escolhida traz o GRUPO INTEIRO: em venda a régua é o
  // histórico da loja, não o CNPJ da vez — ver [[estoque-perna-ativa-vendas-grupo-inteiro]].
  let filiais = todasFiliais;
  if (filialParam === VAREJO_VALUE) {
    filiais = todasFiliais.filter((f) => !ecommerceFilials.has(f));
  } else if (filialParam) {
    const membros = new Set(getFilialGroupMembers(company, filialParam));
    filiais = todasFiliais.filter((f) => membros.has(f));
  }
  if (filialParam && filialParam !== VAREJO_VALUE && filiais.length === 0) {
    return NextResponse.json(
      { error: `Filial "${filialParam}" não pertence ao escopo de vendas da empresa` },
      { status: 400 }
    );
  }

  try {
    const [itens, estoque] = await Promise.all([
      fetchProjecaoEmbalagens({
        companyKey,
        posFilialNames: filiais.filter((f) => !ecommerceFilials.has(f)),
        ecommerceFilialNames: filiais.filter((f) => ecommerceFilials.has(f)),
        base: baseParam,
      }),
      carregarEstoqueEmbalagens(companyKey),
    ]);

    return NextResponse.json(
      { dataBase: baseParam, windows: JANELAS_DIAS, itens, estoque },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Erro em /api/projecao-embalagens:", error);
    return NextResponse.json({ error: "Erro ao calcular a projeção de embalagens" }, { status: 500 });
  }
}

/** Salva o estoque digitado das embalagens (aceita só as linhas alteradas). */
export async function PUT(request: Request) {
  try {
    const usuario = request.headers.get("x-auth-username") ?? "";
    const bloqueado = await readOnlyBlock(usuario);
    if (bloqueado) return bloqueado;

    const body = (await request.json()) as { company?: string; estoque?: unknown };
    const company = String(body?.company ?? "").trim();
    if (company !== "scarfme") {
      return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
    }

    const estoque = await salvarEstoqueEmbalagens(company, body?.estoque ?? {}, usuario);
    return NextResponse.json({ estoque });
  } catch (error) {
    console.error("Erro ao salvar estoque de embalagens:", error);
    return NextResponse.json({ error: "Erro ao salvar o estoque" }, { status: 500 });
  }
}
