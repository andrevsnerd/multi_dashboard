"use client";

/**
 * Ajuste fino da impressão — três controles que valem para TODOS os elementos
 * ao mesmo tempo (horizontal, vertical e tamanho).
 *
 * É o laço prático de calibração: imprime uma tira, vê que saiu deslocada ou
 * grande demais, arrasta aqui, imprime de novo. Não mexe no modelo (a posição
 * de cada linha, as fontes, o código de barras) — só desloca e escala o
 * conjunto na hora de desenhar, então o botão "zerar" sempre devolve o
 * desenho original.
 */

import { useState } from "react";

import { CALIBRACAO_NEUTRA, type EtiquetaConfig } from "@/lib/etiquetas/tipos";

import styles from "./ImprimirEtiquetasPage.module.css";

interface Props {
  config: EtiquetaConfig;
  onChange: (config: EtiquetaConfig) => void;
  podeConfigurar: boolean;
}

function Controle({
  label,
  valor,
  onChange,
  min,
  max,
  passo,
  formatar,
  desabilitado,
}: {
  label: string;
  valor: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  passo: number;
  formatar: (v: number) => string;
  desabilitado?: boolean;
}) {
  return (
    <div className={styles.calibracaoControle}>
      <div className={styles.calibracaoLabel}>
        <span>{label}</span>
        <span className={styles.calibracaoValor}>{formatar(valor)}</span>
      </div>
      <div className={styles.calibracaoLinha}>
        <button
          type="button"
          className={styles.botaoMini}
          onClick={() => onChange(Math.max(min, Number((valor - passo).toFixed(3))))}
          disabled={desabilitado || valor <= min}
          aria-label={`Diminuir ${label}`}
        >
          −
        </button>
        <input
          type="range"
          className={styles.calibracaoSlider}
          min={min}
          max={max}
          step={passo}
          value={valor}
          disabled={desabilitado}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button
          type="button"
          className={styles.botaoMini}
          onClick={() => onChange(Math.min(max, Number((valor + passo).toFixed(3))))}
          disabled={desabilitado || valor >= max}
          aria-label={`Aumentar ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function CalibracaoEtiqueta({ config, onChange, podeConfigurar }: Props) {
  const [copiado, setCopiado] = useState(false);
  const cal = config.calibracao ?? CALIBRACAO_NEUTRA;

  const set = (patch: Partial<EtiquetaConfig["calibracao"]>) =>
    onChange({ ...config, calibracao: { ...cal, ...patch } });

  const neutra = cal.deslocXMm === 0 && cal.deslocYMm === 0 && cal.escala === 1;

  /** Texto pronto para colar de volta no chat quando os valores ficarem bons. */
  const copiarValores = async () => {
    const texto =
      `Calibração da etiqueta que ficou certa (${config.nomeModelo}, ` +
      `${config.larguraEtiquetaMm}x${config.alturaEtiquetaMm}mm): ` +
      `horizontal ${cal.deslocXMm}mm, vertical ${cal.deslocYMm}mm, ` +
      `tamanho ${Math.round(cal.escala * 100)}%. Torne isso o novo padrão.`;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      // clipboard bloqueado (http sem permissão) — o usuário ainda lê os números na tela
    }
  };

  return (
    <div className={styles.calibracao}>
      <div className={styles.cardHeader}>
        <span className={styles.secaoTitulo}>Ajuste fino da impressão</span>
        {!neutra ? (
          <button
            type="button"
            className={styles.botaoLink}
            onClick={() => set({ ...CALIBRACAO_NEUTRA })}
            disabled={!podeConfigurar}
          >
            zerar
          </button>
        ) : null}
      </div>

      <Controle
        label="Horizontal"
        valor={cal.deslocXMm}
        onChange={(v) => set({ deslocXMm: v })}
        min={-10}
        max={10}
        passo={0.1}
        formatar={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}mm`}
        desabilitado={!podeConfigurar}
      />
      <Controle
        label="Vertical"
        valor={cal.deslocYMm}
        onChange={(v) => set({ deslocYMm: v })}
        min={-10}
        max={10}
        passo={0.1}
        formatar={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}mm`}
        desabilitado={!podeConfigurar}
      />
      <Controle
        label="Tamanho"
        valor={cal.escala}
        onChange={(v) => set({ escala: v })}
        min={0.5}
        max={1.6}
        passo={0.01}
        formatar={(v) => `${Math.round(v * 100)}%`}
        desabilitado={!podeConfigurar}
      />

      <div className={styles.calibracaoRodape}>
        <span>
          Vale para tudo de uma vez. Imprima, veja o resultado e ajuste — depois{" "}
          <strong>Salvar modelo</strong> guarda para a empresa.
        </span>
        {!neutra ? (
          <button type="button" className={styles.botaoLink} onClick={() => void copiarValores()}>
            {copiado ? "copiado!" : "copiar valores"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
