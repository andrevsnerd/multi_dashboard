import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { canRevisarConferencia, isReadOnlyRole } from "@/lib/auth/permissions";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { operaNaFilial } from "@/lib/utils/transferencia-permissoes-filiais";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { getConfirmados } from "@/lib/utils/romaneio-confirmacao-store";
import {
  enviarRevisao,
  getRevisao,
  resolverRevisao,
  type ItemRevisao,
} from "@/lib/utils/romaneio-revisao-store";
import { agoraBrasil, anotarObsRomaneio } from "@/lib/server/obs-operacao";

/**
 * Conferência parcial aguardando a logística — ver lib/utils/romaneio-revisao-store.ts.
 *
 * GET  ?company&romaneio&filialDestino → { revisao }
 * POST { acao: "enviar" }   — a loja manda a conferência parcial (nada vai ao Linx).
 * POST { acao: "cancelar" } — a loja (ou a logística) desiste e confere de novo.
 *
 * A APROVAÇÃO não passa por aqui: é a própria confirmação (`confirmar-lote` em
 * /api/romaneio-confirmar-entrada com `aprovacaoRevisao`), que lança a entrada e
 * fecha a revisão no mesmo passo.
 */

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const companyKey = url.searchParams.get("company") ?? "";
    const romaneioId = url.searchParams.get("romaneio") ?? "";
    const filialDestino = url.searchParams.get("filialDestino") ?? "";
    if (!companyKey || !romaneioId || !filialDestino) {
      return NextResponse.json({ error: "Parâmetros company, romaneio e filialDestino são obrigatórios" }, { status: 400 });
    }
    const companyConfig = await resolveCompanyDynamic(companyKey);
    const fd = (getActiveFilial(companyConfig, filialDestino) || filialDestino).trim();
    const revisao = await getRevisao(companyKey, romaneioId, fd);
    return NextResponse.json({ revisao });
  } catch (err) {
    console.error("GET conferencia-revisao:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro interno" }, { status: 500 });
  }
}

function normalizarItens(raw: unknown): ItemRevisao[] {
  if (!Array.isArray(raw)) return [];
  const out: ItemRevisao[] = [];
  for (const it of raw as Array<Record<string, unknown>>) {
    const produto = String(it?.produto ?? "").trim();
    if (!produto) continue;
    let tamanhos: Record<number, number> | null = null;
    if (it.tamanhos && typeof it.tamanhos === "object") {
      tamanhos = {};
      for (const [k, v] of Object.entries(it.tamanhos as Record<string, unknown>)) {
        const t = Number(k);
        const q = Math.floor(Number(v));
        if (Number.isInteger(t) && t >= 1 && t <= 48 && Number.isFinite(q) && q >= 0) tamanhos[t] = q;
      }
      if (Object.keys(tamanhos).length === 0) tamanhos = null;
    }
    out.push({
      produto,
      corProduto: String(it.corProduto ?? "").trim(),
      qtdeEnviada: Math.max(0, Math.floor(Number(it.qtdeEnviada) || 0)),
      qtdeConferida: Math.max(0, Math.floor(Number(it.qtdeConferida) || 0)),
      tamanhos,
    });
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const username = request.headers.get("x-auth-username")?.trim();
    if (!username) {
      return NextResponse.json({ error: "Usuário não identificado. Faça login novamente." }, { status: 401 });
    }
    const user = await findUserByUsername(username);
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 403 });
    if (isReadOnlyRole(user.role)) {
      return NextResponse.json({ error: "Acesso somente leitura." }, { status: 403 });
    }

    const body = (await request.json()) as {
      acao: "enviar" | "cancelar";
      companyKey: string;
      romaneioId: string;
      filialDestino: string;
      filialOrigem?: string;
      dataRomaneio?: string;
      itens?: unknown;
    };
    const { acao, companyKey, romaneioId } = body;
    if (!companyKey || !romaneioId || !body.filialDestino) {
      return NextResponse.json({ error: "Campos obrigatórios: companyKey, romaneioId, filialDestino" }, { status: 400 });
    }
    const companyConfig = await resolveCompanyDynamic(companyKey);
    const fd = (getActiveFilial(companyConfig, body.filialDestino) || body.filialDestino).trim();
    const revisor = canRevisarConferencia(user.role);

    // Mesma checagem de filial da confirmação: a loja só mexe no que é dela.
    if (!revisor) {
      const permissao = await getPermissaoByUsername(username);
      if (!permissao) return NextResponse.json({ error: "Sem permissão configurada." }, { status: 403 });
      const filialOk =
        !permissao.filialAtribuida ||
        permissao.filialAtribuida === "TODAS" ||
        permissao.filialAtribuida === fd ||
        operaNaFilial(permissao, companyConfig, fd) ||
        permissao.filiaisDestino.length === 0 ||
        permissao.filiaisDestino.some((f) => getActiveFilial(companyConfig, f || "").trim() === fd);
      if (!filialOk) return NextResponse.json({ error: "Sem permissão para esta filial." }, { status: 403 });
    }

    if (acao === "enviar") {
      const itens = normalizarItens(body.itens);
      const filialOrigem = (body.filialOrigem ?? "").trim();
      if (itens.length === 0 || !filialOrigem) {
        return NextResponse.json({ error: "Conferência sem itens ou sem filial de origem." }, { status: 400 });
      }
      const confirmados = await getConfirmados(companyKey, romaneioId, fd);
      if (confirmados.size > 0) {
        return NextResponse.json(
          { error: "Este romaneio já tem itens confirmados — atualize a tela." },
          { status: 409 }
        );
      }
      const ok = await enviarRevisao({
        companyKey,
        romaneioId,
        filialDestino: fd,
        filialOrigem,
        dataRomaneio: body.dataRomaneio ?? "",
        itens,
        enviadoPor: username,
      });
      if (!ok) {
        return NextResponse.json(
          { error: "Esta conferência já foi aprovada pela logística — atualize a tela." },
          { status: 409 }
        );
      }
      const pecasEnviadas = itens.reduce((s, it) => s + it.qtdeEnviada, 0);
      const pecasConferidas = itens.reduce((s, it) => s + it.qtdeConferida, 0);
      const itensOk = itens.filter((it) => it.qtdeConferida === it.qtdeEnviada).length;
      // Rastro no OBS da saída (best-effort, como as outras anotações).
      await anotarObsRomaneio({
        tipo: "saida",
        romaneio: romaneioId,
        filial: filialOrigem,
        linha:
          `CONFERENCIA PARCIAL EM ${fd} AGUARDANDO LOGISTICA | ${itensOk}/${itens.length} itens, ` +
          `${pecasConferidas}/${pecasEnviadas} pecas | POR: ${username} | ${agoraBrasil()}`,
      }).catch((e) => console.error("Erro ao anotar OBS da revisão", e));
      const revisao = await getRevisao(companyKey, romaneioId, fd);
      return NextResponse.json({ success: true, revisao });
    }

    if (acao === "cancelar") {
      const atual = await getRevisao(companyKey, romaneioId, fd);
      if (!atual || atual.status !== "pendente") {
        return NextResponse.json({ error: "Não há conferência aguardando a logística." }, { status: 409 });
      }
      await resolverRevisao({ companyKey, romaneioId, filialDestino: fd, status: "cancelada", resolvidoPor: username });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err) {
    console.error("POST conferencia-revisao:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro interno" }, { status: 500 });
  }
}
