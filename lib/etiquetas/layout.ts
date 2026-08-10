/**
 * Calcula a caixa (x, y, largura, altura, em mm) de cada elemento visível da
 * etiqueta — cada linha de texto, o código de barras e o número embaixo dele.
 *
 * É a MESMA conta usada pelo preview (EtiquetaSvg), pelo editor visual
 * (arrastar/redimensionar) e pelo ZPL (zpl.ts) — um só lugar garante que o que
 * aparece na tela é o que sai impresso.
 *
 * Três camadas, nesta ordem:
 *  1. a pilha automática (elementos empilhados de cima para baixo);
 *  2. a posição arrastada no editor (`xMm`/`yMm` de um elemento específico);
 *  3. a calibração global (escala + deslocamento), que vale para TODOS.
 */

import { encodeBarcode } from './barcode';
import {
  dadoDoBarcode,
  dotsPorMm,
  type Alinhamento,
  type EtiquetaConfig,
  type ItemEtiqueta,
} from './tipos';

export type TipoElementoLayout = 'linha' | 'barcode' | 'numero';

export interface ElementoLayout {
  chave: string;
  tipo: TipoElementoLayout;
  linhaId?: string;
  xMm: number;
  yMm: number;
  larguraMm: number;
  /** Altura JÁ com a escala de calibração aplicada — use esta, não a do modelo. */
  alturaMm: number;
  alinhamento: Alinhamento;
  /** true quando a posição vem de um arraste salvo (override), não da pilha automática. */
  manual: boolean;
}

function temOverride(x: unknown, y: unknown): x is number {
  return typeof x === 'number' && typeof y === 'number';
}

/** Escala de calibração, sempre um número usável. */
export function escalaDe(config: EtiquetaConfig): number {
  const e = config.calibracao?.escala;
  return Number.isFinite(e) && (e as number) > 0 ? (e as number) : 1;
}

/**
 * Largura do módulo do código de barras já calibrada, em dots.
 *
 * A Zebra só aceita módulo inteiro (^BY), então a escala aqui é quantizada:
 * escala 1,2 sobre módulo 2 dá 2,4 → 2. É por isso que o código de barras
 * "engrossa em degraus" enquanto o texto cresce liso.
 */
export function moduloEfetivoDots(config: EtiquetaConfig): number {
  return Math.max(1, Math.round(config.barcode.moduloDots * escalaDe(config)));
}

/**
 * `item` é opcional: sem ele (ex.: painel de configuração antes de haver
 * exemplo) o código de barras usa uma largura de referência; com ele, usa a
 * largura real do código codificado — a mesma largura que vai para o papel.
 */
export function calcularLayout(config: EtiquetaConfig, item?: ItemEtiqueta | null): ElementoLayout[] {
  const escala = escalaDe(config);
  const deslocX = config.calibracao?.deslocXMm ?? 0;
  const deslocY = config.calibracao?.deslocYMm ?? 0;

  const { larguraEtiquetaMm: L, margemInternaMm: M } = config;
  const x0 = M;
  const larguraUtil = Math.max(0, L - M * 2);

  const cru: ElementoLayout[] = [];
  // A margem do topo escala junto: assim o conteúdo inteiro cresce a partir do
  // canto, como um zoom, em vez de crescer e "descolar" da borda.
  let y = (config.margemTopoMm + M) * escala;

  for (const linha of config.linhas) {
    if (!linha.visivel) continue;
    const alturaMm = linha.alturaMm * escala;
    const manual = temOverride(linha.xMm, linha.yMm);
    cru.push({
      chave: `linha-${linha.id}`,
      tipo: 'linha',
      linhaId: linha.id,
      // A caixa sempre tem a largura útil da etiqueta (é o que o ^FB usa) —
      // `linha.larguraMm` é um controle separado, só da largura da FONTE no
      // ZPL, não do tamanho da caixa/arraste.
      xMm: manual ? (linha.xMm as number) * escala : x0,
      yMm: manual ? (linha.yMm as number) * escala : y,
      larguraMm: larguraUtil,
      alturaMm,
      // Arrastado no editor = ancorado no ponto exato do arraste (como um
      // objeto solto numa peça gráfica); o alinhamento left/center/right só
      // faz sentido dentro da pilha automática.
      alinhamento: manual ? 'left' : linha.alinhamento,
      manual,
    });
    y += alturaMm + linha.espacoAbaixoMm * escala;
  }

  if (config.barcode.alturaMm > 0) {
    y += config.barcode.espacoAcimaMm * escala;

    const moduloMm = moduloEfetivoDots(config) / dotsPorMm(config.impressora.dpi);
    let larguraBarras = larguraUtil * 0.6;
    if (item) {
      const dado = dadoDoBarcode(item, config);
      const codificado = dado ? encodeBarcode(dado, config.barcode.simbologia) : null;
      if (codificado) larguraBarras = codificado.modulos * moduloMm;
    }
    larguraBarras = Math.min(larguraBarras, larguraUtil);

    const sobra = Math.max(0, larguraUtil - larguraBarras);
    const desloc =
      config.barcode.alinhamento === 'center'
        ? sobra / 2
        : config.barcode.alinhamento === 'right'
          ? sobra
          : 0;

    const alturaBarras = config.barcode.alturaMm * escala;
    const manual = temOverride(config.barcode.xMm, config.barcode.yMm);
    const xBarcode = manual ? (config.barcode.xMm as number) * escala : x0 + desloc;
    const yBarcode = manual ? (config.barcode.yMm as number) * escala : y;
    cru.push({
      chave: 'barcode',
      tipo: 'barcode',
      xMm: xBarcode,
      yMm: yBarcode,
      larguraMm: larguraBarras,
      alturaMm: alturaBarras,
      alinhamento: manual ? 'left' : config.barcode.alinhamento,
      manual,
    });
    y += alturaBarras;

    // O número impresso sempre acompanha o código de barras — se ele foi
    // arrastado, o número desce/sobe junto, embaixo das barras.
    if (config.barcode.mostrarNumero) {
      cru.push({
        chave: 'numero',
        tipo: 'numero',
        xMm: x0,
        yMm: yBarcode + alturaBarras + config.barcode.espacoNumeroMm * escala,
        larguraMm: larguraUtil,
        alturaMm: config.barcode.alturaNumeroMm * escala,
        alinhamento: config.barcode.alinhamento,
        manual: false,
      });
    }
  }

  // O deslocamento entra por último, igual para todo mundo: é a régua de
  // calibração, não faz parte do desenho do modelo.
  if (deslocX === 0 && deslocY === 0) return cru;
  return cru.map((e) => ({ ...e, xMm: e.xMm + deslocX, yMm: e.yMm + deslocY }));
}

export function elementoPorChave(layout: ElementoLayout[], chave: string): ElementoLayout | undefined {
  return layout.find((e) => e.chave === chave);
}
