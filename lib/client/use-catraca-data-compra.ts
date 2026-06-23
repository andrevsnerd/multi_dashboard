"use client";

import { useCallback, useEffect, useState } from "react";

import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";
import { applyDataCompraFixa, type CompraIdealResult } from "@/lib/utils/compra-ideal";
import { hasCicloCompra } from "@/lib/config/compra-ciclo";
import {
  fetchComprasDataFixa,
  saveComprasDataFixa,
  computeTransitoSig,
  type CompraDataFixaEntry,
} from "@/lib/client/compra-data-fixa";

export interface CatracaFreeze {
  itemKey: string;
  dataCompra: string;
  transitoSig: string;
}

export interface CatracaReconcileResult {
  /** Ideal pronto pra exibir (data da catraca aplicada quando é pra manter a mais cedo). */
  ideal: CompraIdealResult;
  /** Entrada a persistir (catraca avança/re-baseia), ou null quando nada muda. */
  freeze: CatracaFreeze | null;
}

/**
 * CATRACA da data de compra (modo ciclo), compartilhada por TODAS as telas de Compra Ideal.
 *
 * Regra: a data só anda pra MAIS CEDO. Acelerou → avança; desacelerou → mantém a registrada
 * (mais cedo) e só a quantidade atualiza; estável → mantém. Re-baseia quando entra trânsito
 * novo (assinatura muda = compra feita → próximo ciclo). A data é persistida por
 * empresa+filial+item, então o comportamento é o MESMO em qualquer tela.
 *
 * Uso na tela:
 *  - `const catraca = useCatracaDataCompra(companyKey, filial)`
 *  - por item: `const { ideal, freeze } = catraca.reconcile(idealCru, itemKey, transitEntries)`
 *    (usa `ideal` pra exibir; junta os `freeze` não-nulos numa lista)
 *  - `useEffect(() => catraca.persist(freezes), [freezes])`
 */
export function useCatracaDataCompra(companyKey: string, filial: string | null | undefined) {
  const enabled = hasCicloCompra(companyKey);
  const [map, setMap] = useState<Record<string, CompraDataFixaEntry>>({});

  useEffect(() => {
    // Quando desabilitado, reconcile/persist já são no-op; não precisa resetar o mapa
    // (evita setState síncrono no effect). Só busca quando habilitado.
    if (!enabled) return;
    let cancelled = false;
    fetchComprasDataFixa(companyKey, filial ?? "")
      .then((m) => {
        if (!cancelled) setMap(m);
      })
      .catch(() => {
        if (!cancelled) setMap({});
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, companyKey, filial]);

  const reconcile = useCallback(
    (ideal: CompraIdealResult, itemKey: string, transitEntries: CompraTransitoIndexEntry[]): CatracaReconcileResult => {
      if (!enabled || !ideal.modoCiclo || ideal.status !== "REPOR" || !ideal.dataCompra) {
        return { ideal, freeze: null };
      }
      const sig = computeTransitoSig(transitEntries);
      const frozen = map[itemKey];
      // Mesmo ciclo (assinatura igual) e registrada não é mais tarde que a recalculada →
      // mantém a registrada (desaceleração/estável). Não grava.
      if (frozen && frozen.transitoSig === sig && frozen.dataCompra <= ideal.dataCompra) {
        return { ideal: applyDataCompraFixa(ideal, frozen.dataCompra), freeze: null };
      }
      // Sem registro, assinatura nova (trânsito novo) ou recalculada mais cedo (acelerou):
      // a catraca avança/re-baseia pra recalculada — exibe a recalculada e grava.
      return { ideal, freeze: { itemKey, dataCompra: ideal.dataCompra, transitoSig: sig } };
    },
    [enabled, map]
  );

  const persist = useCallback(
    (freezes: CatracaFreeze[]) => {
      if (!enabled || freezes.length === 0) return;
      let cancelled = false;
      saveComprasDataFixa(companyKey, filial ?? "", freezes)
        .then(() => {
          if (cancelled) return;
          setMap((prev) => {
            const now = new Date().toISOString();
            const next = { ...prev };
            for (const e of freezes) {
              next[e.itemKey] = {
                itemKey: e.itemKey,
                dataCompra: e.dataCompra,
                transitoSig: e.transitoSig,
                updatedAt: now,
              };
            }
            return next;
          });
        })
        .catch(() => {
          /* silencioso: tenta de novo na próxima carga */
        });
      return () => {
        cancelled = true;
      };
    },
    [enabled, companyKey, filial]
  );

  return { enabled, map, reconcile, persist };
}
