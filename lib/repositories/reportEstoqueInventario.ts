import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import type { InventarioLojaResumo, LojaInventarioDef } from "@/lib/reports/estoque-inventario";

/**
 * "Estoque inventário" do Gerador de Relatórios — porte FIEL de
 * C:\NERD\AUTOMACOES\estoque_inventario.py (modo por loja / --todas). Mesmas regras:
 *
 *  - Estoque lido de ESTOQUE_PRODUTOS (ES1..ES48 → TAMANHO = posição da grade). Nada é
 *    recalculado (regra do CLAUDE.md: estoque atual é o número do Linx).
 *  - Loja com mais de uma filial (troca de CNPJ): os produtos vêm de TODAS as filiais da
 *    loja, mas o estoque só da filial ATIVA (as demais entram com 0). A ativa é a de
 *    venda (LOJA_VENDA.DATA_VENDA) ou faturamento (FATURAMENTO.EMISSAO) mais recente;
 *    sem movimento, o 1º código da lista.
 *  - Códigos de barra: PRODUTOS_BARRA ativos, não vazios, com ATÉ 8 caracteres. Quando há
 *    mais de um para o mesmo PRODUTO × COR × TAMANHO, só o principal (TIPO_COD_BAR = 3
 *    primeiro, depois o menor código) leva o estoque; os demais saem com ESTOQUE 0.
 *  - Saída: FILIAL | CODIGO_BARRA | DESC_PRODUTO | CODIGO_COR | ESTOQUE, ordenada por
 *    FILIAL, DESC_PRODUTO, CODIGO_BARRA.
 *
 * Mudou a regra no script? Mude aqui também (e vice-versa).
 */

export interface InventarioRow {
  FILIAL: string;
  CODIGO_BARRA: string;
  DESC_PRODUTO: string | null;
  CODIGO_COR: string;
  ESTOQUE: number;
}

export interface InventarioLoja {
  loja: LojaInventarioDef;
  resumo: InventarioLojaResumo;
  rows: InventarioRow[];
}

const POSICOES_GRADE = Array.from({ length: 48 }, (_, i) => i + 1);
const COLUNAS_GRADE_ESTOQUE = POSICOES_GRADE.map((i) => `ES${i}`);

/** Igual ao `normalizar_texto` do script: troca NBSP por espaço e apara. */
function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).replace(/\u00a0/g, " ").trim();
}

/** Comparação por code point, como o sort de strings do pandas (não usa locale). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const chave = (produto: string, cor: string, tamanho: number) => `${produto}\u0001${cor}\u0001${tamanho}`;

function placeholders(request: { input: (n: string, t: unknown, v: unknown) => unknown }, prefix: string, values: string[]) {
  return values
    .map((v, i) => {
      request.input(`${prefix}${i}`, sql.VarChar, v);
      return `@${prefix}${i}`;
    })
    .join(", ");
}

async function carregarFiliais(cods: string[]): Promise<Map<string, string>> {
  return withRequest(async (request) => {
    const ph = placeholders(request, "cod", cods);
    const { recordset } = await request.query<{ COD_FILIAL: string; FILIAL: string }>(
      `SELECT COD_FILIAL, FILIAL FROM FILIAIS WITH (NOLOCK) WHERE LTRIM(RTRIM(COD_FILIAL)) IN (${ph})`
    );
    // Comparação exata: '001' (MATRIZ) e '00001' (CIDADE JARDIM) são filiais diferentes.
    const out = new Map<string, string>();
    for (const r of recordset) {
      const cod = String(r.COD_FILIAL ?? "").trim();
      if (!out.has(cod)) out.set(cod, norm(r.FILIAL) ?? "");
    }
    return out;
  });
}

function nomeFilial(nomes: Map<string, string>, cod: string): string {
  const nome = nomes.get(cod);
  if (nome === undefined) throw new Error(`COD_FILIAL ${cod} não encontrado em FILIAIS.`);
  return nome;
}

/** Entre os códigos da loja, devolve o FILIAL com movimentação mais recente. */
async function detectarFilialAtiva(cods: string[], nomes: Map<string, string>): Promise<string> {
  if (cods.length === 1) return nomeFilial(nomes, cods[0]);
  const nomesLoja = cods.map((c) => nomeFilial(nomes, c));
  return withRequest(async (request) => {
    const phCod = placeholders(request, "ac", cods);
    const phNome = placeholders(request, "an", nomesLoja);
    const { recordset } = await request.query<{ COD_FILIAL: string; ULTIMA: Date | null }>(`
      SELECT LTRIM(RTRIM(F.COD_FILIAL)) AS COD_FILIAL, MAX(M.DATA) AS ULTIMA
      FROM FILIAIS F WITH (NOLOCK)
      JOIN (
          SELECT CODIGO_FILIAL AS COD_FILIAL, MAX(DATA_VENDA) AS DATA
          FROM LOJA_VENDA WITH (NOLOCK) WHERE CODIGO_FILIAL IN (${phCod})
          GROUP BY CODIGO_FILIAL
          UNION ALL
          SELECT F2.COD_FILIAL, MAX(FT.EMISSAO)
          FROM FATURAMENTO FT WITH (NOLOCK)
          JOIN FILIAIS F2 WITH (NOLOCK) ON F2.FILIAL = FT.FILIAL
          WHERE FT.FILIAL IN (${phNome})
          GROUP BY F2.COD_FILIAL
      ) M ON M.COD_FILIAL = F.COD_FILIAL
      GROUP BY F.COD_FILIAL
    `);
    const comData = recordset
      .filter((r) => r.ULTIMA != null)
      .sort((a, b) => new Date(b.ULTIMA as Date).getTime() - new Date(a.ULTIMA as Date).getTime());
    const ativo = comData.length > 0 ? String(comData[0].COD_FILIAL).trim() : cods[0];
    return nomeFilial(nomes, ativo);
  });
}

type EstoqueRaw = Record<string, unknown> & { FILIAL: string; PRODUTO: string; COR_PRODUTO: string };

async function carregarEstoque(filiais: string[]): Promise<EstoqueRaw[]> {
  return withRequest(async (request) => {
    const ph = placeholders(request, "fil", filiais);
    const { recordset } = await request.query<EstoqueRaw>(
      `SELECT FILIAL, PRODUTO, COR_PRODUTO, ${COLUNAS_GRADE_ESTOQUE.join(", ")}
       FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
       WHERE LTRIM(RTRIM(REPLACE(FILIAL, CHAR(160), ' '))) IN (${ph})`
    );
    return recordset;
  });
}

async function carregarProdutos(): Promise<Map<string, string | null>> {
  return withRequest(async (request) => {
    const { recordset } = await request.query<{ PRODUTO: string; DESC_PRODUTO: string | null }>(
      "SELECT PRODUTO, DESC_PRODUTO FROM PRODUTOS WITH (NOLOCK)"
    );
    const out = new Map<string, string | null>();
    for (const r of recordset) {
      const p = norm(r.PRODUTO);
      if (p !== null && !out.has(p)) out.set(p, norm(r.DESC_PRODUTO));
    }
    return out;
  });
}

interface Barra {
  codigo: string;
  /** 1 = principal (leva o estoque); > 1 = referência extra (sai com 0). */
  rn: number;
}

/** PRODUTO × COR × TAMANHO → códigos de barra já ordenados (RN). Igual a `preparar_barras`. */
async function carregarBarras(): Promise<Map<string, Barra[]>> {
  const recordset = await withRequest(async (request) => {
    const { recordset } = await request.query<{
      PRODUTO: string;
      COR_PRODUTO: string;
      TAMANHO: unknown;
      CODIGO_BARRA: string;
      TIPO_COD_BAR: unknown;
    }>(`
      SELECT
          LTRIM(RTRIM(PRODUTO)) AS PRODUTO,
          LTRIM(RTRIM(COR_PRODUTO)) AS COR_PRODUTO,
          TAMANHO,
          LTRIM(RTRIM(CODIGO_BARRA)) AS CODIGO_BARRA,
          ISNULL(TIPO_COD_BAR, 0) AS TIPO_COD_BAR
      FROM PRODUTOS_BARRA WITH (NOLOCK)
      WHERE ISNULL(INATIVO, 0) = 0
        AND CODIGO_BARRA IS NOT NULL
        AND LTRIM(RTRIM(CODIGO_BARRA)) <> ''
    `);
    return recordset;
  });

  const grupos = new Map<string, Array<{ codigo: string; prioridade: number }>>();
  for (const r of recordset) {
    const codigo = norm(r.CODIGO_BARRA) ?? "";
    // Regra do script: considerar apenas códigos de barras com até 8 dígitos.
    if (codigo.length > 8) continue;
    const produto = norm(r.PRODUTO);
    const cor = norm(r.COR_PRODUTO);
    const tamanho = Number(r.TAMANHO);
    if (produto === null || cor === null || r.TAMANHO === null || !Number.isFinite(tamanho)) continue;
    // TIPO_COD_BAR = 3 vale 100; código com até 8 dígitos vale +10 (sempre, após o filtro).
    const prioridade = (Number(r.TIPO_COD_BAR) === 3 ? 100 : 0) + 10;
    const k = chave(produto, cor, tamanho);
    const lista = grupos.get(k) ?? [];
    lista.push({ codigo, prioridade });
    grupos.set(k, lista);
  }

  const out = new Map<string, Barra[]>();
  for (const [k, lista] of grupos) {
    lista.sort((a, b) => b.prioridade - a.prioridade || cmp(a.codigo, b.codigo));
    out.set(k, lista.map((b, i) => ({ codigo: b.codigo, rn: i + 1 })));
  }
  return out;
}

/** Igual a `montar_inventario_loja` + `montar_inventario` do script. */
function montarInventarioLoja(
  filialAtiva: string,
  filiaisLoja: Set<string>,
  estoque: EstoqueRaw[],
  barras: Map<string, Barra[]>,
  produtos: Map<string, string | null>
): InventarioRow[] {
  // Estoque por PRODUTO × COR × TAMANHO: produtos de todas as filiais da loja, saldo só da ativa.
  const saldo = new Map<string, { produto: string; cor: string; tamanho: number; estoque: number }>();
  for (const r of estoque) {
    const filial = norm(r.FILIAL);
    if (filial === null || !filiaisLoja.has(filial)) continue;
    const produto = norm(r.PRODUTO);
    const cor = norm(r.COR_PRODUTO);
    if (produto === null || cor === null) continue;
    const ativa = filial === filialAtiva;
    for (const tamanho of POSICOES_GRADE) {
      const k = chave(produto, cor, tamanho);
      const qtde = ativa ? Number(r[`ES${tamanho}`]) || 0 : 0;
      const atual = saldo.get(k);
      if (atual) atual.estoque += qtde;
      else saldo.set(k, { produto, cor, tamanho, estoque: qtde });
    }
  }

  const rows: InventarioRow[] = [];
  for (const [k, s] of saldo) {
    const lista = barras.get(k);
    if (!lista) continue; // inner join: sem código de barra válido, fica fora.
    const desc = produtos.has(s.produto) ? produtos.get(s.produto) ?? null : null;
    for (const b of lista) {
      rows.push({
        FILIAL: filialAtiva,
        CODIGO_BARRA: b.codigo,
        DESC_PRODUTO: desc,
        CODIGO_COR: s.cor,
        // Regra pedida: primeira referência carrega estoque; demais saem com zero.
        ESTOQUE: b.rn === 1 ? Math.trunc(s.estoque) : 0,
      });
    }
  }

  // Ordenação do script: FILIAL, DESC_PRODUTO (vazio por último), CODIGO_BARRA.
  rows.sort((a, b) => {
    if (a.DESC_PRODUTO !== b.DESC_PRODUTO) {
      if (a.DESC_PRODUTO === null) return 1;
      if (b.DESC_PRODUTO === null) return -1;
      const d = cmp(a.DESC_PRODUTO, b.DESC_PRODUTO);
      if (d !== 0) return d;
    }
    return cmp(a.CODIGO_BARRA, b.CODIGO_BARRA);
  });
  return rows;
}

/** Monta o inventário de cada loja pedida (carrega barras/produtos uma vez só). */
export async function fetchEstoqueInventario(lojas: LojaInventarioDef[]): Promise<InventarioLoja[]> {
  const todosCods = [...new Set(lojas.flatMap((l) => l.cods))];
  const nomes = await carregarFiliais(todosCods);

  const ativas = new Map<string, string>();
  for (const loja of lojas) {
    ativas.set(loja.slug, await detectarFilialAtiva(loja.cods, nomes));
  }

  const todasFiliais = [...new Set(lojas.flatMap((l) => l.cods.map((c) => nomeFilial(nomes, c))))];
  const [estoque, barras, produtos] = await Promise.all([
    carregarEstoque(todasFiliais),
    carregarBarras(),
    carregarProdutos(),
  ]);

  return lojas.map((loja) => {
    const filialAtiva = ativas.get(loja.slug)!;
    const filiaisLoja = new Set(loja.cods.map((c) => nomeFilial(nomes, c)));
    const rows = montarInventarioLoja(filialAtiva, filiaisLoja, estoque, barras, produtos);
    return {
      loja,
      rows,
      resumo: {
        slug: loja.slug,
        filialAtiva,
        cods: loja.cods,
        linhas: rows.length,
        comSaldo: rows.filter((r) => r.ESTOQUE !== 0).length,
        pecas: rows.reduce((acc, r) => acc + r.ESTOQUE, 0),
      },
    };
  });
}

/**
 * Caractere de controle no cadastro (ex.: \x02 no fim de uma DESC_PRODUTO) não é XML
 * válido. O xlsxwriter do script grava como `_x0002_`; o exceljs descartaria. Escapamos
 * igual ao script para o arquivo sair idêntico.
 */
function escaparControle(s: string): string {
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);
}

/** XLSX de uma loja — aba "Inventario", cabeçalho em negrito e colunas autoajustadas. */
export async function buildInventarioXlsx(rows: InventarioRow[]): Promise<Buffer> {
  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inventario");

  const headers: Array<keyof InventarioRow> = ["FILIAL", "CODIGO_BARRA", "DESC_PRODUTO", "CODIGO_COR", "ESTOQUE"];
  const larguras = headers.map((h) => h.length);
  const header = sheet.addRow(headers);
  header.eachCell((cell: { font: unknown; border: unknown; alignment: unknown }) => {
    cell.font = { bold: true };
    cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    cell.alignment = { horizontal: "center" };
  });
  for (const r of rows) {
    const valores = headers.map((h) => (typeof r[h] === "string" ? escaparControle(r[h] as string) : r[h]));
    sheet.addRow(valores);
    valores.forEach((v, i) => {
      const len = v === null ? 0 : String(v).length;
      if (len > larguras[i]) larguras[i] = len;
    });
  }
  larguras.forEach((w, i) => {
    sheet.getColumn(i + 1).width = Math.min(w + 2, 100);
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
