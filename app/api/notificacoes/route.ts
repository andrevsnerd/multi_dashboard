import { NextRequest, NextResponse } from "next/server";
import { getSaidasPendentesParaUsuario, isSaidaBloqueante } from "@/lib/server/notificacoes-saidas";
import { getLidasByUsername, marcarLidas } from "@/lib/utils/notificacoes-leitura-store";
import type { Notificacao, SaidaPendente } from "@/lib/types/notificacao";

/** Monta o link para o detalhe do romaneio (mesma URL usada na lista de romaneios). */
function buildHref(p: SaidaPendente): string {
  const destinoEfetivo = (p.destinoCodigo || p.filialDestino || "").trim();
  const params = new URLSearchParams({
    tipo: "saida",
    filialOrigem: p.filialOrigem || "",
    filialDestino: destinoEfetivo,
    dataEmissao: p.dataEmissao || "",
    responsavel: p.responsavel || "",
    tipoRomaneio: p.tipoRomaneio || "",
  });
  return `/${p.company}/romaneios/${encodeURIComponent(p.romaneio)}?${params.toString()}`;
}

/**
 * GET /api/notificacoes?company=nerd
 * Header: x-auth-username
 * Retorna notificações da filial atribuída do usuário + contagem de não-lidas.
 */
export async function GET(request: NextRequest) {
  try {
    const username = request.headers.get("x-auth-username")?.trim();
    const companyKey = request.nextUrl.searchParams.get("company")?.trim();

    if (!username || !companyKey) {
      return NextResponse.json({ data: [], naoLidas: 0, bloqueios: [] });
    }

    const [pendentes, lidas] = await Promise.all([
      getSaidasPendentesParaUsuario(companyKey, username),
      getLidasByUsername(username),
    ]);

    const data: Notificacao[] = pendentes.map((p) => ({
      ...p,
      lida: lidas.has(p.key),
      href: buildHref(p),
    }));

    const naoLidas = data.reduce((acc, n) => (n.lida ? acc : acc + 1), 0);
    const bloqueios = data.filter((n) => isSaidaBloqueante(n));

    return NextResponse.json({ data, naoLidas, bloqueios });
  } catch (error) {
    console.error("Erro ao buscar notificações", error);
    return NextResponse.json({ data: [], naoLidas: 0, bloqueios: [] });
  }
}

/**
 * POST /api/notificacoes
 * Header: x-auth-username
 * Body: { keys?: string[]; marcarTodas?: boolean; company?: string }
 * Marca notificações como lidas para o usuário.
 */
export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get("x-auth-username")?.trim();
    if (!username) {
      return NextResponse.json({ error: "Usuário não identificado" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      keys?: string[];
      marcarTodas?: boolean;
      company?: string;
    };

    let keys = Array.isArray(body.keys) ? body.keys : [];

    // "Marcar todas": resolve as keys pendentes atuais do usuário no servidor.
    if (body.marcarTodas && body.company) {
      const pendentes = await getSaidasPendentesParaUsuario(body.company.trim(), username);
      keys = pendentes.map((p) => p.key);
    }

    await marcarLidas(username, keys);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao marcar notificações como lidas", error);
    return NextResponse.json({ error: "Erro ao marcar como lida" }, { status: 500 });
  }
}
