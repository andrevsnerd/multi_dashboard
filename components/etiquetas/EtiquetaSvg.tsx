"use client";

/**
 * Desenho de UMA etiqueta em SVG, com o viewBox em MILÍMETROS.
 *
 * É a mesma geometria que o gerador de ZPL usa (mesmas margens, mesma ordem de
 * linhas, mesma conta de centralização das barras), então o que aparece na tela
 * é o que sai na Zebra. Serve para o preview e para o caminho "imprimir pelo
 * navegador", onde o SVG vai direto para a folha em mm.
 */

import { barrasDoBinario, encodeBarcode, motivoFalha } from "@/lib/etiquetas/barcode";
import { calcularLayout, elementoPorChave, escalaDe, moduloEfetivoDots } from "@/lib/etiquetas/layout";
import {
  dadoDoBarcode,
  larguraCaractereMm,
  textoDaLinha,
  type Alinhamento,
  type EtiquetaConfig,
  type ItemEtiqueta,
} from "@/lib/etiquetas/tipos";

interface Props {
  item: ItemEtiqueta;
  config: EtiquetaConfig;
  /** Mostra a borda tracejada da etiqueta (só no preview da tela). */
  comBorda?: boolean;
  className?: string;
  /** Largura renderizada. Sem isso o SVG ocupa exatamente os mm reais. */
  larguraCss?: string;
}

function ancora(alinhamento: Alinhamento): "start" | "middle" | "end" {
  if (alinhamento === "center") return "middle";
  if (alinhamento === "right") return "end";
  return "start";
}

function xDoTexto(alinhamento: Alinhamento, x: number, largura: number): number {
  if (alinhamento === "center") return x + largura / 2;
  if (alinhamento === "right") return x + largura;
  return x;
}

export default function EtiquetaSvg({ item, config, comBorda, className, larguraCss }: Props) {
  const { larguraEtiquetaMm: L, alturaEtiquetaMm: A } = config;

  const elementos: React.ReactNode[] = [];
  const layout = calcularLayout(config, item);
  const escala = escalaDe(config);

  // No ZPL a altura da fonte (^A0N,h) é a caixa do caractere e a linha de base
  // fica a ~78% dela. Reproduzir isso aqui é o que faz o preview bater com o
  // que sai impresso. O que passar da etiqueta é cortado pelo viewBox — mesmo
  // comportamento do ^FB da Zebra.
  const BASELINE = 0.78;

  config.linhas.forEach((linha, i) => {
    if (!linha.visivel) return;
    const texto = textoDaLinha(item, linha);
    if (!texto) return;
    const box = elementoPorChave(layout, `linha-${linha.id}`);
    if (!box) return;

    // A fonte D da Zebra é MONOESPAÇADA e só existe em múltiplos de 18x10 dots.
    // O preview precisa desenhar do mesmo jeito, senão a tela volta a mentir
    // sobre o que cabe: aqui a largura de cada caractere é travada em mm reais
    // (textLength + lengthAdjust), não deixada para a fonte do navegador.
    const larguraCar = larguraCaractereMm(linha, config.impressora.dpi);
    const monoespacada = linha.fonteZpl === 'bitmap';
    elementos.push(
      <text
        key={`linha-${linha.id}-${i}`}
        x={xDoTexto(box.alinhamento, box.xMm, box.larguraMm)}
        y={box.yMm + box.alturaMm * BASELINE}
        textAnchor={ancora(box.alinhamento)}
        fontSize={box.alturaMm}
        fontWeight={linha.negrito ? 700 : 400}
        fontFamily={
          monoespacada
            ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
            : 'Helvetica, Arial, sans-serif'
        }
        textLength={monoespacada ? texto.length * larguraCar * escala : undefined}
        lengthAdjust={monoespacada ? 'spacingAndGlyphs' : undefined}
        fill="#000"
      >
        {texto}
      </text>
    );
  });

  const dado = dadoDoBarcode(item, config);
  const codificado = dado ? encodeBarcode(dado, config.barcode.simbologia) : null;
  // 1 dot a 203dpi = 1/8 mm. O módulo é configurado em dots para bater com o ^BY.
  const moduloMm = moduloEfetivoDots(config) / (config.impressora.dpi / 25.4);
  const boxBarcode = elementoPorChave(layout, "barcode");

  if (boxBarcode) {
    if (codificado) {
      for (const barra of barrasDoBinario(codificado.binario)) {
        elementos.push(
          <rect
            key={`b-${barra.x}`}
            x={boxBarcode.xMm + barra.x * moduloMm}
            y={boxBarcode.yMm}
            width={barra.largura * moduloMm}
            height={boxBarcode.alturaMm}
            fill="#000"
          />
        );
      }
    } else {
      elementos.push(
        <text
          key="sem-barra"
          x={boxBarcode.xMm}
          y={boxBarcode.yMm + boxBarcode.alturaMm * 0.7}
          fontSize={Math.min(2, boxBarcode.alturaMm * 0.5)}
          fontFamily="Helvetica, Arial, sans-serif"
          fill="#b91c1c"
        >
          {motivoFalha(dado, config.barcode.simbologia)}
        </text>
      );
    }
  }

  const boxNumero = elementoPorChave(layout, "numero");
  if (dado && boxNumero) {
    elementos.push(
      <text
        key="numero"
        x={xDoTexto(boxNumero.alinhamento, boxNumero.xMm, boxNumero.larguraMm)}
        y={boxNumero.yMm + boxNumero.alturaMm * BASELINE}
        textAnchor={ancora(boxNumero.alinhamento)}
        fontSize={boxNumero.alturaMm}
        fontFamily="Helvetica, Arial, sans-serif"
        fill="#000"
      >
        {dado}
      </text>
    );
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${L} ${A}`}
      width={larguraCss ?? `${L}mm`}
      height={larguraCss ? undefined : `${A}mm`}
      style={larguraCss ? { aspectRatio: `${L} / ${A}` } : undefined}
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={L} height={A} fill="#fff" />
      {comBorda ? (
        <rect
          x={0.05}
          y={0.05}
          width={L - 0.1}
          height={A - 0.1}
          fill="none"
          stroke="#cbd5e1"
          strokeWidth={0.1}
          strokeDasharray="0.6 0.4"
        />
      ) : null}
      {elementos}
    </svg>
  );
}
