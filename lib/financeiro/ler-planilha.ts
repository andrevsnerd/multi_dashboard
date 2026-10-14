/**
 * Leitura da planilha do Controle Financeiro no NAVEGADOR (SheetJS).
 *
 * O arquivo tem ~15 MB e ~170 mil linhas: não cabe no limite de corpo de request do
 * Vercel (4,5 MB), então ele é lido aqui e vai ao servidor já como registros, em lotes.
 *
 * Datas: a célula de data é número serial do Excel com formato de data. Ela é
 * convertida pelo serial (SSF.parse_date_code), nunca por Date local — fuso não entra.
 * Serial < 367 com formato de data é dia da semana ou data em branco (01/01/1900 de
 * fórmula vazia) e fica como número.
 */

import * as XLSX from "xlsx";

import {
  type AbaLida,
  type Campo,
  type CelulaSolta,
  type ColunaAba,
  type DreLinhaLayout,
  type RegistroFin,
  type TipoAba,
  type ValorCelula,
  CAMPOS_DATA,
  SPECS,
  letraColuna,
  montarBase,
  normalizar,
  pareceLancamento,
  primeiroDoMes,
  tipoDaAba,
} from "./planilha";

const ERROS_EXCEL: Record<number, string> = {
  0x00: "#NULL!",
  0x07: "#DIV/0!",
  0x0f: "#VALUE!",
  0x17: "#REF!",
  0x1d: "#NAME?",
  0x24: "#NUM!",
  0x2a: "#N/A",
  0x2b: "#GETTING_DATA",
};

interface Celula {
  v: ValorCelula;
  pct: boolean;
}

type Grade = Map<number, Map<number, Celula>>;

const pad = (x: number) => String(x).padStart(2, "0");

function serialParaIso(serial: number, date1904: boolean): string | null {
  const p = XLSX.SSF.parse_date_code(serial, { date1904 });
  if (!p || !p.y) return null;
  const dia = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return p.H || p.M ? `${dia} ${pad(p.H)}:${pad(p.M)}` : dia;
}

function arred(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function lerCelula(cell: XLSX.CellObject, date1904: boolean): Celula | null {
  const fmt = typeof cell.z === "string" ? cell.z : "";
  switch (cell.t) {
    case "n": {
      const v = cell.v as number;
      if (fmt && fmt !== "General" && XLSX.SSF.is_date(fmt) && v >= 367) {
        return { v: serialParaIso(v, date1904), pct: false };
      }
      return { v: arred(v), pct: fmt.includes("%") };
    }
    case "s": {
      const s = String(cell.v ?? "").trim();
      return s ? { v: s, pct: false } : null;
    }
    case "b":
      return { v: cell.v ? "VERDADEIRO" : "FALSO", pct: false };
    case "e":
      return { v: ERROS_EXCEL[cell.v as number] ?? "#ERRO", pct: false };
    case "d":
      return { v: cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : String(cell.v), pct: false };
    default:
      return null;
  }
}

function montarGrade(ws: XLSX.WorkSheet, date1904: boolean): { grade: Grade; maxCol: number } {
  const grade: Grade = new Map();
  let maxCol = 0;
  for (const addr of Object.keys(ws)) {
    if (addr.charCodeAt(0) === 33) continue; // "!ref", "!merges"…
    const cel = lerCelula(ws[addr] as XLSX.CellObject, date1904);
    if (!cel || cel.v === null) continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    let linha = grade.get(r + 1);
    if (!linha) {
      linha = new Map();
      grade.set(r + 1, linha);
    }
    linha.set(c, cel);
    if (c > maxCol) maxCol = c;
  }
  return { grade, maxCol };
}

const linhasOrdenadas = (g: Grade) => [...g.keys()].sort((a, b) => a - b);

/* ------------------------------------------------------- conversão de tipos */

function paraData(raw: ValorCelula, date1904: boolean): string | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    if (raw < 367 || raw > 2958465) return null;
    return serialParaIso(raw, date1904)?.slice(0, 10) ?? null;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(iso[1]) < 1901 ? null : `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${pad(Number(br[2]))}-${pad(Number(br[1]))}`;
  return null;
}

function paraNumero(raw: ValorCelula): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  const limpo = raw.replace(/R\$|\s/g, "");
  if (!/^-?[\d.,]+$/.test(limpo)) return null;
  const num = limpo.includes(",") ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
  return Number.isFinite(num) ? num : null;
}

function converter(campo: Campo, raw: ValorCelula, date1904: boolean): ValorCelula {
  if ((CAMPOS_DATA as readonly string[]).includes(campo)) return paraData(raw, date1904);
  if (campo === "valor") return paraNumero(raw);
  return raw == null ? null : String(raw);
}

/* -------------------------------------------------------- abas tipadas */

function acharCabecalho(grade: Grade, identifica: string[]): number | null {
  for (const r of linhasOrdenadas(grade)) {
    if (r > 25) break;
    const textos = new Set([...grade.get(r)!.values()].map((c) => normalizar(c.v)));
    if (identifica.every((h) => textos.has(h))) return r;
  }
  return null;
}

function preambuloAte(grade: Grade, linhaLimite: number): CelulaSolta[] {
  const out: CelulaSolta[] = [];
  for (const r of linhasOrdenadas(grade)) {
    if (r >= linhaLimite) break;
    for (const [c, cel] of [...grade.get(r)!.entries()].sort((a, b) => a[0] - b[0])) {
      out.push({ endereco: `${letraColuna(c)}${r}`, valor: cel.v });
    }
  }
  return out;
}

function lerTipada(
  nome: string,
  tipo: Exclude<TipoAba, "dre" | "grade">,
  grade: Grade,
  maxCol: number,
  hdr: number,
  date1904: boolean
): Omit<AbaLida, "ordem" | "oculta"> {
  const spec = SPECS[tipo];
  const cab = grade.get(hdr)!;
  const linhas = linhasOrdenadas(grade);

  // Colunas que têm cabeçalho ou algum dado abaixo dele.
  const comDado = new Set<number>(cab.keys());
  for (const r of linhas) {
    if (r <= hdr) continue;
    for (const c of grade.get(r)!.keys()) comDado.add(c);
  }
  const titulosNorm = new Set([...cab.values()].map((c) => normalizar(c.v)));

  const usados = new Set<Campo>();
  const chaves = new Set<string>();
  const colunas: (ColunaAba & { idx: number })[] = [];
  let anterior: Campo | null = null;
  for (let c = 0; c <= maxCol; c++) {
    if (!comDado.has(c)) continue;
    const letra = letraColuna(c);
    const bruto = cab.get(c)?.v;
    let titulo = bruto == null ? "" : String(bruto).trim();
    let campo: Campo | null = titulo ? spec.mapa[normalizar(titulo)] ?? null : null;
    // Fornecedor: a coluna de destino (loja/canal) vem sem título, logo após Matriz.
    if (!titulo && tipo === "lancamento" && anterior === "matriz" && !titulosNorm.has("shopping")) {
      titulo = "Shopping / Destino";
      campo = "loja";
    }
    if (!titulo) titulo = `Coluna ${letra}`;
    if (campo && usados.has(campo)) campo = null;
    if (campo) usados.add(campo);
    let chave = titulo;
    if (chaves.has(chave)) chave = `${titulo} (${letra})`;
    chaves.add(chave);
    colunas.push({ letra, titulo, campo, chave, idx: c });
    anterior = campo;
  }

  const registros: RegistroFin[] = [];
  let ignoradas = 0;
  for (const r of linhas) {
    if (r <= hdr) continue;
    const row = grade.get(r)!;
    const cReg: RegistroFin["c"] = {};
    const x: RegistroFin["x"] = {};
    for (const col of colunas) {
      const raw = row.get(col.idx)?.v ?? null;
      if (raw == null) continue;
      if (col.campo) {
        const conv = converter(col.campo, raw, date1904);
        if (conv != null) cReg[col.campo] = conv;
        else x[col.chave] = raw;
      } else {
        x[col.chave] = raw;
      }
    }
    if (!spec.essenciais.some((k) => cReg[k] != null)) {
      ignoradas++;
      continue;
    }
    if (cReg.mes_competencia == null && typeof cReg.data_competencia === "string") {
      cReg.mes_competencia = primeiroDoMes(cReg.data_competencia);
    }
    if (cReg.mes_caixa == null && typeof cReg.data_caixa === "string") {
      cReg.mes_caixa = primeiroDoMes(cReg.data_caixa);
    }
    registros.push({
      aba: nome,
      tipo,
      linha: r,
      base: montarBase(spec.base(cReg, { linha: r, x })),
      c: cReg,
      x,
    });
  }

  const preambulo = preambuloAte(grade, hdr);
  return {
    aba: nome,
    tipo,
    titulo: (preambulo.find((p) => typeof p.valor === "string" && !/^[\d#]/.test(p.valor))?.valor as string) ?? null,
    dataReferencia: (preambulo.find((p) => typeof p.valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(p.valor))
      ?.valor as string | undefined)?.slice(0, 10) ?? null,
    linhaCabecalho: hdr,
    colunas: colunas.map((col) => ({ letra: col.letra, titulo: col.titulo, campo: col.campo, chave: col.chave })),
    preambulo,
    layout: null,
    registros,
    totalRegistros: registros.length,
    ignoradas,
  };
}

/* ------------------------------------------------------------------- DRE */

function lerDre(nome: string, grade: Grade): Omit<AbaLida, "ordem" | "oculta"> | null {
  const linhas = linhasOrdenadas(grade);
  let hdr: number | null = null;
  const meses = new Map<number, string>();
  for (const r of linhas) {
    const datas = [...grade.get(r)!.entries()].filter(
      ([, c]) => typeof c.v === "string" && /^\d{4}-\d{2}-\d{2}/.test(c.v)
    );
    if (datas.length >= 6) {
      hdr = r;
      for (const [c, cel] of datas) meses.set(c, primeiroDoMes(cel.v as string)!);
      break;
    }
  }
  if (hdr == null) return null;
  const primeiraMes = Math.min(...meses.keys());

  const layout: DreLinhaLayout[] = [];
  const registros: RegistroFin[] = [];
  const soltas: CelulaSolta[] = [];
  const ocorrencias = new Map<string, number>();
  let bloco = "Consolidado";

  for (const r of linhas) {
    if (r <= hdr) continue;
    const row = grade.get(r)!;
    let rotulo = "";
    for (const [c, cel] of [...row.entries()].sort((a, b) => a[0] - b[0])) {
      if (c >= primeiraMes) break;
      if (typeof cel.v === "string") {
        rotulo = cel.v;
        break;
      }
    }
    const valores = [...row.entries()].filter(([c]) => meses.has(c));
    for (const [c, cel] of row.entries()) {
      if (!meses.has(c) && !(c < primeiraMes && cel.v === rotulo)) {
        soltas.push({ endereco: `${letraColuna(c)}${r}`, valor: cel.v });
      }
    }
    if (!rotulo && valores.length === 0) continue;
    if (rotulo && valores.length === 0 && /\bDRE\b/i.test(rotulo)) {
      bloco = rotulo;
      layout.push({ linha: r, bloco, rotulo, ocorrencia: 0, formato: "moeda", titulo: true });
      continue;
    }
    const chaveOc = `${bloco}|${normalizar(rotulo)}`;
    const ocorrencia = ocorrencias.get(chaveOc) ?? 0;
    ocorrencias.set(chaveOc, ocorrencia + 1);
    const formato: DreLinhaLayout["formato"] = valores.some(([, c]) => c.pct)
      ? "pct"
      : /markup/i.test(rotulo)
        ? "multiplo"
        : "moeda";
    layout.push({ linha: r, bloco, rotulo, ocorrencia, formato });

    for (const [c, cel] of valores) {
      const mes = meses.get(c)!;
      const num = typeof cel.v === "number" ? cel.v : null;
      registros.push({
        aba: nome,
        tipo: "dre",
        linha: r,
        base: montarBase([bloco, normalizar(rotulo), ocorrencia, mes]),
        c: { grupo: bloco, classificacao: rotulo || null, mes_competencia: mes, valor: num },
        x: num == null ? { texto: cel.v } : {},
      });
    }
  }

  return {
    aba: nome,
    tipo: "dre",
    titulo: "DRE",
    dataReferencia: null,
    linhaCabecalho: hdr,
    colunas: [],
    preambulo: [...preambuloAte(grade, hdr), ...soltas],
    layout,
    registros,
    totalRegistros: registros.length,
    ignoradas: 0,
  };
}

/* ------------------------------------------------------------------ grade */

function lerGrade(nome: string, grade: Grade, maxCol: number): Omit<AbaLida, "ordem" | "oculta"> {
  const usadas = new Set<number>();
  for (const row of grade.values()) for (const c of row.keys()) usadas.add(c);
  const colunas: ColunaAba[] = [];
  for (let c = 0; c <= maxCol; c++) {
    if (!usadas.has(c)) continue;
    const letra = letraColuna(c);
    colunas.push({ letra, titulo: letra, campo: null, chave: letra });
  }
  const registros: RegistroFin[] = linhasOrdenadas(grade).map((r) => {
    const x: RegistroFin["x"] = {};
    for (const [c, cel] of grade.get(r)!.entries()) x[letraColuna(c)] = cel.v;
    return { aba: nome, tipo: "grade", linha: r, base: `L${r}`, c: {}, x };
  });
  return {
    aba: nome,
    tipo: "grade",
    titulo: null,
    dataReferencia: null,
    linhaCabecalho: null,
    colunas,
    preambulo: [],
    layout: null,
    registros,
    totalRegistros: registros.length,
    ignoradas: 0,
  };
}

/* ------------------------------------------------------------------ main */

export interface PlanilhaLida {
  abas: AbaLida[];
  date1904: boolean;
}

export function lerPlanilhaFinanceira(dados: ArrayBuffer): PlanilhaLida {
  const wb = XLSX.read(dados, {
    type: "array",
    cellDates: false,
    cellNF: true,
    cellFormula: false,
    cellHTML: false,
    cellText: false,
  });
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  const abas: AbaLida[] = [];

  wb.SheetNames.forEach((nomeOriginal, ordem) => {
    const ws = wb.Sheets[nomeOriginal];
    const nome = nomeOriginal.trim();
    const oculta = !!wb.Workbook?.Sheets?.[ordem]?.Hidden;
    const { grade, maxCol } = montarGrade(ws, date1904);

    let tipo = tipoDaAba(nome);
    let lida: Omit<AbaLida, "ordem" | "oculta"> | null = null;

    if (tipo === "dre") {
      lida = lerDre(nome, grade);
    } else {
      if (!tipo) {
        // Aba nova: se o cabeçalho é de lançamento, entra como lançamento.
        for (const r of linhasOrdenadas(grade).slice(0, 25)) {
          if (pareceLancamento([...grade.get(r)!.values()].map((c) => String(c.v)))) {
            tipo = "lancamento";
            break;
          }
        }
      }
      if (tipo && tipo !== "grade") {
        const t = tipo as Exclude<TipoAba, "dre" | "grade">;
        const hdr = acharCabecalho(grade, SPECS[t].identifica);
        if (hdr != null) lida = lerTipada(nome, t, grade, maxCol, hdr, date1904);
      }
    }
    // Estrutura que não bate com o mapa nunca se perde: vira grade.
    if (!lida) lida = lerGrade(nome, grade, maxCol);
    abas.push({ ...lida, ordem, oculta });
  });

  return { abas, date1904 };
}
