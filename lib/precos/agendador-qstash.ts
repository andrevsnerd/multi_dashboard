import "server-only";

/**
 * Despertador das tarefas de preço: o QStash (Upstash) chama a rota de disparo UMA vez,
 * no horário marcado. A Vercel só roda código quando recebe requisição, então alguém de
 * fora precisa "tocar" a dash na hora — sem ficar consultando de tempos em tempos.
 *
 * Variáveis de ambiente (painel do Upstash → QStash):
 *   QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY
 *   QSTASH_URL (opcional — só se a conta estiver numa região que não a padrão)
 * Endereço público da dash (para onde o QStash liga):
 *   PRECOS_AGENDA_BASE_URL (opcional) ou VERCEL_PROJECT_PRODUCTION_URL (a Vercel injeta).
 */

import { Client, Receiver } from "@upstash/qstash";

export const ROTA_DISPARO = "/api/precos/tarefas/disparar";

/** Quantas vezes o QStash tenta de novo se a execução falhar (ex.: proxy do Linx fora). */
export const TENTATIVAS_QSTASH = 3;

function baseUrl(): string | null {
  const explicita = process.env.PRECOS_AGENDA_BASE_URL?.trim();
  if (explicita) return explicita.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return null;
}

/** O que falta configurar para agendar; null quando está tudo certo. */
export function faltaConfigurarAgendamento(): string | null {
  if (!process.env.QSTASH_TOKEN?.trim()) return "QSTASH_TOKEN não configurado.";
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY?.trim() || !process.env.QSTASH_NEXT_SIGNING_KEY?.trim()) {
    return "Chaves de assinatura do QStash não configuradas.";
  }
  if (!baseUrl()) return "Endereço público da dash não definido (PRECOS_AGENDA_BASE_URL).";
  return null;
}

function cliente(): Client {
  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) throw new Error("QSTASH_TOKEN não configurado.");
  const url = process.env.QSTASH_URL?.trim();
  return new Client(url ? { token, baseUrl: url } : { token });
}

/**
 * O plano gratuito do QStash não aceita atraso acima de 7 dias (`max_delay` 604800).
 * Agendamento mais longe vira saltos de até 6 dias: o disparo intermediário só reagenda
 * (ver `/disparar`), e o último cai no horário certo.
 */
const SALTO_MAXIMO_MS = 6 * 24 * 60 * 60 * 1000;

/** Agenda o disparo (ou o próximo salto) e devolve o id da mensagem, guardado na tarefa. */
export async function agendarDisparo(tarefaId: string, quando: Date): Promise<string> {
  const falta = faltaConfigurarAgendamento();
  if (falta) throw new Error(`Agendamento indisponível: ${falta}`);
  const alvo = Math.min(quando.getTime(), Date.now() + SALTO_MAXIMO_MS);
  const res = await cliente().publishJSON({
    url: `${baseUrl()}${ROTA_DISPARO}`,
    body: { tarefaId },
    notBefore: Math.floor(alvo / 1000),
    retries: TENTATIVAS_QSTASH,
  });
  return res.messageId;
}

/**
 * Cancela a mensagem agendada. Falha silenciosa de propósito: se a mensagem já foi
 * entregue ou não existe mais, o disparo antigo cai no no-op do `reivindicarExecucao`
 * (que exige o messageId corrente), então não há risco em seguir.
 */
export async function cancelarDisparo(messageId: string | null | undefined): Promise<void> {
  if (!messageId) return;
  try {
    await cliente().messages.delete(messageId);
  } catch (erro) {
    console.warn("[precos/agenda] não foi possível cancelar a mensagem", messageId, erro);
  }
}

/** Confere que a chamada veio do QStash (assinatura JWT no header `upstash-signature`). */
export async function assinaturaValida(signature: string | null, body: string): Promise<boolean> {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const next = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();
  if (!signature || !current || !next) return false;
  try {
    return await new Receiver({ currentSigningKey: current, nextSigningKey: next }).verify({
      signature,
      body,
      clockTolerance: 30,
    });
  } catch {
    return false;
  }
}
