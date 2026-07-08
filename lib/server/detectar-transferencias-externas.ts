import 'server-only';

import { getActiveFilial, getFilialLabelForDisplay } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { fetchTransferenciasExternasLinx } from '@/lib/repositories/detectTransferenciasExternas';
import {
  registrarTransferenciasDetectadas,
  type TransferenciaDetectadaRegistro,
} from '@/lib/utils/transferencia-pendente-store';

/**
 * Monta o conjunto de nomes de filiais candidatos a ORIGEM de uma empresa —
 * inclui os nomes do inventário, membros e canônicas de grupos, os pares de
 * `activeFilials` (rodízios) e as filiais de e-commerce. É um superconjunto de
 * propósito: melhor casar um nome a mais do Linx do que perder um rodízio.
 */
function coletarEscopoFiliais(company: Awaited<ReturnType<typeof resolveCompanyDynamic>>): string[] {
  if (!company) return [];
  const set = new Set<string>();
  const add = (v?: string | null) => {
    const t = (v || '').trim();
    if (t) set.add(t);
  };

  for (const f of company.filialFilters?.inventory ?? []) add(f);
  for (const [canonical, members] of Object.entries(company.filialGroups ?? {})) {
    add(canonical);
    for (const m of members) add(m);
  }
  for (const [from, to] of Object.entries(company.activeFilials ?? {})) {
    add(from);
    add(to);
  }
  for (const ec of company.ecommerceFilials ?? []) add(ec);

  return Array.from(set);
}

export interface DetectarResultado {
  detectados: number;
  romaneiosInseridos: number;
  itensInseridos: number;
  itensConfirmados: number;
}

/**
 * Detecta transferências entre lojas feitas fora do app (direto no Linx) e as
 * registra no Neon como "realizadas", espelhando uma transferência feita pela
 * própria tela. Retorna um resumo (quantos itens novos entraram e quantos já
 * vieram confirmados pela perna de entrada).
 */
export async function detectarERegistrarTransferenciasExternas(
  companyKey: string | undefined,
  dias = 45
): Promise<DetectarResultado> {
  const company = await resolveCompanyDynamic(companyKey);
  const vazio: DetectarResultado = {
    detectados: 0,
    romaneiosInseridos: 0,
    itensInseridos: 0,
    itensConfirmados: 0,
  };
  if (!company || !companyKey) return vazio;

  const escopo = coletarEscopoFiliais(company);
  if (escopo.length === 0) return vazio;

  const detectadas = await fetchTransferenciasExternasLinx(escopo, dias);
  if (detectadas.length === 0) return vazio;

  const registros: TransferenciaDetectadaRegistro[] = detectadas.map((d) => {
    // Canoniza origem/destino para o MEMBRO ATIVO do grupo — exatamente a régua
    // usada pela execução da saída e pela leitura da tela. Assim o cooldown
    // (origem+produto+cor) e o painel Realizadas (origem→destino) casam.
    const origemCanonico = getActiveFilial(company, d.origem);
    const destinoCanonico = getActiveFilial(company, d.destino);
    return {
      romaneio: d.romaneio,
      origemCanonico,
      destinoCanonico,
      origemLabel: getFilialLabelForDisplay(company, origemCanonico),
      destinoLabel: getFilialLabelForDisplay(company, destinoCanonico),
      produto: d.produto,
      corCodigo: d.corCodigo,
      corDescricao: null,
      descricao: null,
      codigoBarra: null,
      emissao: d.emissao,
      quantidade: d.quantidade,
      qtdEntrada: d.qtdEntrada,
    };
  });

  const res = await registrarTransferenciasDetectadas(company.key, registros);

  return {
    detectados: detectadas.length,
    ...res,
  };
}
