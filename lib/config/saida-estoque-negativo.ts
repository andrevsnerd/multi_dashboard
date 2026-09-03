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
 * A NERD MATRIZ é o único ponto onde isso atrapalha: ela é depósito, então o
 * saldo dela fica negativo por atraso de lançamento de entrada, e a peça que
 * precisa sair para a loja está fisicamente lá. Nessas condições a trava
 * bloqueia uma operação real, então a MATRIZ (e só ela) sai no negativo.
 *
 * Nada de servidor muda: `/api/saidas-entradas-produtos/executar` nunca
 * conferiu saldo — quem trava é a tela. Este módulo é a fonte única de "quem
 * pode", para a exceção não se espalhar em condições soltas pelo componente.
 *
 * NÃO afeta: entrada (que já aceita saldo zero/negativo), transferências de
 * outras telas, ou qualquer outra filial.
 */

/**
 * Nomes que identificam a filial liberada, por empresa. Vale tanto o FILIAL do
 * Linx (`NERD`, id 000069) quanto o rótulo do registry (`MATRIZ`) — a tela
 * compara todos os apelidos da filial selecionada, e a lista dupla evita que
 * um rename no ERP derrube a exceção.
 */
const FILIAIS_SAIDA_NEGATIVA_POR_EMPRESA: Record<string, string[]> = {
  nerd: ['NERD', 'MATRIZ'],
};

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
