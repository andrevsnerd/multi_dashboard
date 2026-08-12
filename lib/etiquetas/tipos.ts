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

/**
 * `bitmap` = as fontes internas da Zebra (`^AAN`, `^ABN`, `^ADN`…): monoespaçadas,
 * nítidas e sólidas na térmica, mas só existem em tamanhos fixos.
 * `escalavel` = `^A0N`, qualquer tamanho, porém fina e serrilhada no miúdo.
 */
export type FonteZpl = 'bitmap' | 'escalavel';

/**
 * Fontes bitmap internas da Zebra a 203dpi (altura x largura da célula, em dots).
 *
 * Elas NÃO diminuem abaixo da base e só crescem em múltiplos inteiros — é por
 * isso que travar numa só (a D, dos .prg do Linx) deixava o ajuste de tamanho
 * sem efeito. Com a escada inteira o tamanho anda em degraus e o texto continua
 * nítido, em vez de cair na escalável fininha.
 */
export const FONTES_BITMAP = [
  { nome: 'A', alturaDots: 9, larguraDots: 5 },
  { nome: 'B', alturaDots: 11, larguraDots: 7 },
  { nome: 'D', alturaDots: 18, larguraDots: 10 },
  { nome: 'H', alturaDots: 21, larguraDots: 13 },
  { nome: 'F', alturaDots: 26, larguraDots: 13 },
  { nome: 'E', alturaDots: 28, larguraDots: 15 },
] as const;

/** Fonte A: a que a Zebra usa na linha de leitura do código de barras. */
export const FONTE_A_BASE = { alturaDots: 9, larguraDots: 5 } as const;

export interface MetricaFonte {
  nome: string;
  alturaDots: number;
  larguraDots: number;
}

/**
 * Degrau da escada bitmap mais próximo da altura pedida — é o tamanho que a
 * impressora VAI usar de fato. Quem empilha o layout tem que usar este valor,
 * não o pedido: era essa diferença que fazia o desenho descer no papel em
 * relação ao preview.
 */
export function melhorFonteBitmap(alturaDots: number): MetricaFonte {
  let escolhida: MetricaFonte = {
    nome: FONTES_BITMAP[0].nome,
    alturaDots: FONTES_BITMAP[0].alturaDots,
    larguraDots: FONTES_BITMAP[0].larguraDots,
  };
  let melhorDif = Infinity;
  let melhorMult = Infinity;
  for (const f of FONTES_BITMAP) {
    for (let mult = 1; mult <= 4; mult += 1) {
      const h = f.alturaDots * mult;
      const dif = Math.abs(h - alturaDots);
      // Empate de medida → fica a fonte NATIVA (menor multiplicador). A 18x10
      // dá tanto por D×1 quanto por A×2, e a bitmap ampliada sai mais grosseira
      // que o desenho original da fonte.
      if (dif < melhorDif || (dif === melhorDif && mult < melhorMult)) {
        melhorDif = dif;
        melhorMult = mult;
        escolhida = { nome: f.nome, alturaDots: h, larguraDots: f.larguraDots * mult };
      }
    }
  }
  return escolhida;
}

/** Métrica real da linha: degrau da escada na bitmap, o valor pedido na escalável. */
export function metricaDaLinha(
  linha: Pick<LinhaEtiqueta, 'alturaMm' | 'larguraMm' | 'fonteZpl'>,
  dpi: number
): MetricaFonte {
  const dpmm = dotsPorMm(dpi);
  if (linha.fonteZpl === 'bitmap') return melhorFonteBitmap(linha.alturaMm * dpmm);
  const alturaDots = Math.max(1, Math.round(linha.alturaMm * dpmm));
  const larguraDots =
    linha.larguraMm > 0
      ? Math.round(linha.larguraMm * dpmm)
      : Math.max(1, Math.round(alturaDots * PROPORCAO_FONTE_PADRAO));
  return { nome: '0', alturaDots, larguraDots };
}

/**
 * Altura que a linha REALMENTE ocupa. Na bitmap é o degrau da escada, que pode
 * ser maior que o pedido — o layout precisa empilhar por aqui para o papel
 * bater com a tela.
 */
export function alturaEfetivaMm(
  linha: Pick<LinhaEtiqueta, 'alturaMm' | 'larguraMm' | 'fonteZpl'>,
  dpi: number
): number {
  return metricaDaLinha(linha, dpi).alturaDots / dotsPorMm(dpi);
}

/** Uma linha de texto da etiqueta (de cima para baixo, na ordem do array). */
export interface LinhaEtiqueta {
  id: string;
  campo: CampoEtiqueta;
  /** Usado quando `campo === 'fixo'`. */
  textoFixo: string;
  /** Altura da fonte em mm (a Zebra pensa em altura, não em pt). */
  alturaMm: number;
  /** Largura da fonte em mm; 0 = proporcional. Ignorado na fonte bitmap. */
  larguraMm: number;
  /**
   * `bitmap` escolhe sozinha o degrau da escada de fontes internas da Zebra mais
   * próximo de `alturaMm` (A/B/D/H/F/E e múltiplos): nítida na térmica e com
   * largura EXATA, mas o tamanho anda em degraus. `escalavel` (`^A0N`) aceita
   * qualquer tamanho e sai fina/serrilhada no miúdo.
   */
  fonteZpl: FonteZpl;
  negrito: boolean;
  alinhamento: Alinhamento;
  maiuscula: boolean;
  /**
   * Pula as N primeiras PALAVRAS do campo. Com `maxPalavras` na linha de cima,
   * é isso que QUEBRA um nome comprido em duas linhas em vez de cortar: o
   * título leva "CP SILICONE" e a linha seguinte leva "IP 17 PRO MAX".
   */
  pularPalavras: number;
  /**
   * Mantém só as N primeiras PALAVRAS depois do pulo (0 = todas). É assim que o
   * Linx monta o título — por caractere sobraria lixo ("CP SILICONE IP 17 PR").
   */
  maxPalavras: number;
  /** Trava de segurança em caracteres, aplicada depois das palavras (0 = não corta). */
  maxCaracteres: number;
  /** Espaço em mm entre esta linha e a de baixo. */
  espacoAbaixoMm: number;
  visivel: boolean;
  /**
   * Posição arrastada no editor visual (mm, a partir do canto da etiqueta).
   * `undefined` = segue a pilha automática (comportamento de sempre).
   */
  xMm?: number;
  yMm?: number;
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
  /** Respiro entre o pé das barras e o número — sem isso os dois saem grudados. */
  espacoNumeroMm: number;
  alinhamento: Alinhamento;
  espacoAcimaMm: number;
  /** Posição arrastada no editor visual (mm). `undefined` = posição automática. */
  xMm?: number;
  yMm?: number;
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

/**
 * Ajuste fino que vale para TODOS os elementos de uma vez — o jeito prático de
 * calibrar: imprime uma tira, vê que saiu torto/grande, mexe aqui, imprime de
 * novo. Não mexe no modelo (posição de cada linha, fontes, etc.), só desloca e
 * escala o conjunto na hora de desenhar; por isso dá para zerar e voltar
 * exatamente ao modelo original.
 */
export interface ConfigCalibracao {
  /** Desloca tudo para a direita (+) ou esquerda (−). */
  deslocXMm: number;
  /** Desloca tudo para baixo (+) ou cima (−). */
  deslocYMm: number;
  /** Multiplica o tamanho de tudo (1 = tamanho do modelo). */
  escala: number;
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
  calibracao: ConfigCalibracao;
}

export const CALIBRACAO_NEUTRA: ConfigCalibracao = { deslocXMm: 0, deslocYMm: 0, escala: 1 };

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
  // PASSO ENTRE COLUNAS = 33mm (27 + 6), copiado do próprio Linx.
  // Os geradores de ZPL do Linx (C:\Linx\Report\User\*_002016_zebra*.prg, a
  // mesma tela 002016 de onde sai a etiqueta) posicionam as 3 colunas com
  // ^LH001,000 / ^LH265,000 / ^LH529,000 — passo de 264 dots = 33mm a 203dpi.
  // Com os 29mm que estavam aqui, cada coluna saía 4mm à esquerda da anterior
  // (deriva acumulada de 6mm na 3ª), que é exatamente o defeito das amostras
  // impressas: o texto de uma etiqueta invadindo a vizinha.
  espacoColunasMm: 6,
  espacoLinhasMm: 0,
  margemInternaMm: 0.8,
  // MEDIDO NA IMPRESSORA (ZD230 do escritório, rolo 27x15 de 3 colunas): o dono
  // calibrou +3,9mm na horizontal e +0,8mm na vertical até a etiqueta sair
  // certa, e os valores foram incorporados aqui (2+3,9 e 0,5+0,8). Ficam no
  // MODELO de propósito, não na calibração, para o ajuste fino continuar zerado
  // e disponível para a próxima correção.
  // O recuo existe porque o ZPL cru não passa pelo driver ZDesigner, que é quem
  // aplica a origem calibrada que o Linx herda de graça.
  margemEsquerdaMm: 5.9,
  // MEDIDO NO EDITOR VISUAL: o dono arrastou as 3 linhas até Y = 1,9 / 4,2 / 6,1mm
  // e o resultado foi convertido de volta para a pilha AUTOMÁTICA (margem do topo
  // + espaço abaixo de cada linha) em vez de virar posição arrastada — mesma
  // impressão, mas o modelo continua cascateando se alguma altura mudar.
  //   margemTopo   = 1,9 − 0,8 (margem interna)          = 1,1
  //   l1.espaço    = 4,2 − 1,9 − 2,25 (fonte D, 18 dots) = 0,05
  //   l2.espaço    = 6,1 − 4,2 − 1,375 (fonte B, 11 dots) = 0,525
  margemTopoMm: 1.1,
  // FONTE ESCALÁVEL (^A0), de propósito — não a bitmap D dos .prg do Linx.
  // Os .prg são da etiqueta GRANDE do HandBook (~55mm): lá a fonte D fica
  // pequena, aqui o MÍNIMO dela (18x10 dots = 2,25mm alto, 1,25mm/caractere)
  // dá 20×1,25 = 25,0mm dos 25,4mm úteis — 98% cheio. E fonte bitmap só existe
  // em múltiplos inteiros da base, então ela NÃO diminui: o ajuste fino de
  // tamanho não tinha efeito algum. A etiqueta 27x15x3 do Linx é um relatório
  // FoxPro impresso pelo driver do Windows (fonte TrueType, escalável) — ela
  // também nunca usou a fonte D.
  // Com a escalável a 0,58 de proporção: 20 × 2,0 × 0,58 = 23,2mm (2,2mm de
  // folga) e o ajuste fino volta a funcionar em qualquer valor.
  linhas: [
    {
      id: 'l1',
      campo: 'descProduto',
      textoFixo: '',
      alturaMm: 2.25,
      larguraMm: 0,
      fonteZpl: 'bitmap',
      negrito: true,
      alinhamento: 'left',
      maiuscula: true,
      // O Linx põe as 2 primeiras palavras no título...
      pularPalavras: 0,
      maxPalavras: 2,
      maxCaracteres: 20,
      espacoAbaixoMm: 0.05,
      visivel: true,
    },
    {
      id: 'l2',
      // ...e o RESTO do nome na linha de baixo — nada se perde.
      campo: 'descProduto',
      textoFixo: '',
      alturaMm: 1.375,
      larguraMm: 0,
      fonteZpl: 'bitmap',
      negrito: false,
      alinhamento: 'left',
      maiuscula: true,
      pularPalavras: 2,
      maxPalavras: 0,
      maxCaracteres: 26,
      espacoAbaixoMm: 0.525,
      visivel: true,
    },
    {
      id: 'l3',
      campo: 'descCor',
      textoFixo: '',
      alturaMm: 1.375,
      larguraMm: 0,
      fonteZpl: 'bitmap',
      negrito: false,
      alinhamento: 'left',
      maiuscula: true,
      pularPalavras: 0,
      maxPalavras: 0,
      maxCaracteres: 26,
      espacoAbaixoMm: 0.15,
      visivel: true,
    },
  ],
  barcode: {
    simbologia: 'CODE128',
    origem: 'codigoBarra',
    // 4,2mm (era 4,6) para abrir espaço ao respiro do número sem estourar os 15mm.
    alturaMm: 4.2,
    moduloDots: 2,
    mostrarNumero: true,
    alturaNumeroMm: 1.125,
    espacoNumeroMm: 0.5,
    alinhamento: 'center',
    espacoAcimaMm: 0.3,
  },
  impressora: {
    dpi: 203,
    larguraMidiaMm: 104,
    // ETIQUETA RECORTADA = 'gap' (^MNY), não contínua.
    // Em 'continua' (^MNN) a Zebra ignora o sensor e só avança o ^LL que
    // mandamos: se ele não bater CRAVADO com o passo físico do rolo, cada
    // etiqueta sai um pouco fora da anterior e o erro acumula — era o "imprimo
    // de novo e a distância vertical muda". Com 'gap' o sensor acha o vão e
    // registra o topo de cada etiqueta, então toda impressão cai no mesmo lugar.
    // Exige a impressora calibrada (botão "calibrar mídia" manda ~JC).
    tipoMidia: 'gap',
    velocidadeMmS: 152,
    escuridao: 30,
    modoImpressao: 'transferencia-termica',
    offsetTopoMm: 0,
    offsetEsquerdaMm: 0,
    nomeImpressora: '',
  },
  calibracao: { ...CALIBRACAO_NEUTRA },
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
  // Palavras primeiro (regra do Linx): pula as N iniciais, depois limita as
  // restantes. É o par pular+máx que quebra o nome em duas linhas sem perder
  // nada. Caracteres ficam só como trava final.
  if (linha.pularPalavras > 0 || linha.maxPalavras > 0) {
    let palavras = texto.split(/\s+/).filter(Boolean);
    if (linha.pularPalavras > 0) palavras = palavras.slice(linha.pularPalavras);
    if (linha.maxPalavras > 0) palavras = palavras.slice(0, linha.maxPalavras);
    texto = palavras.join(' ');
  }
  if (linha.maxCaracteres > 0 && texto.length > linha.maxCaracteres) {
    texto = texto.slice(0, linha.maxCaracteres);
  }
  return texto;
}

/** Dado que vai para as barras. */
export function dadoDoBarcode(item: ItemEtiqueta, config: EtiquetaConfig): string {
  return (config.barcode.origem === 'produto' ? item.produto : item.codigoBarra ?? '').trim();
}

/**
 * Largura por caractere que o ZPL manda pro ^A0 quando a linha não pede uma
 * largura de fonte específica — aproxima a proporção média de um caractere
 * maiúsculo Helvetica/Arial (a mesma fonte que o preview SVG desenha) em
 * relação à altura. Compartilhado entre o gerador de ZPL e os avisos de "não
 * cabe" — os dois têm que usar a MESMA conta.
 */
export const PROPORCAO_FONTE_PADRAO = 0.58;

/**
 * Largura (mm) de UM caractere da linha. Na fonte D é o valor EXATO que sai
 * impresso (ela é monoespaçada); na escalável é estimativa.
 */
export function larguraCaractereMm(
  linha: Pick<LinhaEtiqueta, 'alturaMm' | 'larguraMm' | 'fonteZpl'>,
  dpi: number
): number {
  return metricaDaLinha(linha, dpi).larguraDots / dotsPorMm(dpi);
}

/** Largura impressa de um texto — exata na fonte D, estimada na escalável. */
export function larguraTextoMm(
  texto: string,
  linha: Pick<LinhaEtiqueta, 'alturaMm' | 'larguraMm' | 'fonteZpl'>,
  dpi: number
): number {
  return texto.length * larguraCaractereMm(linha, dpi);
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

  // Posição arrastada: só existe quando os dois (x e y) vieram números de verdade.
  // Um só dos dois (ex.: config corrompida) volta pro automático, nunca "meio arrastado".
  const posOpcional = (x: unknown, y: unknown): { xMm?: number; yMm?: number } => {
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return {};
    return { xMm: Math.min(300, Math.max(-50, nx)), yMm: Math.min(300, Math.max(-50, ny)) };
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
      // Config salva antes da fonte existir cai na escalável, que é como ela foi
      // desenhada — trocar por baixo mudaria a etiqueta de quem já ajustou. O
      // 'D' é do formato anterior, quando a bitmap era travada nessa fonte só.
      fonteZpl: l?.fonteZpl === 'bitmap' || (l?.fonteZpl as string) === 'D' ? 'bitmap' : 'escalavel',
      negrito: Boolean(l?.negrito),
      alinhamento: (['left', 'center', 'right'] as const).includes(l?.alinhamento as Alinhamento)
        ? (l!.alinhamento as Alinhamento)
        : 'left',
      maiuscula: l?.maiuscula !== false,
      pularPalavras: Math.round(num(l?.pularPalavras, 0, 0, 20)),
      maxPalavras: Math.round(num(l?.maxPalavras, 0, 0, 20)),
      maxCaracteres: Math.round(num(l?.maxCaracteres, 0, 0, 200)),
      espacoAbaixoMm: num(l?.espacoAbaixoMm, 0.2, 0, 20),
      visivel: l?.visivel !== false,
      ...posOpcional(l?.xMm, l?.yMm),
    };
  });

  const bc = obj.barcode ?? base.barcode;
  const imp = obj.impressora ?? base.impressora;
  const cal = obj.calibracao ?? base.calibracao;

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
      espacoNumeroMm: num(bc?.espacoNumeroMm, base.barcode.espacoNumeroMm, 0, 20),
      alinhamento: (['left', 'center', 'right'] as const).includes(bc?.alinhamento as Alinhamento)
        ? (bc!.alinhamento as Alinhamento)
        : 'center',
      espacoAcimaMm: num(bc?.espacoAcimaMm, base.barcode.espacoAcimaMm, 0, 20),
      ...posOpcional(bc?.xMm, bc?.yMm),
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
    calibracao: {
      deslocXMm: num(cal?.deslocXMm, 0, -50, 50),
      deslocYMm: num(cal?.deslocYMm, 0, -50, 50),
      escala: num(cal?.escala, 1, 0.2, 3),
    },
  };
}

export function clonarConfig(config: EtiquetaConfig): EtiquetaConfig {
  return JSON.parse(JSON.stringify(config)) as EtiquetaConfig;
}

/** Altura do conteúdo no tamanho do MODELO, sem a calibração. */
export function alturaConteudoBrutaMm(config: EtiquetaConfig): number {
  let altura = config.margemTopoMm + config.margemInternaMm;
  for (const linha of config.linhas) {
    if (!linha.visivel) continue;
    // Altura EFETIVA: na fonte bitmap o degrau da escada pode ser maior que o
    // pedido, e é ele que a impressora usa.
    altura += alturaEfetivaMm(linha, config.impressora.dpi) + linha.espacoAbaixoMm;
  }
  altura += config.barcode.espacoAcimaMm + config.barcode.alturaMm;
  if (config.barcode.mostrarNumero) {
    altura += config.barcode.espacoNumeroMm + config.barcode.alturaNumeroMm;
  }
  return altura + config.margemInternaMm;
}

/**
 * Onde o conteúdo TERMINA na vertical — comparado com a altura da etiqueta para
 * avisar que a Zebra vai cortar o pé.
 *
 * Reproduz a mesma transformação do `calcularLayout`: a escala é um zoom em
 * torno do centro da etiqueta (diminuir recolhe para o meio, não para o topo),
 * e o deslocamento entra depois.
 */
export function alturaConteudoMm(config: EtiquetaConfig): number {
  const escala = config.calibracao?.escala ?? 1;
  const cy = config.alturaEtiquetaMm / 2;
  const fim = alturaConteudoBrutaMm(config);
  return cy + (fim - cy) * escala + (config.calibracao?.deslocYMm ?? 0);
}

/** Largura total da fileira (todas as colunas + espaços + margem). */
export function larguraFileiraMm(config: EtiquetaConfig): number {
  return (
    config.margemEsquerdaMm +
    config.colunas * config.larguraEtiquetaMm +
    Math.max(0, config.colunas - 1) * config.espacoColunasMm
  );
}
