"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { normalizeVmKeyPart } from "@/lib/utils/vm";

/**
 * Marcadores de VM para as telas de análise.
 *
 * O VM já saiu do estoque de verdade (romaneio tipo VM), então o número da tela está
 * certo — esta etiqueta existe só para o operador não achar que a loja está zerada por
 * esquecimento: tem uma peça no manequim.
 *
 * A busca casa a filial por CÓDIGO ou por NOME, porque as telas usam ora um ora outro. A
 * cor é opcional: sem cor informada, responde "existe VM deste produto nesta filial". Com
 * cor, aceita tanto o código (ex.: "12") quanto a descrição (ex.: "PRETO"), já que umas
 * telas trazem o código e outras o nome normalizado da cor.
 */
export interface VmMarcador {
  filial: string;
  filialNome: string;
  produto: string;
  cor: string;
  descCor: string;
}

export interface VmMarcadoresApi {
  /** true se existe peça em VM para esse produto (e cor, quando informada) na filial. */
  isVm: (
    filial: string | null | undefined,
    produto: string | null | undefined,
    cor?: string | null
  ) => boolean;
  /** Total de peças em VM carregadas (0 quando a empresa não usa VM). */
  total: number;
}

export function useVmMarcadores(company: string | null | undefined): VmMarcadoresApi {
  const [marcadores, setMarcadores] = useState<VmMarcador[]>([]);

  useEffect(() => {
    // Sem empresa não busca nada; o índice abaixo já resolve para vazio, então não há
    // setState aqui (e nada de dado velho vazando quando a empresa sai de cena).
    if (!company) return;

    let cancelado = false;

    fetch(`/api/vm/marcadores?company=${encodeURIComponent(company)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { data?: VmMarcador[] }) => {
        if (!cancelado) setMarcadores(json.data ?? []);
      })
      .catch(() => {
        if (!cancelado) setMarcadores([]);
      });

    return () => {
      cancelado = true;
    };
  }, [company]);

  // Índice: (filial normalizada por cod E por nome) + produto → conjunto de cores.
  const indice = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!company) return map;
    const add = (filial: string, produto: string, cores: string[]) => {
      const chave = `${normalizeVmKeyPart(filial)}||${normalizeVmKeyPart(produto)}`;
      if (!chave.replace(/\|/g, "")) return;
      const set = map.get(chave) ?? new Set<string>();
      for (const cor of cores) {
        const c = normalizeVmKeyPart(cor);
        if (c) set.add(c);
      }
      map.set(chave, set);
    };

    for (const m of marcadores) {
      const cores = [m.cor, m.descCor];
      add(m.filial, m.produto, cores);
      if (m.filialNome && m.filialNome !== m.filial) add(m.filialNome, m.produto, cores);
    }
    return map;
  }, [marcadores, company]);

  const isVm = useCallback(
    (filial: string | null | undefined, produto: string | null | undefined, cor?: string | null) => {
      if (indice.size === 0) return false;
      const chave = `${normalizeVmKeyPart(filial)}||${normalizeVmKeyPart(produto)}`;
      const cores = indice.get(chave);
      if (!cores) return false;
      const alvo = normalizeVmKeyPart(cor);
      // Sem cor informada pela tela → basta existir VM do produto nessa filial.
      if (!alvo) return true;
      return cores.has(alvo);
    },
    [indice]
  );

  return { isVm, total: marcadores.length };
}
