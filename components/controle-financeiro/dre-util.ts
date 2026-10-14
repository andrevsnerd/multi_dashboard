import type { DreLinha, DreResposta } from "./shared";

export function normalizarRotulo(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface DreIndex {
  blocos: string[];
  linhas: DreLinha[];
  valor: (linha: number, mes: string) => number | null;
  texto: (linha: number, mes: string) => string | null;
  /** Primeira linha do bloco com esse rótulo (ignora acento/caixa/espaço). */
  acharLinha: (bloco: string, rotulo: string) => DreLinha | undefined;
  /** Série de um rótulo do bloco nos meses pedidos (null quando a célula está vazia). */
  serie: (bloco: string, rotulo: string, meses: string[]) => (number | null)[];
  soma: (bloco: string, rotulo: string, meses: string[]) => number;
}

export function indexarDre(dre: DreResposta): DreIndex {
  const valores = new Map<string, number | null>();
  const textos = new Map<string, string | null>();
  for (const c of dre.celulas) {
    valores.set(`${c.linha}|${c.mes}`, c.valor);
    if (c.texto) textos.set(`${c.linha}|${c.mes}`, c.texto);
  }
  const blocos = [...new Set(dre.layout.map((l) => l.bloco))];
  const acharLinha = (bloco: string, rotulo: string) => {
    const alvo = normalizarRotulo(rotulo);
    return dre.layout.find((l) => !l.titulo && l.bloco === bloco && normalizarRotulo(l.rotulo) === alvo);
  };
  const valor = (linha: number, mes: string) => valores.get(`${linha}|${mes}`) ?? null;
  const serie = (bloco: string, rotulo: string, meses: string[]) => {
    const l = acharLinha(bloco, rotulo);
    return meses.map((m) => (l ? valor(l.linha, m) : null));
  };
  return {
    blocos,
    linhas: dre.layout,
    valor,
    texto: (linha, mes) => textos.get(`${linha}|${mes}`) ?? null,
    acharLinha,
    serie,
    soma: (bloco, rotulo, meses) => serie(bloco, rotulo, meses).reduce<number>((t, v) => t + (v ?? 0), 0),
  };
}

export const mesesDoAno = (ano: number) =>
  Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}-01`);

/** Linhas que são subtotal/total (negrito) ou resultado (destaque). */
export function papelDaLinha(l: DreLinha): "resultado" | "total" | "taxa" | "detalhe" {
  const r = normalizarRotulo(l.rotulo);
  if (l.formato !== "moeda") return "taxa";
  if (r.startsWith("resultado")) return "resultado";
  if (r.startsWith("total") || r === "receitas liquidas" || r === "despesas") return "total";
  return "detalhe";
}

export const BLOCO_PRINCIPAL = "Consolidado";
