import "server-only";

/**
 * Aplica uma tarefa de preço. Usado pelo "Aplicar agora" e pelo disparo agendado —
 * nos dois casos é o mesmo `executarAlteracaoPrecos` do Alterar Custo / Preço, então
 * o lote cai na NERD_PRECO_HISTORICO e o "Reverter" de lá desfaz.
 */

import { findUserByUsername } from "@/lib/auth/users-store";
import { isReadOnlyRole, normalizeRole } from "@/lib/auth/permissions";
import { PRECOS_VIEW_ROLES } from "@/lib/auth/precos-guard";
import {
  executarAlteracaoPrecos,
  type ExecutarPrecosResult,
  type PrecoCompany,
} from "@/lib/repositories/precos";
import { executarTarefaCor, parseChaveCor, type ItemTarefaCor } from "@/lib/repositories/precosCor";
import { agendarDisparo, cancelarDisparo } from "@/lib/precos/agendador-qstash";
import {
  atualizarTarefa,
  excluirTarefa,
  obterTarefa,
  reivindicarExecucao,
  type PrecoTarefa,
} from "@/lib/precos/tarefas-store";

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

  const resultado: ExecutarPrecosResult =
    tarefa.modo === "cor"
      ? await executarCor(tarefa, usuario)
      : await executarAlteracaoPrecos({
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

/**
 * Tarefa por cor: Preço Líquido (1) por cor, ligando o modo cor do produto se preciso.
 * Histórico em NERD_PRECO_COR_HISTORICO (o Reverter da tela por produto não a enxerga).
 */
async function executarCor(tarefa: PrecoTarefa, usuario: string): Promise<ExecutarPrecosResult> {
  const itens: ItemTarefaCor[] = [];
  const erros: string[] = [];
  for (const a of tarefa.alteracoes) {
    const chave = parseChaveCor(a.campoKey);
    if (!chave) {
      erros.push(`Alteração ignorada (${a.produto} · ${a.campoKey}): não é Preço Líquido por cor.`);
      continue;
    }
    itens.push({ produto: a.produto, tabela: chave.tabela, cor: chave.cor, valor: a.valor });
  }
  const r = await executarTarefaCor({
    company: tarefa.company,
    usuario,
    obs: `Tarefa: ${tarefa.nome}`.slice(0, 300),
    itens,
  });
  // r.ligados (produtos que viraram modo cor) fica no histórico como VARIA_PRECO_COR 0→1.
  return {
    lote: r.lote,
    aplicados: r.aplicados,
    semMudanca: r.semMudanca,
    semRegistro: r.semRegistro,
    naoConfirmados: r.naoConfirmados + erros.length,
    porCampo: [],
    erros: [...erros, ...r.erros],
  };
}

/** Erro de regra com o status HTTP que a rota deve devolver (o MCP só usa a mensagem). */
export class TarefaErro extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TarefaErro";
  }
}

/**
 * "Aplicar agora": reivindica a tarefa (agendada ou não), cancela o disparo agendado e
 * aplica. Usado pela tela e pelo MCP de preços — mesmo caminho, mesmo histórico.
 */
export async function aplicarTarefaAgora(
  id: string,
  company: PrecoCompany,
  usuario: string
): Promise<{ tarefa: PrecoTarefa; resultado: ExecutarPrecosResult }> {
  const existente = await obterTarefa(id);
  if (!existente || existente.company !== company) {
    throw new TarefaErro("Tarefa não encontrada.", 404);
  }

  const tarefa = await reivindicarExecucao(id, { usuario });
  if (!tarefa) {
    throw new TarefaErro("A tarefa já foi aplicada ou está sendo aplicada agora.", 409);
  }
  // Aplicou na mão: o disparo agendado (se havia) não tem mais o que fazer.
  await cancelarDisparo(existente.qstashMessageId);

  try {
    return await executarTarefa(tarefa, usuario);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await atualizarTarefa(id, { status: "erro", erro: msg.slice(0, 1000), qstashMessageId: null });
    throw new TarefaErro(`Falha ao aplicar: ${msg}`, 500);
  }
}

/** Exclui a tarefa e cancela o disparo, se estava agendada. Não mexe em preço nenhum. */
export async function excluirTarefaComDisparo(id: string, company: PrecoCompany): Promise<void> {
  const tarefa = await obterTarefa(id);
  if (!tarefa || tarefa.company !== company) {
    throw new TarefaErro("Tarefa não encontrada.", 404);
  }
  if (tarefa.status === "executando") {
    throw new TarefaErro("A tarefa está sendo aplicada agora.", 409);
  }
  await excluirTarefa(id);
  await cancelarDisparo(tarefa.qstashMessageId);
}
