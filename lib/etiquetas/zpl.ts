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

import { dadosZplCode128, encodeBarcode } from './barcode';
import { calcularLayout, elementoPorChave, escalaDe, moduloEfetivoDots } from './layout';
import {
  alturaConteudoBrutaMm,
  CAMPOS_DISPONIVEIS,
  clonarConfig,
  dadoDoBarcode,
  dotsPorMm,
  FONTE_A_BASE,
  larguraCaractereMm,
  larguraTextoMm,
  metricaDaLinha,
  textoDaLinha,
  type EtiquetaConfig,
  type ItemEtiqueta,
  type Alinhamento,
  type FonteZpl,
  type LinhaEtiqueta,
} from './tipos';

/** Item + quantas cópias imprimir. */
export interface ItemComQuantidade {
  item: ItemEtiqueta;
  quantidade: number;
}

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
  negrito: boolean,
  fonteZpl: FonteZpl,
  dpmm: number
): string {
  const limpo = limparTexto(texto);
  if (!limpo) return '';

  // A métrica sai do MESMO lugar que o layout e o preview usam, então o que a
  // impressora escreve tem a largura e a altura que a tela mostrou.
  const m = metricaDaLinha(
    { alturaMm: alturaDots / dpmm, larguraMm: larguraDots / dpmm, fonteZpl },
    Math.round(dpmm * 25.4)
  );
  const fonte = `^A${m.nome}N,${m.alturaDots},${m.larguraDots}`;
  const larguraTextoDots = limpo.length * m.larguraDots;

  // O Linx não usa ^FB: posiciona com ^FO puro e corta o texto no código. Como
  // a nossa configuração tem alinhamento, o deslocamento é calculado aqui —
  // mesmo resultado, sem depender do ^FB (que descarta a sobra em silêncio).
  const sobra = Math.max(0, larguraBloco - larguraTextoDots);
  const xTexto =
    alinhamento === 'center'
      ? x + Math.round(sobra / 2)
      : alinhamento === 'right'
        ? x + sobra
        : x;

  // ^FH liga o escape hexadecimal (_XX), igual ao Linx — é o que faz acento de
  // descrição sair certo em vez de virar caractere de comando.
  let out = `^FO${xTexto},${y}${fonte}^FH^FD${limpo}^FS`;
  // Nenhuma fonte da Zebra tem negrito: repete o campo 1 dot ao lado.
  if (negrito) out += `^FO${xTexto + 1},${y}${fonte}^FH^FD${limpo}^FS`;
  return out;
}

function comandoBarcode(
  dado: string,
  config: EtiquetaConfig,
  x: number,
  y: number,
  alturaDots: number,
  dpmm: number
): string {
  const { simbologia } = config.barcode;
  const codificado = encodeBarcode(dado, simbologia);
  if (!codificado) return '';

  // x já vem posicionado (alinhamento/arraste resolvidos pelo layout.ts — a
  // mesma conta que o preview usa), não precisa recalcular deslocamento aqui.
  const by = `^BY${moduloEfetivoDots(config)},3,${alturaDots}`;
  // No Code 128 o dado leva os caracteres de invocação de subset (>; e >6), do
  // mesmo jeito que os geradores do Linx emitem. É o que faz a Zebra codificar
  // com a MESMA largura que o preview desenhou — sem eles a impressora joga
  // tudo em subset B e o código sai ~50% mais largo do que a tela mostrou.
  const dados =
    simbologia === 'CODE128' ? dadosZplCode128(limparTexto(dado)) : limparTexto(dado);

  // O número embaixo das barras é desenhado pela PRÓPRIA impressora (o "Y" da
  // interpretation line), como o Linx faz (`^BCN,55,Y,N,`). O ^CF antes fixa a
  // fonte dela — a Zebra usaria o padrão do firmware, que varia; assim o
  // tamanho é o mesmo que o preview desenha.
  const mostrar = config.barcode.mostrarNumero ? 'Y' : 'N';
  const cf = config.barcode.mostrarNumero
    ? `^CFA,${mm(config.barcode.alturaNumeroMm, dpmm)},${Math.max(
        1,
        Math.round(
          (mm(config.barcode.alturaNumeroMm, dpmm) * FONTE_A_BASE.larguraDots) /
            FONTE_A_BASE.alturaDots
        )
      )}`
    : '';

  let comando: string;
  if (simbologia === 'EAN13') comando = `^BEN,${alturaDots},${mostrar},N`;
  else if (simbologia === 'CODE39') comando = `^B3N,N,${alturaDots},${mostrar},N`;
  else if (simbologia === 'ITF') comando = `^B2N,${alturaDots},${mostrar},N,N`;
  else comando = `^BCN,${alturaDots},${mostrar},N,N`;

  return `${cf}${by}^FO${x},${y}${comando}^FD${dados}^FS`;
}

/**
 * Desenha uma etiqueta na posição x da fileira. Devolve o ZPL do conteúdo.
 *
 * As posições vêm de `calcularLayout` — a MESMA conta que o preview SVG usa
 * (pilha automática, ou a posição arrastada no editor visual quando existir).
 */
function zplDaEtiqueta(item: ItemEtiqueta, config: EtiquetaConfig, xBaseMm: number): string {
  const dpmm = dotsPorMm(config.impressora.dpi);
  const layout = calcularLayout(config, item);
  const partes: string[] = [];
  // A posição é arredondada UMA vez, já somada à base da coluna. Arredondar a
  // margem e o elemento separado dava até 1 dot de erro por elemento (e ele se
  // acumulava coluna a coluna).

  // As alturas vêm do layout (box.alturaMm), não do modelo cru: é lá que a
  // escala de calibração já foi aplicada.
  const escala = escalaDe(config);

  for (const linha of config.linhas) {
    if (!linha.visivel) continue;
    const box = elementoPorChave(layout, `linha-${linha.id}`);
    if (!box) continue;
    partes.push(
      comandoTexto(
        textoDaLinha(item, linha),
        mm(xBaseMm + box.xMm, dpmm),
        mm(box.yMm, dpmm),
        mm(box.alturaMm, dpmm),
        mm(linha.larguraMm * escala, dpmm),
        mm(box.larguraMm, dpmm),
        box.alinhamento,
        linha.negrito,
        linha.fonteZpl,
        dpmm
      )
    );
  }

  const dado = dadoDoBarcode(item, config);
  const boxBarcode = elementoPorChave(layout, 'barcode');
  if (dado && boxBarcode) {
    partes.push(
      comandoBarcode(
        dado,
        config,
        mm(xBaseMm + boxBarcode.xMm, dpmm),
        mm(boxBarcode.yMm, dpmm),
        mm(boxBarcode.alturaMm, dpmm),
        dpmm
      )
    );
  }

  // O número NÃO vira campo de texto aqui: quem desenha é a impressora, pela
  // interpretation line do ^BC (o "Y"), igual ao Linx. O elemento 'numero' do
  // layout existe só para o preview mostrar onde ele vai cair.

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
  const moduloMm = moduloEfetivoDots(config) / dotsPorMm(config.impressora.dpi);

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

export interface LinhaEstoura {
  linhaId: string;
  campoLabel: string;
  larguraEstimadaMm: number;
  larguraUtilMm: number;
}

/**
 * Estima (não mede de verdade — a Zebra não devolve isso) quais linhas de
 * texto provavelmente vão além da largura útil da etiqueta, tanto pelo texto
 * já na fila quanto pelo PIOR CASO permitido pelo corte (máx. caracteres)
 * configurado — assim o aviso aparece mesmo com a fila vazia, enquanto o
 * modelo ainda está sendo ajustado no editor visual.
 */
export function analisarTextos(itens: ItemComQuantidade[], config: EtiquetaConfig): LinhaEstoura[] {
  const larguraUtilMm = Math.max(0, config.larguraEtiquetaMm - config.margemInternaMm * 2);
  const escala = escalaDe(config);
  const linhasEstouram: LinhaEstoura[] = [];

  for (const linha of config.linhas) {
    if (!linha.visivel) continue;
    // Mede o tamanho JÁ calibrado — aumentar a escala tem que acender o aviso.
    const calibrada = {
      ...linha,
      alturaMm: linha.alturaMm * escala,
      larguraMm: linha.larguraMm * escala,
    };

    let maiorMm = 0;
    for (const { item } of itens) {
      const largura = larguraTextoMm(textoDaLinha(item, linha), calibrada, config.impressora.dpi);
      if (largura > maiorMm) maiorMm = largura;
    }
    // Pior caso só faz sentido quando o corte é por caractere: com corte por
    // PALAVRA não há teto previsível (uma palavra pode ser longa), então nesse
    // caso vale o que os itens da fila realmente medem.
    if (linha.maxCaracteres > 0 && linha.maxPalavras === 0) {
      const piorCaso = larguraTextoMm('X'.repeat(linha.maxCaracteres), calibrada, config.impressora.dpi);
      if (piorCaso > maiorMm) maiorMm = piorCaso;
    }

    if (maiorMm > larguraUtilMm + 0.01) {
      linhasEstouram.push({
        linhaId: linha.id,
        campoLabel: CAMPOS_DISPONIVEIS.find((c) => c.valor === linha.campo)?.label ?? linha.campo,
        larguraEstimadaMm: maiorMm,
        larguraUtilMm,
      });
    }
  }

  return linhasEstouram;
}

/** Quantos caracteres a linha precisa comportar (texto real ou o corte configurado). */
function caracteresDaLinha(itens: ItemComQuantidade[], linha: LinhaEtiqueta): number {
  let maior = linha.maxCaracteres > 0 && linha.maxPalavras === 0 ? linha.maxCaracteres : 0;
  for (const { item } of itens) {
    const n = textoDaLinha(item, linha).length;
    if (n > maior) maior = n;
  }
  return maior;
}

/**
 * Encolhe as FONTES até tudo caber — sem cortar texto nenhum.
 *
 * Duas passadas: primeiro cada linha que passa da largura tem a fonte reduzida
 * no fator exato que falta; depois, se o conjunto ainda passa da altura da
 * etiqueta, tudo encolhe proporcionalmente. Mexe no modelo (é uma correção de
 * verdade, não calibração), então é reversível por "Descartar alterações".
 */
export function ajustarTamanhoParaCaber(
  itens: ItemComQuantidade[],
  config: EtiquetaConfig
): EtiquetaConfig {
  const novo = clonarConfig(config);
  const larguraUtilMm = Math.max(0, novo.larguraEtiquetaMm - novo.margemInternaMm * 2);
  const escala = escalaDe(novo);
  const arred = (v: number) => Math.round(v * 100) / 100;

  // 1) Largura: cada linha encolhe só o quanto precisa.
  for (const linha of novo.linhas) {
    if (!linha.visivel) continue;
    const chars = caracteresDaLinha(itens, linha);
    if (chars <= 0) continue;

    const porCaractere = larguraCaractereMm(
      { ...linha, alturaMm: linha.alturaMm * escala, larguraMm: linha.larguraMm * escala },
      novo.impressora.dpi
    );
    const precisaMm = chars * porCaractere;
    if (precisaMm <= larguraUtilMm + 0.01) continue;

    const fator = larguraUtilMm / precisaMm;
    linha.alturaMm = Math.max(0.8, arred(linha.alturaMm * fator));
    if (linha.larguraMm > 0) linha.larguraMm = Math.max(0, arred(linha.larguraMm * fator));
  }

  // 2) Altura: se o conjunto ainda estoura, encolhe tudo junto.
  // Desfaz a mesma transformação do layout (zoom em torno do centro + desloc)
  // para saber até onde o conteúdo pode ir no tamanho do modelo.
  const cy = novo.alturaEtiquetaMm / 2;
  const alvoBrutoMm = cy + (novo.alturaEtiquetaMm - (novo.calibracao?.deslocYMm ?? 0) - cy) / escala;
  const brutoMm = alturaConteudoBrutaMm(novo);
  if (brutoMm > alvoBrutoMm && alvoBrutoMm > 0) {
    const fator = alvoBrutoMm / brutoMm;
    for (const linha of novo.linhas) {
      linha.alturaMm = Math.max(0.8, arred(linha.alturaMm * fator));
      linha.espacoAbaixoMm = Math.max(0, arred(linha.espacoAbaixoMm * fator));
    }
    novo.barcode.alturaMm = arred(novo.barcode.alturaMm * fator);
    novo.barcode.alturaNumeroMm = Math.max(0.8, arred(novo.barcode.alturaNumeroMm * fator));
    novo.barcode.espacoAcimaMm = Math.max(0, arred(novo.barcode.espacoAcimaMm * fator));
    novo.barcode.espacoNumeroMm = Math.max(0, arred(novo.barcode.espacoNumeroMm * fator));
  }

  return novo;
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
  const passoColunaMm = config.larguraEtiquetaMm + config.espacoColunasMm;

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
      zplDaEtiqueta(item, config, config.margemEsquerdaMm + coluna * passoColunaMm)
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
