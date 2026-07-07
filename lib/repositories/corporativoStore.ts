import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { hasPostgres, getNeonSql } from "@/lib/db/neon";

/**
 * Persistência da LOJA CORPORATIVA — o "e-commerce" interno do cliente atacado.
 * Três domínios: catálogo (produtos + preço atacado manual), imagens de produto
 * GLOBAIS (produto × cor × posição, base64) e pedidos do checkout.
 *
 * Segue o padrão do app: usa Postgres/Neon quando `DATABASE_URL` está
 * configurado; caso contrário, cai para arquivos JSON em `data/` (dev local
 * sem banco) — igual a users-store / presentation-asset-store.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const CATALOGO_FILE = path.join(DATA_DIR, "corporativo-catalogo.json");
const IMAGENS_FILE = path.join(DATA_DIR, "produto-imagens.json");
const PEDIDOS_FILE = path.join(DATA_DIR, "corporativo-pedidos.json");

let tablesChecked = false;

async function ensureTables() {
  if (tablesChecked) return;
  const sql = getNeonSql();
  await sql`
    CREATE TABLE IF NOT EXISTS corporativo_catalogo (
      produto TEXT PRIMARY KEY,
      preco_atacado NUMERIC(18,2) NOT NULL DEFAULT 0,
      categoria TEXT NOT NULL DEFAULT '',
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      ordem INTEGER NOT NULL DEFAULT 0,
      desc_produto TEXT NOT NULL DEFAULT '',
      ean TEXT NOT NULL DEFAULT '',
      grupo TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS produto_imagens (
      produto TEXT NOT NULL,
      cor TEXT NOT NULL DEFAULT '',
      posicao INTEGER NOT NULL DEFAULT 0,
      data_url TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (produto, cor, posicao)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS corporativo_pedidos (
      id TEXT PRIMARY KEY,
      cliente_codigo TEXT NOT NULL DEFAULT '',
      cliente_nome TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL DEFAULT '',
      user_nome TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',
      subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
      frete NUMERIC(18,2) NOT NULL DEFAULT 0,
      total NUMERIC(18,2) NOT NULL DEFAULT 0,
      endereco JSONB,
      itens JSONB NOT NULL DEFAULT '[]'::jsonb,
      observacao TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  tablesChecked = true;
}

// ── Helpers de arquivo (fallback local sem Postgres) ────────────────────────
async function readFile<T>(file: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
async function writeFile<T>(file: string, rows: T[]): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
  await fs.writeFile(file, JSON.stringify(rows, null, 2), "utf-8");
}

/* ────────────────────────────── Catálogo ────────────────────────────── */

export interface CatalogoItem {
  produto: string;
  precoAtacado: number;
  categoria: string;
  ativo: boolean;
  ordem: number;
  descProduto: string;
  ean: string;
  grupo: string;
  updatedAt: string;
}

export interface CatalogoUpsertInput {
  produto: string;
  precoAtacado: number;
  categoria?: string;
  ativo?: boolean;
  ordem?: number;
  descProduto?: string;
  ean?: string;
  grupo?: string;
}

function rowToCatalogo(row: {
  produto: string;
  preco_atacado: number | string;
  categoria: string;
  ativo: boolean;
  ordem: number;
  desc_produto: string;
  ean: string;
  grupo: string;
  updated_at: Date | string;
}): CatalogoItem {
  return {
    produto: String(row.produto).trim(),
    precoAtacado: Number(row.preco_atacado ?? 0),
    categoria: row.categoria ?? "",
    ativo: row.ativo !== false,
    ordem: Number(row.ordem ?? 0),
    descProduto: row.desc_produto ?? "",
    ean: row.ean ?? "",
    grupo: row.grupo ?? "",
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function sortCatalogo(a: CatalogoItem, b: CatalogoItem): number {
  if (a.ordem !== b.ordem) return a.ordem - b.ordem;
  return a.descProduto.localeCompare(b.descProduto);
}

export async function listCatalogo(opts: { ativoOnly?: boolean } = {}): Promise<CatalogoItem[]> {
  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    const rows = opts.ativoOnly
      ? await sql`SELECT * FROM corporativo_catalogo WHERE ativo = TRUE ORDER BY ordem ASC, desc_produto ASC`
      : await sql`SELECT * FROM corporativo_catalogo ORDER BY ordem ASC, desc_produto ASC`;
    return rows.map((r) => rowToCatalogo(r as Parameters<typeof rowToCatalogo>[0]));
  }
  const all = await readFile<CatalogoItem>(CATALOGO_FILE);
  return all.filter((i) => (opts.ativoOnly ? i.ativo : true)).sort(sortCatalogo);
}

export async function getCatalogoItem(produto: string): Promise<CatalogoItem | null> {
  const cod = String(produto ?? "").trim();
  if (!cod) return null;
  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    const rows = await sql`SELECT * FROM corporativo_catalogo WHERE produto = ${cod} LIMIT 1`;
    const row = rows[0] as Parameters<typeof rowToCatalogo>[0] | undefined;
    return row ? rowToCatalogo(row) : null;
  }
  const all = await readFile<CatalogoItem>(CATALOGO_FILE);
  return all.find((i) => i.produto === cod) ?? null;
}

export async function upsertCatalogoItem(input: CatalogoUpsertInput): Promise<CatalogoItem> {
  const produto = String(input.produto ?? "").trim();
  if (!produto) throw new Error("Produto é obrigatório.");
  const preco = Number.isFinite(input.precoAtacado) ? Number(input.precoAtacado) : 0;
  const categoria = (input.categoria ?? "").trim();
  const ativo = input.ativo !== false;
  const ordem = Number.isFinite(input.ordem as number) ? Number(input.ordem) : 0;
  const desc = (input.descProduto ?? "").trim();
  const ean = (input.ean ?? "").trim();
  const grupo = (input.grupo ?? "").trim();

  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    const rows = await sql`
      INSERT INTO corporativo_catalogo
        (produto, preco_atacado, categoria, ativo, ordem, desc_produto, ean, grupo, updated_at)
      VALUES (${produto}, ${preco}, ${categoria}, ${ativo}, ${ordem}, ${desc}, ${ean}, ${grupo}, NOW())
      ON CONFLICT (produto) DO UPDATE SET
        preco_atacado = EXCLUDED.preco_atacado,
        categoria = EXCLUDED.categoria,
        ativo = EXCLUDED.ativo,
        ordem = EXCLUDED.ordem,
        desc_produto = CASE WHEN EXCLUDED.desc_produto <> '' THEN EXCLUDED.desc_produto ELSE corporativo_catalogo.desc_produto END,
        ean = CASE WHEN EXCLUDED.ean <> '' THEN EXCLUDED.ean ELSE corporativo_catalogo.ean END,
        grupo = CASE WHEN EXCLUDED.grupo <> '' THEN EXCLUDED.grupo ELSE corporativo_catalogo.grupo END,
        updated_at = NOW()
      RETURNING *
    `;
    return rowToCatalogo(rows[0] as Parameters<typeof rowToCatalogo>[0]);
  }

  const all = await readFile<CatalogoItem>(CATALOGO_FILE);
  const idx = all.findIndex((i) => i.produto === produto);
  const prev = idx >= 0 ? all[idx] : null;
  const item: CatalogoItem = {
    produto,
    precoAtacado: preco,
    categoria,
    ativo,
    ordem,
    descProduto: desc || prev?.descProduto || "",
    ean: ean || prev?.ean || "",
    grupo: grupo || prev?.grupo || "",
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) all[idx] = item;
  else all.push(item);
  await writeFile(CATALOGO_FILE, all);
  return item;
}

export async function deleteCatalogoItem(produto: string): Promise<void> {
  const cod = String(produto ?? "").trim();
  if (!cod) return;
  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    await sql`DELETE FROM corporativo_catalogo WHERE produto = ${cod}`;
    return;
  }
  const all = await readFile<CatalogoItem>(CATALOGO_FILE);
  await writeFile(CATALOGO_FILE, all.filter((i) => i.produto !== cod));
}

/* ────────────────────────── Imagens (global) ────────────────────────── */

export interface ProdutoImagem {
  produto: string;
  cor: string;
  posicao: number;
  dataUrl: string;
  updatedAt: string;
}

function rowToImagem(row: {
  produto: string;
  cor: string;
  posicao: number;
  data_url: string;
  updated_at: Date | string;
}): ProdutoImagem {
  return {
    produto: String(row.produto).trim(),
    cor: row.cor ?? "",
    posicao: Number(row.posicao ?? 0),
    dataUrl: row.data_url,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function sortImagem(a: ProdutoImagem, b: ProdutoImagem): number {
  if (a.cor !== b.cor) return a.cor.localeCompare(b.cor);
  return a.posicao - b.posicao;
}

export async function listProdutoImagens(produto: string): Promise<ProdutoImagem[]> {
  const cod = String(produto ?? "").trim();
  if (!cod) return [];
  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT produto, cor, posicao, data_url, updated_at
      FROM produto_imagens WHERE produto = ${cod}
      ORDER BY cor ASC, posicao ASC`;
    return rows.map((r) => rowToImagem(r as Parameters<typeof rowToImagem>[0]));
  }
  const all = await readFile<ProdutoImagem>(IMAGENS_FILE);
  return all.filter((i) => i.produto === cod).sort(sortImagem);
}

/** Primeira imagem (capa) de cada produto de uma lista — para os cards da vitrine. */
export async function getCoverImagens(produtos: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const codes = [...new Set(produtos.map((p) => String(p ?? "").trim()).filter(Boolean))];
  if (codes.length === 0) return map;
  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    const rows = await sql`
      SELECT DISTINCT ON (produto) produto, data_url
      FROM produto_imagens
      WHERE produto = ANY(${codes}::text[])
      ORDER BY produto, cor ASC, posicao ASC`;
    for (const r of rows as { produto: string; data_url: string }[]) {
      map.set(String(r.produto).trim(), r.data_url);
    }
    return map;
  }
  const wanted = new Set(codes);
  const all = (await readFile<ProdutoImagem>(IMAGENS_FILE))
    .filter((i) => wanted.has(i.produto))
    .sort(sortImagem);
  for (const im of all) {
    if (!map.has(im.produto)) map.set(im.produto, im.dataUrl);
  }
  return map;
}

export async function upsertProdutoImagem(input: {
  produto: string;
  cor?: string;
  posicao?: number;
  dataUrl: string;
}): Promise<ProdutoImagem> {
  const produto = String(input.produto ?? "").trim();
  if (!produto) throw new Error("Produto é obrigatório.");
  if (!input.dataUrl) throw new Error("Imagem é obrigatória.");
  const cor = (input.cor ?? "").trim();
  const posicao = Number.isFinite(input.posicao as number) ? Number(input.posicao) : 0;

  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    const rows = await sql`
      INSERT INTO produto_imagens (produto, cor, posicao, data_url, updated_at)
      VALUES (${produto}, ${cor}, ${posicao}, ${input.dataUrl}, NOW())
      ON CONFLICT (produto, cor, posicao)
      DO UPDATE SET data_url = EXCLUDED.data_url, updated_at = NOW()
      RETURNING produto, cor, posicao, data_url, updated_at`;
    return rowToImagem(rows[0] as Parameters<typeof rowToImagem>[0]);
  }

  const all = await readFile<ProdutoImagem>(IMAGENS_FILE);
  const item: ProdutoImagem = { produto, cor, posicao, dataUrl: input.dataUrl, updatedAt: new Date().toISOString() };
  const idx = all.findIndex((i) => i.produto === produto && i.cor === cor && i.posicao === posicao);
  if (idx >= 0) all[idx] = item;
  else all.push(item);
  await writeFile(IMAGENS_FILE, all);
  return item;
}

export async function deleteProdutoImagem(produto: string, cor: string, posicao: number): Promise<void> {
  const cod = String(produto ?? "").trim();
  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    await sql`DELETE FROM produto_imagens WHERE produto = ${cod} AND cor = ${cor ?? ""} AND posicao = ${posicao}`;
    return;
  }
  const all = await readFile<ProdutoImagem>(IMAGENS_FILE);
  await writeFile(
    IMAGENS_FILE,
    all.filter((i) => !(i.produto === cod && i.cor === (cor ?? "") && i.posicao === posicao))
  );
}

/* ────────────────────────────── Pedidos ────────────────────────────── */

export interface PedidoItem {
  produto: string;
  descProduto: string;
  ean: string;
  cor: string;
  corNome: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
}

export interface PedidoEndereco {
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export interface Pedido {
  id: string;
  clienteCodigo: string;
  clienteNome: string;
  userId: string;
  userNome: string;
  status: string;
  subtotal: number;
  frete: number;
  total: number;
  endereco: PedidoEndereco | null;
  itens: PedidoItem[];
  observacao: string;
  createdAt: string;
}

export interface CriarPedidoInput {
  clienteCodigo: string;
  clienteNome: string;
  userId: string;
  userNome: string;
  frete: number;
  endereco: PedidoEndereco | null;
  itens: PedidoItem[];
  observacao?: string;
}

function rowToPedido(row: {
  id: string;
  cliente_codigo: string;
  cliente_nome: string;
  user_id: string;
  user_nome: string;
  status: string;
  subtotal: number | string;
  frete: number | string;
  total: number | string;
  endereco: PedidoEndereco | null;
  itens: PedidoItem[] | string;
  observacao: string;
  created_at: Date | string;
}): Pedido {
  const itens = typeof row.itens === "string" ? (JSON.parse(row.itens) as PedidoItem[]) : row.itens ?? [];
  const endereco =
    typeof row.endereco === "string" ? (JSON.parse(row.endereco) as PedidoEndereco) : row.endereco ?? null;
  return {
    id: row.id,
    clienteCodigo: row.cliente_codigo ?? "",
    clienteNome: row.cliente_nome ?? "",
    userId: row.user_id ?? "",
    userNome: row.user_nome ?? "",
    status: row.status ?? "pendente",
    subtotal: Number(row.subtotal ?? 0),
    frete: Number(row.frete ?? 0),
    total: Number(row.total ?? 0),
    endereco,
    itens,
    observacao: row.observacao ?? "",
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function criarPedido(input: CriarPedidoInput): Promise<Pedido> {
  const itens = (input.itens ?? []).filter((i) => i && i.produto && i.quantidade > 0);
  if (itens.length === 0) throw new Error("O pedido não tem itens.");
  const subtotal = Number(itens.reduce((s, i) => s + Number(i.subtotal ?? 0), 0).toFixed(2));
  const frete = Number.isFinite(input.frete) ? Number(input.frete) : 0;
  const total = Number((subtotal + frete).toFixed(2));
  const id = randomUUID();

  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    const rows = await sql`
      INSERT INTO corporativo_pedidos
        (id, cliente_codigo, cliente_nome, user_id, user_nome, status, subtotal, frete, total, endereco, itens, observacao)
      VALUES (
        ${id}, ${input.clienteCodigo ?? ""}, ${input.clienteNome ?? ""}, ${input.userId ?? ""}, ${input.userNome ?? ""},
        'pendente', ${subtotal}, ${frete}, ${total},
        ${input.endereco ? JSON.stringify(input.endereco) : null}::jsonb,
        ${JSON.stringify(itens)}::jsonb, ${input.observacao ?? ""}
      )
      RETURNING *`;
    return rowToPedido(rows[0] as Parameters<typeof rowToPedido>[0]);
  }

  const pedido: Pedido = {
    id,
    clienteCodigo: input.clienteCodigo ?? "",
    clienteNome: input.clienteNome ?? "",
    userId: input.userId ?? "",
    userNome: input.userNome ?? "",
    status: "pendente",
    subtotal,
    frete,
    total,
    endereco: input.endereco ?? null,
    itens,
    observacao: input.observacao ?? "",
    createdAt: new Date().toISOString(),
  };
  const all = await readFile<Pedido>(PEDIDOS_FILE);
  all.push(pedido);
  await writeFile(PEDIDOS_FILE, all);
  return pedido;
}

export async function listPedidos(opts: {
  clienteCodigo?: string;
  userId?: string;
  limit?: number;
} = {}): Promise<Pedido[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    let rows;
    if (opts.clienteCodigo) {
      rows = await sql`SELECT * FROM corporativo_pedidos WHERE cliente_codigo = ${opts.clienteCodigo} ORDER BY created_at DESC LIMIT ${limit}`;
    } else if (opts.userId) {
      rows = await sql`SELECT * FROM corporativo_pedidos WHERE user_id = ${opts.userId} ORDER BY created_at DESC LIMIT ${limit}`;
    } else {
      rows = await sql`SELECT * FROM corporativo_pedidos ORDER BY created_at DESC LIMIT ${limit}`;
    }
    return rows.map((r) => rowToPedido(r as Parameters<typeof rowToPedido>[0]));
  }
  let all = (await readFile<Pedido>(PEDIDOS_FILE)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (opts.clienteCodigo) all = all.filter((p) => p.clienteCodigo === opts.clienteCodigo);
  else if (opts.userId) all = all.filter((p) => p.userId === opts.userId);
  return all.slice(0, limit);
}

export async function getPedido(id: string): Promise<Pedido | null> {
  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    const rows = await sql`SELECT * FROM corporativo_pedidos WHERE id = ${id} LIMIT 1`;
    const row = rows[0] as Parameters<typeof rowToPedido>[0] | undefined;
    return row ? rowToPedido(row) : null;
  }
  const all = await readFile<Pedido>(PEDIDOS_FILE);
  return all.find((p) => p.id === id) ?? null;
}

export async function updatePedidoStatus(id: string, status: string): Promise<void> {
  if (hasPostgres()) {
    await ensureTables();
    const sql = getNeonSql();
    await sql`UPDATE corporativo_pedidos SET status = ${status} WHERE id = ${id}`;
    return;
  }
  const all = await readFile<Pedido>(PEDIDOS_FILE);
  const idx = all.findIndex((p) => p.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], status };
    await writeFile(PEDIDOS_FILE, all);
  }
}
