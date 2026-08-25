"use client";

import { useMemo, useState } from "react";

import type { CompraGastoParcela } from "@/lib/types/compra-gasto";
import {
  cents,
  gerarParcelas,
  gerarParcelasPorPercentual,
  parsePercentuais,
  percentualDaParcela,
} from "@/lib/utils/compra-gastos-agregacao";

import styles from "./GastosCompra.module.css";
import { brl, money, parseMoeda } from "./gastos-compra-format";

interface Props {
  /** Valor de referência da compra — base do rateio e do aviso de divergência. */
  total: number;
  parcelas: CompraGastoParcela[];
  onChange: (parcelas: CompraGastoParcela[]) => void;
  /** Data sugerida para o 1º vencimento ao gerar (normalmente a data da compra). */
  vencimentoSugerido: string;
  /** Texto do rodapé à esquerda. */
  rodape?: string;
  disabled?: boolean;
}

type Modo = "quantidade" | "percentual";

function renumerar(parcelas: CompraGastoParcela[]): CompraGastoParcela[] {
  return parcelas.map((p, i) => ({ ...p, numero: i + 1 }));
}

/**
 * Editor de parcelamento.
 *
 * Dois jeitos de dividir: em N parcelas iguais ou por percentual ("40/60",
 * "30/30/40"). Parcela já paga fica travada e sai do rateio — só o restante é
 * redividido, senão marcar como pago viraria um valor diferente do que saiu.
 */
export default function ParcelasEditor({
  total,
  parcelas,
  onChange,
  vencimentoSugerido,
  rodape,
  disabled,
}: Props) {
  const [modo, setModo] = useState<Modo>("quantidade");
  const [quantidade, setQuantidade] = useState(2);
  const [percentuaisTexto, setPercentuaisTexto] = useState("40/60");
  const [primeiroVencimento, setPrimeiroVencimento] = useState(vencimentoSugerido);
  const [intervalo, setIntervalo] = useState<"mensal" | "quinzenal">("mensal");

  const pagas = useMemo(() => parcelas.filter((p) => p.pago), [parcelas]);
  const somaPagas = useMemo(() => cents(pagas.reduce((s, p) => s + p.valor, 0)), [pagas]);
  const restante = cents(total - somaPagas);
  const soma = useMemo(() => cents(parcelas.reduce((s, p) => s + p.valor, 0)), [parcelas]);
  const divergencia = cents(soma - total);

  const percentuais = useMemo(() => parsePercentuais(percentuaisTexto), [percentuaisTexto]);
  const somaPercentuais = percentuais.reduce((s, p) => s + p, 0);

  function gerar() {
    const base = restante > 0 ? restante : total;
    const novas =
      modo === "quantidade"
        ? gerarParcelas(base, quantidade, primeiroVencimento, intervalo)
        : gerarParcelasPorPercentual(base, percentuais, primeiroVencimento, intervalo);
    if (novas.length === 0) return;
    onChange(renumerar([...pagas, ...novas]));
  }

  function alterar(indice: number, campo: "vencimento" | "valor", valor: string) {
    onChange(
      parcelas.map((p, i) =>
        i === indice ? { ...p, [campo]: campo === "valor" ? parseMoeda(valor) : valor } : p
      )
    );
  }

  function remover(indice: number) {
    onChange(renumerar(parcelas.filter((_, i) => i !== indice)));
  }

  function adicionar() {
    const ultima = parcelas[parcelas.length - 1];
    onChange(
      renumerar([
        ...parcelas,
        {
          numero: parcelas.length + 1,
          vencimento: ultima?.vencimento ?? primeiroVencimento,
          valor: 0,
          pago: false,
          dataPagamento: null,
        },
      ])
    );
  }

  return (
    <div>
      <div className={styles.splitTools}>
        <div className={styles.seg} role="group" aria-label="Como dividir">
          <button
            type="button"
            className={modo === "quantidade" ? styles.segActive : undefined}
            aria-pressed={modo === "quantidade"}
            onClick={() => setModo("quantidade")}
            disabled={disabled}
          >
            Em parcelas iguais
          </button>
          <button
            type="button"
            className={modo === "percentual" ? styles.segActive : undefined}
            aria-pressed={modo === "percentual"}
            onClick={() => setModo("percentual")}
            disabled={disabled}
          >
            Por percentual
          </button>
        </div>

        <div className={styles.fieldGrid}>
          {modo === "quantidade" ? (
            <label className={styles.field}>
              <span>Nº de parcelas</span>
              <input
                type="number"
                min={1}
                max={48}
                value={quantidade}
                disabled={disabled}
                onChange={(e) => setQuantidade(Math.max(1, Math.min(48, Number(e.target.value) || 1)))}
              />
            </label>
          ) : (
            <label className={styles.field}>
              <span>Percentuais</span>
              <input
                className={styles.money}
                value={percentuaisTexto}
                placeholder="40/60"
                disabled={disabled}
                onChange={(e) => setPercentuaisTexto(e.target.value)}
              />
            </label>
          )}
          <label className={styles.field}>
            <span>1º vencimento</span>
            <input
              type="date"
              value={primeiroVencimento}
              disabled={disabled}
              onChange={(e) => setPrimeiroVencimento(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Intervalo</span>
            <select
              value={intervalo}
              disabled={disabled}
              onChange={(e) => setIntervalo(e.target.value as "mensal" | "quinzenal")}
            >
              <option value="mensal">Mensal, mesmo dia</option>
              <option value="quinzenal">A cada 15 dias</option>
            </select>
          </label>
          <div className={styles.field}>
            <span>&nbsp;</span>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm}`}
              onClick={gerar}
              disabled={disabled || (modo === "percentual" && percentuais.length === 0)}
            >
              Dividir
            </button>
          </div>
        </div>

        {modo === "percentual" && percentuais.length > 0 && (
          <p className={styles.note}>
            {percentuais.map((p) => `${p}%`).join(" + ")}
            {Math.abs(somaPercentuais - 100) > 0.05
              ? ` — soma ${somaPercentuais}%, tratada como proporção do total`
              : ""}
            {somaPagas > 0 ? ` · rateando ${brl(restante)} (o já pago fica de fora)` : ""}
          </p>
        )}
      </div>

      <div className={styles.parcelaGrid}>
        <div className={styles.parcelaRow}>
          <span className={styles.freeLineHead}>#</span>
          <span className={styles.freeLineHead}>Vencimento</span>
          <span className={`${styles.freeLineHead} ${styles.parcelaValorHead}`}>Valor</span>
          <span className={styles.freeLineHead}>%</span>
          <span />
        </div>

        {parcelas.map((p, i) => (
          <div className={styles.parcelaRow} key={`${i}-${p.vencimento}`}>
            <span className={styles.parcelaNum}>
              {i + 1}/{parcelas.length}
            </span>
            <input
              type="date"
              value={p.vencimento}
              disabled={disabled || p.pago}
              onChange={(e) => alterar(i, "vencimento", e.target.value)}
            />
            <input
              className={styles.money}
              value={money(p.valor)}
              inputMode="decimal"
              disabled={disabled || p.pago}
              onChange={(e) => alterar(i, "valor", e.target.value)}
            />
            <span className={styles.parcelaPct}>
              {total > 0 ? `${percentualDaParcela(p.valor, total)}%` : "—"}
            </span>
            {p.pago ? (
              <span className={`${styles.pill} ${styles.pillGood}`}>
                <i />
                pago
              </span>
            ) : (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => remover(i)}
                disabled={disabled || parcelas.length <= 1}
                aria-label={`Remover parcela ${i + 1}`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className={styles.parcelaFoot}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
          onClick={adicionar}
          disabled={disabled}
        >
          + parcela
        </button>
        <div className={styles.sumRow} style={{ border: 0, margin: 0, padding: 0, flex: 1 }}>
          <span className={styles.note} style={{ margin: 0 }}>
            {rodape ?? "Soma das parcelas"}
          </span>
          <b className={Math.abs(divergencia) > 0.5 ? styles.neg : undefined}>{brl(soma)}</b>
        </div>
      </div>

      {Math.abs(divergencia) > 0.5 && (
        <p className={styles.note}>
          {divergencia > 0 ? "Sobra" : "Falta"} {brl(Math.abs(divergencia))} em relação ao valor da
          compra ({brl(total)}). O gasto do mês segue as parcelas — ajuste se não for intencional.
        </p>
      )}
    </div>
  );
}
