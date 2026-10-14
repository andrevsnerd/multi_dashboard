/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EXCEÇÃO — saída de produto com saldo NEGATIVO na filial
 * ════════════════════════════════════════════════════════════════════════════
 *
 * A regra normal de Saídas/Entradas é que a saída não pode passar do saldo da
 * filial: a tela trava o "+", o `max` do campo e a bipagem quando o item não
 * tem estoque. Isso vale para toda loja — saldo negativo em loja é ruptura /
 * erro de inventário, e deixar sair mais fundo esconde o problema.
 *
 * HISTÓRICO: de 03/09 a 14/10/2026 a NERD MATRIZ ficou liberada aqui (saldo
 * negativo "por atraso de lançamento de entrada"). Revogado a pedido do dono em
 * 14/10/2026: a matriz acumulou 636 peças negativas (ex.: saída 032435, troca
 * Uniq, 38 peças com 11 em estoque). A matriz foi zerada e o Linx passou a
 * recusar negativo nela (FILIAIS.PERMITE_EST_NEGATIVO = 0) — liberar aqui de
 * novo só faria a gravação falhar no trigger. Não reativar.
 *
 * O servidor também confere o saldo antes de gravar, pela mesma regra do Linx:
 * `lib/server/trava-estoque-negativo.ts`. Este módulo é só a trava da tela.
 *
 * NÃO afeta: entrada (que já aceita saldo zero/negativo).
 */

/**
 * Nomes que identificam a filial liberada, por empresa. Vale tanto o FILIAL do
 * Linx quanto o rótulo do registry — a tela compara todos os apelidos da filial
 * selecionada. Vazio: nenhuma filial sai no negativo.
 */
const FILIAIS_SAIDA_NEGATIVA_POR_EMPRESA: Record<string, string[]> = {};

/** Compara nomes de filial tolerando caixa e espaços duplicados (ver Galeão RJ). */
function normalizeNome(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * True se a filial pode registrar SAÍDA de item com saldo negativo.
 *
 * `filial` aceita um nome só ou a lista de apelidos da opção de filial
 * (codFilial / filial / activeFilial / displayName / aliases): basta um deles
 * casar. Passar a lista é o uso preferido, porque o nome vivo do ERP e o
 * rótulo do registry podem divergir.
 */
export function permiteSaidaEstoqueNegativo(
  companyKey: string | null | undefined,
  filial: string | null | undefined | Array<string | null | undefined>
): boolean {
  const liberadas = FILIAIS_SAIDA_NEGATIVA_POR_EMPRESA[(companyKey || '').trim().toLowerCase()];
  if (!liberadas) return false;

  const tokens = (Array.isArray(filial) ? filial : [filial]).map(normalizeNome).filter(Boolean);
  if (tokens.length === 0) return false;

  return liberadas.some((nome) => tokens.includes(normalizeNome(nome)));
}
