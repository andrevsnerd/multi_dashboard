/**
 * Classificacao do TIPO_ROMANEIO (texto livre do cadastro do Linx).
 * Fica fora dos repositorios porque a mesma regra vale para saidas, entradas e transito.
 */

/**
 * True se o romaneio e de ajuste de estoque ("AJUSTE DE ESTOQUE" e variacoes do cadastro).
 * Nao considera DEFEITO/INVENTARIO: aqui e so o tipo ajuste.
 */
export function isTipoRomaneioAjuste(tipo: string | null | undefined): boolean {
  return /AJUST/.test((tipo ?? "").toUpperCase());
}
