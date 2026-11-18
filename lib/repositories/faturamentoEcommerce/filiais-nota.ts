import "server-only";

import { PADROES, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import { namesForIds } from "@/lib/server/filial-resolver";

/**
 * Última NF de e-commerce de uma filial (naturezas 100.02/100.022), a mais recente
 * primeiro. Desempate no mesmo dia pela hora da gravação (EMISSAO é só data, e no dia
 * da virada do rodízio duas pernas emitem no mesmo dia).
 *
 * Fonte única para as duas perguntas que dependem dela:
 *  - qual filial é a principal (a que emitiu por último — regra do rodízio);
 *  - qual série a filial usa (as pernas não usam a mesma: AKS/MSC/LLL/FFF = 1, CMS = 13).
 *
 * `filialExpr` é a expressão SQL da coluna FILIAL do lado de fora (ex.: "FI.FILIAL").
 */
export function sqlUltimaNfEcommerce(filialExpr: string): string {
  return `SELECT TOP 1 UF_.SERIE_NF, UF_.EMISSAO, UF_.DATA_PARA_TRANSFERENCIA
            FROM FATURAMENTO UF_ WITH (NOLOCK)
           WHERE UF_.FILIAL = ${filialExpr} AND UF_.NATUREZA_SAIDA IN ('100.02','100.022')
           ORDER BY UF_.EMISSAO DESC, UF_.DATA_PARA_TRANSFERENCIA DESC`;
}

/**
 * Nomes vivos (tabela FILIAIS do Linx) das filiais que emitem NF de e-commerce da
 * empresa, resolvidos por COD_FILIAL. Toda checagem "esta filial é desta empresa?" e
 * todo filtro por FILIAL do módulo passa por aqui — nunca pelo nome do registry.
 */
export async function filiaisNotaDaEmpresa(empresa: EmpresaFat): Promise<string[]> {
  return namesForIds(PADROES[empresa].nota.codFiliais);
}
