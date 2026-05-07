"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { getActiveFilial, resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { ProdutoTransferencia, FilialData } from "@/lib/repositories/controleTransferencias";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import { useAuth } from "@/components/auth/AuthContext";
import { exportTransfersToPDF } from "./exportToPDF";

import styles from "./ControleTransferenciasTable.module.css";

export interface ControleTransferenciasFilialApi {
  codFilial: string;
  filial: string;
}

export interface ControleTransferenciasPermissao {
  username: string;
  filiaisOrigem: string[];
  filiaisDestino: string[];
  filiaisDestinoControle?: string[];
  tiposRomaneioPermitidos: string[];
  responsavelPadrao?: string;
  tipoRomaneioPadrao?: string;
  responsavelFixo: boolean;
  tipoRomaneioFixo: boolean;
  podeVerOutrasFiliais?: boolean;
  filialAtribuida?: string | null;
}
type CurvaABC = 'A' | 'B' | 'C';
type UrgenciaDestinoStatus = "CRITICO" | "ALTO" | "MEDIO" | "OK";

interface TransferByOrigin {
  origem: string;
  items: TransferItem[];
  totalItens: number;
  totalQuantidade: number;
}

interface ControleTransferenciasTableProps {
  companyKey: CompanyKey;
  data: ProdutoTransferencia[];
  loading?: boolean;
  dateRange?: DateRangeValue;
  selectedFilial?: string | null;
  /** Carregados uma vez na página — evita GET duplicado em /permissoes e /filiais */
  permissoes: ControleTransferenciasPermissao | null;
  filiaisApi: ControleTransferenciasFilialApi[];
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

interface TransferItem {
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

/** Chave estável do item para marcar como "realizada" (persiste só em produção). */
function getTransferItemKey(item: TransferItem): string {
  return `${item.produto}|${item.cor}|${item.origem}|${item.destino}`;
}


function isBlockedDestinationFilial(filial: string): boolean {
  const normalized = (filial || "").trim().toUpperCase();
  return normalized.includes("IBIRAPUERA");
}

function isMainMatrizFilial(companyKey: CompanyKey, filial: string): boolean {
  const norm = (filial || "").trim().toUpperCase();
  if (!norm) return false;
  if (companyKey === "nerd") return norm === "NERD";
  if (companyKey === "scarfme") return norm === "SCARF ME - MATRIZ";
  return false;
}

function getFilialData(
  item: ProdutoTransferencia,
  company: ReturnType<typeof resolveCompany> | null | undefined,
  filialCanonico?: string | null,
  filialLabel?: string | null
): FilialData | undefined {
  const canonico = (filialCanonico || "").trim().toUpperCase();
  const label = (filialLabel || "").trim().toUpperCase();

  if (canonico) {
    const byCanonico = item.filiais.find(
      (f) => (f.filial || "").trim().toUpperCase() === canonico
    );
    if (byCanonico) return byCanonico;
  }

  if (label) {
    const byDisplay = item.filiais.find((f) => {
      const filialDisplayName = company?.filialDisplayNames?.[f.filial] || f.filial;
      return (filialDisplayName || "").trim().toUpperCase() === label;
    });
    if (byDisplay) return byDisplay;

    return item.filiais.find(
      (f) => (f.filial || "").trim().toUpperCase() === label
    );
  }

  return undefined;
}

function aggregateLogicalStock(filiais: FilialData[]): number {
  const positiveStock = filiais.reduce((sum, filial) => sum + Math.max(0, filial.stock), 0);
  if (positiveStock > 0) return positiveStock;
  return filiais.reduce((sum, filial) => sum + filial.stock, 0);
}

/**
 * Formata a descrição do produto com código
 */
function formatProductDescription(descricao: string, produto: string): {
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
const DIAS_PARADA_COBERTURA = 15;
const JANELA_PROTECAO_COM_POTENCIAL = 15;
const JANELA_PROTECAO_SEM_POTENCIAL = 7;
const DIAS_RESERVA_COM_POTENCIAL = 7;
const DIAS_RESERVA_SEM_POTENCIAL = 3;

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
function calcDiasCobertura(demandaDiaria: number): number {
  return Math.max(5, Math.min(12, 10 - demandaDiaria * 5));
}

/**
 * Cobertura alvo com boost para Curva A.
 * Produtos campeões (curva A) mantêm mínimo de 7 dias — nunca podem faltar.
 */
function calcDiasAlvo(demandaDiaria: number, curva: CurvaABC): number {
  const base = calcDiasCobertura(demandaDiaria);
  return curva === 'A' ? Math.max(base, 7) : base;
}

function applyClusterCoverageBias(baseDiasAlvo: number, cluster: StoreCluster): number {
  if (cluster === "alto") return Math.max(4, baseDiasAlvo - 1);
  if (cluster === "baixo") return Math.min(14, baseDiasAlvo + 1);
  return baseDiasAlvo;
}

function getFilialLeadTimeDays(
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

function getCurvaPeso(curva: CurvaABC): number {
  if (curva === "A") return 1.4;
  if (curva === "B") return 1.15;
  return 1;
}

function getUrgenciaDestinoStatus(coberturaDias: number): UrgenciaDestinoStatus {
  if (coberturaDias <= 0) return "CRITICO";
  if (coberturaDias <= 2) return "ALTO";
  if (coberturaDias <= 5) return "MEDIO";
  return "OK";
}

function getUrgenciaDestinoPeso(status: UrgenciaDestinoStatus): number {
  if (status === "CRITICO") return 3;
  if (status === "ALTO") return 2;
  if (status === "MEDIO") return 1;
  return 0;
}

function origemTemPotencial(filial: FilialData): boolean {
  return filial.salesLast30Days > 0 || filial.vendas60d > 0 || filial.vendas12m > 0;
}

function getJanelaProtecaoDias(temPotencial: boolean): number {
  return temPotencial ? JANELA_PROTECAO_COM_POTENCIAL : JANELA_PROTECAO_SEM_POTENCIAL;
}

function getDiasDesdeEntrada(
  ultimaEntrada: Date | string | null | undefined,
  dataReferencia: Date
): number | null {
  if (!ultimaEntrada) return null;

  const dataEntrada = new Date(ultimaEntrada);
  if (Number.isNaN(dataEntrada.getTime())) return null;

  const diffMs = dataReferencia.getTime() - dataEntrada.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function getReservaMinimaOrigem(diaria: number, temPotencial: boolean): number {
  const diasReserva = temPotencial ? DIAS_RESERVA_COM_POTENCIAL : DIAS_RESERVA_SEM_POTENCIAL;
  return Math.max(1, Math.ceil(diaria * diasReserva));
}

function origemClaramenteParada(filial: FilialData, coberturaDias: number): boolean {
  return (
    Math.max(0, filial.stock) > 0 &&
    filial.salesLast30Days === 0 &&
    filial.vendas60d <= 1 &&
    filial.vendas12m <= 3 &&
    coberturaDias >= 7
  );
}

function fmtDiasPt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function fmtUnPt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

function fmtDiariaPt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function unidadesPt(n: number): string {
  const r = Math.round(n);
  if (r === 1) return "1 unidade";
  return `${fmtUnPt(n)} unidades`;
}

function textoEstoqueDestino(coberturaDias: number): string {
  if (coberturaDias < 0.75) return "estoque quase zero";
  if (coberturaDias < 2) return `estoque muito baixo (~${fmtDiasPt(coberturaDias)} dias)`;
  return `estoque ~${fmtDiasPt(coberturaDias)} dias`;
}

/** Rótulo curto para o cabeçalho do tooltip de quantidade. */
function curvaLabelCurto(curva: CurvaABC): string {
  if (curva === "A") return "Prioritário";
  if (curva === "B") return "Normal";
  return "Menor prioridade";
}

type StoreCluster = "alto" | "medio" | "baixo";

/**
 * Demanda diária com piso adaptativo ao histórico anual.
 * Evita cobertura explosiva para produtos de cauda longa sem travar com valor fixo.
 *
 *   piso = max(mensal/30, m12/60, 0.05)
 *   → m12/60: adapta ao ritmo histórico real (não força 0.1 para produto que vende 1x/mês)
 *   → 0.05: floor absoluto contra divisão por zero
 */
function calcDiaria(demandaMensal: number, vendas12m: number): number {
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
function calcDemandaPonderada(
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
function organizeFiliais(
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
 * Mesma lógica da versão antiga, mas otimizada
 */
export function calculateTransfers(
  data: ProdutoTransferencia[],
  companyKey: CompanyKey,
  dateRange?: DateRangeValue
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
        reservaMinima: getReservaMinimaOrigem(diaria, temPotencial),
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

    // --- 3. Origens: filiais com excedente > 0 ---
    const filiaisComEstoque = item.filiais
      .filter(f => {
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

interface TransferByDestinationGroup {
  destino: string;
  items: TransferItem[];
  totalQuantidade: number;
}

const QTT_STATUS_LABEL: Record<UrgenciaDestinoStatus, string> = {
  CRITICO: "Crítico",
  ALTO: "Alto",
  MEDIO: "Médio",
  OK: "OK",
};

const QTT_STATUS_STYLE: Record<UrgenciaDestinoStatus, string> = {
  CRITICO: "qttStatusCritico",
  ALTO: "qttStatusAlto",
  MEDIO: "qttStatusMedio",
  OK: "qttStatusOk",
};

function QuantidadeTransferenciaTooltipBody({
  chunks,
  quantidadeSugerida,
  quantidadeExibida,
  ajustadaPorEstoqueReal,
  destinoCanonicoAtual,
}: {
  chunks: QuantidadeExplicacaoChunk[] | undefined;
  quantidadeSugerida: number;
  quantidadeExibida: number;
  ajustadaPorEstoqueReal: boolean;
  destinoCanonicoAtual?: string;
}) {
  const first = chunks?.[0];

  if (!first) {
    return (
      <div className={styles.qttSimple}>
        <div className={styles.qttHeaderRow}>
          <span className={styles.qttEnviarPrincipal}>
            Enviar <strong>{unidadesPt(quantidadeSugerida)}</strong>
          </span>
        </div>
        <p className={styles.qttLeadMuted}>Estimativa a partir de estoque e vendas por loja.</p>
        {ajustadaPorEstoqueReal && (
          <footer className={styles.qttCardFooter}>
            Estoque real: <strong>{unidadesPt(quantidadeExibida)}</strong>
          </footer>
        )}
      </div>
    );
  }

  const d = first.destino;
  const regra = first.regra;
  const escassez = d.fatorEscassez < 0.999 && d.metaTransferencia < d.necessidadeIntegral;
  const roteiro = chunks.find((c) => c.roteiroDestinosParaEstaOrigem?.length)?.roteiroDestinosParaEstaOrigem;
  const canonAtual = (destinoCanonicoAtual || "").trim().toUpperCase();
  const enviaTotalLinha = chunks.reduce((s, c) => s + c.esteEnvio.enviado, 0);

  const roteiroPorLabel = roteiro
    ? Array.from(
        roteiro.reduce((acc, r) => {
          const k = (r.destinoLabel || "").trim().toUpperCase();
          const prev = acc.get(k);
          const isAtual = (r.destinoCanonico || "").trim().toUpperCase() === canonAtual;
          if (prev) {
            prev.quantidade += r.quantidade;
            prev.isAtual = prev.isAtual || isAtual;
          } else {
            acc.set(k, { ordem: r.ordem, destinoLabel: r.destinoLabel, quantidade: r.quantidade, isAtual });
          }
          return acc;
        }, new Map<string, { ordem: number; destinoLabel: string; quantidade: number; isAtual: boolean }>())
        .values()
      )
      .sort((a, b) => a.ordem - b.ordem)
      .map((r, i) => ({ ...r, ordem: i + 1 }))
    : [];

  const statusDestino = regra.statusDestino ?? "MEDIO";
  const reservaOrigem = regra.reservaOrigem ?? 1;
  const estoqueOrigem = first.origem.estoqueNaOrigem;
  const disponivelLinha = Math.ceil(first.origem.excedenteDisponivel);

  return (
    <div className={styles.qttSimple}>

      {/* Cabeçalho */}
      <div className={styles.qttHeaderRow}>
        <span className={styles.qttCurvaTag}>Curva {first.curva} · {curvaLabelCurto(first.curva)}</span>
        <span className={styles.qttEnviarPrincipal}>
          {"→"} <strong>{unidadesPt(enviaTotalLinha)}</strong>
        </span>
      </div>

      {/* Destino */}
      <section className={styles.qttSection}>
        <div className={styles.qttSectionHead}>
          <span className={styles.qttSectionTitle}>Destino</span>
          <span className={`${styles.qttStatusBadge} ${styles[QTT_STATUS_STYLE[statusDestino]]}`}>
            {QTT_STATUS_LABEL[statusDestino]}
          </span>
        </div>
        <div className={styles.qttRow}>
          <span>Cobertura atual</span>
          <span>{fmtDiasPt(d.coberturaDias)} dias</span>
        </div>
        <div className={styles.qttRow}>
          <span>Alvo</span>
          <span>{fmtDiasPt(d.diasAlvo)} dias</span>
        </div>
        <div className={`${styles.qttRow} ${styles.qttRowStrong}`}>
          <span>Precisa</span>
          <strong>{fmtUnPt(Math.ceil(d.necessidadeIntegral))} un.</strong>
        </div>
      </section>

      {/* Origem */}
      <section className={styles.qttSection}>
        <div className={styles.qttSectionHead}>
          <span className={styles.qttSectionTitle}>Origem</span>
          {regra.origemTemPotencial !== undefined && (
            <span className={styles.qttPotencialTag}>
              {regra.origemTemPotencial ? "com histórico" : "sem histórico"}
            </span>
          )}
        </div>
        <div className={styles.qttRow}>
          <span>Em estoque</span>
          <span>{fmtUnPt(estoqueOrigem)} un.</span>
        </div>
        <div className={styles.qttRow}>
          <span>Reserva mínima</span>
          <span>{fmtUnPt(reservaOrigem)} un.</span>
        </div>
        <div className={`${styles.qttRow} ${styles.qttRowStrong}`}>
          <span>Disponível</span>
          <strong>{fmtUnPt(disponivelLinha)} un.</strong>
        </div>
        {regra.diasDesdeEntrada != null && (
          <div className={`${styles.qttRow} ${styles.qttRowNote}`}>
            <span>
              {regra.quebraProtecao
                ? "Proteção quebrada"
                : regra.protecaoAtiva
                ? "Dentro da janela"
                : "Janela expirada"}
            </span>
            <span>{regra.diasDesdeEntrada}d / {regra.janelaProtecaoDias}d</span>
          </div>
        )}
      </section>

      {/* Roteiro desta origem */}
      {roteiroPorLabel.length > 0 && (
        <section className={styles.qttSection}>
          <div className={styles.qttSectionHead}>
            <span className={styles.qttSectionTitle}>Destinos desta origem</span>
          </div>
          {roteiroPorLabel.map((rot) => (
            <div
              key={`${rot.destinoLabel}-${rot.ordem}`}
              className={`${styles.qttRow} ${rot.isAtual ? styles.qttRowAtual : ""}`}
            >
              <span>{rot.destinoLabel}</span>
              <span>
                {rot.quantidade} un.
                {rot.isAtual && <span className={styles.qttAtualTag}>esta linha</span>}
              </span>
            </div>
          ))}
        </section>
      )}

      {/* Múltiplos trechos */}
      {chunks.length > 1 && (
        <section className={styles.qttSection}>
          <div className={styles.qttSectionHead}>
            <span className={styles.qttSectionTitle}>Trechos</span>
          </div>
          {chunks.map((c, i) => (
            <div key={`trecho-${i}`} className={styles.qttRow}>
              <span>Trecho {i + 1}</span>
              <span>
                min({fmtUnPt(c.esteEnvio.faltava)}, {fmtUnPt(Math.ceil(c.origem.excedenteDisponivel))}) = {fmtUnPt(c.esteEnvio.enviado)}
              </span>
            </div>
          ))}
        </section>
      )}

      {/* Rateio por escassez */}
      {escassez && (
        <div className={styles.qttNota}>
          Rateio: <strong>{Math.round(d.fatorEscassez * 100)}%</strong> da necessidade — estoque insuficiente para cobrir todos os destinos.
        </div>
      )}

      {/* Estoque real sobreposto */}
      {ajustadaPorEstoqueReal && (
        <footer className={styles.qttCardFooter}>
          Estoque real: <strong>{unidadesPt(quantidadeExibida)}</strong>
          <span className={styles.qttFooterSep}>·</span>
          sugestão: <strong>{unidadesPt(quantidadeSugerida)}</strong>
        </footer>
      )}
    </div>
  );
}

export default function ControleTransferenciasTable({
  companyKey,
  data,
  loading,
  dateRange,
  selectedFilial,
  permissoes,
  filiaisApi,
}: ControleTransferenciasTableProps) {
  const company = resolveCompany(companyKey);

  /** Só depende de dados + período — evita recalcular algoritmo inteiro ao trocar só a filial de origem na UI. */
  const transfersAllOrigins = useMemo(
    () => calculateTransfers(data, companyKey, dateRange),
    [data, companyKey, dateRange]
  );

  // Agrupar por origem, e dentro de cada origem, agrupar por destino
  const transfersByOriginAndDestination = useMemo(() => {
    let filteredTransfers = transfersAllOrigins;
    if (selectedFilial) {
      const selectedFilialDisplayName = company?.filialDisplayNames?.[selectedFilial] || selectedFilial;
      filteredTransfers = transfersAllOrigins.filter(
        (group) =>
          group.origem === selectedFilial || group.origem === selectedFilialDisplayName
      );
    }

    const transferGroups = filteredTransfers.map((group) => {
      // Agrupar itens por destino dentro desta origem
      const itemsByDest = new Map<string, TransferItem[]>();
      
      group.items.forEach(item => {
        if (!itemsByDest.has(item.destino)) {
          itemsByDest.set(item.destino, []);
        }
        itemsByDest.get(item.destino)!.push(item);
      });
      
      // Converter para array de grupos por destino
      const destinationGroups: TransferByDestinationGroup[] = Array.from(itemsByDest.entries())
        .map(([destino, items]) => {
          const totalQuantidade = items.reduce((sum, item) => sum + item.quantidade, 0);
          return {
            destino,
            items: items.sort((a, b) => {
              // Ordenar por estoque da origem (maior primeiro), depois por produto, depois por cor
              const estoqueA = (() => {
                const filialOrigemData = a.itemOriginal.filiais.find(
                  f => {
                    const filialDisplayName = company?.filialDisplayNames?.[f.filial] || f.filial;
                    return f.filial === a.origem || filialDisplayName === a.origem;
                  }
                );
                return filialOrigemData?.stock || 0;
              })();
              
              const estoqueB = (() => {
                const filialOrigemData = b.itemOriginal.filiais.find(
                  f => {
                    const filialDisplayName = company?.filialDisplayNames?.[f.filial] || f.filial;
                    return f.filial === b.origem || filialDisplayName === b.origem;
                  }
                );
                return filialOrigemData?.stock || 0;
              })();
              
              // Ordenar por estoque decrescente
              if (estoqueA !== estoqueB) {
                return estoqueB - estoqueA;
              }
              
              // Se estoque igual, ordenar por produto, depois por cor
              if (a.produto !== b.produto) {
                return a.produto.localeCompare(b.produto);
              }
              return a.cor.localeCompare(b.cor);
            }),
            totalQuantidade,
          };
        })
        .sort((a, b) => {
          // Ordenar destinos alfabeticamente
          return a.destino.localeCompare(b.destino);
        });
      
      return {
        ...group,
        destinationGroups,
      };
    });
    return transferGroups;
  }, [transfersAllOrigins, selectedFilial, company]);

  const [markedKeys, setMarkedKeys] = useState<Set<string>>(new Set());
  const [savingMarked, setSavingMarked] = useState(false);

  // Quantidades reais (Neon): item_key -> quantidade
  const [quantidadesReais, setQuantidadesReais] = useState<Record<string, number>>({});
  const [savingQuantidadeReal, setSavingQuantidadeReal] = useState(false);
  const [editingQuantidadeRealKey, setEditingQuantidadeRealKey] = useState<string | null>(null);
  const [inputQuantidadeReal, setInputQuantidadeReal] = useState("");
  const [hoveredCorTooltip, setHoveredCorTooltip] = useState<{ itemKey: string; codigoCor: string } | null>(null);
  const [quantidadeTooltip, setQuantidadeTooltip] = useState<{
    chunks: QuantidadeExplicacaoChunk[] | undefined;
    quantidadeSugerida: number;
    quantidadeExibida: number;
    ajustadaPorEstoqueReal: boolean;
    destinoCanonicoAtual?: string;
    x: number;
    y: number;
  } | null>(null);
  const quantidadeTooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { user } = useAuth();

  const filialToCodMap = useMemo(() => {
    const map = new Map<string, string>();
    filiaisApi.forEach((f) => {
      const key = (f.filial || "").trim();
      const cod = (f.codFilial || "").trim();
      if (key && cod) {
        map.set(key, cod);
        map.set(key.toUpperCase(), cod);
        map.set(cod, cod);
        const keyLower = key.toLowerCase();
        if (key !== keyLower) map.set(keyLower, cod);
      }
    });
    if (company) {
      const allCanonical = new Set<string>();
      (company.filialFilters?.inventory ?? []).forEach((x) => allCanonical.add((x || "").trim()));
      Object.entries(company.filialDisplayNames ?? {}).forEach(([k, v]) => {
        allCanonical.add((k || "").trim());
        if (v) allCanonical.add((v || "").trim());
      });
      allCanonical.forEach((canon) => {
        if (!canon) return;
        const found = filiaisApi.find(
          (fi) => (fi.filial || "").trim().toUpperCase() === canon.toUpperCase()
        );
        if (found?.codFilial) map.set(canon, found.codFilial.trim());
      });
      Object.entries(company.filialDisplayNames ?? {}).forEach(([displayName, actualName]) => {
        const dn = (displayName || "").trim();
        const an = (actualName || "").trim();
        if (!dn || !an) return;
        const codForActual = map.get(an) ?? map.get(an.toUpperCase());
        if (codForActual) map.set(dn, codForActual);
      });
    }
    return map;
  }, [filiaisApi, company]);

  const getCodFilial = useCallback(
    (canonico: string): string | null => {
      const k = canonico.trim();
      const active = getActiveFilial(company, k);
      return filialToCodMap.get(active) ??
        filialToCodMap.get(active.toUpperCase()) ??
        filialToCodMap.get(k) ??
        filialToCodMap.get(k.toUpperCase()) ??
        null;
    },
    [filialToCodMap, company]
  );

  /** Verifica se um valor de permissão corresponde à filial (origem ou destino).
   * permValue = codFilial (ex: "000001") armazenado nas permissões.
   * filialCanonico = nome canônico da filial no item (ex: "NERD", "NERD CENTER NORTE").
   */
  const permissaoMatchFilial = useCallback(
    (permValue: string, filialCanonico: string): boolean => {
      const perm = (permValue || "").trim();
      const canon = getActiveFilial(company, (filialCanonico || "").trim());
      if (!perm || !canon) return false;
      const cod = getCodFilial(filialCanonico);
      if (cod && perm === cod) return true;
      const filialFromPerm = filiaisApi.find((f) => (f.codFilial || "").trim() === perm);
      if (filialFromPerm) {
        const fn = getActiveFilial(company, (filialFromPerm.filial || "").trim());
        return fn === canon || fn.toUpperCase() === canon.toUpperCase();
      }
      const activePerm = getActiveFilial(company, perm);
      return activePerm === canon || activePerm.toUpperCase() === canon.toUpperCase();
    },
    [getCodFilial, filiaisApi, company]
  );

  const filteredTransfersByOriginAndDestination = useMemo(() => {
    if (user?.role === "admin") return transfersByOriginAndDestination;
    if (!permissoes || filiaisApi.length === 0) return [];
    if (permissoes.podeVerOutrasFiliais) return transfersByOriginAndDestination;
    // Destinos visíveis: usa filiaisDestinoControle (visualização no controle de transferências).
    // Vazio = todos os destinos visíveis.
    const destinosVisiveis = permissoes.filiaisDestinoControle ?? [];
    // Origem visível: apenas a filial atribuída ao usuário (filialAtribuida).
    // filiaisOrigem é para permissão de execução de saídas, não para filtrar origens no controle.
    const filialAtribuida = permissoes.filialAtribuida?.trim() || null;
    return transfersByOriginAndDestination
      .filter((group) => {
        const origemCanonico = group.items[0]?.origemCanonico ?? group.origem;
        const origemOk =
          !filialAtribuida ||
          permissaoMatchFilial(filialAtribuida, origemCanonico);
        return origemOk;
      })
      .map((group) => ({
        ...group,
        destinationGroups: group.destinationGroups.filter((dg) => {
          const destinoCanonico = dg.items[0]?.destinoCanonico ?? dg.destino;
          const destinoOk =
            destinosVisiveis.length === 0 ||
            destinosVisiveis.some((p) => permissaoMatchFilial(p, destinoCanonico));
          return destinoOk;
        }),
      }))
      .filter((group) => group.destinationGroups.length > 0);
  }, [
    transfersByOriginAndDestination,
    user?.role,
    permissoes,
    permissaoMatchFilial,
    filiaisApi.length,
  ]);

  const { visibleItemKeys, visibleItemKeysSig } = useMemo(() => {
    const set = new Set<string>();
    filteredTransfersByOriginAndDestination.forEach((group) => {
      group.destinationGroups.forEach((dg) => {
        dg.items.forEach((item) => set.add(getTransferItemKey(item)));
      });
    });
    const sig = [...set].sort().join("|");
    return { visibleItemKeys: set, visibleItemKeysSig: sig };
  }, [filteredTransfersByOriginAndDestination]);


  // Carregar marcações da API (Neon + Redis com migração automática)
  // IMPORTANTE: Carregamos TODOS os dados salvos, não apenas os visíveis.
  // Isso garante que dados não sejam perdidos quando itens saem da lista.
  // Apenas mostramos como marcados os itens que estão visíveis E salvos.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/transferencias-realizadas?company=${encodeURIComponent(companyKey)}`);
        if (!active) return;
        if (!res.ok) return;
        const json = await res.json();
        const stored: string[] = Array.isArray(json.markedKeys) ? json.markedKeys : [];
        // Filtrar apenas os visíveis para exibição, mas manter todos salvos no backend
        const visible = visibleItemKeys;
        const filtered = stored.filter((k) => visible.has(k));
        setMarkedKeys(new Set(filtered));
      } catch {
        if (active) setMarkedKeys(new Set());
      }
    })();
    return () => {
      active = false;
    };
  }, [companyKey, visibleItemKeysSig]);

  // Carregar quantidades reais da API (Neon)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/transferencias-quantidade-real?company=${encodeURIComponent(companyKey)}`);
        if (!active) return;
        if (!res.ok) return;
        const json = await res.json();
        const stored = json.quantidadesReais && typeof json.quantidadesReais === "object" ? json.quantidadesReais : {};
        setQuantidadesReais(stored);
      } catch {
        if (active) setQuantidadesReais({});
      }
    })();
    return () => { active = false; };
  }, [companyKey]);

  const saveQuantidadeReal = async (itemKey: string, value: number | null) => {
    setSavingQuantidadeReal(true);
    try {
      await fetch("/api/transferencias-quantidade-real", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyKey, updates: { [itemKey]: value } }),
      });
      setQuantidadesReais((prev) => {
        const next = { ...prev };
        if (value === null) delete next[itemKey];
        else next[itemKey] = value;
        return next;
      });
      setEditingQuantidadeRealKey(null);
      setInputQuantidadeReal("");
    } finally {
      setSavingQuantidadeReal(false);
    }
  };

  const toggleMarked = async (item: TransferItem) => {
    const key = getTransferItemKey(item);
    const isCurrentlyMarked = markedKeys.has(key);
    const next = new Set(markedKeys);
    
    // Atualizar estado local imediatamente
    if (isCurrentlyMarked) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setMarkedKeys(next);
    
    setSavingMarked(true);
    try {
      // Usar a nova API que faz merge - adiciona/remove apenas este item específico
      // Isso preserva todos os outros dados, mesmo os que não estão visíveis
      await fetch("/api/transferencias-realizadas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          companyKey, 
          markedKeys: isCurrentlyMarked ? [] : [key], // Adicionar apenas se não estava marcado
          removeKeys: isCurrentlyMarked ? [key] : []  // Remover apenas se estava marcado
        }),
      });
    } finally {
      setSavingMarked(false);
    }
  };

  const [hoveredItem, setHoveredItem] = useState<TransferItem | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (quantidadeTooltipTimeoutRef.current) {
        clearTimeout(quantidadeTooltipTimeoutRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (filteredTransfersByOriginAndDestination.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>
          {selectedFilial 
            ? `Nenhuma transferência necessária para ${company?.filialDisplayNames?.[selectedFilial] || selectedFilial} no momento.`
            : "Nenhuma transferência necessária no momento."}
        </div>
      </div>
    );
  }

  // Função para exportar PDF
  const handleExportPDF = () => {
    // Preparar dados para exportação incluindo estoqueOrigem
    const dataForExport = filteredTransfersByOriginAndDestination.map((group) => ({
      origem: group.origem,
      totalQuantidade: group.totalQuantidade,
      destinationGroups: group.destinationGroups.map((destGroup) => ({
        destino: destGroup.destino,
        totalQuantidade: destGroup.totalQuantidade,
        items: destGroup.items.map((item) => {
          // Buscar estoque da origem
          const filialOrigemData = getFilialData(
            item.itemOriginal,
            company,
            item.origemCanonico,
            item.origem
          );
          return {
            produto: item.produto,
            descricao: item.descricao,
            codigo: item.codigo,
            codigoBarra: item.codigoBarra,
            subgrupo: item.subgrupo,
            grade: item.grade,
            cor: item.cor,
            origem: item.origem,
            destino: item.destino,
            quantidade: item.quantidade,
            estoqueOrigem: filialOrigemData?.stock || 0,
          };
        }),
      })),
    }));

    exportTransfersToPDF(dataForExport, companyKey, dateRange, markedKeys, quantidadesReais);
  };

  return (
    <div className={styles.wrapper}>
      {/* Botão de exportar PDF */}
      <div className={styles.exportButtonContainer}>
        <button onClick={handleExportPDF} className={styles.exportButton}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.5 12.5V15.8333C17.5 16.2754 17.3244 16.6993 17.0118 17.0118C16.6993 17.3244 16.2754 17.5 15.8333 17.5H4.16667C3.72464 17.5 3.30072 17.3244 2.98816 17.0118C2.67559 16.6993 2.5 16.2754 2.5 15.8333V12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14.1667 6.66667L10 2.5L5.83333 6.66667" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 2.5V12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Exportar PDF
        </button>
      </div>

      {filteredTransfersByOriginAndDestination.map((group) => (
        <div key={group.origem} className={styles.transferGroup}>
          {/* Header principal: Filial de origem */}
          <div className={styles.header}>
            <div className={styles.originInfo}>
              <div className={styles.originIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 21H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M5 21V7L13 2L21 7V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 9V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M15 9V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div className={styles.originText}>
                <div className={styles.originName}>{group.origem}</div>
                <div className={styles.originLabel}>Filial de origem</div>
              </div>
            </div>
            <div className={styles.totalBox}>
              <div className={styles.totalLabel}>Total de itens</div>
              <div className={styles.totalValue}>{group.totalQuantidade}</div>
            </div>
          </div>

          {/* Grupos por destino dentro desta origem */}
          {group.destinationGroups.map((destGroup, destIndex) => (
            <div key={`${group.origem}-${destGroup.destino}-${destIndex}`} className={styles.destinationSection}>
              {/* Header menor: Filial de destino */}
              <div className={styles.destinationHeader}>
                <div className={styles.destinationInfo}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.destinationIcon}>
                    <path d="M16.6667 10L10 3.33333M10 3.33333L3.33333 10M10 3.33333V16.6667" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <div className={styles.destinationText}>
                    <span className={styles.destinationLabel}>Transferir para</span>
                    <span className={styles.destinationName}>{destGroup.destino}</span>
                  </div>
                </div>
                <div className={styles.destinationTotal}>
                  {destGroup.totalQuantidade} un
                </div>
              </div>

              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.realizadaHeader} title="Marcar como já realizada (pendente de atualização no sistema)">
                      Realizada
                    </th>
                    <th className={styles.produtoHeader}>Produto</th>
                    <th className={styles.codigoBarraHeader}>Código de Barras</th>
                    <th className={styles.estoqueHeader}>Estoque {group.origem}</th>
                    <th className={styles.quantidadeRealHeader}>Estoque real</th>
                    {companyKey === 'scarfme' && (
                      <>
                        <th className={styles.subgrupoHeader}>Subgrupo</th>
                        <th className={styles.gradeHeader}>Grade</th>
                      </>
                    )}
                    <th className={styles.descricaoHeader}>Descrição</th>
                    <th className={styles.corHeader}>Cor</th>
                    <th className={styles.destinoHeader}>Destino</th>
                    <th className={styles.quantidadeHeader}>Quantidade</th>
                  </tr>
                </thead>
                <tbody>
                  {destGroup.items.map((item, index) => {
                    // Buscar estoque atual da filial origem
                    const filialOrigemData = getFilialData(
                      item.itemOriginal,
                      company,
                      item.origemCanonico,
                      item.origem
                    );
                    const estoqueOrigem = filialOrigemData?.stock || 0;
                    
                    // Calcular altura do tooltip baseada no número de filiais deste item
                    const numFiliais = item.itemOriginal.filiais.length;
                    const tooltipHeightEstimate = Math.min(700, 100 + (numFiliais * 28));
                    const itemKey = getTransferItemKey(item);
                    const isMarkedRealizada = markedKeys.has(itemKey);
                    
                    // Calcular quantidade ajustada baseada no estoque real
                    const estoqueReal = quantidadesReais[itemKey];
                    const temEstoqueReal = estoqueReal !== undefined && estoqueReal !== null;
                    
                    // Apenas as matrizes principais (NERD e SCARF ME - MATRIZ) podem enviar tudo.
                    const isMatriz =
                      isMainMatrizFilial(companyKey, item.origemCanonico) ||
                      isMainMatrizFilial(companyKey, filialOrigemData?.filial ?? "") ||
                      isMainMatrizFilial(companyKey, item.origem);
                    
                    // Verificar se está parada há 14+ dias
                    let isParada = false;
                    if (filialOrigemData) {
                      const estoquePositivo = Math.max(0, filialOrigemData.stock);
                      if (estoquePositivo >= 1 && filialOrigemData.sales === 0 && filialOrigemData.salesLast30Days === 0) {
                        if (filialOrigemData.ultimaEntrada) {
                          const hoje = new Date();
                          const dataUltimaEntrada = new Date(filialOrigemData.ultimaEntrada);
                          const diasDesdeUltimaEntrada = Math.floor((hoje.getTime() - dataUltimaEntrada.getTime()) / (1000 * 60 * 60 * 24));
                          if (diasDesdeUltimaEntrada >= 14) {
                            isParada = true;
                          }
                        } else {
                          // Se não há data de entrada, considerar parada (comportamento antigo)
                          isParada = true;
                        }
                      }
                    }
                    
                    // Verificar se pode enviar tudo (matriz ou loja parada há 14+ dias sem vendas)
                    const podeEnviarTudo = isMatriz || (isParada && filialOrigemData?.sales === 0);
                    
                    // Calcular quantidade ajustada baseada no estoque real
                    let quantidadeAjustada = item.quantidade;
                    let quantidadeAfetada = false;
                    
                    if (temEstoqueReal) {
                      if (estoqueReal === 0) {
                        // Se estoque real = 0: quantidade = 0
                        quantidadeAjustada = 0;
                        quantidadeAfetada = true;
                      } else if (estoqueReal === 1) {
                        // Se estoque real = 1
                        if (!podeEnviarTudo) {
                          // Loja não pode enviar tudo: quantidade = 0
                          quantidadeAjustada = 0;
                          quantidadeAfetada = true;
                        } else {
                          // Se pode enviar tudo, quantidade = 1 (sempre limita ao estoque real disponível)
                          quantidadeAjustada = 1;
                          quantidadeAfetada = true; // Sempre afetada quando há estoque real
                        }
                      } else if (estoqueReal < item.quantidade) {
                        // Se estoque real < quantidade original: quantidade = estoque real
                        quantidadeAjustada = estoqueReal;
                        quantidadeAfetada = true;
                      }
                      // Se estoque real >= quantidade original, quantidade mantém igual (não afetada)
                    }

                    const urgenciaStatus = item.quantidadeExplicacao?.[0]?.regra?.statusDestino;

                    return (
                <tr
                  key={`${item.produto}-${item.cor}-${item.destino}-${index}`}
                  className={isMarkedRealizada ? styles.rowRealizada : undefined}
                >
                  <td className={styles.realizadaCell}>
                    <label className={styles.realizadaCheckboxLabel} title="Já realizada, pendente de atualização no sistema">
                      <input
                        type="checkbox"
                        checked={isMarkedRealizada}
                        onChange={() => toggleMarked(item)}
                        disabled={savingMarked}
                        className={styles.realizadaCheckbox}
                      />
                      {isMarkedRealizada && (
                        <span className={styles.realizadaCheckboxText}>Realizada</span>
                      )}
                    </label>
                  </td>
                  <td className={styles.produtoCell}>
                    <div className={styles.produtoIcon}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M6 2V14M10 2V14M2 6H14M2 10H14" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                    </div>
                    {item.codigo}
                  </td>
                  <td className={styles.codigoBarraCell}>
                    {item.codigoBarra ? (
                      <span className={styles.codigoBarraBadge}>{item.codigoBarra}</span>
                    ) : (
                      <span className={styles.codigoBarraEmpty}>-</span>
                    )}
                  </td>
                  <td className={styles.estoqueCell}>
                    <span 
                      className={
                        temEstoqueReal 
                          ? `${styles.estoqueBadge} ${styles.estoqueIgnorado}` 
                          : styles.estoqueBadge
                      }
                    >
                      {estoqueOrigem}
                    </span>
                  </td>
                  <td className={styles.quantidadeRealCell}>
                    {editingQuantidadeRealKey === itemKey ? (
                      <div className={styles.quantidadeRealEditWrap}>
                        <input
                          type="number"
                          min={0}
                          className={styles.quantidadeRealInput}
                          value={inputQuantidadeReal}
                          onChange={(e) => setInputQuantidadeReal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const n = parseInt(inputQuantidadeReal, 10);
                              if (!isNaN(n) && n >= 0) saveQuantidadeReal(itemKey, n);
                            }
                            if (e.key === "Escape") {
                              setEditingQuantidadeRealKey(null);
                              setInputQuantidadeReal("");
                            }
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className={styles.quantidadeRealSaveBtn}
                          disabled={savingQuantidadeReal}
                          onClick={() => {
                            const n = parseInt(inputQuantidadeReal, 10);
                            if (!isNaN(n) && n >= 0) saveQuantidadeReal(itemKey, n);
                          }}
                          title="Salvar"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={styles.quantidadeRealCancelBtn}
                          disabled={savingQuantidadeReal}
                          onClick={() => {
                            setEditingQuantidadeRealKey(null);
                            setInputQuantidadeReal("");
                          }}
                          title="Cancelar"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ) : quantidadesReais[itemKey] !== undefined ? (
                      <div className={styles.quantidadeRealRow}>
                        <span className={styles.quantidadeRealBadge}>{quantidadesReais[itemKey]}</span>
                        <div className={styles.quantidadeRealIcons}>
                          <button
                            type="button"
                            className={styles.quantidadeRealIconBtn}
                            disabled={savingQuantidadeReal}
                            onClick={() => {
                              setEditingQuantidadeRealKey(itemKey);
                              setInputQuantidadeReal(String(quantidadesReais[itemKey]));
                            }}
                            title="Editar estoque real"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className={styles.quantidadeRealIconBtn}
                            disabled={savingQuantidadeReal}
                            onClick={() => saveQuantidadeReal(itemKey, null)}
                            title="Remover estoque real"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={styles.quantidadeRealAddBtn}
                        disabled={savingQuantidadeReal}
                        onClick={() => {
                          setEditingQuantidadeRealKey(itemKey);
                          setInputQuantidadeReal(String(item.quantidade));
                        }}
                        title="Inserir estoque real"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    )}
                  </td>
                  {companyKey === 'scarfme' && (
                    <>
                      <td className={styles.subgrupoCell}>
                        {item.subgrupo ? (
                          <span className={styles.subgrupoBadge}>{item.subgrupo}</span>
                        ) : (
                          <span className={styles.subgrupoEmpty}>-</span>
                        )}
                      </td>
                      <td className={styles.gradeCell}>
                        {item.grade ? (
                          <span className={styles.gradeBadge}>{item.grade}</span>
                        ) : (
                          <span className={styles.gradeEmpty}>-</span>
                        )}
                      </td>
                    </>
                  )}
                  <td 
                    className={styles.descricaoCell}
                    onMouseMove={(e) => {
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                      }
                      const tooltipWidth = 480;
                      const tooltipHeight = tooltipHeightEstimate;
                      const offset = 15;
                      
                      let x = e.clientX + offset;
                      let y = e.clientY + offset;
                      
                      if (x + tooltipWidth > window.innerWidth) {
                        x = e.clientX - tooltipWidth - offset;
                      }
                      
                      if (y + tooltipHeight > window.innerHeight) {
                        y = e.clientY - tooltipHeight - offset;
                      }
                      
                      if (x < 10) x = 10;
                      if (y < 10) y = 10;
                      
                      setTooltipPosition({ x, y });
                      if (!hoveredItem || hoveredItem.produto !== item.produto || hoveredItem.cor !== item.cor) {
                        setHoveredItem(item);
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                      }
                      const tooltipWidth = 480;
                      const tooltipHeight = tooltipHeightEstimate;
                      const offset = 15;
                      
                      let x = e.clientX + offset;
                      let y = e.clientY + offset;
                      
                      if (x + tooltipWidth > window.innerWidth) {
                        x = e.clientX - tooltipWidth - offset;
                      }
                      
                      if (y + tooltipHeight > window.innerHeight) {
                        y = e.clientY - tooltipHeight - offset;
                      }
                      
                      if (x < 10) x = 10;
                      if (y < 10) y = 10;
                      
                      setTooltipPosition({ x, y });
                      setHoveredItem(item);
                    }}
                    onMouseLeave={() => {
                      hoverTimeoutRef.current = setTimeout(() => {
                        setHoveredItem(null);
                      }, 200);
                    }}
                    style={{ cursor: 'help' }}
                  >
                    {item.descricao}
                  </td>
                  <td className={styles.corCell}>
                    <span
                      className={styles.corBadgeWrapper}
                      onMouseEnter={() =>
                        setHoveredCorTooltip({
                          itemKey,
                          codigoCor: item.itemOriginal.codigoCor ?? "—",
                        })
                      }
                      onMouseLeave={() => setHoveredCorTooltip(null)}
                    >
                      <span className={styles.corBadge}>{item.cor}</span>
                      {hoveredCorTooltip?.itemKey === itemKey && (
                        <span className={styles.corCodigoTooltip}>
                          Código: {item.itemOriginal.codigoCor ?? "—"}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={styles.destinoCell}>
                    <span className={styles.destinoBadge}>{item.destino}</span>
                  </td>
                  <td className={styles.quantidadeCell}>
                    <span
                      className={styles.quantidadeBadgeWrap}
                      onMouseEnter={(e) => {
                        if (quantidadeTooltipTimeoutRef.current) {
                          clearTimeout(quantidadeTooltipTimeoutRef.current);
                          quantidadeTooltipTimeoutRef.current = null;
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        setQuantidadeTooltip({
                          chunks: item.quantidadeExplicacao,
                          quantidadeSugerida: item.quantidade,
                          quantidadeExibida: quantidadeAjustada,
                          ajustadaPorEstoqueReal: quantidadeAfetada,
                          destinoCanonicoAtual: item.destinoCanonico,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }}
                      onMouseLeave={() => {
                        quantidadeTooltipTimeoutRef.current = setTimeout(() => {
                          setQuantidadeTooltip(null);
                        }, 180);
                      }}
                    >
                      <span
                        className={
                          quantidadeAfetada && quantidadeAjustada === 0
                            ? `${styles.quantidadeBadge} ${styles.quantidadeZero}`
                            : quantidadeAfetada
                            ? `${styles.quantidadeBadge} ${styles.quantidadeAjustada}`
                            : styles.quantidadeBadge
                        }
                      >
                        {quantidadeAjustada}
                      </span>
                    </span>
                  </td>
                </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          <div className={styles.footer}>
            <div className={styles.footerLeft}>
              {group.totalItens} itens para transferência
            </div>
            <div className={styles.footerRight}>
              Total: <span className={styles.footerTotal}>{group.totalQuantidade}</span>
            </div>
          </div>
        </div>
      ))}

      {quantidadeTooltip ? (
        <div
          className={styles.quantidadeExplicacaoTooltip}
          style={{
            left: `${quantidadeTooltip.x}px`,
            top: `${quantidadeTooltip.y}px`,
          }}
          onMouseEnter={() => {
            if (quantidadeTooltipTimeoutRef.current) {
              clearTimeout(quantidadeTooltipTimeoutRef.current);
              quantidadeTooltipTimeoutRef.current = null;
            }
          }}
          onMouseLeave={() => {
            quantidadeTooltipTimeoutRef.current = setTimeout(() => {
              setQuantidadeTooltip(null);
            }, 120);
          }}
        >
          <QuantidadeTransferenciaTooltipBody
            chunks={quantidadeTooltip.chunks}
            quantidadeSugerida={quantidadeTooltip.quantidadeSugerida}
            quantidadeExibida={quantidadeTooltip.quantidadeExibida}
            ajustadaPorEstoqueReal={quantidadeTooltip.ajustadaPorEstoqueReal}
            destinoCanonicoAtual={quantidadeTooltip.destinoCanonicoAtual}
          />
        </div>
      ) : null}
      
      {/* Tooltip com detalhes do produto */}
      {hoveredItem && (
        <div
          ref={tooltipRef}
          className={styles.tooltip}
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
          }}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
            }
          }}
          onMouseLeave={() => {
            setHoveredItem(null);
          }}
        >
          <div className={styles.tooltipHeader}>
            <div className={styles.tooltipTitle}>{hoveredItem.descricao}</div>
            <div className={styles.tooltipSubtitle}>
              {hoveredItem.codigo} • {hoveredItem.cor}
            </div>
          </div>
          <div className={styles.tooltipContent}>
            <div className={styles.tooltipSection}>
              <div className={styles.tooltipSectionTitle}>Estoque e Vendas por Filial</div>
              {(() => {
                const matriz = companyKey === "nerd" ? "NERD" : companyKey === "scarfme" ? "SCARF ME - MATRIZ" : null;
                const ecommerceFilials = company?.ecommerceFilials ?? [];
                const normalizedEcommerceFilials = ecommerceFilials.map(f => f.trim().toUpperCase());
                
                // Separar filiais normais e e-commerce
                const normalFiliais: typeof hoveredItem.itemOriginal.filiais = [];
                const ecommerceFiliais: typeof hoveredItem.itemOriginal.filiais = [];
                
                hoveredItem.itemOriginal.filiais.forEach(filial => {
                  const normalizedFilial = filial.filial.trim().toUpperCase();
                  if (normalizedEcommerceFilials.includes(normalizedFilial)) {
                    ecommerceFiliais.push(filial);
                  } else {
                    normalFiliais.push(filial);
                  }
                });
                
                // Agregar filiais de e-commerce
                type FilialTooltipItem = (typeof hoveredItem.itemOriginal.filiais)[number] & { displayName?: string };
                let ecommerceAggregated: FilialTooltipItem | null = null;
                if (ecommerceFiliais.length > 0) {
                  const totalStock = aggregateLogicalStock(ecommerceFiliais);
                  const totalSales = ecommerceFiliais.reduce((sum, f) => sum + f.sales, 0);
                  const totalSalesLast30Days = ecommerceFiliais.reduce((sum, f) => sum + f.salesLast30Days, 0);
                  
                  // Pegar a data de entrada mais recente entre todas as filiais de e-commerce
                  const ultimaEntradaEcommerce = ecommerceFiliais
                    .map(f => f.ultimaEntrada)
                    .filter(date => date !== null && date !== undefined)
                    .map(date => new Date(date as Date | string))
                    .filter(date => !isNaN(date.getTime())) // Filtrar datas inválidas
                    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
                  
                  ecommerceAggregated = {
                    filial: 'E-COMMERCE',
                    stock: totalStock,
                    sales: totalSales,
                    salesLast30Days: totalSalesLast30Days,
                    vendas60d: ecommerceFiliais.reduce((s, f) => s + f.vendas60d, 0),
                    vendas12m: ecommerceFiliais.reduce((s, f) => s + f.vendas12m, 0),
                    ultimaEntrada: ultimaEntradaEcommerce,
                  };
                }
                
                // Agrupar filiais que têm o mesmo display name (ex: PAULISTA pode vir de múltiplas filiais)
                const filiaisPorDisplayName = new Map<string, typeof hoveredItem.itemOriginal.filiais>();
                
                normalFiliais.forEach(filial => {
                  const displayName = company?.filialDisplayNames?.[filial.filial] || filial.filial;
                  if (!filiaisPorDisplayName.has(displayName)) {
                    filiaisPorDisplayName.set(displayName, []);
                  }
                  filiaisPorDisplayName.get(displayName)!.push(filial);
                });
                
                // Agregar filiais com mesmo display name
                const filiaisAgregadas: FilialTooltipItem[] = Array.from(filiaisPorDisplayName.entries()).map(([displayName, filiais]) => {
                  if (filiais.length === 1) {
                    // Se só tem uma filial, retornar como está
                    return {
                      ...filiais[0],
                      displayName,
                    };
                  } else {
                    // Se tem múltiplas filiais com mesmo display name, agregar
                    const totalStock = aggregateLogicalStock(filiais);
                    const totalSales = filiais.reduce((sum, f) => sum + f.sales, 0);
                    const totalSalesLast30Days = filiais.reduce((sum, f) => sum + f.salesLast30Days, 0);
                    
                    // Pegar a data de entrada mais recente
                    const ultimaEntradaAgregada = filiais
                      .map(f => f.ultimaEntrada)
                      .filter(date => date !== null && date !== undefined)
                      .map(date => new Date(date as Date | string))
                      .filter(date => !isNaN(date.getTime()))
                      .sort((a, b) => b.getTime() - a.getTime())[0] || null;
                    
                    return {
                      filial: displayName, // Usar display name como identificador
                      stock: totalStock,
                      sales: totalSales,
                      salesLast30Days: totalSalesLast30Days,
                      vendas60d: filiais.reduce((sum, f) => sum + f.vendas60d, 0),
                      vendas12m: filiais.reduce((sum, f) => sum + f.vendas12m, 0),
                      ultimaEntrada: ultimaEntradaAgregada,
                      displayName,
                    };
                  }
                });
                
                // Combinar e ordenar
                const allFiliaisToShow: FilialTooltipItem[] = [
                  ...filiaisAgregadas,
                  ...(ecommerceAggregated ? [ecommerceAggregated] : []),
                ].sort((a, b) => {
                  const filialA = a.displayName || a.filial;
                  const filialB = b.displayName || b.filial;
                  if (filialA === matriz) return -1;
                  if (filialB === matriz) return 1;
                  return filialA.localeCompare(filialB);
                });
                
                return allFiliaisToShow.map((filial) => {
                  const displayName = filial.filial === 'E-COMMERCE' 
                    ? 'E-COMMERCE'
                    : (filial.displayName || company?.filialDisplayNames?.[filial.filial] || filial.filial);
                  // Verificar se está parada há pelo menos 14 dias desde a última entrada
                  let isParada = false;
                  let diasParado: number | null = null;
                  let dataUltimaEntradaFormatada: string | null = null;
                  
                  // SEMPRE formatar a data da última entrada se existir (independente de estar parada ou não)
                  if (filial.ultimaEntrada) {
                    const hoje = new Date();
                    const dataUltimaEntrada = new Date(filial.ultimaEntrada);
                    const diasDesdeUltimaEntrada = Math.floor((hoje.getTime() - dataUltimaEntrada.getTime()) / (1000 * 60 * 60 * 24));
                    
                    // Formatar data da última entrada
                    dataUltimaEntradaFormatada = dataUltimaEntrada.toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    });
                    
                    // Verificar se está parada (estoque >= 1, sem vendas, e última entrada há 14+ dias)
                    if (filial.stock >= 1 && filial.sales === 0 && filial.salesLast30Days === 0 && diasDesdeUltimaEntrada >= 14) {
                      isParada = true;
                      diasParado = diasDesdeUltimaEntrada;
                    }
                  } else if (filial.stock >= 1 && filial.sales === 0 && filial.salesLast30Days === 0) {
                    // Se não há data de entrada, usar o período selecionado como fallback
                    const daysInPeriod = dateRange ? 
                      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;
                    // Se o período for >= 14 dias, considerar parado
                    if (daysInPeriod >= 14) {
                      isParada = true;
                      diasParado = Math.max(14, daysInPeriod);
                    }
                  } else if (filial.stock > 0 && filial.sales === 0 && filial.salesLast30Days > 0) {
                    // Teve vendas nos últimos 30 dias, mas não no período: mostrar dias do período
                    const daysInPeriod = dateRange ? 
                      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;
                    if (daysInPeriod >= 14) {
                      diasParado = daysInPeriod;
                    }
                  }
                  
                  return (
                    <div key={displayName} className={styles.tooltipFilialRow}>
                      <div className={styles.tooltipFilialName}>{displayName}</div>
                      <div className={styles.tooltipFilialData}>
                        <span className={styles.tooltipEstoque}>
                          Est: <strong>{filial.stock}</strong>
                        </span>
                        <span className={styles.tooltipVendas}>
                          Vnd: <strong>{filial.sales}</strong>
                        </span>
                        {dataUltimaEntradaFormatada && (
                          <span className={styles.tooltipUltimaEntrada}>
                            Últ. Entrada: <strong>{dataUltimaEntradaFormatada}</strong>
                          </span>
                        )}
                        {isParada && diasParado !== null && (
                          <span className={styles.tooltipParado}>
                            Parado: <strong>{diasParado}+d</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

