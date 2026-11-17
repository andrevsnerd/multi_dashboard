"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { FILTROS_STATUS, PADROES, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import type { FatLookups, NotaListItem } from "@/lib/faturamento-ecommerce/types";

import { dataLocal, fmtBRL, useFatApi } from "./api";
import { ListaNotas } from "./FaturamentoAba";
import NotaDetalheModal from "./NotaDetalheModal";
import styles from "./FaturamentoEcommerce.module.css";

const ATUALIZA_MS = 60_000;

/**
 * Monitor da NF-e (somente leitura). O envio à SEFAZ continua no Monitor de Controle
 * da NF-e do Linx — é o Linx desktop que chama a API Fiscal Flow; não há como disparar
 * pelo banco. Aqui: status, motivo de rejeição, XML autorizado.
 */
export default function MonitorAba({ empresa, lookups, ativo }: { empresa: EmpresaFat; lookups: FatLookups; ativo: boolean }) {
  const { get } = useFatApi(empresa);
  const [filial, setFilial] = useState("");
  const [de, setDe] = useState(dataLocal(15));
  const [ate, setAte] = useState(dataLocal(0));
  const [status, setStatus] = useState("pendentes");
  const [lista, setLista] = useState<NotaListItem[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<NotaListItem | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setLista(await get<NotaListItem[]>("/notas", { filial, de, ate, status }));
      setAtualizadoEm(new Date());
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [get, filial, de, ate, status]);

  // Carrega ao abrir a aba / mudar filtro e atualiza a cada minuto enquanto aberta.
  useEffect(() => {
    if (!ativo) return;
    void carregar();
    const t = setInterval(() => void carregar(), ATUALIZA_MS);
    return () => clearInterval(t);
  }, [ativo, carregar]);

  const resumo = useMemo(() => {
    const m = new Map<string, { n: number; valor: number; tom: string }>();
    for (const nf of lista ?? []) {
      const r = m.get(nf.statusLabel) ?? { n: 0, valor: 0, tom: nf.tom };
      r.n += 1;
      r.valor += nf.valor;
      m.set(nf.statusLabel, r);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [lista]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Monitor de NF-e — {PADROES[empresa].nome}</h2>
          <div className={styles.acoes}>
            {atualizadoEm && <span className={styles.muted}>atualizado às {atualizadoEm.toLocaleTimeString("pt-BR")}</span>}
            <button type="button" className={styles.btn} onClick={() => void carregar()} disabled={carregando}>
              {carregando ? "Atualizando…" : "Atualizar"}
            </button>
          </div>
        </div>
        <div className={styles.infoBox}>
          O envio para a SEFAZ continua no Linx: <strong>Monitor de Controle da NF-e</strong> → selecione a NF →{" "}
          <strong>Envia NFe para Sefaz</strong>. Esta aba mostra o resultado (atualiza sozinha a cada minuto).
        </div>
        <div className={styles.grid}>
          <label className={styles.campo}>
            <span className={styles.label}>Situação</span>
            <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
              {FILTROS_STATUS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.campo}>
            <span className={styles.label}>Filial</span>
            <select className={styles.select} value={filial} onChange={(e) => setFilial(e.target.value)}>
              <option value="">Todas da {PADROES[empresa].nome}</option>
              {lookups.filiaisNota.map((f) => (
                <option key={f.filial} value={f.filial}>
                  {f.filial}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.campo}>
            <span className={styles.label}>Emissão de</span>
            <input className={styles.input} type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </label>
          <label className={styles.campo}>
            <span className={styles.label}>até</span>
            <input className={styles.input} type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </label>
        </div>
        {erro && <div className={styles.erroBox}>{erro}</div>}
        {resumo.length > 0 && (
          <div className={styles.acoes}>
            {resumo.map(([label, r]) => (
              <span key={label} className={`${styles.badge} ${styles[`badge_${r.tom}`]}`}>
                {label}: {r.n} · {fmtBRL(r.valor)}
              </span>
            ))}
          </div>
        )}
        {lista && <ListaNotas lista={lista} onAbrir={setAberta} />}
      </div>
      {aberta && <NotaDetalheModal empresa={empresa} nota={aberta} onFechar={() => setAberta(null)} />}
    </div>
  );
}
