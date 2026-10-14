import { NextResponse } from "next/server";

import { autorizarFinanceiro } from "@/lib/auth/controle-financeiro-guard";
import { empresaDaUrl, inteiro, respostaErro, semEmpresa } from "@/lib/financeiro/api";
import {
  CAMPOS_NORMALIZADOS,
  type CampoNormalizado,
  type TipoRegra,
  regrasEmbutidas,
} from "@/lib/financeiro/normalizacao";
import {
  removerRegra,
  renormalizar,
  resumoNormalizacao,
  salvarRegra,
  sugestoes,
  unificacoes,
} from "@/lib/financeiro/normalizacao-store";
import { carregarRegras } from "@/lib/financeiro/store";

// Renormalizar mexe em até ~185 mil linhas na primeira vez.
export const maxDuration = 300;

const ehCampo = (v: string | null): v is CampoNormalizado =>
  !!v && (CAMPOS_NORMALIZADOS as readonly string[]).includes(v);

/** `?visao=resumo` | `unificacoes&campo=&q=&todas=1` | `sugestoes`. */
export async function GET(request: Request) {
  const autorizado = await autorizarFinanceiro(request);
  if ("erro" in autorizado) return autorizado.erro;
  const url = new URL(request.url);
  const empresa = empresaDaUrl(url);
  if (!empresa) return semEmpresa();
  const p = url.searchParams;
  try {
    const visao = p.get("visao") ?? "resumo";
    if (visao === "unificacoes") {
      const campo = p.get("campo");
      if (!ehCampo(campo)) return NextResponse.json({ error: "Campo inválido." }, { status: 400 });
      const grupos = await unificacoes(empresa, campo, {
        q: p.get("q") || undefined,
        soVarias: p.get("todas") !== "1",
        limite: inteiro(p.get("limite"), 200, 10, 1000),
      });
      return NextResponse.json({ grupos });
    }
    if (visao === "sugestoes") return NextResponse.json(await sugestoes(empresa));
    const [resumo, regras] = await Promise.all([resumoNormalizacao(empresa), carregarRegras(empresa)]);
    return NextResponse.json({
      resumo,
      regras,
      embutidas: regrasEmbutidas(),
      podeEditar: autorizado.auth.podeImportar,
    });
  } catch (erro) {
    return respostaErro("normalização", erro);
  }
}

/**
 * `{ acao: "aprovar" | "rejeitar", tipo, campo?, de, para }` grava a regra e reaplica.
 * `{ acao: "remover", id }` apaga uma regra da tela. `{ acao: "renormalizar" }` reaplica tudo.
 */
export async function POST(request: Request) {
  const autorizado = await autorizarFinanceiro(request, { exigirImportacao: true });
  if ("erro" in autorizado) return autorizado.erro;
  const empresa = empresaDaUrl(new URL(request.url));
  if (!empresa) return semEmpresa();
  try {
    const body = (await request.json()) as {
      acao?: string;
      id?: number;
      tipo?: TipoRegra;
      campo?: string;
      de?: string;
      para?: string;
    };
    if (body.acao === "renormalizar") return NextResponse.json({ alterados: await renormalizar(empresa) });
    if (body.acao === "remover" && body.id) {
      return NextResponse.json({ alterados: await removerRegra(empresa, Number(body.id)) });
    }
    if ((body.acao === "aprovar" || body.acao === "rejeitar") && body.de && body.para) {
      const tipo: TipoRegra = body.tipo === "valor" ? "valor" : "palavra";
      const campo = ehCampo(body.campo ?? null) ? (body.campo as CampoNormalizado) : null;
      const alterados = await salvarRegra(
        empresa,
        { tipo, campo, de: body.de, para: body.para, status: body.acao === "aprovar" ? "aprovada" : "rejeitada" },
        autorizado.auth.username
      );
      return NextResponse.json({ alterados });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (erro) {
    return respostaErro("normalização", erro);
  }
}
