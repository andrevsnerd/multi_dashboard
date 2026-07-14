"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { getActiveFilial, resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { ProdutoTransferencia, FilialData } from "@/lib/repositories/controleTransferencias";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import { useAuth } from "@/components/auth/AuthContext";
import { seesAllFiliais } from "@/lib/auth/permissions";
import { exportTransfersToPDF } from "./exportToPDF";
import TransferenciaConfirmModal from "./TransferenciaConfirmModal";
import RealizadasPanel from "./RealizadasPanel";

import styles from "./ControleTransferenciasTable.module.css";

import {
  calculateTransfers,
} from "@/lib/utils/transferencia-regras";
import type {
  CurvaABC,
  UrgenciaDestinoStatus,
  TransferItem,
  QuantidadeExplicacaoChunk,
} from "@/lib/utils/transferencia-regras";

// Re-export para consumidores externos (ListaLojaPage etc.) — a régua vive na lib agora.
export { calculateTransfers };
export type {
  CurvaABC,
  UrgenciaDestinoStatus,
  TransferByOrigin,
  TransferItem,
  RoteiroDestinoAlocacao,
  QuantidadeExplicacaoChunk,
} from "@/lib/utils/transferencia-regras";

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

interface ControleTransferenciasTableProps {
  companyKey: CompanyKey;
  data: ProdutoTransferencia[];
  loading?: boolean;
  dateRange?: DateRangeValue;
  selectedFilial?: string | null;
  /** Carregados uma vez na página — evita GET duplicado em /permissoes e /filiais */
  permissoes: ControleTransferenciasPermissao | null;
  filiaisApi: ControleTransferenciasFilialApi[];
  /** Chaves do cooldown (origens que mandaram esse produto+cor nos últimos N dias).
   * Carregado em paralelo pela página. Formato: `${produto}|${codigoCor}|${origemUPPER}`. */
  cooldownKeys?: Set<string>;
  /** Contadores de itens em "Realizadas" por (origem|destino). Usado para badges nas tabs. */
  realizadasContadores?: Map<string, number>;
  /** Disparado após uma transferência (saída) ser executada com sucesso. Usado pela página
   * para refazer o fetch de /api/controle-transferencias e refletir o novo estoque. */
  onTransferExecuted?: () => void | Promise<void>;
}


/** Chave estável do item para marcar como "realizada" (persiste só em produção). */
function getTransferItemKey(item: TransferItem): string {
  return `${item.produto}|${item.cor}|${item.origem}|${item.destino}`;
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
  cooldownKeys,
  realizadasContadores,
  onTransferExecuted,
}: ControleTransferenciasTableProps) {
  const company = resolveCompany(companyKey);

  /** Só depende de dados + período + cooldown. Cooldown remove origens que já enviaram
   * esse produto+cor recentemente, evitando sugestões repetidas. */
  const transfersAllOrigins = useMemo(
    () => calculateTransfers(data, companyKey, dateRange, cooldownKeys),
    [data, companyKey, dateRange, cooldownKeys]
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
    // Admin/diretor/supervisor/logística veem todas as transferências.
    if (seesAllFiliais(user?.role)) return transfersByOriginAndDestination;
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

  // Estado do modal de confirmação de transferência (lote — mesmo origem/destino).
  // `transferTarget` é o snapshot dos itens que vão para o modal, junto com a
  // quantidade efetiva a transferir de cada um (já ajustada por estoque real).
  const [transferTarget, setTransferTarget] = useState<{
    origemCanonico: string;
    destinoCanonico: string;
    origemLabel: string;
    destinoLabel: string;
    items: Array<{ item: TransferItem; quantidade: number }>;
  } | null>(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);

  // Seleção em lote: chave estável do item. Sem `originGroup` separado porque a
  // chave já contém origem+destino, então não há colisão entre grupos.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Aba ativa por destinationGroup: "sugestoes" (default) ou "realizadas".
  // Chave: `${origemCanonico}|${destinoCanonico}`.
  const [activeTabByGroup, setActiveTabByGroup] = useState<Record<string, "sugestoes" | "realizadas">>({});
  const getActiveTab = useCallback(
    (origemCanonico: string, destinoCanonico: string): "sugestoes" | "realizadas" =>
      activeTabByGroup[`${origemCanonico}|${destinoCanonico}`] ?? "sugestoes",
    [activeTabByGroup]
  );
  const setActiveTab = useCallback(
    (origemCanonico: string, destinoCanonico: string, tab: "sugestoes" | "realizadas") => {
      setActiveTabByGroup((prev) => ({
        ...prev,
        [`${origemCanonico}|${destinoCanonico}`]: tab,
      }));
    },
    []
  );

  const toggleSelectKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const replaceSelectionForGroup = useCallback(
    (groupKeys: string[], allOnGroupKeys: string[]) => {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        // remove apenas as chaves visíveis deste grupo, preservando seleções de outros grupos
        for (const k of allOnGroupKeys) next.delete(k);
        for (const k of groupKeys) next.add(k);
        return next;
      });
    },
    []
  );

  /** Verifica se o usuário pode executar saída a partir da origem informada.
   * Espelha exatamente a regra de `/api/saidas-entradas-produtos/executar`:
   *   - admin: pode tudo
   *   - sem permissões cadastradas: bloqueado
   *   - filiaisOrigem vazio: todas as origens liberadas
   *   - caso contrário: precisa bater com a origem via permissaoMatchFilial
   */
  const canExecuteSaidaFromOrigem = useCallback(
    (origemCanonico: string): boolean => {
      if (user?.role === "admin") return true;
      if (!permissoes) return false;
      if (permissoes.filiaisOrigem.length === 0) return true;
      return permissoes.filiaisOrigem.some((p) =>
        permissaoMatchFilial(p, origemCanonico)
      );
    },
    [user?.role, permissoes, permissaoMatchFilial]
  );

  /** Executa a saída como TRANSFERENCIA ENTRE LOJAS em LOTE. Um único romaneio
   * cobre todos os itens (mesma filial origem + filial destino). Inclui metadata
   * no payload para o backend gravar `transferencia_pendente` (histórico/cooldown). */
  const executarTransferenciaSaida = async (
    target: NonNullable<typeof transferTarget>
  ): Promise<void> => {
    if (!user?.username) {
      setTransferError("Usuário não identificado. Faça login novamente.");
      return;
    }
    const itensValidos = target.items.filter((x) => x.quantidade > 0);
    if (itensValidos.length === 0) {
      setTransferError("Nenhum item com quantidade válida para transferir.");
      return;
    }

    setTransferSubmitting(true);
    setTransferError(null);
    setTransferSuccess(null);

    try {
      const itensPayload = itensValidos.map(({ item, quantidade }) => ({
        produto: item.produto,
        corProduto: item.itemOriginal.codigoCor ?? null,
        quantidade,
      }));

      const metadataItems = itensValidos.map(({ item, quantidade }) => ({
        produto: item.produto,
        corCodigo: item.itemOriginal.codigoCor ?? null,
        corDescricao: item.cor ?? null,
        descricao: item.descricao ?? null,
        codigoBarra: item.codigoBarra ?? null,
        origemLabel: item.origem ?? null,
        destinoLabel: item.destino ?? null,
        itemKey: getTransferItemKey(item),
        quantidade,
      }));

      const response = await fetch("/api/saidas-entradas-produtos/executar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-username": user.username,
        },
        body: JSON.stringify({
          tipoOperacao: "saida",
          filial: target.origemCanonico,
          filialDestino: target.destinoCanonico,
          itens: itensPayload,
          tipoRomaneio: "TRANSFERENCIA ENTRE LOJAS",
          observacao: null,
          companyKey,
          registrarTransferenciaPendente: { items: metadataItems },
        }),
      });

      if (!response.ok) {
        const errorJson = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorJson.error || "Erro ao executar a transferência.");
      }

      const json = (await response.json()) as {
        success: boolean;
        message?: string;
        romaneio?: string;
      };

      // Limpa seleção dos itens transferidos
      const itensTransferidos = itensValidos.map((x) => x.item);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        itensTransferidos.forEach((it) => next.delete(getTransferItemKey(it)));
        return next;
      });

      const totalQtd = itensValidos.reduce((s, x) => s + x.quantidade, 0);
      const totalItens = itensValidos.length;
      setTransferSuccess(
        json.romaneio
          ? `Romaneio ${json.romaneio} gerado com ${totalItens} ${totalItens === 1 ? "item" : "itens"} (${totalQtd} un.).`
          : json.message || "Transferência executada com sucesso."
      );

      // Refetch dos dados de controle (reflete o novo estoque)
      try {
        await onTransferExecuted?.();
      } catch {
        // ignorar erro de refetch — a transferência já foi registrada
      }

      setTimeout(() => {
        setTransferTarget(null);
        setTransferSuccess(null);
      }, 1300);
    } catch (err) {
      setTransferError(
        err instanceof Error ? err.message : "Erro ao executar a transferência."
      );
    } finally {
      setTransferSubmitting(false);
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

    exportTransfersToPDF(dataForExport, companyKey, dateRange, new Set());
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
          {group.destinationGroups.map((destGroup, destIndex) => {
            // Computa estado de seleção/seleção possível deste destinationGroup
            const origemCanonicoDoGrupo = destGroup.items[0]?.origemCanonico ?? "";
            const destinoCanonicoDoGrupo = destGroup.items[0]?.destinoCanonico ?? "";
            const podeOperarOrigem = canExecuteSaidaFromOrigem(origemCanonicoDoGrupo);

            // Para cada item do grupo: chave + se é selecionável + quantidade
            const itemSelecaoInfo = destGroup.items.map((it) => {
              const key = getTransferItemKey(it);
              const qtdAjustada = it.quantidade;
              const isSelectable = podeOperarOrigem && qtdAjustada > 0;
              return { key, isSelectable, qtdAjustada, item: it };
            });

            const allItemKeys = itemSelecaoInfo.map((x) => x.key);
            const selectableItems = itemSelecaoInfo.filter((x) => x.isSelectable);
            const selecionadosNoGrupo = selectableItems.filter((x) => selectedKeys.has(x.key));
            const totalSelecionados = selecionadosNoGrupo.length;
            const totalSelecionavel = selectableItems.length;
            const allSelected = totalSelecionavel > 0 && totalSelecionados === totalSelecionavel;
            const someSelected = totalSelecionados > 0 && totalSelecionados < totalSelecionavel;
            const qtdTotalSelecionada = selecionadosNoGrupo.reduce((s, x) => s + x.qtdAjustada, 0);

            const handleToggleAllInGroup = () => {
              if (allSelected) {
                // desmarca todas do grupo
                replaceSelectionForGroup([], allItemKeys);
              } else {
                // marca todos os selecionáveis
                replaceSelectionForGroup(
                  selectableItems.map((x) => x.key),
                  allItemKeys
                );
              }
            };

            const handleAbrirModalLote = () => {
              if (selecionadosNoGrupo.length === 0) return;
              setTransferError(null);
              setTransferSuccess(null);
              setTransferTarget({
                origemCanonico: origemCanonicoDoGrupo,
                destinoCanonico: destinoCanonicoDoGrupo,
                origemLabel: group.origem,
                destinoLabel: destGroup.destino,
                items: selecionadosNoGrupo.map((x) => ({
                  item: x.item,
                  quantidade: x.qtdAjustada,
                })),
              });
            };

            const activeTab = getActiveTab(origemCanonicoDoGrupo, destinoCanonicoDoGrupo);
            const realizadasCount =
              realizadasContadores?.get(`${origemCanonicoDoGrupo}|${destinoCanonicoDoGrupo}`) ?? 0;

            return (
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
                <div className={styles.destinationTabs} role="tablist" aria-label="Visão do destino">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "sugestoes"}
                    className={`${styles.destinationTab} ${activeTab === "sugestoes" ? styles.destinationTabActive : ""}`}
                    onClick={() => setActiveTab(origemCanonicoDoGrupo, destinoCanonicoDoGrupo, "sugestoes")}
                  >
                    Sugestões
                    <span className={styles.destinationTabBadge}>{destGroup.items.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "realizadas"}
                    className={`${styles.destinationTab} ${activeTab === "realizadas" ? styles.destinationTabActive : ""}`}
                    onClick={() => setActiveTab(origemCanonicoDoGrupo, destinoCanonicoDoGrupo, "realizadas")}
                  >
                    Realizadas
                    {realizadasCount > 0 ? (
                      <span className={styles.destinationTabBadge}>{realizadasCount}</span>
                    ) : null}
                  </button>
                </div>
                <div className={styles.destinationActions}>
                  {activeTab === "sugestoes" && podeOperarOrigem && totalSelecionavel > 0 ? (
                    <button
                      type="button"
                      className={styles.bulkTransferBtn}
                      onClick={handleAbrirModalLote}
                      disabled={totalSelecionados === 0 || transferSubmitting}
                      title={
                        totalSelecionados === 0
                          ? "Selecione ao menos um item para transferir"
                          : `Gera 1 romaneio com ${totalSelecionados} ${totalSelecionados === 1 ? "item" : "itens"} (${qtdTotalSelecionada} un.) para ${destGroup.destino}`
                      }
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                      Transferir
                      <span className={styles.bulkTransferCount}>{totalSelecionados}</span>
                    </button>
                  ) : null}
                  <div className={styles.destinationTotal}>
                    {destGroup.totalQuantidade} un
                  </div>
                </div>
              </div>

              {activeTab === "realizadas" ? (
                <RealizadasPanel
                  companyKey={companyKey}
                  companySlug={companyKey}
                  origemCanonico={origemCanonicoDoGrupo}
                  origemLabel={group.origem}
                  destinoCanonico={destinoCanonicoDoGrupo}
                  destinoLabel={destGroup.destino}
                />
              ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.selectHeader} title="Selecionar todos os itens transferíveis deste destino">
                      {podeOperarOrigem && totalSelecionavel > 0 ? (
                        <input
                          type="checkbox"
                          className={styles.selectCheckbox}
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={handleToggleAllInGroup}
                          disabled={transferSubmitting}
                          aria-label="Selecionar todos"
                        />
                      ) : null}
                    </th>
                    <th className={styles.produtoHeader}>Produto</th>
                    <th className={styles.codigoBarraHeader}>Código de Barras</th>
                    <th className={styles.estoqueHeader}>Estoque {group.origem}</th>
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

                    const quantidadeAjustada = item.quantidade;

                    return (
                <tr key={`${item.produto}-${item.cor}-${item.destino}-${index}`}>
                  <td className={styles.selectCell}>
                    {podeOperarOrigem ? (
                      <input
                        type="checkbox"
                        className={styles.selectCheckbox}
                        checked={selectedKeys.has(itemKey)}
                        onChange={() => toggleSelectKey(itemKey)}
                        disabled={quantidadeAjustada <= 0 || transferSubmitting}
                        title={
                          quantidadeAjustada <= 0
                            ? "Quantidade ajustada é zero — não pode ser transferida"
                            : `Selecionar ${quantidadeAjustada} un. para ${item.destino}`
                        }
                        aria-label={`Selecionar ${item.descricao} ${item.cor}`}
                      />
                    ) : (
                      <span className={styles.transferirDisabled} title="Sem permissão de saída nesta origem">—</span>
                    )}
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
                    <span className={styles.estoqueBadge}>
                      {estoqueOrigem}
                    </span>
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
                          ajustadaPorEstoqueReal: false,
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
                      <span className={styles.quantidadeBadge}>
                        {quantidadeAjustada}
                      </span>
                    </span>
                  </td>
                </tr>
                  );
                  })}
                </tbody>
              </table>
              )}
            </div>
            );
          })}

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

      <TransferenciaConfirmModal
        open={transferTarget !== null}
        origemLabel={transferTarget?.origemLabel ?? ""}
        destinoLabel={transferTarget?.destinoLabel ?? ""}
        items={
          transferTarget?.items.map(({ item, quantidade }) => ({
            codigo: item.codigo,
            descricao: item.descricao,
            cor: item.cor,
            codigoBarra: item.codigoBarra,
            quantidade,
          })) ?? []
        }
        submitting={transferSubmitting}
        error={transferError}
        success={transferSuccess}
        onConfirm={() => {
          if (!transferTarget) return;
          void executarTransferenciaSaida(transferTarget);
        }}
        onCancel={() => {
          if (transferSubmitting) return;
          setTransferTarget(null);
          setTransferError(null);
          setTransferSuccess(null);
        }}
      />

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


