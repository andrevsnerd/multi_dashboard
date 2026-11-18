import "server-only";

import { PADROES, type EmpresaFat, type FilialNotaExtra } from "@/lib/faturamento-ecommerce/config";
import { nameForId, namesForIds } from "@/lib/server/filial-resolver";

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
 * Nomes vivos (tabela FILIAIS do Linx) das filiais que podem emitir NF por esta página:
 * as pernas do rodízio do e-commerce + as extras da empresa (Matriz da Scarf Me), por
 * COD_FILIAL. Toda checagem "esta filial é desta empresa?" e todo filtro por FILIAL do
 * módulo passa por aqui — nunca pelo nome do registry.
 */
export async function filiaisNotaDaEmpresa(empresa: EmpresaFat): Promise<string[]> {
  const nota = PADROES[empresa].nota;
  return namesForIds([...nota.codFiliais, ...nota.filiaisExtras.map((x) => x.codFilial)]);
}

/** Filiais extras (fora do rodízio) com o nome vivo no Linx. */
export async function filiaisExtrasDaEmpresa(empresa: EmpresaFat): Promise<(FilialNotaExtra & { filial: string })[]> {
  const out: (FilialNotaExtra & { filial: string })[] = [];
  for (const x of PADROES[empresa].nota.filiaisExtras) {
    const filial = await nameForId(x.codFilial);
    if (filial) out.push({ ...x, filial });
  }
  return out;
}
