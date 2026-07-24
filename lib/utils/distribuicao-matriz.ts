// Distribuição da Matriz → Lojas — regra de rateio (read-only), PURA.
//
// LÓGICA: estoque MÍNIMO por loja × item (planilha "DIVISÃO LOJAS NOVO"), grão produto×cor.
//   • necessidade da loja = max(0, mínimo − estoque atual)  (completar até o mínimo).
//   • loja com estoque ≥ mínimo → não recebe nada.
//   • mínimo 0 (loja não estoca o item) → nunca recebe.
// A origem é sempre a MATRIZ (depósito): ela cede tudo, com rateio quando o estoque não
// cobre a necessidade de toda a rede (serve primeiro quem está zerado / com maior falta).
//
// Este módulo NÃO decide o mínimo — recebe `minimo` já resolvido (lib/config/distribuicao-minimos.ts,
// com sazonal + overrides de coleção/cor aplicados) e só faz falta + rateio.

/** Status da célula loja×item na tela. */
export type LojaDistStatus = "SEM_ESTOQUE" | "CRITICO" | "BAIXO" | "OK" | "SEM_VENDA" | "NOVO";

export interface LojaDistribuicao {
  filial: string;
  filialLabel: string;
  estoqueAtual: number;
  /** Recebe o item (mínimo > 0). Reaproveita o campo `vende` da UI. */
  vende: boolean;
  /** Não usado na regra de mínimo (mantido p/ compatibilidade da UI). */
  coberturaAtualDias: number | null;
  /** Mínimo efetivo da loja para este item (reaproveita o campo `idealAlvo` da UI). */
  idealAlvo: number;
  /** "Abaixo do mínimo" | "OK" | "Não estoca". */
  idealStatusLabel: string;
  /** Falta para o mínimo = max(0, mínimo − estoque). */
  necessidade: number;
  /** Quanto a Matriz deve enviar (após rateio). */
  enviar: number;
  /** Estoque projetado após o envio. */
  saldoAposEnvio: number;
  status: LojaDistStatus;
}

export interface DistribuicaoItem {
  produto: string;
  cor: string;
  codigoCor?: string;
  descricao: string;
  codigo: string;
  codigoBarra?: string;
  subgrupo?: string;
  grade?: string;
  /** Rótulo do material da planilha (ex.: "CETIM POLIÉSTER 90X90"). */
  material?: string;
  /** Estoque positivo na Matriz (o que há para distribuir). */
  matrizEstoque: number;
  totalEnviar: number;
  /** Soma da falta da rede (antes do limite de estoque da Matriz). */
  totalNecessidade: number;
  /** Nº de lojas que estocam o item (mínimo > 0) e estão zeradas. */
  lojasSemEstoque: number;
  /** Sempre false na regra de mínimo (não há conceito de "sem histórico"). */
  semHistorico: boolean;
  /** true quando a Matriz cobre toda a falta da rede. */
  atendeTudo: boolean;
  lojas: LojaDistribuicao[];
}

export interface DistribuicaoResult {
  matrizLabel: string;
  filiaisDestino: string[];
  filialLabels: Record<string, string>;
  itens: DistribuicaoItem[];
}

/** Entrada por loja para montar um item: estoque atual + mínimo já resolvido. */
export interface LojaDistribuicaoInput {
  filial: string;
  filialLabel: string;
  estoqueAtual: number;
  /** Mínimo efetivo (config + sazonal + overrides). 0 = loja não estoca. */
  minimo: number;
}

function classificarStatus(minimo: number, estoqueAtual: number): LojaDistStatus {
  if (minimo <= 0) return "SEM_VENDA"; // loja não estoca este item
  if (estoqueAtual <= 0) return "SEM_ESTOQUE";
  if (estoqueAtual < minimo) return estoqueAtual * 2 <= minimo ? "CRITICO" : "BAIXO";
  return "OK";
}

/**
 * Monta o item do board a partir do mínimo por loja: calcula a falta e rateia o estoque
 * da Matriz servindo primeiro quem está mais descoberto (zerado, depois maior falta).
 */
export function montarDistribuicaoItem(
  base: Omit<
    DistribuicaoItem,
    "lojas" | "totalEnviar" | "totalNecessidade" | "lojasSemEstoque" | "semHistorico" | "atendeTudo"
  >,
  lojasInput: LojaDistribuicaoInput[]
): DistribuicaoItem {
  const lojas: LojaDistribuicao[] = lojasInput.map((l) => {
    const minimo = Math.max(0, Math.round(l.minimo));
    const estoqueAtual = Math.max(0, Math.round(l.estoqueAtual));
    const necessidade = Math.max(0, minimo - estoqueAtual);
    const status = classificarStatus(minimo, estoqueAtual);
    return {
      filial: l.filial,
      filialLabel: l.filialLabel,
      estoqueAtual,
      vende: minimo > 0,
      coberturaAtualDias: null,
      idealAlvo: minimo,
      idealStatusLabel: minimo <= 0 ? "Não estoca" : estoqueAtual >= minimo ? "OK" : "Abaixo do mínimo",
      necessidade,
      enviar: 0,
      saldoAposEnvio: estoqueAtual,
      status,
    };
  });

  const totalNecessidade = lojas.reduce((s, l) => s + l.necessidade, 0);

  // ── Rateio em DUAS ETAPAS (regra do dono) ──────────────────────────────────
  // Sobra da divisão manda todo mundo receber o mínimo cheio quando a Matriz cobre.
  //   1ª ETAPA: se não cobre tudo mas dá pra TODAS as lojas com falta receberem ao menos 1,
  //             reduz as quantidades e espalha (ninguém que precisa fica sem) — passadas de +1,
  //             servindo antes quem tem maior falta.
  //   2ª ETAPA: se nem 1 pra cada dá, aí sim prioridade pra maior déficit (favorece ecom/oscar).
  const needy = lojas.filter((l) => l.necessidade > 0);
  let disponivel = Math.max(0, Math.round(base.matrizEstoque));

  if (disponivel >= totalNecessidade) {
    needy.forEach((l) => (l.enviar = l.necessidade)); // cobre tudo
  } else if (disponivel >= needy.length) {
    // 1ª etapa: todas recebem ao menos 1; distribui o restante por passadas (maior falta primeiro).
    needy.forEach((l) => (l.enviar = 1));
    disponivel -= needy.length;
    while (disponivel > 0) {
      const cand = needy
        .filter((l) => l.enviar < l.necessidade)
        .sort(
          (a, b) => b.necessidade - b.enviar - (a.necessidade - a.enviar) || a.estoqueAtual - b.estoqueAtual
        );
      if (cand.length === 0) break;
      for (const l of cand) {
        if (disponivel <= 0) break;
        l.enviar += 1;
        disponivel -= 1;
      }
    }
  } else {
    // 2ª etapa: não dá pra todas → maior déficit primeiro, 1 unidade cada.
    const prioridade = [...needy].sort(
      (a, b) => b.necessidade - a.necessidade || a.estoqueAtual - b.estoqueAtual
    );
    for (const l of prioridade) {
      if (disponivel <= 0) break;
      l.enviar = 1;
      disponivel -= 1;
    }
  }

  lojas.forEach((l) => {
    l.saldoAposEnvio = l.estoqueAtual + l.enviar;
  });

  const totalEnviar = lojas.reduce((s, l) => s + l.enviar, 0);
  const lojasSemEstoque = lojas.filter((l) => l.status === "SEM_ESTOQUE").length;

  return {
    ...base,
    totalEnviar,
    totalNecessidade,
    lojasSemEstoque,
    semHistorico: false,
    atendeTudo: base.matrizEstoque >= totalNecessidade,
    lojas,
  };
}
