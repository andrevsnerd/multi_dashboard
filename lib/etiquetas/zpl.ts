/**
 * Gerador de ZPL II para a ZDesigner ZD230-203dpi ZPL.
 *
 * Cada `^XA...^XZ` é uma FILEIRA (as N colunas lado a lado da mídia contínua de
 * 104mm). Fileiras idênticas consecutivas são colapsadas em `^PQ`, então
 * "80 etiquetas do mesmo item" viram um formato só repetido 27 vezes.
 *
 * Puro (sem `server-only`) de propósito: o cliente monta o ZPL para mandar ao
 * Zebra Browser Print sem passar pelo servidor.
 */

import { encodeBarcode } from './barcode';
import {
  dadoDoBarcode,
  dotsPorMm,
  textoDaLinha,
  type EtiquetaConfig,
  type ItemEtiqueta,
  type Alinhamento,
} from './tipos';

/** Item + quantas cópias imprimir. */
export interface ItemComQuantidade {
  item: ItemEtiqueta;
  quantidade: number;
}

const JUSTIFICACAO: Record<Alinhamento, string> = { left: 'L', center: 'C', right: 'R' };

/** `^` e `~` são caracteres de comando do ZPL — não podem entrar cru no ^FD. */
function limparTexto(texto: string): string {
  return texto.replace(/[\^~]/g, ' ').replace(/\s+/g, ' ').trim();
}

function mm(valor: number, dpmm: number): number {
  return Math.round(valor * dpmm);
}

/** Bloco de texto justificado dentro da largura da etiqueta. */
function comandoTexto(
  texto: string,
  x: number,
  y: number,
  alturaDots: number,
  larguraDots: number,
  larguraBloco: number,
  alinhamento: Alinhamento,
  negrito: boolean
): string {
  const limpo = limparTexto(texto);
  if (!limpo) return '';
  // Largura 0 = a Zebra mantém a proporção natural da fonte, que é o mesmo que o
  // Helvetica faz no preview SVG. Forçar uma largura fixa deixava o impresso mais
  // estreito do que a tela mostrava.
  const fonte = `^A0N,${alturaDots},${larguraDots || 0}`;
  const bloco = `^FB${larguraBloco},1,0,${JUSTIFICACAO[alinhamento]}`;
  let out = `^FO${x},${y}${fonte}${bloco}^FD${limpo}^FS`;
  // ^A0 não tem negrito: repete o campo deslocado 1 dot para engrossar.
  if (negrito) out += `^FO${x + 1},${y}${fonte}${bloco}^FD${limpo}^FS`;
  return out;
}

function comandoBarcode(
  dado: string,
  config: EtiquetaConfig,
  xEtiqueta: number,
  y: number,
  larguraEtiquetaDots: number,
  alturaDots: number
): string {
  const { simbologia, moduloDots } = config.barcode;
  const codificado = encodeBarcode(dado, simbologia);
  if (!codificado) return '';

  // Centraliza/alinha usando a largura real em módulos — a mesma conta do preview.
  const larguraBarrasDots = codificado.modulos * moduloDots;
  const sobra = Math.max(0, larguraEtiquetaDots - larguraBarrasDots);
  const desloc =
    config.barcode.alinhamento === 'center'
      ? Math.round(sobra / 2)
      : config.barcode.alinhamento === 'right'
        ? sobra
        : 0;
  const x = xEtiqueta + desloc;

  const by = `^BY${moduloDots},3,${alturaDots}`;
  const dados = limparTexto(dado);

  // A linha do número é impressa por nós (campo de texto próprio), não pelo
  // parâmetro de "interpretation line" — assim o tamanho e o alinhamento
  // seguem a configuração da tela.
  let comando: string;
  if (simbologia === 'EAN13') comando = `^BEN,${alturaDots},N,N`;
  else if (simbologia === 'CODE39') comando = `^B3N,N,${alturaDots},N,N`;
  else if (simbologia === 'ITF') comando = `^B2N,${alturaDots},N,N,N`;
  else comando = `^BCN,${alturaDots},N,N,N`;

  return `${by}^FO${x},${y}${comando}^FD${dados}^FS`;
}

/** Desenha uma etiqueta na posição x da fileira. Devolve o ZPL do conteúdo. */
function zplDaEtiqueta(item: ItemEtiqueta, config: EtiquetaConfig, xBaseDots: number): string {
  const dpmm = dotsPorMm(config.impressora.dpi);
  const larguraUtil = mm(config.larguraEtiquetaMm - config.margemInternaMm * 2, dpmm);
  const x = xBaseDots + mm(config.margemInternaMm, dpmm);

  const partes: string[] = [];
  let y = mm(config.margemTopoMm + config.margemInternaMm, dpmm);

  for (const linha of config.linhas) {
    if (!linha.visivel) continue;
    const alturaDots = mm(linha.alturaMm, dpmm);
    const larguraDots = mm(linha.larguraMm, dpmm);
    partes.push(
      comandoTexto(
        textoDaLinha(item, linha),
        x,
        y,
        alturaDots,
        larguraDots,
        larguraUtil,
        linha.alinhamento,
        linha.negrito
      )
    );
    y += alturaDots + mm(linha.espacoAbaixoMm, dpmm);
  }

  const dado = dadoDoBarcode(item, config);
  if (dado && config.barcode.alturaMm > 0) {
    y += mm(config.barcode.espacoAcimaMm, dpmm);
    const alturaBarras = mm(config.barcode.alturaMm, dpmm);
    partes.push(comandoBarcode(dado, config, x, y, larguraUtil, alturaBarras));
    y += alturaBarras;
  }

  if (dado && config.barcode.mostrarNumero) {
    const alturaNumero = mm(config.barcode.alturaNumeroMm, dpmm);
    partes.push(
      comandoTexto(dado, x, y, alturaNumero, 0, larguraUtil, config.barcode.alinhamento, false)
    );
  }

  return partes.filter(Boolean).join('');
}

/** Explode a lista em etiquetas individuais e agrupa em fileiras de N colunas. */
export function montarFileiras(
  itens: ItemComQuantidade[],
  colunas: number
): ItemEtiqueta[][] {
  const planas: ItemEtiqueta[] = [];
  for (const { item, quantidade } of itens) {
    const qtd = Math.max(0, Math.floor(quantidade));
    for (let i = 0; i < qtd; i += 1) planas.push(item);
  }
  const fileiras: ItemEtiqueta[][] = [];
  for (let i = 0; i < planas.length; i += colunas) {
    fileiras.push(planas.slice(i, i + colunas));
  }
  return fileiras;
}

export interface AnaliseBarras {
  /** Largura do maior código da fila, em mm. */
  larguraMaxMm: number;
  /** Área útil da etiqueta (descontadas as margens internas). */
  larguraUtilMm: number;
  /** Silêncio de cada lado do código mais largo. */
  quietZoneMm: number;
  /** O código não cabe: a Zebra corta as barras e nada lê. */
  estoura: boolean;
  /**
   * Cabe, mas o silêncio lateral está abaixo dos 10 módulos (mín. 2,5mm a
   * 0,25mm/módulo) que as normas pedem — leitor engasga nas bordas.
   */
  quietZoneCurta: boolean;
}

/**
 * Confere se o código de barras cabe fisicamente na etiqueta. Existe porque
 * simbologia larga (Code 39) ou módulo grande estouram os 27mm sem aviso: a
 * Zebra simplesmente corta as barras e a etiqueta sai ilegível.
 */
export function analisarBarras(itens: ItemComQuantidade[], config: EtiquetaConfig): AnaliseBarras {
  const larguraUtilMm = Math.max(0, config.larguraEtiquetaMm - config.margemInternaMm * 2);
  const moduloMm = config.barcode.moduloDots / dotsPorMm(config.impressora.dpi);

  let maxModulos = 0;
  for (const { item } of itens) {
    const codificado = encodeBarcode(dadoDoBarcode(item, config), config.barcode.simbologia);
    if (codificado && codificado.modulos > maxModulos) maxModulos = codificado.modulos;
  }

  const larguraMaxMm = maxModulos * moduloMm;
  const quietZoneMm = (larguraUtilMm - larguraMaxMm) / 2;

  return {
    larguraMaxMm,
    larguraUtilMm,
    quietZoneMm,
    estoura: maxModulos > 0 && larguraMaxMm > larguraUtilMm + 0.01,
    quietZoneCurta: maxModulos > 0 && larguraMaxMm <= larguraUtilMm && quietZoneMm < 10 * moduloMm,
  };
}

export interface ResultadoZpl {
  zpl: string;
  totalEtiquetas: number;
  totalFileiras: number;
  /** Itens cujo código não pôde virar barras na simbologia escolhida. */
  semBarcode: Array<{ produto: string; cor: string; codigo: string }>;
}

/** Monta o job ZPL completo. */
export function gerarZpl(itens: ItemComQuantidade[], config: EtiquetaConfig): ResultadoZpl {
  const dpmm = dotsPorMm(config.impressora.dpi);
  const fileiras = montarFileiras(itens, config.colunas);

  const semBarcode: ResultadoZpl['semBarcode'] = [];
  const vistos = new Set<string>();
  for (const { item } of itens) {
    const dado = dadoDoBarcode(item, config);
    const chave = `${item.produto}|${item.cor}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    if (!encodeBarcode(dado, config.barcode.simbologia)) {
      semBarcode.push({ produto: item.produto, cor: item.cor, codigo: dado });
    }
  }

  // A margem do topo é interna à etiqueta, então a fileira mede só a etiqueta
  // mais o avanço extra de papel entre fileiras.
  const alturaFileira = mm(config.alturaEtiquetaMm + config.espacoLinhasMm, dpmm);
  const larguraMidia = mm(config.impressora.larguraMidiaMm, dpmm);
  const passoColuna = mm(config.larguraEtiquetaMm + config.espacoColunasMm, dpmm);
  const margemEsq = mm(config.margemEsquerdaMm, dpmm);

  const cabecalho: string[] = [];
  // Escuridão e velocidade valem para a sessão inteira (fora do formato).
  cabecalho.push(`~SD${String(Math.round(config.impressora.escuridao)).padStart(2, '0')}`);

  const prefixo = [
    '^XA',
    '^CI28', // UTF-8: acentos das descrições saem certos
    `^PW${larguraMidia}`,
    `^LL${alturaFileira}`,
    `^LH${mm(config.impressora.offsetEsquerdaMm, dpmm)},${mm(config.impressora.offsetTopoMm, dpmm)}`,
    config.impressora.tipoMidia === 'gap' ? '^MNY' : config.impressora.tipoMidia === 'marca' ? '^MNM' : '^MNN',
    config.impressora.modoImpressao === 'termica-direta' ? '^MTD' : '^MTT',
    `^PR${Math.max(2, Math.round(config.impressora.velocidadeMmS / 25.4))}`,
    '^PON', // orientação normal (0° retrato, igual ao driver)
    '^LT0',
  ].join('');

  const corpos: string[] = [];
  for (const fileira of fileiras) {
    const partes = fileira.map((item, coluna) =>
      zplDaEtiqueta(item, config, margemEsq + coluna * passoColuna)
    );
    corpos.push(partes.join(''));
  }

  // Fileiras idênticas consecutivas → um formato só com ^PQ.
  const blocos: string[] = [];
  let i = 0;
  while (i < corpos.length) {
    let repete = 1;
    while (i + repete < corpos.length && corpos[i + repete] === corpos[i]) repete += 1;
    const pq = repete > 1 ? `^PQ${repete},0,0,N` : '';
    blocos.push(`${prefixo}${corpos[i]}${pq}^XZ`);
    i += repete;
  }

  const totalEtiquetas = fileiras.reduce((soma, f) => soma + f.length, 0);

  return {
    zpl: [...cabecalho, ...blocos].join('\n'),
    totalEtiquetas,
    totalFileiras: fileiras.length,
    semBarcode,
  };
}
