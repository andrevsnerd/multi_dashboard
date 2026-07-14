// Régua de transferência entre filiais — fonte única.
// Extraída de components/controle-transferencias/ControleTransferenciasTable.tsx.
// Módulo puro (sem "use client") para ser reusado no client (Curva ABC) E no server (Gerador export).

import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { ProdutoTransferencia, FilialData } from "@/lib/repositories/controleTransferencias";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";

export type CurvaABC = 'A' | 'B' | 'C';
export type UrgenciaDestinoStatus = "CRITICO" | "ALTO" | "MEDIO" | "OK";
export type StoreCluster = "alto" | "medio" | "baixo";

export interface TransferByOrigin {
  origem: string;
  items: TransferItem[];
  totalItens: number;
  totalQuantidade: number;
}
/** Ordem de atendimento dos destinos (para esta origem neste produto+cor). */
export interface RoteiroDestinoAlocacao {
  ordem: number;
  destinoLabel: string;
  destinoCanonico: string;
  quantidade: number;
}

/** Trecho de alocação (origem → destino); vários podem ser somados na mesma linha após consolidação. */
export interface QuantidadeExplicacaoChunk {
  curva: CurvaABC;
  destino: {
    coberturaDias: number;
    diasAlvo: number;
    diaria: number;
    necessidadeIntegral: number;
    metaTransferencia: number;
    fatorEscassez: number;
  };
  origem: {
    coberturaDias: number;
    /** Excedente ainda livre no mapa neste ponto (após outros destinos do mesmo produto). */
    excedenteDisponivel: number;
    /** Excedente ao começar o rateamento deste produto para esta origem (= filiaisComEstoque.excedente). */
    excedenteInicialNaRodada: number;
    /** Estoque físico na origem (mesma base da coluna da tabela). */
    estoqueNaOrigem: number;
    isMatrizPrincipal: boolean;
  };
  regra: {
    zonaNeutraDias: number;
    folgaCoberturaDias: number;
    statusDestino?: UrgenciaDestinoStatus;
    reservaOrigem?: number;
    diasDesdeEntrada?: number | null;
    janelaProtecaoDias?: number;
    protecaoAtiva?: boolean;
    quebraProtecao?: boolean;
    origemTemPotencial?: boolean;
  };
  esteEnvio: {
    faltava: number;
    enviado: number;
  };
  /** Filas de destinos nesta origem, na ordem de prioridade do algoritmo (preenchido após o rateio do item). */
  roteiroDestinosParaEstaOrigem?: RoteiroDestinoAlocacao[];
}

export interface TransferItem {
  produto: string;
  descricao: string;
  codigo: string;
  codigoBarra?: string;
  subgrupo?: string;
  grade?: string;
  cor: string;
  origem: string;
  destino: string;
  /** Nome canônico da filial de origem (para API) */
  origemCanonico: string;
  /** Nome canônico da filial de destino (para API) */
  destinoCanonico: string;
  quantidade: number;
  curva: CurvaABC;
  itemOriginal: ProdutoTransferencia;
  /** Por que esta quantidade (preenchido em `calculateTransfers`). */
  quantidadeExplicacao?: QuantidadeExplicacaoChunk[];
}
export function isBlockedDestinationFilial(filial: string): boolean {
  const normalized = (filial || "").trim().toUpperCase();
  return normalized.includes("IBIRAPUERA");
}

export function isMainMatrizFilial(companyKey: CompanyKey, filial: string): boolean {
  const norm = (filial || "").trim().toUpperCase();
  if (!norm) return false;
  if (companyKey === "nerd") return norm === "NERD";
  if (companyKey === "scarfme") return norm === "SCARF ME - MATRIZ";
  return false;
}
/**
 * Formata a descrição do produto com código
 */
export function formatProductDescription(descricao: string, produto: string): {
  name: string;
  code: string;
} {
  if (descricao.includes(`(${produto})`)) {
    const parts = descricao.split(`(${produto})`);
    return {
      name: parts[0].trim(),
      code: produto,
    };
  }
  return {
    name: descricao.trim() || "Sem descrição",
    code: produto,
  };
}

// --- Constantes de cobertura ---
/** Cobertura acima deste valor + sem vendas 60d → loja classificada como "parada" */
export const DIAS_PARADA_COBERTURA = 15;
export const JANELA_PROTECAO_COM_POTENCIAL = 15;
export const JANELA_PROTECAO_SEM_POTENCIAL = 7;
export const DIAS_RESERVA_COM_POTENCIAL = 7;
export const DIAS_RESERVA_SEM_POTENCIAL = 3;
/**
 * Cobertura alvo dinâmica com curva contínua: elimina cliffs bruscos nas fronteiras 0.3 e 1.0.
 *
 *   diaria = 0   → 10 dias  (mínimo giro)
 *   diaria = 1   →  5 dias  (alto giro)
 *   diaria > 1   → clamp em 5 (floor)
 *   faixa máx   → 12 dias (cap para produtos muito lentos/sazonais)
 *
 * Fórmula: clamp(5, 12, 10 - diaria × 5)
 */
export function calcDiasCobertura(demandaDiaria: number): number {
  return Math.max(5, Math.min(12, 10 - demandaDiaria * 5));
}

/**
 * Cobertura alvo com boost para Curva A.
 * Produtos campeões (curva A) mantêm mínimo de 7 dias — nunca podem faltar.
 */
export function calcDiasAlvo(demandaDiaria: number, curva: CurvaABC): number {
  const base = calcDiasCobertura(demandaDiaria);
  return curva === 'A' ? Math.max(base, 7) : base;
}

export function applyClusterCoverageBias(baseDiasAlvo: number, cluster: StoreCluster): number {
  if (cluster === "alto") return Math.max(4, baseDiasAlvo - 1);
  if (cluster === "baixo") return Math.min(14, baseDiasAlvo + 1);
  return baseDiasAlvo;
}

export function getFilialLeadTimeDays(
  company: ReturnType<typeof resolveCompany>,
  filial: string
): number {
  const defaultLead = Math.max(0, company?.leadTimeDays?.default ?? 0);
  const byFilial = company?.leadTimeDays?.byFilial ?? {};
  const normFilial = (filial || "").trim().toUpperCase();
  if (!normFilial) return defaultLead;
  const exact = byFilial[filial];
  if (typeof exact === "number") return Math.max(0, exact);
  for (const [k, v] of Object.entries(byFilial)) {
    if ((k || "").trim().toUpperCase() === normFilial) return Math.max(0, v);
  }
  return defaultLead;
}

export function getCurvaPeso(curva: CurvaABC): number {
  if (curva === "A") return 1.4;
  if (curva === "B") return 1.15;
  return 1;
}

export function getUrgenciaDestinoStatus(coberturaDias: number): UrgenciaDestinoStatus {
  if (coberturaDias <= 0) return "CRITICO";
  if (coberturaDias <= 2) return "ALTO";
  if (coberturaDias <= 5) return "MEDIO";
  return "OK";
}

export function getUrgenciaDestinoPeso(status: UrgenciaDestinoStatus): number {
  if (status === "CRITICO") return 3;
  if (status === "ALTO") return 2;
  if (status === "MEDIO") return 1;
  return 0;
}

export function origemTemPotencial(filial: FilialData): boolean {
  return filial.salesLast30Days > 0 || filial.vendas60d > 0 || filial.vendas12m > 0;
}

export function getJanelaProtecaoDias(temPotencial: boolean): number {
  return temPotencial ? JANELA_PROTECAO_COM_POTENCIAL : JANELA_PROTECAO_SEM_POTENCIAL;
}

export function getDiasDesdeEntrada(
  ultimaEntrada: Date | string | null | undefined,
  dataReferencia: Date
): number | null {
  if (!ultimaEntrada) return null;

  const dataEntrada = new Date(ultimaEntrada);
  if (Number.isNaN(dataEntrada.getTime())) return null;

  const diffMs = dataReferencia.getTime() - dataEntrada.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Reserva mínima que a loja de ORIGEM guarda antes de ceder o excedente.
 *
 * Regra do dono (jul/2026):
 *  - Matriz (depósito, não vende): reserva 0 — cede tudo.
 *  - Loja "parada no item" (não vendeu no período de 30 dias): reserva 0 — cede tudo.
 *  - Loja que vende o item: guarda `diaria × 7` (piso de 1) — cede só o que passa de 7 dias
 *    de cobertura de venda; a proteção por cobertura (zona neutra) evita tirar de quem gira.
 *
 * ATENÇÃO: antes esta função devolvia `Math.max(1, …)` para TODOS (Matriz e paradas
 * seguravam 1 peça). Isso travava a doação e foi corrigido — vale também no Controle
 * de Transferências, que usa esta mesma régua.
 */
export function getReservaMinimaOrigem(
  diaria: number,
  temPotencial: boolean,
  opts?: { isMatriz?: boolean; salesLast30Days?: number }
): number {
  if (opts?.isMatriz) return 0;
  // "Parada no item" = sem venda nos últimos 30 dias (mesma janela do Controle de Transferências).
  if ((opts?.salesLast30Days ?? 1) === 0) return 0;
  const diasReserva = temPotencial ? DIAS_RESERVA_COM_POTENCIAL : DIAS_RESERVA_SEM_POTENCIAL;
  return Math.max(1, Math.ceil(diaria * diasReserva));
}

export function origemClaramenteParada(filial: FilialData, coberturaDias: number): boolean {
  return (
    Math.max(0, filial.stock) > 0 &&
    filial.salesLast30Days === 0 &&
    filial.vendas60d <= 1 &&
    filial.vendas12m <= 3 &&
    coberturaDias >= 7
  );
}
/**
 * Demanda diária com piso adaptativo ao histórico anual.
 * Evita cobertura explosiva para produtos de cauda longa sem travar com valor fixo.
 *
 *   piso = max(mensal/30, m12/60, 0.05)
 *   → m12/60: adapta ao ritmo histórico real (não força 0.1 para produto que vende 1x/mês)
 *   → 0.05: floor absoluto contra divisão por zero
 */
export function calcDiaria(demandaMensal: number, vendas12m: number): number {
  if (demandaMensal <= 0) return 0;
  const m12Diaria = vendas12m / 720; // vendas12m/12 meses / 60 dias
  return Math.max(demandaMensal / 30, m12Diaria, 0.05);
}

/**
 * Demanda mensal ponderada: combina média anual (estabilidade) com tendência recente (reatividade).
 *
 * m12     = vendas12m / 12
 * recente = vendas60d / 2        (média mensal dos últimos 60 dias)
 * peso    = clamp(recente/m12, 0.5, 1.5)
 * demanda = m12 × (0.5 + 0.5 × peso)
 *
 * Proteção de ruptura: se stock ≤ 0 e m12 > 0, eleva demanda para ≥ 70% da média anual
 * para não penalizar filiais que ficaram sem estoque.
 */
export function calcDemandaPonderada(
  vendas30d: number,
  vendas60d: number,
  vendas12m: number,
  stock: number
): number {
  const m12     = vendas12m / 12;
  const recente = vendas60d / 2;

  if (m12 <= 0) {
    // sem histórico anual: usa vendas recentes como estimativa
    return Math.max(recente, vendas30d);
  }

  const peso  = Math.max(0.5, Math.min(recente / m12, 1.5));
  let demanda = m12 * (0.5 + 0.5 * peso);

  // Ruptura detectada: stock zerado com histórico → piso de 80% do anual OU tendência recente (maior).
  // max(recente, m12*0.8): garante recuperação mesmo se recente caiu por falta de produto (não queda real).
  // Evita tanto inflar produto morto (< m12) quanto subestimar produto forte que esvaziou (â‰¥ m12*0.8).
  if (stock <= 0 && m12 > 0) {
    demanda = Math.max(demanda, recente, m12 * 0.8);
  }

  return demanda;
}

/**
 * Organiza as filiais baseado na configuração da empresa
 */
export function organizeFiliais(
  companyKey: CompanyKey,
  items: ProdutoTransferencia[]
): {
  matriz: string | null;
  ecommerce: string | null;
  filiais: string[];
} {
  const company = resolveCompany(companyKey);
  if (!company) {
    return { matriz: null, ecommerce: null, filiais: [] };
  }

  let matriz: string | null = null;
  let ecommerce: string | null = null;
  if (companyKey === "nerd") {
    matriz = "NERD";
  } else if (companyKey === "scarfme") {
    matriz = "SCARF ME - MATRIZ";
    ecommerce = "SCARFME MATRIZ CMS";
  }

  const allFiliais = company.filialFilters['inventory'] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];
  const normalFiliais = allFiliais.filter(f => 
    !ecommerceFilials.includes(f) && f !== matriz
  );

  return {
    matriz,
    ecommerce,
    filiais: normalFiliais.sort(),
  };
}
/**
 * Calcula as transferências necessárias
 * Mesma lógica da versão antiga, mas otimizada.
 *
 * `cooldownKeys`: chaves no formato `${produto}|${codigoCor}|${origemCanonicoUpper}`
 * que devem ser excluídas como origem para esse produto+cor. Usado para impedir
 * que a mesma loja seja sugerida como origem para o mesmo produto duas vezes
 * dentro da janela de cooldown (default 7 dias) configurada no backend.
 */
export function calculateTransfers(
  data: ProdutoTransferencia[],
  companyKey: CompanyKey,
  dateRange?: DateRangeValue,
  cooldownKeys?: Set<string>
): TransferByOrigin[] {
  const company = resolveCompany(companyKey);
  if (!company) {
    return [];
  }

  const { matriz, ecommerce } = organizeFiliais(companyKey, data);
  // Janela de proteção é sempre relativa ao "agora" — independe do período de vendas filtrado.
  const dataReferenciaProtecao = new Date();

  const transfers: TransferItem[] = [];

  // --- Curva ABC por filial: top 20% por vendas12m dentro de cada loja ---
  // Cada loja tem seu próprio ranking — um produto pode ser A em uma loja e C em outra.
  const curvaMapPorFilial = new Map<string, CurvaABC>(); // key: `${filial}|${produto}|${cor}`
  {
    const porFilial = new Map<string, Array<{ key: string; vendas12m: number }>>();
    data.forEach(item => {
      item.filiais.forEach(f => {
        if (!porFilial.has(f.filial)) porFilial.set(f.filial, []);
        porFilial.get(f.filial)!.push({ key: `${item.produto}|${item.cor}`, vendas12m: f.vendas12m });
      });
    });
    porFilial.forEach((produtos, filial) => {
      const sorted = [...produtos].sort((a, b) => b.vendas12m - a.vendas12m);
      const n = sorted.length;
      sorted.forEach(({ key }, i) => {
        const pct = i / n;
        curvaMapPorFilial.set(`${filial}|${key}`, pct < 0.2 ? 'A' : pct < 0.5 ? 'B' : 'C');
      });
    });
  }

  // Mapa para rastrear quantidades já transferidas para cada destino (produto+cor+destino)
  const quantidadeTransferidaPorDestino = new Map<string, number>();

  // Pré-computado uma vez (constantes da empresa) — evita refazer a cada produto.
  const ecommerceFilialsList = company.ecommerceFilials ?? [];
  const ecommerceFilialsSet = new Set(
    ecommerceFilialsList.map(ec => (ec || '').trim().toUpperCase())
  );
  const isEcommerceFilial = (filial: string): boolean =>
    ecommerceFilialsSet.has((filial || '').trim().toUpperCase());

  data.forEach((item) => {

    // --- 1. Calcular demanda ponderada e cobertura por filial ---
    const demandaPorFilial  = new Map<string, number>();
    const coberturaPorFilial = new Map<string, number>();
    const contextoOrigemPorFilial = new Map<string, {
      temPotencial: boolean;
      diasDesdeEntrada: number | null;
      janelaProtecaoDias: number;
      dentroDaProtecao: boolean;
      reservaMinima: number;
      origemParadaSemHistoricoForte: boolean;
    }>();

    item.filiais.forEach(f => {
      const demanda = calcDemandaPonderada(f.salesLast30Days, f.vendas60d, f.vendas12m, f.stock);
      demandaPorFilial.set(f.filial, demanda);
      // Piso adaptativo: max(mensal/30, m12/60, 0.05) — evita cobertura explosiva
      const diaria    = calcDiaria(demanda, f.vendas12m);
      const estPos    = Math.max(0, f.stock);
      const cobertura = diaria > 0 ? estPos / diaria : (estPos > 0 ? 999 : 0);
      coberturaPorFilial.set(f.filial, cobertura);

      const temPotencial = origemTemPotencial(f);
      const janelaProtecaoDias = getJanelaProtecaoDias(temPotencial);
      const diasDesdeEntrada = getDiasDesdeEntrada(f.ultimaEntrada, dataReferenciaProtecao);
      const dentroDaProtecao =
        diasDesdeEntrada !== null && diasDesdeEntrada < janelaProtecaoDias;

      contextoOrigemPorFilial.set(f.filial, {
        temPotencial,
        diasDesdeEntrada,
        janelaProtecaoDias,
        dentroDaProtecao,
        reservaMinima: getReservaMinimaOrigem(diaria, temPotencial, {
          isMatriz: isMainMatrizFilial(companyKey, f.filial),
          salesLast30Days: f.salesLast30Days,
        }),
        origemParadaSemHistoricoForte: origemClaramenteParada(f, cobertura),
      });
    });

    // FILTRO 1: produto deve ter demanda em pelo menos uma filial
    const totalDemanda = Array.from(demandaPorFilial.values()).reduce((s, v) => s + v, 0);
    if (totalDemanda <= 0) return;

    // Helper curva por filial
    const getCurvaFilial = (filial: string): CurvaABC =>
      curvaMapPorFilial.get(`${filial}|${item.produto}|${item.cor}`) ?? 'C';

    // Helper: demanda diária com piso adaptativo
    const getDiaria = (demanda: number, vendas12m: number): number =>
      calcDiaria(demanda, vendas12m);

    // Cache da curva por filial (evita reconstruir a chave duas vezes no filter+map).
    const curvaPorFilial = new Map<string, CurvaABC>();
    item.filiais.forEach(f => curvaPorFilial.set(f.filial, getCurvaFilial(f.filial)));

    // --- 2. Destinos: filiais com necessidade > 0 ---
    const estoqueAgregadoEcommerce = item.filiais
      .filter(f => isEcommerceFilial(f.filial))
      .reduce((sum, f) => sum + Math.max(0, f.stock), 0);

    const filiaisQuePrecisam = item.filiais
      .filter(f => {
        if (isBlockedDestinationFilial(f.filial)) return false;
        if (isEcommerceFilial(f.filial) && estoqueAgregadoEcommerce >= 1) return false;
        const demanda = demandaPorFilial.get(f.filial) || 0;
        if (demanda <= 0) return false;
        // Ultra-low sellers: < 1 unidade/mês — custo logístico não justifica movimentação
        if (demanda < 1) return false;
        const diaria      = calcDiaria(demanda, f.vendas12m);
        const estPos      = Math.max(0, f.stock);
        const diasAlvo    = calcDiasAlvo(diaria, curvaPorFilial.get(f.filial) ?? 'C');
        const necessidade = (diaria * diasAlvo) - estPos;
        return necessidade > 0;
      })
      .map(f => {
        const curva       = curvaPorFilial.get(f.filial) ?? 'C';
        const demanda     = demandaPorFilial.get(f.filial) || 0;
        const diaria      = calcDiaria(demanda, f.vendas12m);
        const estPos      = Math.max(0, f.stock);
        const cluster: StoreCluster = "medio";
        const diasAlvoBase = calcDiasAlvo(diaria, curva);
        const diasAlvoCluster = applyClusterCoverageBias(diasAlvoBase, cluster);
        const leadTimeDays = getFilialLeadTimeDays(company, f.filial);
        const diasAlvo = diasAlvoCluster + leadTimeDays;
        const necessidade = Math.max(0, (diaria * diasAlvo) - estPos);
        const cobertura   = coberturaPorFilial.get(f.filial) || 0;
        const statusDestino = getUrgenciaDestinoStatus(cobertura);
        if (statusDestino === "OK") return null;
        const urgencia    = Math.max(0, diasAlvo - cobertura);
        const pesoCurva = getCurvaPeso(curva);
        const prioridade  = (urgencia * 2 + diaria) * pesoCurva;
        const prioridadeUrgencia = getUrgenciaDestinoPeso(statusDestino);
        return { filial: f.filial, stock: estPos, sales: f.sales, salesLast30Days: f.salesLast30Days,
                 curva, demanda, diaria, diasAlvo, necessidade, cobertura, prioridade, statusDestino, prioridadeUrgencia };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .sort((a, b) => {
        if (b.prioridadeUrgencia !== a.prioridadeUrgencia) {
          return b.prioridadeUrgencia - a.prioridadeUrgencia;
        }
        if (b.prioridade !== a.prioridade) return b.prioridade - a.prioridade;
        return a.cobertura - b.cobertura; // fallback: menor cobertura = mais urgente
      });

    if (filiaisQuePrecisam.length === 0) return;

    // Pré-computa chave do cooldown para este produto+cor (codigoCor).
    // O backend devolve chaves no formato `${produto}|${codigoCor}|${origemUPPER}`.
    const cooldownProdutoCorPrefix = cooldownKeys && cooldownKeys.size > 0
      ? `${(item.produto || '').trim()}|${(item.codigoCor || '').trim()}|`
      : null;

    // --- 3. Origens: filiais com excedente > 0 ---
    const filiaisComEstoque = item.filiais
      .filter(f => {
        if (cooldownProdutoCorPrefix && cooldownKeys) {
          const chave = cooldownProdutoCorPrefix + (f.filial || '').trim().toUpperCase();
          if (cooldownKeys.has(chave)) return false;
        }
        const demanda   = demandaPorFilial.get(f.filial) || 0;
        const diaria    = getDiaria(demanda, f.vendas12m);
        const estPos    = Math.max(0, f.stock);
        if (estPos < 1) return false;
        const contextoOrigem = contextoOrigemPorFilial.get(f.filial);
        const reservaMinima = contextoOrigem?.reservaMinima ?? getReservaMinimaOrigem(diaria, false);
        const disponivel = estPos - reservaMinima;
        return Math.floor(disponivel) >= 1;
      })
      .map(f => {
        const demanda    = demandaPorFilial.get(f.filial) || 0;
        const diaria     = getDiaria(demanda, f.vendas12m);
        const estPos     = Math.max(0, f.stock);
        const cobertura  = coberturaPorFilial.get(f.filial) || 0;
        const contextoOrigem = contextoOrigemPorFilial.get(f.filial);
        const isParada   = cobertura > DIAS_PARADA_COBERTURA && f.vendas60d === 0;
        const reservaMinima = contextoOrigem?.reservaMinima ?? getReservaMinimaOrigem(diaria, false);
        const excedente  = Math.floor(Math.max(0, estPos - reservaMinima));
        return { filial: f.filial, stock: estPos, sales: f.sales, salesLast30Days: f.salesLast30Days,
                 isMatriz: isMainMatrizFilial(companyKey, f.filial),
                 curva: curvaPorFilial.get(f.filial) ?? 'C', demanda, diaria, cobertura, isParada,
                 isEcommerceParado: isParada && f.filial === ecommerce,
                 excedente,
                 temPotencial: contextoOrigem?.temPotencial ?? false,
                 diasDesdeEntrada: contextoOrigem?.diasDesdeEntrada ?? null,
                 janelaProtecaoDias: contextoOrigem?.janelaProtecaoDias ?? JANELA_PROTECAO_SEM_POTENCIAL,
                 dentroDaProtecao: contextoOrigem?.dentroDaProtecao ?? false,
                 reservaMinima,
                 origemParadaSemHistoricoForte: contextoOrigem?.origemParadaSemHistoricoForte ?? false };
      })
      .sort((a, b) => {
        if (a.isMatriz !== b.isMatriz) return a.isMatriz ? -1 : 1;
        const aP = a.isParada || a.isEcommerceParado;
        const bP = b.isParada || b.isEcommerceParado;
        if (aP !== bP) return aP ? -1 : 1;
        return b.cobertura - a.cobertura; // maior cobertura = mais folga = cede primeiro
      });

    const productInfo = formatProductDescription(item.descricao, item.produto);

    if (filiaisComEstoque.length === 0) return;

    // Excedente disponível por origem (decrementado a cada sugestão gerada)
    const excedenteDisponivel = new Map<string, number>(
      filiaisComEstoque.map(f => [f.filial, f.excedente])
    );

    // Visão global do produto: quando o excedente total não cobre toda necessidade,
    // priorizamos filiais de maior impacto (curva + urgência + demanda).
    const necessidadeTotalGlobal = filiaisQuePrecisam.reduce((s, f) => s + Math.ceil(f.necessidade), 0);
    const excedenteTotalGlobal = Array.from(excedenteDisponivel.values()).reduce((s, v) => s + v, 0);
    const fatorAtendimentoGlobal =
      necessidadeTotalGlobal > 0 ? Math.min(1, excedenteTotalGlobal / necessidadeTotalGlobal) : 1;

    const ordemDestinosCanon = filiaisQuePrecisam.map((d) => d.filial);
    const transfersDesteItem: TransferItem[] = [];

    // --- 4. Para cada destino, suprir de origens em ordem de prioridade ---
    filiaisQuePrecisam.forEach(filialDestino => {
      const destinoKey      = `${item.produto}|${item.cor}|${filialDestino.filial}`;
      const jaTransferido   = quantidadeTransferidaPorDestino.get(destinoKey) || 0;
      let necessidadeTotal = Math.ceil(filialDestino.necessidade);
      if (fatorAtendimentoGlobal < 1) {
        const necessidadeAjustada = Math.floor(necessidadeTotal * fatorAtendimentoGlobal);
        necessidadeTotal = filialDestino.curva === "A"
          ? Math.max(1, necessidadeAjustada)
          : Math.max(0, necessidadeAjustada);
      }

      if (jaTransferido >= necessidadeTotal) return;

      let aindaNecessario = necessidadeTotal - jaTransferido;
      let totalTransferido = jaTransferido;
      const destinoDisplayName = company.filialDisplayNames?.[filialDestino.filial] || filialDestino.filial;

      // Ordenar origens: matriz → paradas (maior excedente) → ativas (maior cobertura)
      const origensOrdenadas = [...filiaisComEstoque].sort((a, b) => {
        if (a.isMatriz !== b.isMatriz) return a.isMatriz ? -1 : 1;
        const aP = a.isParada || a.isEcommerceParado;
        const bP = b.isParada || b.isEcommerceParado;
        if (aP !== bP) return aP ? -1 : 1;
        return (excedenteDisponivel.get(b.filial) || 0) - (excedenteDisponivel.get(a.filial) || 0);
      });

      for (const origem of origensOrdenadas) {
        if (aindaNecessario <= 0) break;
        if (origem.filial === filialDestino.filial) continue;
        if (origem.stock < 1) continue;

        const excDisponivel = Math.floor(excedenteDisponivel.get(origem.filial) || 0);
        if (excDisponivel < 1) continue;

        const destinoUrgente = filialDestino.statusDestino === "ALTO" || filialDestino.statusDestino === "CRITICO";
        const podeQuebrarProtecao =
          (origem.curva === "A" && destinoUrgente) ||
          (!origem.temPotencial && filialDestino.statusDestino === "CRITICO") ||
          (origem.origemParadaSemHistoricoForte && destinoUrgente);

        if (origem.dentroDaProtecao && !podeQuebrarProtecao) continue;

        // Zona neutra dinâmica: só move se a origem tiver folga de cobertura vs destino.
        // max(2, diasAlvo * 0.3): para diaria>=1 → 2 dias; para diaria<0.3 → ~3 dias
        const zonaNeutra = Math.max(2, filialDestino.diasAlvo * 0.3);
        const diffCobertura = origem.cobertura - filialDestino.cobertura;
        if (filialDestino.statusDestino === "MEDIO") {
          if (diffCobertura < zonaNeutra) continue;
        } else if (diffCobertura < 0) {
          continue;
        }

        const quantidade = Math.min(
          aindaNecessario,
          excDisponivel,
          Math.floor(origem.stock)
        );
        if (quantidade < 1) continue;

        const origemDisplayName = company.filialDisplayNames?.[origem.filial] || origem.filial;

        const qtdEnvio = quantidade;
        const explicacaoChunk: QuantidadeExplicacaoChunk = {
          curva: origem.curva,
          destino: {
            coberturaDias: filialDestino.cobertura,
            diasAlvo: filialDestino.diasAlvo,
            diaria: filialDestino.diaria,
            necessidadeIntegral: Math.ceil(filialDestino.necessidade),
            metaTransferencia: necessidadeTotal,
            fatorEscassez: fatorAtendimentoGlobal,
          },
          origem: {
            coberturaDias: origem.cobertura,
            excedenteDisponivel: excDisponivel,
            excedenteInicialNaRodada: origem.excedente,
            estoqueNaOrigem: origem.stock,
            isMatrizPrincipal: origem.isMatriz,
          },
          regra: {
            zonaNeutraDias: filialDestino.statusDestino === "MEDIO" ? zonaNeutra : 0,
            folgaCoberturaDias: diffCobertura,
            statusDestino: filialDestino.statusDestino,
            reservaOrigem: origem.reservaMinima,
            diasDesdeEntrada: origem.diasDesdeEntrada,
            janelaProtecaoDias: origem.janelaProtecaoDias,
            protecaoAtiva: origem.dentroDaProtecao,
            quebraProtecao: origem.dentroDaProtecao && podeQuebrarProtecao,
            origemTemPotencial: origem.temPotencial,
          },
          esteEnvio: {
            faltava: Math.ceil(aindaNecessario),
            enviado: qtdEnvio,
          },
        };

        const transferItem: TransferItem = {
          produto:         item.produto,
          descricao:       productInfo.name,
          codigo:          productInfo.code,
          codigoBarra:     item.codigoBarra,
          subgrupo:        item.subgrupo,
          grade:           item.grade,
          cor:             item.cor,
          origem:          origemDisplayName,
          destino:         destinoDisplayName,
          origemCanonico:  origem.filial,
          destinoCanonico: filialDestino.filial,
          quantidade:      qtdEnvio,
          curva:           origem.curva,
          itemOriginal:    item,
          quantidadeExplicacao: [explicacaoChunk],
        };
        transfers.push(transferItem);
        transfersDesteItem.push(transferItem);

        excedenteDisponivel.set(origem.filial, excDisponivel - quantidade);
        totalTransferido += quantidade;
        quantidadeTransferidaPorDestino.set(destinoKey, totalTransferido);
        aindaNecessario = necessidadeTotal - totalTransferido;
      }

    });

    // Roteiro: ordem dos destinos (prioridade) e quanto esta origem envia para cada um neste produto+cor.
    const porOrigem = new Map<string, TransferItem[]>();
    for (const t of transfersDesteItem) {
      const k = t.origemCanonico;
      if (!porOrigem.has(k)) porOrigem.set(k, []);
      porOrigem.get(k)!.push(t);
    }
    porOrigem.forEach((lista) => {
      const porDestino = new Map<string, { label: string; canon: string; q: number }>();
      for (const t of lista) {
        const canon = t.destinoCanonico;
        const cur = porDestino.get(canon);
        if (cur) cur.q += t.quantidade;
        else porDestino.set(canon, { label: t.destino, canon, q: t.quantidade });
      }
      const roteiro: RoteiroDestinoAlocacao[] = ordemDestinosCanon
        .filter((canon) => porDestino.has(canon))
        .map((canon, i) => {
          const p = porDestino.get(canon)!;
          return {
            ordem: i + 1,
            destinoLabel: p.label,
            destinoCanonico: p.canon,
            quantidade: p.q,
          };
        });
      for (const t of lista) {
        t.quantidadeExplicacao?.forEach((ch) => {
          ch.roteiroDestinosParaEstaOrigem = roteiro;
        });
      }
    });
  });

  // --- 5. Ordenar por score estratégico ---
  // score = gap_cobertura * quantidade * peso_curva * demanda_destino
  // Maior score = maior impacto de venda/ruptura.
  // Pré-computa o score uma vez por transfer (Schwartzian transform): O(N) ao invés de O(N²).
  const cobFilial = (f: FilialData | undefined): number => {
    if (!f) return 999;
    const dem = calcDemandaPonderada(f.salesLast30Days, f.vendas60d, f.vendas12m, f.stock);
    const dia = calcDiaria(dem, f.vendas12m);
    return dia > 0 ? Math.max(0, f.stock) / dia : (f.stock > 0 ? 999 : 0);
  };

  const transfersComScore = transfers.map(t => {
    const filialDest = t.itemOriginal.filiais.find(f => f.filial === t.destinoCanonico);
    const filialOrig = t.itemOriginal.filiais.find(f => f.filial === t.origemCanonico);
    const demandaDest = calcDemandaPonderada(
      filialDest?.salesLast30Days ?? 0,
      filialDest?.vendas60d ?? 0,
      filialDest?.vendas12m ?? 0,
      filialDest?.stock ?? 0
    );
    const gap = Math.max(0, cobFilial(filialOrig) - cobFilial(filialDest));
    const score = gap * t.quantidade * getCurvaPeso(t.curva) * Math.max(1, demandaDest);
    return { t, score };
  });

  transfersComScore.sort((a, b) => b.score - a.score);
  const transfersOrdenados = transfersComScore.map(({ t }) => t);

  // Consolidar itens duplicados (mesmo produto+cor+origem+destino): somar quantidades
  const transferKey = (t: TransferItem) =>
    `${t.produto}|${t.cor}|${t.origem}|${t.destino}`;
  const consolidatedMap = new Map<string, TransferItem>();
  transfersOrdenados.forEach((t) => {
    const k = transferKey(t);
    const existente = consolidatedMap.get(k);
    if (existente) {
      existente.quantidade += t.quantidade;
      if (t.quantidadeExplicacao?.length) {
        existente.quantidadeExplicacao = [
          ...(existente.quantidadeExplicacao ?? []),
          ...t.quantidadeExplicacao,
        ];
      }
      const roteiro = t.quantidadeExplicacao?.find((c) => c.roteiroDestinosParaEstaOrigem?.length)
        ?.roteiroDestinosParaEstaOrigem;
      if (roteiro?.length) {
        existente.quantidadeExplicacao?.forEach((ch) => {
          if (!ch.roteiroDestinosParaEstaOrigem?.length) ch.roteiroDestinosParaEstaOrigem = roteiro;
        });
      }
    } else {
      consolidatedMap.set(k, { ...t });
    }
  });
  const consolidatedTransfers = Array.from(consolidatedMap.values());

  // Agrupar por origem
  const transfersByOrigin = new Map<string, TransferItem[]>();
  consolidatedTransfers.forEach((transfer) => {
    if (!transfersByOrigin.has(transfer.origem)) {
      transfersByOrigin.set(transfer.origem, []);
    }
    transfersByOrigin.get(transfer.origem)!.push(transfer);
  });

  // Converter para array e ordenar
  const result: TransferByOrigin[] = Array.from(transfersByOrigin.entries())
    .map(([origem, items]) => {
      const totalQuantidade = items.reduce((sum, item) => sum + item.quantidade, 0);
      return {
        origem,
        items,
        totalItens: items.length,
        totalQuantidade,
      };
    })
    .sort((a, b) => {
      return a.origem.localeCompare(b.origem);
    });

  return result;
}

// ============================================================================
// LENTE DE TRANSFERÊNCIA PARA A COMPRA (read-only, opcional)
// ----------------------------------------------------------------------------
// Reusa `calculateTransfers` (mesma régua, mesma janela de 30d do Controle de
// Transferências) e agrega o resultado por produto×cor, para que as telas de
// compra (Curva ABC, Gerador) possam mostrar, ao lado da "Compra original":
//   • Disponível para transferir (quanto a rede tem parado e de onde)
//   • Compra líquida (o que sobraria comprando após transferir)
// Nunca desconta nada à força — quem decide item a item é o usuário.
// ============================================================================

export interface TransferLensDoadora {
  /** Nome de exibição da filial de origem. */
  origem: string;
  /** Nome canônico (para API). */
  origemCanonico: string;
  quantidade: number;
  /** Matriz (depósito) — doadora preferencial ao aparar a lista para o disponível. */
  isMatriz: boolean;
}

export interface TransferLensEntry {
  produto: string;
  corDescricao: string;
  codigoCor?: string;
  /** Total que a rede pode mover para cobrir necessidade deste produto×cor. */
  totalTransferivel: number;
  /** Origens agregadas (de onde sai). */
  doadoras: TransferLensDoadora[];
  /** Destinos agregados (para onde vai). */
  destinos: { destino: string; destinoCanonico: string; quantidade: number }[];
}

/**
 * Normaliza um código de cor para casamento: códigos numéricos perdem o zero à
 * esquerda ('06' e '6' viram '6'), pois a mesma cor chega em dois formatos
 * conforme a fonte. Não-numéricos vão para maiúsculas.
 */
function normalizeCorKey(cor: string | null | undefined): string {
  const c = (cor || "").trim();
  if (!c) return "";
  return /^\d+$/.test(c) ? String(parseInt(c, 10)) : c.toUpperCase();
}

/** Chave de casamento produto×cor entre a régua e as linhas de compra. */
export function transferLensKey(produto: string, cor: string | null | undefined): string {
  return `${(produto || "").trim()}|${normalizeCorKey(cor)}`;
}

export interface TransferLensIndex {
  /** produto×cor (cor normalizada). */
  byKey: Map<string, TransferLensEntry>;
  /** produto (todas as cores somadas) — usado quando a tela agrega por produto. */
  byProduto: Map<string, TransferLensEntry>;
}

function acumularEntry(entry: TransferLensEntry, it: TransferItem, isMatriz: boolean): void {
  entry.totalTransferivel += it.quantidade;
  const doadora = entry.doadoras.find((d) => d.origemCanonico === it.origemCanonico);
  if (doadora) doadora.quantidade += it.quantidade;
  else
    entry.doadoras.push({
      origem: it.origem,
      origemCanonico: it.origemCanonico,
      quantidade: it.quantidade,
      isMatriz,
    });
  const destino = entry.destinos.find((t) => t.destinoCanonico === it.destinoCanonico);
  if (destino) destino.quantidade += it.quantidade;
  else
    entry.destinos.push({
      destino: it.destino,
      destinoCanonico: it.destinoCanonico,
      quantidade: it.quantidade,
    });
}

/**
 * Roda a régua de transferência sobre o dataset da rede e indexa por produto×cor
 * e por produto. `data` deve ser o retorno de `fetchControleTransferencias`
 * (todas as filiais, incluindo Matriz, com vendas em 30d/60d/12m e última entrada).
 */
export function buildTransferLensIndex(
  data: ProdutoTransferencia[],
  companyKey: CompanyKey,
  cooldownKeys?: Set<string>
): TransferLensIndex {
  const grupos = calculateTransfers(data, companyKey, undefined, cooldownKeys);
  const byKey = new Map<string, TransferLensEntry>();
  const byProduto = new Map<string, TransferLensEntry>();

  for (const g of grupos) {
    for (const it of g.items) {
      const isMatriz = isMainMatrizFilial(companyKey, it.origemCanonico);
      const corKey = it.itemOriginal?.codigoCor ?? it.cor;
      const key = transferLensKey(it.produto, corKey);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          produto: it.produto,
          corDescricao: it.cor,
          codigoCor: it.itemOriginal?.codigoCor,
          totalTransferivel: 0,
          doadoras: [],
          destinos: [],
        };
        byKey.set(key, entry);
      }
      acumularEntry(entry, it, isMatriz);

      const pKey = (it.produto || "").trim();
      let pEntry = byProduto.get(pKey);
      if (!pEntry) {
        pEntry = {
          produto: it.produto,
          corDescricao: "",
          totalTransferivel: 0,
          doadoras: [],
          destinos: [],
        };
        byProduto.set(pKey, pEntry);
      }
      acumularEntry(pEntry, it, isMatriz);
    }
  }

  return { byKey, byProduto };
}

/** Resolve a entrada da lente para uma linha de compra (por cor ou agregada por produto). */
export function resolveTransferLens(
  index: TransferLensIndex | null | undefined,
  produto: string,
  cor: string | null | undefined
): TransferLensEntry | undefined {
  if (!index) return undefined;
  if (cor != null && String(cor).trim() !== "") {
    return index.byKey.get(transferLensKey(produto, cor));
  }
  return index.byProduto.get((produto || "").trim());
}

export interface TransferLensResult {
  compraOriginal: number;
  disponivelTransferir: number;
  compraLiquida: number;
  doadoras: TransferLensDoadora[];
}

/**
 * Aplica a lente a um item: desconta da compra original o que a rede pode transferir.
 * `disponivel` nunca passa da própria compra original (cobertura parcial mantém o resíduo).
 */
export function applyTransferLens(
  compraOriginal: number,
  entry: TransferLensEntry | undefined
): TransferLensResult {
  const co = Math.max(0, Math.round(compraOriginal));
  if (!entry || entry.totalTransferivel <= 0 || co <= 0) {
    return { compraOriginal: co, disponivelTransferir: 0, compraLiquida: co, doadoras: [] };
  }
  const disponivel = Math.min(co, Math.round(entry.totalTransferivel));

  // Apara as doadoras para somarem exatamente `disponivel` (a compra original pode ser menor
  // que o total transferível da rede). Prioriza a Matriz (depósito) e depois maior excedente.
  const ordenadas = [...entry.doadoras].sort((a, b) => {
    if (a.isMatriz !== b.isMatriz) return a.isMatriz ? -1 : 1;
    return b.quantidade - a.quantidade;
  });
  const doadoras: TransferLensDoadora[] = [];
  let restante = disponivel;
  for (const d of ordenadas) {
    if (restante <= 0) break;
    const q = Math.min(Math.round(d.quantidade), restante);
    if (q > 0) {
      doadoras.push({ ...d, quantidade: q });
      restante -= q;
    }
  }

  return {
    compraOriginal: co,
    disponivelTransferir: disponivel,
    compraLiquida: Math.max(0, co - disponivel),
    doadoras,
  };
}
