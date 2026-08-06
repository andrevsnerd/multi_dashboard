/**
 * Codificadores de código de barras — puros, sem dependência externa.
 *
 * Servem SÓ para o preview na tela e para o caminho "imprimir pelo navegador".
 * No caminho ZPL quem desenha as barras é a própria Zebra (^BC/^BE/^B3/^B2),
 * que a 203dpi sai muito mais nítida do que qualquer raster do driver.
 *
 * Cada codificador devolve uma string binária ('1' = barra, '0' = espaço) com
 * um módulo por caractere. Quem renderiza decide a largura do módulo.
 */

export type Simbologia = 'CODE128' | 'EAN13' | 'CODE39' | 'ITF';

export const SIMBOLOGIAS: Array<{ valor: Simbologia; label: string; ajuda: string }> = [
  { valor: 'CODE128', label: 'Code 128', ajuda: 'Padrão. Aceita qualquer código (o interno de 6 dígitos inclusive).' },
  { valor: 'EAN13', label: 'EAN-13', ajuda: 'Só para os códigos de 13 dígitos (7898586...).' },
  { valor: 'CODE39', label: 'Code 39', ajuda: 'Letras e números. Barras mais largas.' },
  { valor: 'ITF', label: 'Inter 2 de 5', ajuda: 'Só dígitos, em quantidade par.' },
];

/* ───────────────────────────── CODE 128 ───────────────────────────── */

// Larguras (barra/espaço alternados) dos 107 símbolos + STOP.
const C128_LARGURAS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const C128_START_B = 104;
const C128_START_C = 105;
const C128_CODE_B = 100;
const C128_CODE_C = 99;
const C128_STOP = 106;

function larguraParaBinario(larguras: string, comecaComBarra = true): string {
  let out = '';
  let barra = comecaComBarra;
  for (const ch of larguras) {
    out += (barra ? '1' : '0').repeat(Number(ch));
    barra = !barra;
  }
  return out;
}

/**
 * Code 128 com troca automática B↔C: trechos de 4+ dígitos pares viram subset C
 * (metade das barras). É o mesmo comportamento do gerador do Linx.
 */
function encodeCode128(dados: string): string | null {
  const texto = dados.trim();
  if (!texto) return null;
  for (const ch of texto) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return null; // fora do subset B imprimível
  }

  const valores: number[] = [];
  let i = 0;
  let modo: 'B' | 'C' | null = null;

  const digitosAPartirDe = (pos: number) => {
    let n = 0;
    while (pos + n < texto.length && texto[pos + n] >= '0' && texto[pos + n] <= '9') n += 1;
    return n;
  };

  while (i < texto.length) {
    const dig = digitosAPartirDe(i);
    // Vale a pena o subset C: 4+ dígitos no meio, ou 2 dígitos no fim/começo.
    const usarC = dig >= 4 || (dig >= 2 && (i === 0 || i + dig === texto.length) && dig % 2 === 0);

    if (usarC) {
      const pares = Math.floor(dig / 2);
      if (modo === null) valores.push(C128_START_C);
      else if (modo !== 'C') valores.push(C128_CODE_C);
      modo = 'C';
      for (let p = 0; p < pares; p += 1) {
        valores.push(Number(texto.slice(i, i + 2)));
        i += 2;
      }
      continue;
    }

    if (modo === null) valores.push(C128_START_B);
    else if (modo !== 'B') valores.push(C128_CODE_B);
    modo = 'B';
    valores.push(texto.charCodeAt(i) - 32);
    i += 1;
  }

  if (valores.length === 0) return null;

  // Checksum: soma ponderada a partir do START (peso 1 no primeiro dado).
  let soma = valores[0];
  for (let k = 1; k < valores.length; k += 1) soma += valores[k] * k;
  valores.push(soma % 103);
  valores.push(C128_STOP);

  return valores.map((v) => larguraParaBinario(C128_LARGURAS[v])).join('');
}

/* ───────────────────────────── EAN-13 ───────────────────────────── */

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Dígito verificador do EAN-13 (aceita 12 dígitos e calcula o 13º). */
export function digitoEan13(doze: string): number {
  let soma = 0;
  for (let i = 0; i < 12; i += 1) soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10;
}

function encodeEan13(dados: string): string | null {
  const digitos = dados.replace(/\D/g, '');
  let codigo = digitos;
  if (codigo.length === 12) codigo += String(digitoEan13(codigo));
  if (codigo.length !== 13) return null;
  if (Number(codigo[12]) !== digitoEan13(codigo.slice(0, 12))) return null;

  const paridade = EAN_PARIDADE[Number(codigo[0])];
  let out = '101';
  for (let i = 0; i < 6; i += 1) {
    const d = Number(codigo[1 + i]);
    out += paridade[i] === 'L' ? EAN_L[d] : EAN_G[d];
  }
  out += '01010';
  for (let i = 0; i < 6; i += 1) out += EAN_R[Number(codigo[7 + i])];
  out += '101';
  return out;
}

/* ───────────────────────────── CODE 39 ───────────────────────────── */

const C39: Record<string, string> = {
  '0': '101001101101', '1': '110100101011', '2': '101100101011', '3': '110110010101',
  '4': '101001101011', '5': '110100110101', '6': '101100110101', '7': '101001011011',
  '8': '110100101101', '9': '101100101101', A: '110101001011', B: '101101001011',
  C: '110110100101', D: '101011001011', E: '110101100101', F: '101101100101',
  G: '101010011011', H: '110101001101', I: '101101001101', J: '101011001101',
  K: '110101010011', L: '101101010011', M: '110110101001', N: '101011010011',
  O: '110101101001', P: '101101101001', Q: '101010110011', R: '110101011001',
  S: '101101011001', T: '101011011001', U: '110010101011', V: '100110101011',
  W: '110011010101', X: '100101101011', Y: '110010110101', Z: '100110110101',
  '-': '100101011011', '.': '110010101101', ' ': '100110101101', $: '100100100101',
  '/': '100100101001', '+': '100101001001', '%': '101001001001', '*': '100101101101',
};

function encodeCode39(dados: string): string | null {
  const texto = dados.trim().toUpperCase();
  if (!texto) return null;
  const chars = ['*', ...texto.split(''), '*'];
  const partes: string[] = [];
  for (const ch of chars) {
    const p = C39[ch];
    if (!p) return null;
    partes.push(p);
  }
  return partes.join('0'); // separador de 1 módulo entre caracteres
}

/* ─────────────────────── Interleaved 2 de 5 ─────────────────────── */

const ITF_PADROES = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];

function encodeItf(dados: string): string | null {
  let digitos = dados.replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.length % 2 === 1) digitos = `0${digitos}`; // ITF exige quantidade par

  let out = '1010'; // start: barra fina, espaço fino, barra fina, espaço fino
  for (let i = 0; i < digitos.length; i += 2) {
    const barras = ITF_PADROES[Number(digitos[i])];
    const espacos = ITF_PADROES[Number(digitos[i + 1])];
    for (let k = 0; k < 5; k += 1) {
      out += '1'.repeat(barras[k] === 'w' ? 3 : 1);
      out += '0'.repeat(espacos[k] === 'w' ? 3 : 1);
    }
  }
  out += '11101'; // stop: barra larga, espaço fino, barra fina
  return out;
}

/* ───────────────────────────── fachada ───────────────────────────── */

export interface BarcodeRender {
  /** '1' = barra, '0' = espaço. Um caractere por módulo. */
  binario: string;
  /** Quantidade de módulos (largura total em módulos). */
  modulos: number;
}

/** Codifica e devolve os módulos, ou `null` quando o dado não serve à simbologia. */
export function encodeBarcode(dados: string, simbologia: Simbologia): BarcodeRender | null {
  const bruto = (dados ?? '').trim();
  if (!bruto) return null;

  let binario: string | null = null;
  if (simbologia === 'CODE128') binario = encodeCode128(bruto);
  else if (simbologia === 'EAN13') binario = encodeEan13(bruto);
  else if (simbologia === 'CODE39') binario = encodeCode39(bruto);
  else if (simbologia === 'ITF') binario = encodeItf(bruto);

  if (!binario) return null;
  return { binario, modulos: binario.length };
}

/** Mensagem curta explicando por que o código não pôde ser gerado. */
export function motivoFalha(dados: string, simbologia: Simbologia): string {
  const bruto = (dados ?? '').trim();
  if (!bruto) return 'sem código de barra cadastrado';
  if (simbologia === 'EAN13') return 'EAN-13 precisa de 12 ou 13 dígitos válidos';
  if (simbologia === 'ITF') return 'Inter 2 de 5 aceita só dígitos';
  if (simbologia === 'CODE39') return 'Code 39 aceita A-Z, 0-9 e - . $ / + % espaço';
  return 'código com caractere fora do padrão';
}

/**
 * Converte o binário em retângulos (x, largura) já em módulos — evita um <rect>
 * por módulo no SVG do preview.
 */
export function barrasDoBinario(binario: string): Array<{ x: number; largura: number }> {
  const out: Array<{ x: number; largura: number }> = [];
  let i = 0;
  while (i < binario.length) {
    if (binario[i] === '0') {
      i += 1;
      continue;
    }
    let fim = i;
    while (fim < binario.length && binario[fim] === '1') fim += 1;
    out.push({ x: i, largura: fim - i });
    i = fim;
  }
  return out;
}
