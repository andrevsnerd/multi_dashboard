import "server-only";

/**
 * Aplica uma tarefa de preço. Usado pelo "Aplicar agora" e pelo disparo agendado —
 * nos dois casos é o mesmo `executarAlteracaoPrecos` do Alterar Custo / Preço, então
 * o lote cai na NERD_PRECO_HISTORICO e o "Reverter" de lá desfaz.
 */

import { findUserByUsername } from "@/lib/auth/users-store";
import { isReadOnlyRole, normalizeRole } from "@/lib/auth/permissions";
import { PRECOS_VIEW_ROLES } from "@/lib/auth/precos-guard";
import { executarAlteracaoPrecos, type ExecutarPrecosResult } from "@/lib/repositories/precos";
import { agendarDisparo, cancelarDisparo } from "@/lib/precos/agendador-qstash";
import { atualizarTarefa, type PrecoTarefa } from "@/lib/precos/tarefas-store";

/** Antecedência mínima: abaixo disso é "aplicar agora", não agendamento. */
const ANTECEDENCIA_MINIMA_MS = 60 * 1000;

/**
 * Agenda (ou desagenda, com `quando = null`) a tarefa. A mensagem nova é publicada
 * ANTES de cancelar a antiga: se algo falhar no meio, a antiga ainda dispara — e uma
 * mensagem órfã não faz nada, porque o disparo exige o messageId gravado na tarefa.
 */
export async function programarTarefa(
  tarefa: PrecoTarefa,
  quando: Date | null,
  usuario: string
): Promise<PrecoTarefa> {
  if (tarefa.status === "executando" || tarefa.status === "aplicada") {
    throw new Error("Esta tarefa já foi aplicada ou está sendo aplicada agora.");
  }

  const anterior = tarefa.qstashMessageId;

  if (!quando) {
    const atualizada = await atualizarTarefa(tarefa.id, {
      status: "pendente",
      agendadoPara: null,
      agendadoPor: null,
      qstashMessageId: null,
      atualizadoPor: usuario,
    });
    await cancelarDisparo(anterior);
    return atualizada ?? tarefa;
  }

  if (Number.isNaN(quando.getTime()) || quando.getTime() < Date.now() + ANTECEDENCIA_MINIMA_MS) {
    throw new Error("Escolha um horário pelo menos 1 minuto no futuro (ou use Aplicar agora).");
  }

  const messageId = await agendarDisparo(tarefa.id, quando);
  const atualizada = await atualizarTarefa(tarefa.id, {
    status: "agendada",
    agendadoPara: quando.toISOString(),
    agendadoPor: usuario,
    qstashMessageId: messageId,
    erro: null,
    atualizadoPor: usuario,
  });
  if (anterior && anterior !== messageId) await cancelarDisparo(anterior);
  return atualizada ?? tarefa;
}

/**
 * No disparo agendado ninguém está clicando: confere na hora se quem agendou ainda
 * pode gravar preço (usuário removido ou rebaixado não dispara nada).
 */
export async function usuarioPodeGravarPrecos(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  if (!user) return false;
  const role = normalizeRole(user.role);
  return PRECOS_VIEW_ROLES.includes(role) && !isReadOnlyRole(role);
}

/**
 * Executa uma tarefa JÁ reivindicada (status 'executando') e grava o desfecho.
 * Erro inesperado sobe para quem chamou decidir: o manual mostra, o agendado pode
 * devolver a tarefa para o QStash tentar de novo.
 */
export async function executarTarefa(
  tarefa: PrecoTarefa,
  usuario: string
): Promise<{ tarefa: PrecoTarefa; resultado: ExecutarPrecosResult }> {
  if (tarefa.alteracoes.length === 0) {
    throw new Error("A tarefa não tem alterações.");
  }

  const resultado = await executarAlteracaoPrecos({
    company: tarefa.company,
    usuario,
    alteracoes: tarefa.alteracoes.map((a) => ({ produto: a.produto, campoKey: a.campoKey, valor: a.valor })),
    // Mesma regra da tela Alterar Custo / Preço: o Preço Líquido acompanha o Preço.
    sincronizarPrecoLiquido: true,
    sincronizarPrecoAVista: false,
    obs: `Tarefa: ${tarefa.nome}`.slice(0, 300),
  });

  const falhouTudo = resultado.aplicados === 0 && (resultado.naoConfirmados > 0 || resultado.erros.length > 0);

  const atualizada = await atualizarTarefa(tarefa.id, {
    status: falhouTudo ? "erro" : "aplicada",
    executadoPor: usuario,
    executadoEm: new Date().toISOString(),
    lote: resultado.lote || null,
    resultado,
    erro: falhouTudo ? resultado.erros.join(" | ").slice(0, 1000) || "Nenhuma alteração confirmada." : null,
    qstashMessageId: null,
  });

  return { tarefa: atualizada ?? tarefa, resultado };
}
