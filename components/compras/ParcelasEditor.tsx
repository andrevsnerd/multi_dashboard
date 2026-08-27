"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  COMPRA_GASTO_CANAL_CURTO,
  COMPRA_GASTO_CANAL_LABEL,
  type CompraGastoCanal,
  type CompraGastoModeloParcelamento,
  type CompraGastoParcela,
} from "@/lib/types/compra-gasto";
import {
  canaisDasParcelas,
  cents,
  gerarParcelas,
  gerarParcelasModelo,
  redistribuirNaUltimaEmAberto,
  resumoPorCanal,
} from "@/lib/utils/compra-gastos-agregacao";

import styles from "./GastosCompra.module.css";
import { brl, money, parseMoeda } from "./gastos-compra-format";

interface Props {
  /** Valor de referência da compra — base do % e do aviso de fechamento. */
  total: number;
  parcelas: CompraGastoParcela[];
  onChange: (parcelas: CompraGastoParcela[]) => void;
  /** Data sugerida para o 1º vencimento (normalmente a data da compra). */
  vencimentoSugerido: string;
  rodape?: string;
  disabled?: boolean;
}

/** Célula em digitação: enquanto o campo tem foco, mostra o texto cru. */
interface Edicao {
  linha: number;
  campo: "valor" | "pct";
  texto: string;
}

const ATALHOS = [1, 2, 3, 4, 6, 12];

/**
 * Modelos de pagamento do select "Tipo". Cada um é um gerador: escolher aplica
 * as datas e os valores na hora, e mexer em qualquer linha depois volta o select
 * para "Manual" — o que o usuário digitou nunca é sobrescrito pelo modelo.
 */
const MODELOS: { valor: CompraGastoModeloParcelamento; label: string; dica: string }[] = [
  { valor: "manual", label: "Manual", dica: "Divide em Nx ou por % à mão." },
  {
    valor: "salete",
    label: "Salete",
    dica: "2x iguais: 90 e 120 dias depois da data da compra.",
  },
  {
    valor: "china",
    label: "China",
    dica: `${COMPRA_GASTO_CANAL_LABEL.transferencia} 40% + ${COMPRA_GASTO_CANAL_LABEL.alibaba} 60%, cada um 30% no ato do pedido, 50% no despacho (+30 dias) e 20% 60 dias depois do despacho (+90). As datas convergem: o dia soma os dois pagamentos.`,
  },
];

function renumerar(parcelas: CompraGastoParcela[]): CompraGastoParcela[] {
  return parcelas.map((p, i) => ({ ...p, numero: i + 1 }));
}

/**
 * Editor de parcelamento.
 *
 * Três decisões que sustentam a tela:
 *  - **Atalho de quantidade**: 2x, 3x, 4x… divide na hora, sem passo de
 *    "configurar e clicar em dividir".
 *  - **% e R$ na mesma linha, ligados**: digitar 40 no % preenche o valor e
 *    vice-versa. Não existe modo "por percentual" separado — 40/60 é digitar
 *    40 na primeira linha.
 *  - **As outras linhas se ajustam sozinhas**: ao editar uma, a última em aberto
 *    que não seja ela absorve a diferença, então a soma fecha com o total sem
 *    ninguém fazer conta de cabeça.
 *
 * Parcela já paga fica travada, fora do rateio e do ajuste automático — o que
 * já saiu do caixa não pode mudar de valor.
 */
export default function ParcelasEditor({
  total,
  parcelas,
  onChange,
  vencimentoSugerido,
  rodape,
  disabled,
}: Props) {
  const [primeiroVencimento, setPrimeiroVencimento] = useState(vencimentoSugerido);
  const [intervalo, setIntervalo] = useState<"mensal" | "quinzenal">("mensal");
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  // Parcelamento que já vem com canal foi gerado pelo modelo China — o select
  // abre refletindo isso, em vez de mentir "Manual" sobre o que está na tela.
  const [modelo, setModelo] = useState<CompraGastoModeloParcelamento>(() =>
    parcelas.some((p) => p.canal) ? "china" : "manual"
  );

  const canais = useMemo(() => canaisDasParcelas(parcelas), [parcelas]);
  const temCanal = canais.length > 0;
  const totaisPorCanal = useMemo(
    () => new Map(resumoPorCanal(parcelas).map((resumo) => [resumo.canal, resumo.total])),
    [parcelas]
  );
  const modeloAtivo = MODELOS.find((m) => m.valor === modelo) ?? MODELOS[0];

  // O modelo é aplicado por efeito, não no onChange do select, porque o total
  // costuma chegar DEPOIS da escolha (no modal você pode escolher "China" antes
  // de selecionar a Compra Salva). Refs para não colocar `parcelas`/`onChange`
  // nas dependências: a lista muda a cada aplicação e o efeito entraria em laço.
  const parcelasRef = useRef(parcelas);
  const onChangeRef = useRef(onChange);
  const primeiraRenderizacao = useRef(true);
  useEffect(() => {
    parcelasRef.current = parcelas;
    onChangeRef.current = onChange;
  }, [parcelas, onChange]);

  // A âncora acompanha a data da compra: mudar a data no modal reancora o
  // modelo (Salete conta 90/120 dias DELA), em vez de deixar a data antiga
  // congelada no campo "a partir de".
  useEffect(() => {
    setPrimeiroVencimento(vencimentoSugerido);
  }, [vencimentoSugerido]);

  useEffect(() => {
    // Na montagem nada é regerado: abrir um parcelamento existente não pode
    // reescrever o que está salvo.
    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }
    if (modelo === "manual") return;
    const jaPagas = parcelasRef.current.filter((p) => p.pago);
    const travado = cents(jaPagas.reduce((s, p) => s + (Number(p.valor) || 0), 0));
    const base = cents(total - travado);
    const novas = gerarParcelasModelo(base > 0 ? base : total, primeiroVencimento, modelo);
    if (novas.length === 0) return;
    onChangeRef.current(renumerar([...jaPagas, ...novas]));
  }, [modelo, total, primeiroVencimento]);

  const pagas = useMemo(() => parcelas.filter((p) => p.pago), [parcelas]);
  const somaPagas = useMemo(() => cents(pagas.reduce((s, p) => s + p.valor, 0)), [pagas]);
  const soma = useMemo(() => cents(parcelas.reduce((s, p) => s + p.valor, 0)), [parcelas]);
  const diferenca = cents(soma - total);
  const fecha = total <= 0 || Math.abs(diferenca) <= 0.5;

  /** Índice da última parcela em aberto — é ela que absorve o resto. */
  const indiceBalanceadora = useMemo(() => {
    for (let i = parcelas.length - 1; i >= 0; i -= 1) {
      if (!parcelas[i].pago) return i;
    }
    return -1;
  }, [parcelas]);

  /** Depois de mexer numa linha, a última em aberto absorve a diferença. */
  function comAjuste(
    lista: CompraGastoParcela[],
    editada: number,
    canal: CompraGastoCanal | null | undefined = lista[editada]?.canal
  ): CompraGastoParcela[] {
    if (!canal) return redistribuirNaUltimaEmAberto(lista, total, editada);

    const totalCanal = totaisPorCanal.get(canal);
    if (!(totalCanal && totalCanal > 0)) return lista;

    const indices = lista.flatMap((p, i) => (p.canal === canal ? [i] : []));
    const parcelasDoCanal = indices.map((i) => lista[i]);
    const editadaNoCanal = indices.indexOf(editada);
    const ajustadas = redistribuirNaUltimaEmAberto(
      parcelasDoCanal,
      totalCanal,
      editadaNoCanal
    );
    const porIndice = new Map(indices.map((indice, i) => [indice, ajustadas[i]]));
    return lista.map((p, i) => porIndice.get(i) ?? p);
  }

  function basePercentual(p: CompraGastoParcela): number {
    return p.canal ? (totaisPorCanal.get(p.canal) ?? 0) : total;
  }

  function dividirEm(quantidade: number) {
    setModelo("manual");
    const base = cents(total - somaPagas);
    const novas = gerarParcelas(base > 0 ? base : total, quantidade, primeiroVencimento, intervalo);
    if (novas.length === 0) return;
    onChange(renumerar([...pagas, ...novas]));
    setEdicao(null);
  }

  function alterarData(indice: number, valor: string) {
    setModelo("manual");
    onChange(parcelas.map((p, i) => (i === indice ? { ...p, vencimento: valor } : p)));
  }

  function alterarValor(indice: number, texto: string) {
    setModelo("manual");
    setEdicao({ linha: indice, campo: "valor", texto });
    const valor = Math.max(0, parseMoeda(texto));
    onChange(comAjuste(parcelas.map((p, i) => (i === indice ? { ...p, valor } : p)), indice));
  }

  function alterarPct(indice: number, texto: string) {
    setModelo("manual");
    setEdicao({ linha: indice, campo: "pct", texto });
    const pct = Math.max(0, parseMoeda(texto));
    const valor = cents((basePercentual(parcelas[indice]) * pct) / 100);
    onChange(comAjuste(parcelas.map((p, i) => (i === indice ? { ...p, valor } : p)), indice));
  }

  function remover(indice: number) {
    setModelo("manual");
    setEdicao(null);
    const removida = parcelas[indice];
    onChange(
      comAjuste(
        renumerar(parcelas.filter((_, i) => i !== indice)),
        -1,
        removida?.canal
      )
    );
  }

  function adicionar() {
    const ultima = parcelas[parcelas.length - 1];
    setModelo("manual");
    setEdicao(null);
    onChange(
      renumerar([
        ...parcelas,
        {
          numero: parcelas.length + 1,
          vencimento: proximoMes(ultima?.vencimento ?? primeiroVencimento),
          valor: 0,
          pago: false,
          dataPagamento: null,
        },
      ])
    );
  }

  /** Joga a sobra/falta na última parcela em aberto. */
  function fecharNaUltima() {
    onChange(redistribuirNaUltimaEmAberto(parcelas, total, -1));
    setEdicao(null);
  }

  function textoValor(p: CompraGastoParcela, i: number): string {
    if (edicao && edicao.linha === i && edicao.campo === "valor") return edicao.texto;
    return money(p.valor);
  }

  function textoPct(p: CompraGastoParcela, i: number): string {
    if (edicao && edicao.linha === i && edicao.campo === "pct") return edicao.texto;
    const base = basePercentual(p);
    if (base <= 0) return "";
    const pct = (p.valor / base) * 100;
    return String(Math.round(pct * 10) / 10).replace(".", ",");
  }

  const quantidadeAtual = parcelas.length;

  return (
    <div className={styles.parcelas}>
      <div className={styles.splitBar}>
        <span className={styles.splitLabel}>Dividir em</span>
        <div className={styles.atalhos}>
          {ATALHOS.map((n) => (
            <button
              key={n}
              type="button"
              className={`${styles.atalho} ${
                modelo === "manual" && quantidadeAtual === n ? styles.atalhoAtivo : ""
              }`}
              onClick={() => dividirEm(n)}
              disabled={disabled}
            >
              {n}x
            </button>
          ))}
        </div>
        <label className={styles.splitCampo}>
          <span>a partir de</span>
          <input
            type="date"
            value={primeiroVencimento}
            disabled={disabled}
            onChange={(e) => setPrimeiroVencimento(e.target.value)}
          />
        </label>
        <span className={styles.splitDica}>
          ou digite % / valor numa linha — as outras fecham a conta
        </span>
        <label className={styles.splitCampo}>
          <span>Tipo:</span>
          <select
            value={modelo}
            disabled={disabled}
            title={modeloAtivo.dica}
            onChange={(e) => setModelo(e.target.value as CompraGastoModeloParcelamento)}
          >
            {MODELOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.splitCampo}>
          <span>a cada</span>
          <select
            value={intervalo}
            disabled={disabled}
            onChange={(e) => setIntervalo(e.target.value as "mensal" | "quinzenal")}
          >
            <option value="mensal">mês</option>
            <option value="quinzenal">15 dias</option>
          </select>
        </label>
      </div>

      {modelo !== "manual" && <p className={styles.modeloDica}>{modeloAtivo.dica}</p>}

      <div className={styles.parcelaGrid}>
        <div
          className={`${styles.parcelaRow} ${temCanal ? styles.parcelaRowCanal : ""} ${styles.parcelaHead}`}
        >
          <span>#</span>
          <span>Vencimento</span>
          {temCanal && <span>Pagamento</span>}
          <span className={styles.alinhaDireita}>%</span>
          <span className={styles.alinhaDireita}>Valor</span>
          <span />
        </div>

        {parcelas.map((p, i) => (
          <div
            className={`${styles.parcelaRow} ${temCanal ? styles.parcelaRowCanal : ""}`}
            key={i}
          >
            <span className={styles.parcelaNum}>{i + 1}</span>
            <input
              type="date"
              value={p.vencimento}
              disabled={disabled || p.pago}
              onChange={(e) => alterarData(i, e.target.value)}
            />
            {temCanal && (
              <span
                className={styles.canalCell}
                title={p.etapa ? `${p.canal ? COMPRA_GASTO_CANAL_LABEL[p.canal] : "pagamento único"} — ${p.etapa}` : undefined}
              >
                {p.canal ? (
                  <span className={`${styles.tag} ${styles[`canal_${p.canal}`]}`}>
                    {COMPRA_GASTO_CANAL_CURTO[p.canal]}
                  </span>
                ) : (
                  <span className={styles.muted}>—</span>
                )}
              </span>
            )}
            <input
                className={styles.pctInput}
                value={textoPct(p, i)}
                inputMode="decimal"
                placeholder="0"
                disabled={disabled || p.pago || total <= 0}
                onChange={(e) => alterarPct(i, e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => setEdicao(null)}
                aria-label={`Percentual da parcela ${i + 1}${p.canal ? ` de ${COMPRA_GASTO_CANAL_LABEL[p.canal]}` : ""}`}
              />
            <input
              className={`${styles.money} ${styles.valorInput}`}
              value={textoValor(p, i)}
              inputMode="decimal"
              disabled={disabled || p.pago}
              onChange={(e) => alterarValor(i, e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => setEdicao(null)}
              aria-label={`Valor da parcela ${i + 1}`}
            />
            {p.pago ? (
              <span className={`${styles.pill} ${styles.pillGood}`} title="parcela já paga">
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

        <div className={styles.fechamento}>
          <span className={styles.cardNote}>{rodape ?? "Soma das parcelas"}</span>
          <b className={fecha ? undefined : styles.neg}>{brl(soma)}</b>
          {total > 0 &&
            (fecha ? (
              <span className={`${styles.pill} ${styles.pillGood}`}>
                <i />
                fecha com a compra
              </span>
            ) : (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSm}`}
                onClick={fecharNaUltima}
                disabled={disabled || indiceBalanceadora < 0}
              >
                {diferenca < 0 ? "Faltam" : "Sobram"} {brl(Math.abs(diferenca))} — ajustar
              </button>
            ))}
        </div>
      </div>

      {temCanal && (
        <div className={styles.canalResumo}>
          {resumoPorCanal(parcelas).map((r) => (
            <span className={styles.canalResumoItem} key={r.canal}>
              <span className={`${styles.tag} ${styles[`canal_${r.canal}`]}`}>{r.label}</span>
              <b>{brl(r.total)}</b>
              <span className={styles.cardNote}>
                {r.parcelas} {r.parcelas === 1 ? "pagamento" : "pagamentos"}
              </span>
            </span>
          ))}
        </div>
      )}

      {somaPagas > 0 && (
        <p className={styles.note}>
          {brl(somaPagas)} já pago fica travado: dividir de novo só redistribui os{" "}
          {brl(cents(total - somaPagas))} restantes.
        </p>
      )}
    </div>
  );
}

/** Mesma data no mês seguinte, caindo no último dia quando o mês é mais curto. */
function proximoMes(iso: string): string {
  if (!iso) return iso;
  const ano = parseInt(iso.slice(0, 4), 10);
  const mes = parseInt(iso.slice(5, 7), 10);
  const dia = parseInt(iso.slice(8, 10), 10);
  const alvoAno = mes === 12 ? ano + 1 : ano;
  const alvoMes = mes === 12 ? 1 : mes + 1;
  const ultimoDia = new Date(Date.UTC(alvoAno, alvoMes, 0)).getUTCDate();
  return `${alvoAno}-${String(alvoMes).padStart(2, "0")}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
}
