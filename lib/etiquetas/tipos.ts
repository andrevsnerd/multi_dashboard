/**
 * Modelo da etiqueta — tudo que a tela de configuração deixa personalizar.
 *
 * A referência é a etiqueta que já sai hoje pelo Linx ("Etiqueta Subgrupo 3
 * Colunas 27x15x3", relatório favorito do 002006SPK) numa ZDesigner ZD230
 * 203dpi ZPL com mídia contínua de 104mm.
 */

import type { Simbologia } from './barcode';

export type EtiquetaCompany = 'nerd' | 'scarfme';

/** Campos do cadastro que podem virar uma linha de texto da etiqueta. */
export type CampoEtiqueta =
  | 'descProduto'
  | 'produto'
  | 'grupo'
  | 'subgrupo'
  | 'linha'
  | 'colecao'
  | 'grade'
  | 'tipo'
  | 'descCor'
  | 'cor'
  | 'codigoBarra'
  | 'fixo';

export const CAMPOS_DISPONIVEIS: Array<{ valor: CampoEtiqueta; label: string }> = [
  { valor: 'descProduto', label: 'Nome do produto' },
  { valor: 'subgrupo', label: 'Subgrupo' },
  { valor: 'grupo', label: 'Grupo' },
  { valor: 'linha', label: 'Linha' },
  { valor: 'colecao', label: 'Coleção' },
  { valor: 'grade', label: 'Grade / dimensão' },
  { valor: 'tipo', label: 'Tipo' },
  { valor: 'descCor', label: 'Cor (descrição)' },
  { valor: 'cor', label: 'Cor (código)' },
  { valor: 'produto', label: 'Código do produto' },
  { valor: 'codigoBarra', label: 'Código de barra (número)' },
  { valor: 'fixo', label: 'Texto fixo' },
];

export type Alinhamento = 'left' | 'center' | 'right';

/** Uma linha de texto da etiqueta (de cima para baixo, na ordem do array). */
export interface LinhaEtiqueta {
  id: string;
  campo: CampoEtiqueta;
  /** Usado quando `campo === 'fixo'`. */
  textoFixo: string;
  /** Altura da fonte em mm (a Zebra pensa em altura, não em pt). */
  alturaMm: number;
  /** Largura da fonte em mm; 0 = proporcional à altura. */
  larguraMm: number;
  negrito: boolean;
  alinhamento: Alinhamento;
  maiuscula: boolean;
  /** Corta o texto acima deste tamanho (0 = não corta). */
  maxCaracteres: number;
  /** Espaço em mm entre esta linha e a de baixo. */
  espacoAbaixoMm: number;
  visivel: boolean;
}

export interface ConfigBarcode {
  simbologia: Simbologia;
  /** De onde sai o dado das barras. */
  origem: 'codigoBarra' | 'produto';
  alturaMm: number;
  /** Largura do módulo estreito em dots (1 dot = 1/8 mm a 203dpi). */
  moduloDots: number;
  /** Imprime o número embaixo das barras. */
  mostrarNumero: boolean;
  alturaNumeroMm: number;
  alinhamento: Alinhamento;
  espacoAcimaMm: number;
}

export interface ConfigImpressora {
  dpi: 203 | 300;
  /** Largura útil da mídia (a ZD230 do escritório está em 104mm). */
  larguraMidiaMm: number;
  /** Contínua = a Zebra usa o comprimento que a gente mandar (^LL). */
  tipoMidia: 'continua' | 'gap' | 'marca';
  /** mm/s — a ZD230 está em 152. */
  velocidadeMmS: number;
  /** 0–30 (a ZD230 está em 30). */
  escuridao: number;
  modoImpressao: 'termica-direta' | 'transferencia-termica';
  offsetTopoMm: number;
  offsetEsquerdaMm: number;
  /** Nome da impressora no Zebra Browser Print ('' = a padrão). */
  nomeImpressora: string;
}

export interface EtiquetaConfig {
  versao: 1;
  nomeModelo: string;
  larguraEtiquetaMm: number;
  alturaEtiquetaMm: number;
  colunas: number;
  /** Espaço horizontal entre colunas. */
  espacoColunasMm: number;
  /** Espaço vertical entre as fileiras (avanço extra do papel). */
  espacoLinhasMm: number;
  /** Margem interna de cada etiqueta (afasta texto/barras da borda). */
  margemInternaMm: number;
  margemEsquerdaMm: number;
  margemTopoMm: number;
  linhas: LinhaEtiqueta[];
  barcode: ConfigBarcode;
  impressora: ConfigImpressora;
}

/**
 * Padrão = a etiqueta real do exemplo: nome, subgrupo, cor, barras e número.
 * 27x15mm em 3 colunas, mídia contínua de 104mm, ZD230 203dpi.
 */
export const CONFIG_PADRAO: EtiquetaConfig = {
  versao: 1,
  nomeModelo: 'Etiqueta Subgrupo 27x15 — 3 colunas',
  larguraEtiquetaMm: 27,
  alturaEtiquetaMm: 15,
  colunas: 3,
  espacoColunasMm: 2,
  espacoLinhasMm: 0,
  margemInternaMm: 0.8,
  margemEsquerdaMm: 2,
  margemTopoMm: 0.5,
  // Os tamanhos abaixo somam 14,65mm — cabem nos 15mm com folga. Mexer neles sem
  // olhar o aviso de "não cabe" faz a Zebra cortar o pé da etiqueta.
  linhas: [
    {
      id: 'l1',
      campo: 'descProduto',
      textoFixo: '',
      alturaMm: 2.2,
      larguraMm: 0,
      negrito: true,
      alinhamento: 'left',
      maiuscula: true,
      maxCaracteres: 22,
      espacoAbaixoMm: 0.15,
      visivel: true,
    },
    {
      id: 'l2',
      campo: 'subgrupo',
      textoFixo: '',
      alturaMm: 1.6,
      larguraMm: 0,
      negrito: false,
      alinhamento: 'left',
      maiuscula: true,
      maxCaracteres: 28,
      espacoAbaixoMm: 0.15,
      visivel: true,
    },
    {
      id: 'l3',
      campo: 'descCor',
      textoFixo: '',
      alturaMm: 1.6,
      larguraMm: 0,
      negrito: false,
      alinhamento: 'left',
      maiuscula: true,
      maxCaracteres: 28,
      espacoAbaixoMm: 0.15,
      visivel: true,
    },
  ],
  barcode: {
    simbologia: 'CODE128',
    origem: 'codigoBarra',
    alturaMm: 4.6,
    moduloDots: 2,
    mostrarNumero: true,
    alturaNumeroMm: 1.8,
    alinhamento: 'center',
    espacoAcimaMm: 0.3,
  },
  impressora: {
    dpi: 203,
    larguraMidiaMm: 104,
    tipoMidia: 'continua',
    velocidadeMmS: 152,
    escuridao: 30,
    modoImpressao: 'transferencia-termica',
    offsetTopoMm: 0,
    offsetEsquerdaMm: 0,
    nomeImpressora: '',
  },
};

/** Item que vira etiqueta: um produto×cor com a quantidade de cópias. */
export interface ItemEtiqueta {
  produto: string;
  descProduto: string;
  cor: string;
  descCor: string;
  codigoBarra: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  colecao: string;
  grade: string;
  tipo: string;
}

/** Valor cru de um campo para um item (antes de maiúscula/corte). */
export function valorDoCampo(item: ItemEtiqueta, linha: LinhaEtiqueta): string {
  if (linha.campo === 'fixo') return linha.textoFixo ?? '';
  const valor = (item as unknown as Record<string, unknown>)[linha.campo];
  return typeof valor === 'string' ? valor : '';
}

/** Texto final de uma linha, já com maiúscula e corte aplicados. */
export function textoDaLinha(item: ItemEtiqueta, linha: LinhaEtiqueta): string {
  let texto = valorDoCampo(item, linha).trim();
  if (linha.maiuscula) texto = texto.toUpperCase();
  if (linha.maxCaracteres > 0 && texto.length > linha.maxCaracteres) {
    texto = texto.slice(0, linha.maxCaracteres);
  }
  return texto;
}

/** Dado que vai para as barras. */
export function dadoDoBarcode(item: ItemEtiqueta, config: EtiquetaConfig): string {
  return (config.barcode.origem === 'produto' ? item.produto : item.codigoBarra ?? '').trim();
}

/** Dots por mm da impressora (203dpi = 8, 300dpi ≈ 11.8). */
export function dotsPorMm(dpi: number): number {
  return dpi / 25.4;
}

/** Normaliza uma config vinda do banco/arquivo, preenchendo o que faltar. */
export function normalizarConfig(raw: unknown): EtiquetaConfig {
  const base = CONFIG_PADRAO;
  if (!raw || typeof raw !== 'object') return clonarConfig(base);
  const obj = raw as Partial<EtiquetaConfig>;

  const num = (valor: unknown, padrao: number, min: number, max: number) => {
    const n = Number(valor);
    if (!Number.isFinite(n)) return padrao;
    return Math.min(max, Math.max(min, n));
  };

  const linhasRaw = Array.isArray(obj.linhas) ? obj.linhas : base.linhas;
  const linhas: LinhaEtiqueta[] = linhasRaw.slice(0, 8).map((l, i) => {
    const campo = CAMPOS_DISPONIVEIS.some((c) => c.valor === l?.campo)
      ? (l.campo as CampoEtiqueta)
      : 'descProduto';
    return {
      id: String(l?.id ?? `l${i + 1}`),
      campo,
      textoFixo: String(l?.textoFixo ?? ''),
      alturaMm: num(l?.alturaMm, 2, 0.8, 20),
      larguraMm: num(l?.larguraMm, 0, 0, 20),
      negrito: Boolean(l?.negrito),
      alinhamento: (['left', 'center', 'right'] as const).includes(l?.alinhamento as Alinhamento)
        ? (l!.alinhamento as Alinhamento)
        : 'left',
      maiuscula: l?.maiuscula !== false,
      maxCaracteres: Math.round(num(l?.maxCaracteres, 0, 0, 200)),
      espacoAbaixoMm: num(l?.espacoAbaixoMm, 0.2, 0, 20),
      visivel: l?.visivel !== false,
    };
  });

  const bc = obj.barcode ?? base.barcode;
  const imp = obj.impressora ?? base.impressora;

  return {
    versao: 1,
    nomeModelo: String(obj.nomeModelo ?? base.nomeModelo).slice(0, 80),
    larguraEtiquetaMm: num(obj.larguraEtiquetaMm, base.larguraEtiquetaMm, 5, 300),
    alturaEtiquetaMm: num(obj.alturaEtiquetaMm, base.alturaEtiquetaMm, 5, 300),
    colunas: Math.round(num(obj.colunas, base.colunas, 1, 10)),
    espacoColunasMm: num(obj.espacoColunasMm, base.espacoColunasMm, 0, 50),
    espacoLinhasMm: num(obj.espacoLinhasMm, base.espacoLinhasMm, 0, 50),
    margemInternaMm: num(obj.margemInternaMm, base.margemInternaMm, 0, 20),
    margemEsquerdaMm: num(obj.margemEsquerdaMm, base.margemEsquerdaMm, 0, 50),
    margemTopoMm: num(obj.margemTopoMm, base.margemTopoMm, 0, 50),
    linhas: linhas.length > 0 ? linhas : clonarConfig(base).linhas,
    barcode: {
      simbologia: (['CODE128', 'EAN13', 'CODE39', 'ITF'] as const).includes(bc?.simbologia as Simbologia)
        ? (bc!.simbologia as Simbologia)
        : 'CODE128',
      origem: bc?.origem === 'produto' ? 'produto' : 'codigoBarra',
      alturaMm: num(bc?.alturaMm, base.barcode.alturaMm, 0, 100),
      moduloDots: Math.round(num(bc?.moduloDots, base.barcode.moduloDots, 1, 10)),
      mostrarNumero: bc?.mostrarNumero !== false,
      alturaNumeroMm: num(bc?.alturaNumeroMm, base.barcode.alturaNumeroMm, 0.8, 20),
      alinhamento: (['left', 'center', 'right'] as const).includes(bc?.alinhamento as Alinhamento)
        ? (bc!.alinhamento as Alinhamento)
        : 'center',
      espacoAcimaMm: num(bc?.espacoAcimaMm, base.barcode.espacoAcimaMm, 0, 20),
    },
    impressora: {
      dpi: Number(imp?.dpi) === 300 ? 300 : 203,
      larguraMidiaMm: num(imp?.larguraMidiaMm, base.impressora.larguraMidiaMm, 10, 300),
      tipoMidia: (['continua', 'gap', 'marca'] as const).includes(imp?.tipoMidia as 'continua')
        ? (imp!.tipoMidia as ConfigImpressora['tipoMidia'])
        : 'continua',
      velocidadeMmS: num(imp?.velocidadeMmS, base.impressora.velocidadeMmS, 25, 305),
      escuridao: Math.round(num(imp?.escuridao, base.impressora.escuridao, 0, 30)),
      modoImpressao:
        imp?.modoImpressao === 'termica-direta' ? 'termica-direta' : 'transferencia-termica',
      offsetTopoMm: num(imp?.offsetTopoMm, 0, -50, 50),
      offsetEsquerdaMm: num(imp?.offsetEsquerdaMm, 0, -50, 50),
      nomeImpressora: String(imp?.nomeImpressora ?? '').slice(0, 120),
    },
  };
}

export function clonarConfig(config: EtiquetaConfig): EtiquetaConfig {
  return JSON.parse(JSON.stringify(config)) as EtiquetaConfig;
}

/** Altura total ocupada pelo conteúdo — usada para avisar que não cabe. */
export function alturaConteudoMm(config: EtiquetaConfig): number {
  let altura = config.margemTopoMm + config.margemInternaMm;
  for (const linha of config.linhas) {
    if (!linha.visivel) continue;
    altura += linha.alturaMm + linha.espacoAbaixoMm;
  }
  altura += config.barcode.espacoAcimaMm + config.barcode.alturaMm;
  if (config.barcode.mostrarNumero) altura += config.barcode.alturaNumeroMm;
  return altura + config.margemInternaMm;
}

/** Largura total da fileira (todas as colunas + espaços + margem). */
export function larguraFileiraMm(config: EtiquetaConfig): number {
  return (
    config.margemEsquerdaMm +
    config.colunas * config.larguraEtiquetaMm +
    Math.max(0, config.colunas - 1) * config.espacoColunasMm
  );
}
