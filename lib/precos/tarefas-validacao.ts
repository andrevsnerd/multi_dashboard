/**
 * Validação das alterações de uma tarefa do Programar Preços. Única para a tela
 * (/api/precos/tarefas) e para o MCP de preços: o que um aceita, o outro aceita.
 */

import { LIMITE_ALTERACOES, parseCampoKey } from "@/lib/repositories/precos";
import type { TarefaAlteracao } from "@/lib/precos/tarefas-store";

function limpar(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * Só preço de tabela (PRODUTOS_PRECOS) entra numa tarefa: é o que a tela edita. A chave
 * passa pela mesma whitelist do Alterar Custo / Preço — nada do cliente vai cru ao SQL.
 */
export function validarAlteracoes(entrada: unknown): { alteracoes: TarefaAlteracao[]; erro: string | null } {
  if (!Array.isArray(entrada) || entrada.length === 0) {
    return { alteracoes: [], erro: "A tarefa não tem nenhuma alteração." };
  }
  const vistos = new Set<string>();
  const alteracoes: TarefaAlteracao[] = [];
  for (const raw of entrada as Array<Record<string, unknown>>) {
    const produto = limpar(raw?.produto);
    const campo = parseCampoKey(limpar(raw?.campoKey));
    const valor = Number(raw?.valor);
    if (!produto || !campo || campo.origem !== "PRODUTOS_PRECOS") {
      return { alteracoes: [], erro: `Alteração inválida (${produto || "sem produto"}).` };
    }
    if (!Number.isFinite(valor) || valor < 0) {
      return { alteracoes: [], erro: `Valor inválido para ${produto} na tabela ${campo.codigoTabela}.` };
    }
    const chave = `${produto}||${campo.key}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const atual = raw?.atual === null || raw?.atual === undefined ? null : Number(raw.atual);
    alteracoes.push({
      produto,
      campoKey: campo.key,
      valor: Math.round(valor * 100) / 100,
      atual: atual !== null && Number.isFinite(atual) ? atual : null,
      tabela: campo.codigoTabela ?? "",
      tabelaDesc: limpar(raw?.tabelaDesc).slice(0, 120),
    });
  }
  if (alteracoes.length > LIMITE_ALTERACOES) {
    return { alteracoes: [], erro: `São ${alteracoes.length} alterações (limite ${LIMITE_ALTERACOES}).` };
  }
  return { alteracoes, erro: null };
}
