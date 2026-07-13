import { NextResponse } from "next/server";

import { findUserByUsername, updateUser } from "@/lib/auth/users-store";
import { criarClienteCorporativo } from "@/lib/repositories/clienteCorporativo";
import { aprovarRegistro, getRegistro } from "@/lib/repositories/corporativoCadastros";
import { canApproveCadastro, normalizeRole } from "@/lib/auth/permissions";
import type { ClienteCorporativoInput } from "@/lib/corporativo/types";

export const maxDuration = 120;

/**
 * APROVA um autocadastro: cria o cliente no Linx (com o payload possivelmente
 * editado pelo aprovador), vincula o código (CLIFOR) ao usuário do sistema e
 * marca o cadastro como aprovado. A partir daí o cliente pode comprar.
 *
 * Exceção ao read-only: admin, diretor e supervisor podem aprovar (não usa
 * readOnlyBlock, que barraria diretor/supervisor).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const username = request.headers.get("x-auth-username");
  const approver = username ? await findUserByUsername(username) : null;
  if (!approver || !canApproveCadastro(normalizeRole(approver.role))) {
    return NextResponse.json({ error: "Não autorizado a aprovar." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const registro = await getRegistro(id);
  if (!registro) return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404 });
  if (registro.status === "aprovado" && registro.clienteCodigo) {
    return NextResponse.json({ error: "Este cadastro já foi aprovado." }, { status: 409 });
  }

  // Payload final: o aprovador pode ter editado o formulário. Se não vier, usa o salvo.
  let payload: ClienteCorporativoInput = registro.payload;
  try {
    const body = (await request.json()) as { payload?: ClienteCorporativoInput } | null;
    if (body?.payload) payload = body.payload;
  } catch {
    // sem corpo → usa o payload salvo
  }

  try {
    const criado = await criarClienteCorporativo(payload);

    // Vincula o código do Linx ao usuário do sistema (libera as compras).
    if (registro.userId) {
      try {
        await updateUser(registro.userId, { clienteCodigo: criado.codigo });
      } catch (e) {
        // Usuário pode ter sido removido; o código fica registrado no cadastro mesmo assim.
        console.warn("Aprovado no Linx, mas falhou ao vincular ao usuário:", e);
      }
    }

    await aprovarRegistro(id, {
      clienteCodigo: criado.codigo,
      revisadoPor: approver.username,
      payload,
    });

    return NextResponse.json({ data: criado });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao aprovar/cadastrar no Linx.";
    console.error("Erro ao aprovar autocadastro", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
