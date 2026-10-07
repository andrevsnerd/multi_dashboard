import { NextResponse } from "next/server";

import { autorizarPlanejamento } from "@/lib/auth/planejamento-receita-guard";
import { getPlanejamentoEmpresa } from "@/lib/config/planejamento-receita";
import {
  CANAIS_ORCADO,
  type OrcadoAlteracao,
  listAnosOrcado,
  resolverOrcado,
  salvarOrcado,
} from "@/lib/utils/planejamento-receita-store";

const ANO_MIN = 2020;
const ANO_MAX = 2100;

function anoValido(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= ANO_MIN && n <= ANO_MAX ? n : null;
}

/**
 * Salva alterações do orçado de um ano (lote de células). `valor: null` devolve a célula
 * ao valor da planilha. Só admin (ver PLANEJAMENTO_EDITOR_ROLES).
 */
export async function PUT(request: Request) {
  const autorizado = await autorizarPlanejamento(request, { exigirEdicao: true });
  if ("erro" in autorizado) return autorizado.erro;

  try {
    const body = await request.json();
    const company = String(body?.company ?? "");
    const ano = anoValido(body?.ano);
    if (!getPlanejamentoEmpresa(company) || ano == null) {
      return NextResponse.json({ error: "Empresa ou ano inválido." }, { status: 400 });
    }
    if (!(await listAnosOrcado(company)).includes(ano)) {
      return NextResponse.json({ error: `O ano ${ano} não existe no planejamento.` }, { status: 404 });
    }

    const alteracoes: OrcadoAlteracao[] = (Array.isArray(body?.alteracoes) ? body.alteracoes : [])
      .filter(
        (a: unknown): a is OrcadoAlteracao =>
          !!a &&
          CANAIS_ORCADO.includes((a as OrcadoAlteracao).canal) &&
          Number.isInteger((a as OrcadoAlteracao).mes) &&
          ((a as OrcadoAlteracao).valor === null || Number.isFinite((a as OrcadoAlteracao).valor))
      );
    if (alteracoes.length === 0) {
      return NextResponse.json({ error: "Nenhuma alteração válida." }, { status: 400 });
    }

    const alteradas = await salvarOrcado(company, ano, alteracoes, autorizado.auth.username);
    return NextResponse.json({ ok: true, alteradas });
  } catch (error) {
    console.error("Erro ao salvar orçado", error);
    return NextResponse.json({ error: "Erro ao salvar o orçado." }, { status: 500 });
  }
}

/**
 * Cria um ano novo no planejamento copiando o orçado do ano anterior (com um crescimento
 * opcional por canal). Depois disso o ano se edita como qualquer outro.
 */
export async function POST(request: Request) {
  const autorizado = await autorizarPlanejamento(request, { exigirEdicao: true });
  if ("erro" in autorizado) return autorizado.erro;

  try {
    const body = await request.json();
    const company = String(body?.company ?? "");
    const ano = anoValido(body?.ano);
    if (!getPlanejamentoEmpresa(company) || ano == null) {
      return NextResponse.json({ error: "Empresa ou ano inválido." }, { status: 400 });
    }
    const anos = await listAnosOrcado(company);
    if (anos.includes(ano)) {
      return NextResponse.json({ error: `O ano ${ano} já existe.` }, { status: 409 });
    }
    const anterior = await resolverOrcado(company, ano - 1);
    if (!anterior) {
      return NextResponse.json(
        { error: `Crie o ano a partir de um ano que já exista (${ano - 1} não tem orçado).` },
        { status: 400 }
      );
    }

    const crescimento = (body?.crescimento ?? {}) as Partial<Record<string, number>>;
    const alteracoes: OrcadoAlteracao[] = CANAIS_ORCADO.flatMap((canal) => {
      const fator = 1 + (Number.isFinite(crescimento[canal]) ? Number(crescimento[canal]) : 0);
      return anterior.orcado[canal].map((v, i) => ({
        canal,
        mes: i + 1,
        valor: Math.round(v * fator * 100) / 100,
      }));
    });

    await salvarOrcado(company, ano, alteracoes, autorizado.auth.username);
    return NextResponse.json({ ok: true, ano });
  } catch (error) {
    console.error("Erro ao criar ano do orçado", error);
    return NextResponse.json({ error: "Erro ao criar o ano." }, { status: 500 });
  }
}
