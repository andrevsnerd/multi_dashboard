"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProjecaoCompraPage.module.css";

/**
 * Aba "Aviamentos" da Projeção Compra.
 *
 * A base é o que foi COMPRADO e ainda não chegou (Compras em trânsito, já reconciliadas
 * contra as entradas reais): cada peça a caminho vai precisar dos seus aviamentos, conforme
 * a regra de cada um em [aviamentos.ts](@/lib/config/aviamentos). Só os aviamentos gastos na
 * venda (etiqueta presente, remetente, caixa de presente) somam a venda dos próximos 90 dias,
 * pelo ritmo dos últimos 90.
 *
 * A tabela tem só o estoque e o quanto precisamos: necessidade das peças em trânsito menos
 * o estoque digitado.
 *
 * O estoque é digitado, mas NÃO aqui: quem altera é a tela "Embalagens e Aviamentos"
 * (Rede ScarfMe). Esta aba só lê o mesmo registro, ao abrir e a cada "Atualizar".
 */

interface AviamentoNecessidade {
  id: string;
  nome: string;
  nota?: string;
  temRegra: boolean;
  necessidadeCompras: number;
  necessidadeVenda: number;
  necessidade: number;
}

interface Resposta {
  itens: AviamentoNecessidade[];
  resumo: {
    compras: number;
    pecas: number;
    pecasDaMarca: number;
    venda: { tickets: number; pecasFashion: number; janelaDias: number; horizonteDias: number };
  };
  estoque: Record<string, number>;
  error?: string;
}

function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

interface Props {
  companyKey: CompanyKey;
  /** Avisa a tela-mãe que a consulta está em andamento (o "calculando" é de lá). */
  onLoadingChange?: (carregando: boolean) => void;
}

export default function ProjecaoAviamentosPanel({ companyKey, onLoadingChange }: Props) {
  const [itens, setItens] = useState<AviamentoNecessidade[]>([]);
  const [resumo, setResumo] = useState<Resposta["resumo"] | null>(null);
  const [estoqueAtual, setEstoqueAtual] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** Muda a cada "Atualizar": é o que dispara a consulta de novo. */
  const [versao, setVersao] = useState(0);

  // ── Consulta: ao abrir a aba e a cada "Atualizar" ──
  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    onLoadingChange?.(true);
    setErro(null);
    const params = new URLSearchParams({ company: companyKey });
    fetch(`/api/projecao-aviamentos?${params.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json()) as Resposta;
        if (!r.ok) throw new Error(json?.error || "Erro ao calcular a necessidade de aviamentos");
        return json;
      })
      .then((json) => {
        if (cancelado) return;
        setItens(Array.isArray(json.itens) ? json.itens : []);
        setResumo(json.resumo ?? null);
        setEstoqueAtual(json.estoque ?? {});
      })
      .catch((e: Error) => {
        if (cancelado) return;
        setItens([]);
        setResumo(null);
        setErro(e.message || "Erro ao calcular a necessidade de aviamentos");
      })
      .finally(() => {
        if (cancelado) return;
        setCarregando(false);
        onLoadingChange?.(false);
      });
    return () => {
      cancelado = true;
      // A consulta abandonada não pode deixar o "calculando" da tela-mãe aceso.
      onLoadingChange?.(false);
    };
    // `onLoadingChange` fica fora de propósito: é um callback recriado a cada render da
    // tela-mãe e entraria em laço de carga — ver [[efeito-fetch-strictmode-guard]].
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, versao]);

  const linhas = useMemo(
    () =>
      itens.map((item) => {
        const estoque = Math.max(0, Number(estoqueAtual[item.id] ?? 0) || 0);
        return {
          item,
          estoque,
          precisamos: item.temRegra ? Math.max(0, Math.ceil(item.necessidade - estoque)) : 0,
        };
      }),
    [itens, estoqueAtual]
  );

  const totais = useMemo(() => {
    const comRegra = linhas.filter((l) => l.item.temRegra);
    return {
      semRegra: linhas.length - comRegra.length,
      precisamos: comRegra.reduce((s, l) => s + l.precisamos, 0),
      itensAComprar: comRegra.filter((l) => l.precisamos > 0).length,
      linhas: comRegra.length,
    };
  }, [linhas]);

  return (
    <>
      {erro && <div className={styles.erro}>{erro}</div>}

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className={styles.kpiStrip}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Precisamos comprar</span>
          <span className={styles.kpiValue}>{fmt(totais.precisamos)}</span>
          <span className={styles.kpiHint}>
            {fmt(totais.itensAComprar)} de {fmt(totais.linhas)} aviamentos
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Peças em trânsito</span>
          <span className={styles.kpiValue}>{resumo ? fmt(resumo.pecasDaMarca) : "—"}</span>
          <span className={styles.kpiHint}>
            {resumo
              ? `${fmt(resumo.compras)} ${resumo.compras === 1 ? "compra" : "compras"} ainda não chegaram`
              : "compradas e ainda não chegaram"}
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Vendas projetadas</span>
          <span className={styles.kpiValue}>{resumo ? fmt(resumo.venda.tickets) : "—"}</span>
          <span className={styles.kpiHint}>
            {resumo
              ? `próximos ${fmt(resumo.venda.horizonteDias)} dias · ritmo dos últimos ${fmt(
                  resumo.venda.janelaDias
                )}`
              : "para presente, remetente e caixa de presente"}
          </span>
        </div>
        {totais.semRegra > 0 && (
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Sem regra</span>
            <span className={styles.kpiValue}>{fmt(totais.semRegra)}</span>
            <span className={styles.kpiHint}>aguardando a regra de consumo</span>
          </div>
        )}
      </div>

      {/* ── Aviamento × estoque × necessidade ───────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>Aviamentos · compras em trânsito</span>
          <div className={styles.embActions}>
            <span className={styles.embAviso}>
              Estoque da Rede ScarfMe ·{" "}
              <Link href={`/${companyKey}/embalagens-aviamentos`}>alterar em Embalagens e Aviamentos</Link>
            </span>
            <button
              type="button"
              className={styles.btnGerar}
              onClick={() => setVersao((v) => v + 1)}
              disabled={carregando}
            >
              {carregando ? "Atualizando…" : "Atualizar"}
            </button>
          </div>
        </div>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.embTable}`}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Aviamento</th>
                <th>Estoque</th>
                <th>Precisamos</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td className={styles.tdLeft} colSpan={3}>
                    <span className={styles.muted}>
                      {carregando ? "Carregando…" : "Sem dados."}
                    </span>
                  </td>
                </tr>
              ) : (
                linhas.map((l) => {
                  return (
                    <tr key={l.item.id} title={l.item.nota ?? ""}>
                      <td className={styles.tdLeft}>
                        {l.item.nome}
                        {!l.item.temRegra && <span className={styles.embSemRegra}>sem regra</span>}
                      </td>
                      <td className={styles.num}>{fmt(l.estoque)}</td>
                      <td
                        className={`${styles.num} ${l.precisamos > 0 ? styles.embComprar : ""}`}
                        title={
                          l.item.temRegra
                            ? [
                                l.item.necessidadeCompras > 0 &&
                                  `Peças em trânsito: ${fmt(l.item.necessidadeCompras)}`,
                                l.item.necessidadeVenda > 0 &&
                                  `Venda dos próximos 90 dias: ${fmt(l.item.necessidadeVenda)}`,
                                `Necessário: ${fmt(l.item.necessidade)} · estoque ${fmt(l.estoque)}`,
                              ]
                                .filter(Boolean)
                                .join("\n")
                            : ""
                        }
                      >
                        {l.item.temRegra ? fmt(l.precisamos) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
