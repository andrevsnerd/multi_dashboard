import "server-only";

import fs from "fs";
import path from "path";

import { getNeonSql, hasPostgres } from "@/lib/db/neon";

/**
 * RASCUNHOS DO INVENTÁRIO POR BIPAGEM — COMPARTILHADO POR FILIAL.
 *
 * O inventário é da LOJA, não de quem bipa: duas ou mais pessoas contam juntas,
 * cada uma no seu login. Existe UM rascunho aberto por (empresa × filial) e todo
 * mundo que abre a filial (ou clica em "Continuar") bipa nele.
 *
 * ARMAZENAMENTO — cabeçalho em `inventario_rascunhos`, UMA LINHA POR ITEM em
 * `inventario_rascunho_itens`. Um bipe grava só a linha do item (não a lista
 * inteira) e cada linha guarda a `versao` em que mudou: a tela pede "o que mudou
 * desde a versão N" e recebe só isso. Item removido fica com quantidade 0 (lápide)
 * para a tela do colega saber que saiu.
 *
 * CONVERGÊNCIA — a tela nunca manda "a lista é esta" (isso apagaria o que o colega
 * bipou e a tela ainda não viu). Manda, só das linhas que mexeu, a quantidade da
 * BASE (a última versão do servidor que ela conhece) e a atual; o servidor aplica
 * a diferença por cima do que está gravado. Ale bipa 2, Fátima bipa 2 sem ver os
 * de Ale, Ale bipa mais 2 sem ver os de Fátima → ficam os 6.
 *
 * - `versao` (cabeçalho) sobe a cada mudança; gravação = UPDATE ... WHERE versao =
 *   lida + itens na MESMA transação (otimista, com retry).
 * - `syncId` torna o envio idempotente: resposta perdida + reenvio não soma 2×.
 * - `porUsuario` em cada linha é o rastro de quem contou quanto; `presenca` guarda,
 *   por pessoa, o último bipe e quantos bipes dela NÃO entraram (painel vermelho) —
 *   o subir trava enquanto alguém tiver bipe sem resolver.
 * - Status: aberto → finalizando (trava de quem sobe) → finalizado; ou descartado.
 *   Finalizado/descartado ficam como lápide: quem estava junto descobre que acabou
 *   e não consegue mais bipar nele.
 * - Trava vencida (servidor caiu no meio da subida): quem esbarra nela confere no
 *   Linx se a contagem foi gravada — gravada vira finalizado, senão volta a aberto.
 *
 * Rascunhos antigos (antes de 04/11/2026) eram por usuário, com os itens num JSON
 * do próprio registro (`compartilhado = false`). Continuam listados; abrir um deles
 * o converte (ou soma ao compartilhado, se a pessoa quiser).
 */

const DATA_FILE = path.join(process.cwd(), "data", "inventario-rascunhos.json");

/** "Finalizando" mais velho que isso: a rota de subir (maxDuration 120s) com certeza morreu. */
const TRAVA_VENCE_MS = 3 * 60 * 1000;
/** Quantos syncIds guardar para reconhecer reenvio. */
const SYNC_IDS_MAX = 120;

export type InventarioRascunhoStatus = "aberto" | "finalizando" | "finalizado" | "descartado";

export interface InventarioRascunhoItem {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  /** 0 = item removido (só aparece em "o que mudou desde a versão N"). */
  quantidade: number;
  /** Peça P/M/G: posição da grade (null = sem tamanho / ainda não escolhido). */
  tamanho?: number | null;
  tamanhoLabel?: string | null;
  /** Quantas peças desta linha cada usuário contou (soma = quantidade). */
  porUsuario?: Record<string, number>;
  /** Versão do rascunho em que a linha mudou pela última vez. */
  versao?: number;
}

export interface InventarioParticipante {
  username: string;
  pecas: number;
  ultimoBipeEm: string | null;
  /** Bipes dessa pessoa que NÃO entraram na contagem (painel vermelho da tela dela). */
  ocorrencias: number;
  ocorrenciasEm: string | null;
}

/** Cabeçalho do rascunho (sem os itens). */
export interface InventarioRascunho {
  id: string;
  companyKey: string;
  /** Quem começou o inventário. */
  username: string;
  /** COD_FILIAL do Linx (o inventário é sempre de uma filial física). */
  filialCod: string;
  filialNome: string;
  nomeContagem: string;
  nomeEditado: boolean;
  observacao: string;
  createdAt: string;
  updatedAt: string;
  /** Rascunho por filial. `false` = rascunho antigo, por usuário. */
  compartilhado: boolean;
  versao: number;
  status: InventarioRascunhoStatus;
  /** Finalizando há tempo demais (a subida provavelmente caiu). */
  travaVencida: boolean;
  atualizadoPor: string;
  finalizadoPor: string | null;
  finalizadoEm: string | null;
  participantes: InventarioParticipante[];
  totalPecas: number;
  totalLinhas: number;
}

export interface InventarioCabecalho {
  nomeContagem: string;
  nomeEditado: boolean;
  observacao: string;
}

/** Rascunho + itens: completo (todas as linhas) ou só o que mudou desde a versão pedida. */
export interface InventarioSnapshot {
  rascunho: InventarioRascunho;
  itens: InventarioRascunhoItem[];
  completo: boolean;
}

export interface SincronizarInventarioInput {
  companyKey: string;
  username: string;
  filialCod: string;
  filialNome?: string | null;
  /** Rascunho que a tela está seguindo (null = ainda não entrou em nenhum). */
  rascunhoId: string | null;
  /** Versão que a tela conhece (-1 = nenhuma). */
  versaoBase: number;
  syncId: string;
  /** Só as linhas que a tela mexeu: quantidade na base... */
  base: InventarioRascunhoItem[];
  /** ...e quantidade agora. */
  itens: InventarioRascunhoItem[];
  /** Só vem quando a tela mudou o cabeçalho (última gravação vence). */
  cabecalho?: InventarioCabecalho | null;
  /** Bipes desta tela que não entraram (painel vermelho). */
  ocorrencias?: number | null;
}

export type SincronizarInventarioResultado =
  | ({ estado: "ok" } & InventarioSnapshot)
  /** Alguém está subindo este inventário agora: nada foi aplicado. */
  | { estado: "travado"; rascunho: InventarioRascunho }
  /** O inventário já subiu (ou foi descartado): nada foi aplicado. */
  | { estado: "encerrado"; rascunho: InventarioRascunho | null };

// ─────────────────────────── tipos internos ───────────────────────────

interface PresencaUsuario {
  ocorrencias: number;
  ocorrenciasEm: string | null;
  ultimoBipeEm: string | null;
}

/** Cabeçalho como gravado. */
interface Cab {
  id: string;
  company_key: string;
  username: string;
  filial_cod: string;
  filial_nome: string;
  nome_contagem: string;
  nome_editado: boolean;
  observacao: string;
  /** Itens do rascunho antigo (JSON no próprio registro). Vazio nos compartilhados. */
  itens_legado: InventarioRascunhoItem[];
  created_at: string;
  updated_at: string;
  compartilhado: boolean;
  itens_em_tabela: boolean;
  versao: number;
  status: InventarioRascunhoStatus;
  atualizado_por: string;
  finalizado_por: string | null;
  finalizado_em: string | null;
  finalizando_desde: string | null;
  finalizando_nome: string | null;
  sync_ids: string[];
  presenca: Record<string, PresencaUsuario>;
  participantes: Record<string, number>;
  total_pecas: number;
  total_linhas: number;
}

/** Linha de item como gravada. */
interface Linha {
  chave: string;
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  tamanho: number | null;
  tamanhoLabel: string | null;
  quantidade: number;
  porUsuario: Record<string, number>;
  versao: number;
  criadoVersao: number;
}

// ─────────────────────────── helpers ───────────────────────────

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function normUser(value: unknown): string {
  return norm(value).toLowerCase();
}

/** Mesma chave da tela (`chaveSync`): produto × cor × tamanho. */
export function chaveItemInventario(p: { produto: string; corProduto: string | null; tamanho?: number | null }): string {
  return `${norm(p.produto)}|${norm(p.corProduto)}|${p.tamanho ?? ""}`;
}

function novoId(companyKey: string, filialCod: string): string {
  return [norm(companyKey).toLowerCase(), "inventario", norm(filialCod).toUpperCase(), novoToken()].join("::");
}

function novoToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizePorUsuario(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const user = normUser(k);
    const n = Math.trunc(Number(v) || 0);
    if (user && n > 0) out[user] = (out[user] ?? 0) + n;
  }
  return out;
}

function tamanhoValido(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Linhas válidas da tela, uma por chave (quantidade ≤ 0 some). */
function sanitizeItens(itens: unknown): InventarioRascunhoItem[] {
  if (!Array.isArray(itens)) return [];
  const porChave = new Map<string, InventarioRascunhoItem>();
  for (const raw of itens) {
    const item = (raw ?? {}) as Partial<InventarioRascunhoItem>;
    const produto = norm(item.produto);
    const quantidade = Math.trunc(Number(item.quantidade) || 0);
    if (!produto || quantidade <= 0) continue;
    const limpo: InventarioRascunhoItem = {
      produto,
      descProduto: norm(item.descProduto),
      codigoBarra: norm(item.codigoBarra) || null,
      corProduto: norm(item.corProduto) || null,
      descCor: norm(item.descCor),
      quantidade,
      tamanho: tamanhoValido(item.tamanho),
      tamanhoLabel: norm(item.tamanhoLabel) || null,
      porUsuario: sanitizePorUsuario(item.porUsuario),
    };
    const chave = chaveItemInventario(limpo);
    const existente = porChave.get(chave);
    if (existente) {
      existente.quantidade += limpo.quantidade;
      for (const [u, n] of Object.entries(limpo.porUsuario ?? {})) {
        existente.porUsuario![u] = (existente.porUsuario![u] ?? 0) + n;
      }
    } else {
      porChave.set(chave, limpo);
    }
  }
  return [...porChave.values()];
}

/**
 * Mantém `soma(porUsuario) = quantidade`. Peça sem dono conhecido (rascunho antigo)
 * fica com quem começou o inventário; sobra é tirada de quem tem mais.
 */
function ajustarPorUsuario(pu: Record<string, number>, quantidade: number, donoPadrao: string): Record<string, number> {
  const out = { ...pu };
  let soma = Object.values(out).reduce((acc, n) => acc + n, 0);
  if (soma < quantidade) {
    const dono = normUser(donoPadrao) || "?";
    out[dono] = (out[dono] ?? 0) + (quantidade - soma);
    soma = quantidade;
  }
  while (soma > quantidade) {
    const [maior] = Object.entries(out).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    if (!maior) break;
    const tira = Math.min(maior[1], soma - quantidade);
    out[maior[0]] = maior[1] - tira;
    if (out[maior[0]] <= 0) delete out[maior[0]];
    soma -= tira;
  }
  return out;
}

function linhaParaItem(l: Linha): InventarioRascunhoItem {
  return {
    produto: l.produto,
    descProduto: l.descProduto,
    codigoBarra: l.codigoBarra,
    corProduto: l.corProduto,
    descCor: l.descCor,
    quantidade: l.quantidade,
    tamanho: l.tamanho,
    tamanhoLabel: l.tamanhoLabel,
    porUsuario: l.porUsuario,
    versao: l.versao,
  };
}

function itemParaLinha(it: InventarioRascunhoItem, versao: number, dono: string): Linha {
  return {
    chave: chaveItemInventario(it),
    produto: it.produto,
    descProduto: it.descProduto,
    codigoBarra: it.codigoBarra,
    corProduto: it.corProduto,
    descCor: it.descCor,
    tamanho: it.tamanho ?? null,
    tamanhoLabel: it.tamanhoLabel ?? null,
    quantidade: it.quantidade,
    porUsuario: ajustarPorUsuario(it.porUsuario ?? {}, it.quantidade, dono),
    versao,
    criadoVersao: versao,
  };
}

/**
 * O coração da convergência: aplica (itens − base) da tela sobre as linhas gravadas.
 * Peça a mais vira +N para quem mandou; peça a menos sai primeiro do que a própria
 * pessoa contou, depois dos outros. Nunca fica negativo (0 = lápide).
 * Devolve só as linhas que mudaram, já com a versão nova.
 */
function aplicarDiferencaInventario(params: {
  atuais: Map<string, Linha>;
  base: InventarioRascunhoItem[];
  itens: InventarioRascunhoItem[];
  username: string;
  donoPadrao: string;
  versaoNova: number;
}): { linhas: Linha[]; deltaPorUsuario: Record<string, number>; deltaPecas: number; deltaLinhas: number; bipou: boolean } {
  const user = normUser(params.username);
  const baseQ = new Map<string, number>();
  for (const it of sanitizeItens(params.base)) baseQ.set(chaveItemInventario(it), it.quantidade);
  const cliente = new Map<string, InventarioRascunhoItem>();
  for (const it of sanitizeItens(params.itens)) cliente.set(chaveItemInventario(it), it);

  const linhas: Linha[] = [];
  const deltaPorUsuario: Record<string, number> = {};
  let deltaPecas = 0;
  let deltaLinhas = 0;
  let bipou = false;
  const somarUsuario = (antes: Record<string, number>, depois: Record<string, number>) => {
    for (const u of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
      const d = (depois[u] ?? 0) - (antes[u] ?? 0);
      if (d !== 0) deltaPorUsuario[u] = (deltaPorUsuario[u] ?? 0) + d;
    }
  };

  for (const chave of new Set([...cliente.keys(), ...baseQ.keys()])) {
    const d = (cliente.get(chave)?.quantidade ?? 0) - (baseQ.get(chave) ?? 0);
    if (d === 0) continue;
    const atual = params.atuais.get(chave);
    const qAntes = atual?.quantidade ?? 0;
    const puAntes = atual ? ajustarPorUsuario(atual.porUsuario, qAntes, params.donoPadrao) : {};

    if (d > 0) {
      const doCliente = cliente.get(chave)!;
      const pu = { ...puAntes, [user]: (puAntes[user] ?? 0) + d };
      const linha: Linha = {
        chave,
        produto: atual?.produto || doCliente.produto,
        // Descrição/código podem ter chegado depois (linha antiga sem dado).
        descProduto: atual?.descProduto || doCliente.descProduto,
        codigoBarra: atual?.codigoBarra || doCliente.codigoBarra,
        corProduto: atual ? atual.corProduto : doCliente.corProduto,
        descCor: atual?.descCor || doCliente.descCor,
        tamanho: atual ? atual.tamanho : doCliente.tamanho ?? null,
        tamanhoLabel: atual?.tamanhoLabel || doCliente.tamanhoLabel || null,
        quantidade: qAntes + d,
        porUsuario: pu,
        versao: params.versaoNova,
        criadoVersao: atual?.criadoVersao ?? params.versaoNova,
      };
      linhas.push(linha);
      somarUsuario(puAntes, pu);
      deltaPecas += d;
      if (qAntes === 0) deltaLinhas += 1;
      bipou = true;
      continue;
    }

    if (!atual || qAntes <= 0) continue; // tirar o que já não está lá (colega tirou antes)
    let tirar = Math.min(-d, qAntes);
    const pu = { ...puAntes };
    for (const u of [user, ...Object.keys(pu).filter((x) => x !== user).sort()]) {
      if (tirar <= 0) break;
      const tem = pu[u] ?? 0;
      if (tem <= 0) continue;
      const t = Math.min(tem, tirar);
      pu[u] = tem - t;
      if (pu[u] <= 0) delete pu[u];
      tirar -= t;
    }
    const qDepois = Math.max(0, qAntes - Math.min(-d, qAntes));
    linhas.push({ ...atual, quantidade: qDepois, porUsuario: pu, versao: params.versaoNova });
    somarUsuario(puAntes, pu);
    deltaPecas += qDepois - qAntes;
    if (qDepois === 0) deltaLinhas -= 1;
  }

  return { linhas, deltaPorUsuario, deltaPecas, deltaLinhas, bipou };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return toIso(value);
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sanitizePresenca(raw: unknown): Record<string, PresencaUsuario> {
  const out: Record<string, PresencaUsuario> = {};
  const obj = parseJson(raw);
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = (v ?? {}) as Partial<PresencaUsuario>;
    const user = normUser(k);
    if (!user) continue;
    out[user] = {
      ocorrencias: Math.max(0, Math.trunc(Number(p.ocorrencias) || 0)),
      ocorrenciasEm: toIsoOrNull(p.ocorrenciasEm),
      ultimoBipeEm: toIsoOrNull(p.ultimoBipeEm),
    };
  }
  return out;
}

function rowToCab(row: Record<string, unknown>): Cab {
  const status = norm(row.status) as InventarioRascunhoStatus;
  const syncIds = parseJson(row.sync_ids);
  const participantes = parseJson(row.participantes);
  return {
    id: norm(row.id),
    company_key: norm(row.company_key),
    username: normUser(row.username),
    filial_cod: norm(row.filial_cod),
    filial_nome: norm(row.filial_nome) || norm(row.filial_cod),
    nome_contagem: norm(row.nome_contagem),
    nome_editado: row.nome_editado === true,
    observacao: norm(row.observacao),
    itens_legado: sanitizeItens(parseJson(row.itens)),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    compartilhado: row.compartilhado === true,
    itens_em_tabela: row.itens_em_tabela === true,
    versao: Math.trunc(Number(row.versao) || 0),
    status: ["aberto", "finalizando", "finalizado", "descartado"].includes(status) ? status : "aberto",
    atualizado_por: normUser(row.atualizado_por) || normUser(row.username),
    finalizado_por: normUser(row.finalizado_por) || null,
    finalizado_em: toIsoOrNull(row.finalizado_em),
    finalizando_desde: toIsoOrNull(row.finalizando_desde),
    finalizando_nome: norm(row.finalizando_nome) || null,
    sync_ids: Array.isArray(syncIds) ? syncIds.map((s) => norm(s)).filter(Boolean) : [],
    presenca: sanitizePresenca(row.presenca),
    participantes: sanitizePorUsuario(participantes),
    total_pecas: Math.max(0, Math.trunc(Number(row.total_pecas) || 0)),
    total_linhas: Math.max(0, Math.trunc(Number(row.total_linhas) || 0)),
  };
}

function rowToLinha(row: Record<string, unknown>): Linha {
  return {
    chave: norm(row.chave),
    produto: norm(row.produto),
    descProduto: norm(row.desc_produto),
    codigoBarra: norm(row.codigo_barra) || null,
    corProduto: norm(row.cor_produto) || null,
    descCor: norm(row.desc_cor),
    tamanho: tamanhoValido(row.tamanho),
    tamanhoLabel: norm(row.tamanho_label) || null,
    quantidade: Math.max(0, Math.trunc(Number(row.quantidade) || 0)),
    porUsuario: sanitizePorUsuario(parseJson(row.por_usuario)),
    versao: Math.trunc(Number(row.versao) || 0),
    criadoVersao: Math.trunc(Number(row.criado_versao) || 0),
  };
}

function travaVencida(c: Cab): boolean {
  if (c.status !== "finalizando") return false;
  const desde = c.finalizando_desde ? new Date(c.finalizando_desde).getTime() : 0;
  return Date.now() - desde > TRAVA_VENCE_MS;
}

function cabParaRascunho(c: Cab): InventarioRascunho {
  // Rascunho antigo: participantes e totais vêm do JSON do próprio registro.
  const legado = !c.itens_em_tabela;
  const participantesQtd = legado
    ? c.itens_legado.reduce<Record<string, number>>((acc, it) => {
        for (const [u, n] of Object.entries(ajustarPorUsuario(it.porUsuario ?? {}, it.quantidade, c.username))) {
          acc[u] = (acc[u] ?? 0) + n;
        }
        return acc;
      }, {})
    : c.participantes;
  const usuarios = new Set([...Object.keys(participantesQtd), ...Object.keys(c.presenca)]);
  const participantes = [...usuarios]
    .map((u) => ({
      username: u,
      pecas: participantesQtd[u] ?? 0,
      ultimoBipeEm: c.presenca[u]?.ultimoBipeEm ?? null,
      ocorrencias: c.presenca[u]?.ocorrencias ?? 0,
      ocorrenciasEm: c.presenca[u]?.ocorrenciasEm ?? null,
    }))
    .filter((p) => p.pecas > 0 || p.ocorrencias > 0)
    .sort((x, y) => y.pecas - x.pecas || x.username.localeCompare(y.username));
  return {
    id: c.id,
    companyKey: c.company_key,
    username: c.username,
    filialCod: c.filial_cod,
    filialNome: c.filial_nome,
    nomeContagem: c.nome_contagem,
    nomeEditado: c.nome_editado,
    observacao: c.observacao,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    compartilhado: c.compartilhado,
    versao: c.versao,
    status: c.status,
    travaVencida: travaVencida(c),
    atualizadoPor: c.atualizado_por,
    finalizadoPor: c.finalizado_por,
    finalizadoEm: c.finalizado_em,
    participantes,
    totalPecas: legado ? c.itens_legado.reduce((acc, it) => acc + it.quantidade, 0) : c.total_pecas,
    totalLinhas: legado ? c.itens_legado.length : c.total_linhas,
  };
}

function mesmaFilial(a: string, b: string): boolean {
  return norm(a).toUpperCase() === norm(b).toUpperCase();
}

function mesmaEmpresa(a: string, b: string): boolean {
  return norm(a).toLowerCase() === norm(b).toLowerCase();
}

function aplicarParticipantes(atual: Record<string, number>, delta: Record<string, number>): Record<string, number> {
  const out = { ...atual };
  for (const [u, d] of Object.entries(delta)) {
    out[u] = Math.max(0, (out[u] ?? 0) + d);
    if (out[u] <= 0) delete out[u];
  }
  return out;
}

// ─────────────────────── armazenamento: Neon ───────────────────────

let ensurePromise: Promise<void> | null = null;

/** CREATE concorrente: o objeto já existe = sucesso. */
function objetoJaExiste(erro: unknown): boolean {
  const code = (erro as { code?: string } | null)?.code;
  return code === "23505" || code === "42P07" || code === "42710" || code === "42701";
}

async function ddl(exec: () => Promise<unknown>): Promise<void> {
  try {
    await exec();
  } catch (erro) {
    if (!objetoJaExiste(erro)) throw erro;
  }
}

/**
 * Migrações SÓ do que falta. Uma consulta ao catálogo diz o que já existe; com
 * tudo criado, nenhum ALTER/CREATE roda (ALTER TABLE trava a tabela, mesmo com
 * IF NOT EXISTS — não pode rodar a cada instância nova do servidor).
 */
async function runMigrations(): Promise<void> {
  const sql = getNeonSql();
  const [estado] = (await sql`
    SELECT
      to_regclass('inventario_rascunhos') IS NOT NULL AS tem_cab,
      to_regclass('inventario_rascunho_itens') IS NOT NULL AS tem_itens,
      COALESCE((SELECT array_agg(column_name::text) FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'inventario_rascunhos'), '{}') AS colunas,
      COALESCE((SELECT array_agg(indexname::text) FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename IN ('inventario_rascunhos', 'inventario_rascunho_itens')), '{}') AS indices
  `) as Array<{ tem_cab: boolean; tem_itens: boolean; colunas: string[]; indices: string[] }>;

  if (!estado.tem_cab) {
    await ddl(() => sql`
      CREATE TABLE IF NOT EXISTS inventario_rascunhos (
        id TEXT PRIMARY KEY,
        company_key TEXT NOT NULL,
        username TEXT NOT NULL,
        filial_cod TEXT NOT NULL,
        filial_nome TEXT NOT NULL DEFAULT '',
        nome_contagem TEXT NOT NULL DEFAULT '',
        nome_editado BOOLEAN NOT NULL DEFAULT FALSE,
        observacao TEXT NOT NULL DEFAULT '',
        zerar_nao_contados BOOLEAN NOT NULL DEFAULT TRUE,
        itens JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }
  const colunas = new Set(estado.tem_cab ? estado.colunas : []);
  const indices = new Set(estado.indices);

  // Colunas do rascunho compartilhado (04/11/2026). As linhas que já existiam
  // recebem compartilhado = FALSE: são os rascunhos antigos, por usuário.
  const novas: Array<[string, () => Promise<unknown>]> = [
    ["compartilhado", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS compartilhado BOOLEAN NOT NULL DEFAULT FALSE`],
    ["itens_em_tabela", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS itens_em_tabela BOOLEAN NOT NULL DEFAULT FALSE`],
    ["versao", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS versao INTEGER NOT NULL DEFAULT 1`],
    ["status", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'aberto'`],
    ["atualizado_por", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS atualizado_por TEXT NOT NULL DEFAULT ''`],
    ["finalizado_por", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS finalizado_por TEXT`],
    ["finalizado_em", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS finalizado_em TIMESTAMPTZ`],
    ["finalizando_desde", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS finalizando_desde TIMESTAMPTZ`],
    ["finalizando_nome", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS finalizando_nome TEXT`],
    ["sync_ids", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS sync_ids JSONB NOT NULL DEFAULT '[]'::jsonb`],
    ["presenca", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS presenca JSONB NOT NULL DEFAULT '{}'::jsonb`],
    ["participantes", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS participantes JSONB NOT NULL DEFAULT '{}'::jsonb`],
    ["total_pecas", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS total_pecas INTEGER NOT NULL DEFAULT 0`],
    ["total_linhas", () => sql`ALTER TABLE inventario_rascunhos ADD COLUMN IF NOT EXISTS total_linhas INTEGER NOT NULL DEFAULT 0`],
  ];
  for (const [coluna, exec] of novas) {
    if (!colunas.has(coluna)) await ddl(exec);
  }

  if (!indices.has("inventario_rascunhos_company_idx")) {
    await ddl(() => sql`
      CREATE INDEX IF NOT EXISTS inventario_rascunhos_company_idx
        ON inventario_rascunhos (company_key, updated_at DESC)
    `);
  }
  // Um único rascunho aberto por empresa × filial: duas telas que começam ao mesmo
  // tempo esbarram aqui e a segunda entra no da primeira.
  if (!indices.has("inventario_rascunhos_aberto_filial_uq")) {
    await ddl(() => sql`
      CREATE UNIQUE INDEX IF NOT EXISTS inventario_rascunhos_aberto_filial_uq
        ON inventario_rascunhos (LOWER(company_key), UPPER(filial_cod))
        WHERE compartilhado AND status IN ('aberto', 'finalizando')
    `);
  }
  if (!estado.tem_itens) {
    await ddl(() => sql`
      CREATE TABLE IF NOT EXISTS inventario_rascunho_itens (
        rascunho_id TEXT NOT NULL REFERENCES inventario_rascunhos(id) ON DELETE CASCADE,
        chave TEXT NOT NULL,
        produto TEXT NOT NULL,
        desc_produto TEXT NOT NULL DEFAULT '',
        codigo_barra TEXT,
        cor_produto TEXT,
        desc_cor TEXT NOT NULL DEFAULT '',
        tamanho INTEGER,
        tamanho_label TEXT,
        quantidade INTEGER NOT NULL DEFAULT 0,
        por_usuario JSONB NOT NULL DEFAULT '{}'::jsonb,
        versao INTEGER NOT NULL,
        criado_versao INTEGER NOT NULL,
        PRIMARY KEY (rascunho_id, chave)
      )
    `);
  }
  if (!indices.has("inventario_rascunho_itens_versao_idx")) {
    await ddl(() => sql`
      CREATE INDEX IF NOT EXISTS inventario_rascunho_itens_versao_idx
        ON inventario_rascunho_itens (rascunho_id, versao)
    `);
  }
}

async function ensureTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = runMigrations().catch((erro) => {
      ensurePromise = null;
      throw erro;
    });
  }
  return ensurePromise;
}

function linhasJson(id: string, linhas: Linha[]): string {
  return JSON.stringify(
    linhas.map((l) => ({
      rascunho_id: id,
      chave: l.chave,
      produto: l.produto,
      desc_produto: l.descProduto,
      codigo_barra: l.codigoBarra,
      cor_produto: l.corProduto,
      desc_cor: l.descCor,
      tamanho: l.tamanho,
      tamanho_label: l.tamanhoLabel,
      quantidade: l.quantidade,
      por_usuario: l.porUsuario,
      versao: l.versao,
      criado_versao: l.criadoVersao,
    }))
  );
}

/**
 * Repositório. As gravações "guardadas" levam um `marca` (token único) para o
 * sync_ids do cabeçalho: os itens só são gravados se o cabeçalho tiver passado
 * para a versão nova COM a marca desta gravação (mesma transação).
 */
interface Repo {
  lerCab(id: string): Promise<Cab | null>;
  lerAbertoDaFilial(companyKey: string, filialCod: string): Promise<Cab | null>;
  inserirCab(c: Cab): Promise<void>;
  /** Grava cabeçalho + linhas SE a versão ainda for `versaoLida` (e o status, um dos esperados). */
  gravar(
    versaoLida: number,
    statusEsperado: InventarioRascunhoStatus[],
    novo: Cab,
    linhas: Linha[],
    marca: string,
    presenca: { user: string; dados: PresencaUsuario } | null
  ): Promise<boolean>;
  /** Presença de UM usuário, sem mexer na versão (não invalida a conferência de ninguém). */
  gravarPresenca(id: string, user: string, dados: PresencaUsuario): Promise<void>;
  lerLinhas(id: string, chaves: string[] | null): Promise<Linha[]>;
  /** Cabeçalho + linhas que mudaram depois de `versaoBase` (-1 = todas as vivas), na mesma foto. */
  lerDesde(id: string, versaoBase: number): Promise<{ cab: Cab; linhas: Linha[] } | null>;
  apagarCab(id: string): Promise<void>;
  listarCabs(companyKey: string): Promise<Cab[]>;
  limpar(): Promise<void>;
}

const repoNeon: Repo = {
  async lerCab(id) {
    const sql = getNeonSql();
    await ensureTable();
    const rows = await sql`SELECT * FROM inventario_rascunhos WHERE id = ${norm(id)}`;
    return rows.length > 0 ? rowToCab(rows[0] as Record<string, unknown>) : null;
  },
  async lerAbertoDaFilial(companyKey, filialCod) {
    const sql = getNeonSql();
    await ensureTable();
    const rows = await sql`
      SELECT * FROM inventario_rascunhos
      WHERE compartilhado AND status IN ('aberto', 'finalizando')
        AND LOWER(company_key) = LOWER(${norm(companyKey)})
        AND UPPER(filial_cod) = UPPER(${norm(filialCod)})
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    return rows.length > 0 ? rowToCab(rows[0] as Record<string, unknown>) : null;
  },
  async inserirCab(c) {
    const sql = getNeonSql();
    await ensureTable();
    await sql`
      INSERT INTO inventario_rascunhos (
        id, company_key, username, filial_cod, filial_nome, compartilhado, itens_em_tabela,
        versao, status, atualizado_por, itens
      ) VALUES (
        ${c.id}, ${c.company_key}, ${c.username}, ${c.filial_cod}, ${c.filial_nome}, TRUE, TRUE,
        0, 'aberto', ${c.atualizado_por}, '[]'::jsonb
      )
      ON CONFLICT DO NOTHING
    `;
  },
  async gravar(versaoLida, statusEsperado, novo, linhas, marca, presenca) {
    const sql = getNeonSql();
    await ensureTable();
    const presUser = presenca?.user ?? "";
    const presJson = JSON.stringify(presenca?.dados ?? {});
    const consultas = [
      sql`
        UPDATE inventario_rascunhos SET
          filial_nome = ${novo.filial_nome},
          nome_contagem = ${novo.nome_contagem},
          nome_editado = ${novo.nome_editado},
          observacao = ${novo.observacao},
          itens = ${JSON.stringify(novo.itens_legado)}::jsonb,
          compartilhado = ${novo.compartilhado},
          itens_em_tabela = ${novo.itens_em_tabela},
          versao = ${novo.versao},
          status = ${novo.status},
          atualizado_por = ${novo.atualizado_por},
          finalizado_por = ${novo.finalizado_por},
          finalizado_em = ${novo.finalizado_em},
          finalizando_desde = ${novo.finalizando_desde},
          finalizando_nome = ${novo.finalizando_nome},
          sync_ids = ${JSON.stringify(novo.sync_ids)}::jsonb,
          participantes = ${JSON.stringify(novo.participantes)}::jsonb,
          total_pecas = ${novo.total_pecas},
          total_linhas = ${novo.total_linhas},
          presenca = CASE WHEN ${presUser} = '' THEN presenca
                          ELSE jsonb_set(COALESCE(presenca, '{}'::jsonb), ARRAY[${presUser}]::text[], ${presJson}::jsonb, true) END,
          updated_at = NOW()
        WHERE id = ${novo.id} AND versao = ${versaoLida} AND status = ANY(${statusEsperado}::text[])
        RETURNING id
      `,
    ];
    if (linhas.length > 0) {
      consultas.push(sql`
        INSERT INTO inventario_rascunho_itens (
          rascunho_id, chave, produto, desc_produto, codigo_barra, cor_produto, desc_cor,
          tamanho, tamanho_label, quantidade, por_usuario, versao, criado_versao
        )
        SELECT r.rascunho_id, r.chave, r.produto, r.desc_produto, r.codigo_barra, r.cor_produto, r.desc_cor,
               r.tamanho, r.tamanho_label, r.quantidade, r.por_usuario, r.versao, r.criado_versao
        FROM jsonb_to_recordset(${linhasJson(novo.id, linhas)}::jsonb) AS r(
          rascunho_id TEXT, chave TEXT, produto TEXT, desc_produto TEXT, codigo_barra TEXT, cor_produto TEXT,
          desc_cor TEXT, tamanho INTEGER, tamanho_label TEXT, quantidade INTEGER, por_usuario JSONB,
          versao INTEGER, criado_versao INTEGER
        )
        WHERE EXISTS (
          SELECT 1 FROM inventario_rascunhos h
          WHERE h.id = ${novo.id} AND h.versao = ${novo.versao} AND h.sync_ids @> ${JSON.stringify([marca])}::jsonb
        )
        ON CONFLICT (rascunho_id, chave) DO UPDATE SET
          produto = EXCLUDED.produto,
          desc_produto = EXCLUDED.desc_produto,
          codigo_barra = EXCLUDED.codigo_barra,
          cor_produto = EXCLUDED.cor_produto,
          desc_cor = EXCLUDED.desc_cor,
          tamanho = EXCLUDED.tamanho,
          tamanho_label = EXCLUDED.tamanho_label,
          quantidade = EXCLUDED.quantidade,
          por_usuario = EXCLUDED.por_usuario,
          versao = EXCLUDED.versao
      `);
    }
    const resultados = (await sql.transaction(consultas)) as unknown[][];
    return (resultados[0]?.length ?? 0) > 0;
  },
  async gravarPresenca(id, user, dados) {
    const sql = getNeonSql();
    await ensureTable();
    await sql`
      UPDATE inventario_rascunhos
      SET presenca = jsonb_set(COALESCE(presenca, '{}'::jsonb), ARRAY[${user}]::text[], ${JSON.stringify(dados)}::jsonb, true)
      WHERE id = ${id} AND status IN ('aberto', 'finalizando')
    `;
  },
  async lerLinhas(id, chaves) {
    const sql = getNeonSql();
    await ensureTable();
    const rows =
      chaves === null
        ? await sql`
            SELECT * FROM inventario_rascunho_itens
            WHERE rascunho_id = ${id} AND quantidade > 0
            ORDER BY criado_versao, chave
          `
        : chaves.length === 0
          ? []
          : await sql`
              SELECT * FROM inventario_rascunho_itens
              WHERE rascunho_id = ${id} AND chave = ANY(${chaves}::text[])
            `;
    return rows.map((r) => rowToLinha(r as Record<string, unknown>));
  },
  async lerDesde(id, versaoBase) {
    const sql = getNeonSql();
    await ensureTable();
    const completo = versaoBase < 0;
    const [cabs, linhas] = (await sql.transaction(
      [
        sql`SELECT * FROM inventario_rascunhos WHERE id = ${id}`,
        sql`
          SELECT * FROM inventario_rascunho_itens
          WHERE rascunho_id = ${id} AND versao > ${versaoBase} AND (${!completo} OR quantidade > 0)
          ORDER BY criado_versao, chave
        `,
      ],
      { isolationLevel: "RepeatableRead", readOnly: true }
    )) as Array<Array<Record<string, unknown>>>;
    if (!cabs || cabs.length === 0) return null;
    return { cab: rowToCab(cabs[0]), linhas: (linhas ?? []).map(rowToLinha) };
  },
  async apagarCab(id) {
    const sql = getNeonSql();
    await ensureTable();
    await sql`DELETE FROM inventario_rascunhos WHERE id = ${norm(id)}`;
  },
  async listarCabs(companyKey) {
    const sql = getNeonSql();
    await ensureTable();
    const rows = await sql`
      SELECT * FROM inventario_rascunhos
      WHERE LOWER(company_key) = LOWER(${norm(companyKey)})
        AND status IN ('aberto', 'finalizando')
      ORDER BY updated_at DESC
      LIMIT 200
    `;
    return rows.map((row) => rowToCab(row as Record<string, unknown>));
  },
  async limpar() {
    const sql = getNeonSql();
    await ensureTable();
    // Lápides velhas (os itens vão junto, ON DELETE CASCADE) e compartilhados vazios esquecidos.
    await sql`
      DELETE FROM inventario_rascunhos
      WHERE (status IN ('finalizado', 'descartado') AND updated_at < NOW() - INTERVAL '90 days')
         OR (compartilhado AND status = 'aberto' AND total_pecas = 0 AND updated_at < NOW() - INTERVAL '2 days')
    `;
  },
};

// ─────────────────────── armazenamento: arquivo (sem Neon) ───────────────────────

interface Arquivo {
  cabs: Cab[];
  linhas: Record<string, Linha[]>;
}

function lerArquivo(): Arquivo {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return { cabs: [], linhas: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    // Formato antigo: lista de rascunhos (camelCase), um por usuário.
    const cabsRaw: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : parsed.cabs ?? [];
    const cabs = cabsRaw.map((raw) =>
      raw.company_key !== undefined
        ? rowToCab(raw)
        : rowToCab({
            id: raw.id,
            company_key: raw.companyKey,
            username: raw.username,
            filial_cod: raw.filialCod,
            filial_nome: raw.filialNome,
            nome_contagem: raw.nomeContagem,
            nome_editado: raw.nomeEditado,
            observacao: raw.observacao,
            itens: raw.itens,
            created_at: raw.createdAt,
            updated_at: raw.updatedAt,
          })
    );
    const linhasRaw = (Array.isArray(parsed) ? {} : parsed.linhas ?? {}) as Record<string, Array<Record<string, unknown>>>;
    const linhas: Record<string, Linha[]> = {};
    for (const [id, ls] of Object.entries(linhasRaw)) linhas[id] = ls.map((l) => rowToLinha(l));
    return { cabs, linhas };
  } catch {
    return { cabs: [], linhas: {} };
  }
}

function gravarArquivo(a: Arquivo) {
  const linhas: Record<string, unknown[]> = {};
  for (const [id, ls] of Object.entries(a.linhas)) {
    linhas[id] = ls.map((l) => ({
      chave: l.chave,
      produto: l.produto,
      desc_produto: l.descProduto,
      codigo_barra: l.codigoBarra,
      cor_produto: l.corProduto,
      desc_cor: l.descCor,
      tamanho: l.tamanho,
      tamanho_label: l.tamanhoLabel,
      quantidade: l.quantidade,
      por_usuario: l.porUsuario,
      versao: l.versao,
      criado_versao: l.criadoVersao,
    }));
  }
  const cabs = a.cabs.map((c) => ({ ...c, itens: c.itens_legado }));
  fs.writeFileSync(DATA_FILE, JSON.stringify({ cabs, linhas }, null, 2), "utf-8");
}

const repoArquivo: Repo = {
  async lerCab(id) {
    return lerArquivo().cabs.find((c) => c.id === norm(id)) ?? null;
  },
  async lerAbertoDaFilial(companyKey, filialCod) {
    return (
      lerArquivo()
        .cabs.filter(
          (c) =>
            c.compartilhado &&
            (c.status === "aberto" || c.status === "finalizando") &&
            mesmaEmpresa(c.company_key, companyKey) &&
            mesmaFilial(c.filial_cod, filialCod)
        )
        .sort((x, y) => y.updated_at.localeCompare(x.updated_at))[0] ?? null
    );
  },
  async inserirCab(c) {
    const a = lerArquivo();
    const jaTem = a.cabs.some(
      (x) =>
        x.compartilhado &&
        (x.status === "aberto" || x.status === "finalizando") &&
        mesmaEmpresa(x.company_key, c.company_key) &&
        mesmaFilial(x.filial_cod, c.filial_cod)
    );
    if (jaTem) return;
    a.cabs.push({ ...c, compartilhado: true, itens_em_tabela: true, versao: 0, status: "aberto" });
    gravarArquivo(a);
  },
  async gravar(versaoLida, statusEsperado, novo, linhas, _marca, presenca) {
    const a = lerArquivo();
    const idx = a.cabs.findIndex((c) => c.id === novo.id);
    if (idx < 0 || a.cabs[idx].versao !== versaoLida || !statusEsperado.includes(a.cabs[idx].status)) return false;
    // Índice único: no máximo um compartilhado em andamento por filial.
    if (
      novo.compartilhado &&
      (novo.status === "aberto" || novo.status === "finalizando") &&
      a.cabs.some(
        (c) =>
          c.id !== novo.id &&
          c.compartilhado &&
          (c.status === "aberto" || c.status === "finalizando") &&
          mesmaEmpresa(c.company_key, novo.company_key) &&
          mesmaFilial(c.filial_cod, novo.filial_cod)
      )
    ) {
      throw Object.assign(new Error("duplicado"), { code: "23505" });
    }
    const presencaAtual = a.cabs[idx].presenca;
    a.cabs[idx] = {
      ...novo,
      presenca: presenca ? { ...presencaAtual, [presenca.user]: presenca.dados } : presencaAtual,
      updated_at: new Date().toISOString(),
    };
    const atuais = new Map((a.linhas[novo.id] ?? []).map((l) => [l.chave, l]));
    for (const l of linhas) atuais.set(l.chave, { ...l, criadoVersao: atuais.get(l.chave)?.criadoVersao ?? l.criadoVersao });
    a.linhas[novo.id] = [...atuais.values()];
    gravarArquivo(a);
    return true;
  },
  async gravarPresenca(id, user, dados) {
    const a = lerArquivo();
    const c = a.cabs.find((x) => x.id === id);
    if (!c || (c.status !== "aberto" && c.status !== "finalizando")) return;
    c.presenca = { ...c.presenca, [user]: dados };
    gravarArquivo(a);
  },
  async lerLinhas(id, chaves) {
    const todas = lerArquivo().linhas[id] ?? [];
    if (chaves === null) {
      return todas.filter((l) => l.quantidade > 0).sort((x, y) => x.criadoVersao - y.criadoVersao || x.chave.localeCompare(y.chave));
    }
    const set = new Set(chaves);
    return todas.filter((l) => set.has(l.chave));
  },
  async lerDesde(id, versaoBase) {
    const a = lerArquivo();
    const cab = a.cabs.find((c) => c.id === id);
    if (!cab) return null;
    const linhas = (a.linhas[id] ?? [])
      .filter((l) => l.versao > versaoBase && (versaoBase >= 0 || l.quantidade > 0))
      .sort((x, y) => x.criadoVersao - y.criadoVersao || x.chave.localeCompare(y.chave));
    return { cab, linhas };
  },
  async apagarCab(id) {
    const a = lerArquivo();
    a.cabs = a.cabs.filter((c) => c.id !== id);
    delete a.linhas[id];
    gravarArquivo(a);
  },
  async listarCabs(companyKey) {
    return lerArquivo()
      .cabs.filter((c) => mesmaEmpresa(c.company_key, companyKey) && (c.status === "aberto" || c.status === "finalizando"))
      .sort((x, y) => y.updated_at.localeCompare(x.updated_at));
  },
  async limpar() {
    // arquivo local: nada a limpar
  },
};

function repo(): Repo {
  return hasPostgres() ? repoNeon : repoArquivo;
}

// ─────────────────────────── núcleo ───────────────────────────

/**
 * Lê → decide → grava com versão; refaz se outra tela gravou no meio.
 * `decidir` devolve a gravação (com as linhas) ou a resposta pronta.
 */
async function comRetry<T>(
  id: string,
  decidir: (
    atual: Cab
  ) => Promise<
    | { pronto: T }
    | {
        novo: Cab;
        linhas?: Linha[];
        statusEsperado?: InventarioRascunhoStatus[];
        presenca?: { user: string; dados: PresencaUsuario } | null;
        depois: (gravado: Cab) => Promise<T> | T;
      }
  >
): Promise<T | null> {
  // Várias telas gravando no mesmo instante: quem perde a corrida espera um tempo
  // aleatório crescente (até ~1,5s) e refaz. Medido no Neon: 24 envios simultâneos.
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    const atual = await repo().lerCab(id);
    if (!atual) return null;
    const passo = await decidir(atual);
    if ("pronto" in passo) return passo.pronto;
    const marca = novoToken();
    const novo: Cab = { ...passo.novo, sync_ids: [...passo.novo.sync_ids, marca].slice(-SYNC_IDS_MAX) };
    const ok = await repo().gravar(
      atual.versao,
      passo.statusEsperado ?? [atual.status],
      novo,
      passo.linhas ?? [],
      marca,
      passo.presenca ?? null
    );
    if (ok) return passo.depois(novo);
    await new Promise((r) => setTimeout(r, 30 + Math.random() * Math.min(1500, 60 * 2 ** Math.min(tentativa, 5))));
  }
  throw new Error("Muitas gravações simultâneas no rascunho — tente de novo.");
}

/** Itens de um rascunho antigo passam para a tabela (rascunho vira compartilhado). */
function linhasDoLegado(c: Cab, versao: number): Linha[] {
  return c.itens_legado.map((it) => itemParaLinha(it, versao, c.username));
}

function totaisDe(linhas: Linha[]): { participantes: Record<string, number>; pecas: number; linhasVivas: number } {
  const participantes: Record<string, number> = {};
  let pecas = 0;
  let linhasVivas = 0;
  for (const l of linhas) {
    if (l.quantidade <= 0) continue;
    pecas += l.quantidade;
    linhasVivas += 1;
    for (const [u, n] of Object.entries(l.porUsuario)) participantes[u] = (participantes[u] ?? 0) + n;
  }
  return { participantes, pecas, linhasVivas };
}

async function snapshot(id: string, versaoBase: number): Promise<InventarioSnapshot | null> {
  const r = await repo().lerDesde(id, versaoBase);
  if (!r) return null;
  return { rascunho: cabParaRascunho(r.cab), itens: r.linhas.map(linhaParaItem), completo: versaoBase < 0 };
}

/** Cria o compartilhado da filial; se outra tela criou no mesmo instante, devolve o dela. */
async function abrirOuCriar(params: {
  companyKey: string;
  filialCod: string;
  filialNome: string;
  username: string;
}): Promise<Cab> {
  const existente = await repo().lerAbertoDaFilial(params.companyKey, params.filialCod);
  if (existente) return existente;
  const agora = new Date().toISOString();
  await repo().inserirCab({
    id: novoId(params.companyKey, params.filialCod),
    company_key: norm(params.companyKey),
    username: normUser(params.username),
    filial_cod: norm(params.filialCod),
    filial_nome: norm(params.filialNome) || norm(params.filialCod),
    nome_contagem: "",
    nome_editado: false,
    observacao: "",
    itens_legado: [],
    created_at: agora,
    updated_at: agora,
    compartilhado: true,
    itens_em_tabela: true,
    versao: 0,
    status: "aberto",
    atualizado_por: normUser(params.username),
    finalizado_por: null,
    finalizado_em: null,
    finalizando_desde: null,
    finalizando_nome: null,
    sync_ids: [],
    presenca: {},
    participantes: {},
    total_pecas: 0,
    total_linhas: 0,
  });
  const criado = await repo().lerAbertoDaFilial(params.companyKey, params.filialCod);
  if (!criado) throw new Error("Não foi possível abrir o rascunho do inventário.");
  return criado;
}

// ─────────────────────────── API ───────────────────────────

/**
 * Sincroniza a tela com o rascunho compartilhado: aplica a diferença da tela e
 * devolve o que mudou desde a versão que a tela conhecia (com o que os colegas biparam).
 */
export async function sincronizarInventarioRascunho(
  input: SincronizarInventarioInput
): Promise<SincronizarInventarioResultado> {
  const companyKey = norm(input.companyKey);
  const username = normUser(input.username);
  const filialCod = norm(input.filialCod);
  const syncId = norm(input.syncId);
  if (!companyKey || !username || !filialCod || !syncId) {
    throw new Error('Parâmetros "company", "filialCod" e "syncId" são obrigatórios.');
  }

  let id = norm(input.rascunhoId);
  const base = input.base;
  let versaoBase = Number.isFinite(input.versaoBase) ? Math.trunc(input.versaoBase) : -1;
  if (!id) {
    // A tela ainda não segue nenhum: entra no da filial (ou cria) e soma ao que os
    // colegas já contaram. A base vale como veio: normalmente vazia (tudo é peça
    // nova); num envio de RECUPERAÇÃO é a lista do envio anterior desta mesma tela
    // (que pode ter sido justamente o que criou o rascunho) — zerar a base aqui
    // contaria essas peças duas vezes.
    const temAlgo = sanitizeItens(input.itens).length > 0 || !!input.cabecalho;
    const existente = await repo().lerAbertoDaFilial(companyKey, filialCod);
    if (!existente && !temAlgo) return { estado: "encerrado", rascunho: null };
    const alvo = existente ?? (await abrirOuCriar({ companyKey, filialCod, filialNome: norm(input.filialNome), username }));
    id = alvo.id;
    versaoBase = -1;
  }

  const ocorrencias = input.ocorrencias == null ? null : Math.max(0, Math.trunc(Number(input.ocorrencias) || 0));
  const chaves = [
    ...new Set([...sanitizeItens(input.itens), ...sanitizeItens(base)].map((it) => chaveItemInventario(it))),
  ];

  const resultado = await comRetry<SincronizarInventarioResultado>(id, async (atual) => {
    if (!mesmaEmpresa(atual.company_key, companyKey) || !mesmaFilial(atual.filial_cod, filialCod) || !atual.compartilhado) {
      return { pronto: { estado: "encerrado", rascunho: null } };
    }
    if (atual.status === "finalizado" || atual.status === "descartado") {
      return { pronto: { estado: "encerrado", rascunho: cabParaRascunho(atual) } };
    }
    if (atual.status === "finalizando") {
      return { pronto: { estado: "travado", rascunho: cabParaRascunho(atual) } };
    }
    // Reenvio de algo que já entrou (resposta perdida): não soma de novo.
    if (atual.sync_ids.includes(syncId)) {
      const s = await snapshot(atual.id, versaoBase);
      return { pronto: s ? { estado: "ok", ...s } : { estado: "encerrado", rascunho: null } };
    }

    const versaoNova = atual.versao + 1;
    const atuais = new Map((await repo().lerLinhas(atual.id, chaves)).map((l) => [l.chave, l]));
    const dif = aplicarDiferencaInventario({
      atuais,
      base,
      itens: input.itens,
      username,
      donoPadrao: atual.username,
      versaoNova,
    });

    const cab = input.cabecalho;
    const nomeCab = cab ? norm(cab.nomeContagem).slice(0, 25) : atual.nome_contagem;
    const mudouCab =
      !!cab &&
      (nomeCab !== atual.nome_contagem ||
        (cab.nomeEditado === true) !== atual.nome_editado ||
        norm(cab.observacao) !== atual.observacao);

    const presAntes = atual.presenca[username];
    const agora = new Date().toISOString();
    const ocorrenciasNovas = ocorrencias ?? presAntes?.ocorrencias ?? 0;
    const presenca: PresencaUsuario = {
      ocorrencias: ocorrenciasNovas,
      ocorrenciasEm:
        ocorrenciasNovas !== (presAntes?.ocorrencias ?? 0) ? agora : presAntes?.ocorrenciasEm ?? null,
      ultimoBipeEm: dif.bipou ? agora : presAntes?.ultimoBipeEm ?? null,
    };
    const mudouPresenca =
      presenca.ocorrencias !== (presAntes?.ocorrencias ?? 0) || presenca.ultimoBipeEm !== (presAntes?.ultimoBipeEm ?? null);

    if (dif.linhas.length === 0 && !mudouCab) {
      // Nada na contagem: só a presença (sem subir versão — não invalida a conferência de ninguém).
      if (mudouPresenca) await repo().gravarPresenca(atual.id, username, presenca);
      const s = await snapshot(atual.id, versaoBase);
      return { pronto: s ? { estado: "ok", ...s } : { estado: "encerrado", rascunho: null } };
    }

    const novo: Cab = {
      ...atual,
      filial_nome: norm(input.filialNome) || atual.filial_nome,
      nome_contagem: nomeCab,
      nome_editado: cab ? cab.nomeEditado === true : atual.nome_editado,
      observacao: cab ? norm(cab.observacao) : atual.observacao,
      versao: versaoNova,
      atualizado_por: username,
      sync_ids: [...atual.sync_ids, syncId],
      participantes: aplicarParticipantes(atual.participantes, dif.deltaPorUsuario),
      total_pecas: Math.max(0, atual.total_pecas + dif.deltaPecas),
      total_linhas: Math.max(0, atual.total_linhas + dif.deltaLinhas),
    };
    return {
      novo,
      linhas: dif.linhas,
      statusEsperado: ["aberto"],
      presenca: { user: username, dados: presenca },
      depois: async () => {
        const s = await snapshot(atual.id, versaoBase);
        return s ? ({ estado: "ok", ...s } as const) : ({ estado: "encerrado", rascunho: null } as const);
      },
    };
  });

  return resultado ?? { estado: "encerrado", rascunho: null };
}

/** "Atualizar agora": o que mudou desde a versão que a tela conhece (-1 = tudo). */
export async function atualizarInventarioRascunho(id: string, versaoBase: number): Promise<InventarioSnapshot | null> {
  const key = norm(id);
  if (!key) return null;
  return snapshot(key, Number.isFinite(versaoBase) ? Math.trunc(versaoBase) : -1);
}

/**
 * Abre a filial na tela: o compartilhado em andamento, completo. Se não houver e o
 * usuário tiver um rascunho antigo (por usuário) desta filial, ele é convertido.
 */
export async function abrirInventarioDaFilial(params: {
  companyKey: string;
  filialCod: string;
  username: string;
}): Promise<InventarioSnapshot | null> {
  const aberto = await repo().lerAbertoDaFilial(params.companyKey, params.filialCod);
  if (aberto) return snapshot(aberto.id, -1);

  const antigos = (await repo().listarCabs(params.companyKey)).filter(
    (c) =>
      !c.compartilhado &&
      mesmaFilial(c.filial_cod, params.filialCod) &&
      c.username === normUser(params.username) &&
      c.itens_legado.length > 0
  );
  if (antigos.length === 0) return null;
  const adotado = await adotarInventarioRascunhoAntigo({ id: antigos[0].id, username: params.username, somar: false });
  return adotado.estado === "ok" ? snapshot(adotado.rascunho.id, -1) : null;
}

/**
 * "Continuar" num rascunho antigo (por usuário): vira o compartilhado da filial.
 * Se a filial já tem um compartilhado, só soma com `somar = true` — somar dois
 * rascunhos pode contar a mesma peça duas vezes, então quem decide é a pessoa.
 */
export async function adotarInventarioRascunhoAntigo(params: {
  id: string;
  username: string;
  somar: boolean;
}): Promise<
  | { estado: "ok"; rascunho: InventarioRascunho }
  | { estado: "conflito"; existente: InventarioRascunho; antigo: InventarioRascunho }
  | { estado: "nao_encontrado" }
> {
  const antigo = await repo().lerCab(params.id);
  if (!antigo || antigo.status !== "aberto") return { estado: "nao_encontrado" };
  if (antigo.compartilhado) return { estado: "ok", rascunho: cabParaRascunho(antigo) };
  const user = normUser(params.username);

  const existente = await repo().lerAbertoDaFilial(antigo.company_key, antigo.filial_cod);
  if (!existente) {
    // Converte no lugar: itens do JSON viram linhas. O índice único barra duas conversões juntas.
    try {
      const convertido = await comRetry<Cab>(antigo.id, async (atual) => {
        if (atual.compartilhado || atual.status !== "aberto") return { pronto: atual };
        const versaoNova = atual.versao + 1;
        const linhas = linhasDoLegado(atual, versaoNova);
        const t = totaisDe(linhas);
        return {
          novo: {
            ...atual,
            compartilhado: true,
            itens_em_tabela: true,
            itens_legado: [],
            versao: versaoNova,
            atualizado_por: user,
            participantes: t.participantes,
            total_pecas: t.pecas,
            total_linhas: t.linhasVivas,
          },
          linhas,
          statusEsperado: ["aberto"],
          depois: (g) => g,
        };
      });
      if (convertido) return { estado: "ok", rascunho: cabParaRascunho(convertido) };
    } catch (erro) {
      if ((erro as { code?: string } | null)?.code !== "23505") throw erro;
    }
  }

  const alvo = existente ?? (await repo().lerAbertoDaFilial(antigo.company_key, antigo.filial_cod));
  if (!alvo) return { estado: "nao_encontrado" };
  if (!params.somar) {
    return { estado: "conflito", existente: cabParaRascunho(alvo), antigo: cabParaRascunho(antigo) };
  }

  // Soma: cada peça do antigo entra como contada pela dona dele.
  const itensAntigos = antigo.itens_legado;
  const chaves = itensAntigos.map((it) => chaveItemInventario(it));
  const somado = await comRetry<Cab | null>(alvo.id, async (atual) => {
    if (atual.status !== "aberto") return { pronto: null };
    const versaoNova = atual.versao + 1;
    const atuais = new Map((await repo().lerLinhas(atual.id, chaves)).map((l) => [l.chave, l]));
    const dif = aplicarDiferencaInventario({
      atuais,
      base: [],
      itens: itensAntigos,
      username: antigo.username,
      donoPadrao: atual.username,
      versaoNova,
    });
    return {
      novo: {
        ...atual,
        versao: versaoNova,
        atualizado_por: user,
        participantes: aplicarParticipantes(atual.participantes, dif.deltaPorUsuario),
        total_pecas: atual.total_pecas + dif.deltaPecas,
        total_linhas: atual.total_linhas + dif.deltaLinhas,
      },
      linhas: dif.linhas,
      statusEsperado: ["aberto"],
      depois: (g) => g,
    };
  });
  if (!somado) return { estado: "nao_encontrado" };
  await repo().apagarCab(antigo.id);
  return { estado: "ok", rascunho: cabParaRascunho(somado) };
}

/** Rascunhos em andamento da empresa (compartilhados + antigos), mais recentes primeiro. */
export async function listarInventarioRascunhos(companyKey: string): Promise<InventarioRascunho[]> {
  if (!norm(companyKey)) return [];
  if (Math.random() < 0.05) void repo().limpar().catch(() => undefined);
  return (await repo().listarCabs(companyKey)).map(cabParaRascunho);
}

/**
 * Descartar: o compartilhado vira lápide (quem estava junto descobre no próximo
 * envio e não consegue mais bipar nele); o antigo, por usuário, é apagado.
 */
export async function descartarInventarioRascunho(id: string, username: string): Promise<void> {
  const c = await repo().lerCab(id);
  if (!c) return;
  if (!c.compartilhado) {
    await repo().apagarCab(c.id);
    return;
  }
  await comRetry<null>(c.id, async (atual) => {
    if (atual.status !== "aberto") return { pronto: null };
    return {
      novo: {
        ...atual,
        status: "descartado",
        versao: atual.versao + 1,
        finalizado_por: normUser(username),
        finalizado_em: new Date().toISOString(),
        atualizado_por: normUser(username),
      },
      statusEsperado: ["aberto"],
      depois: () => null,
    };
  });
}

// ─────────────────── subir o estoque (rota /executar) ───────────────────

export type TravaFinalizarMotivo =
  | "nao_encontrado"
  | "mudou"
  | "finalizando"
  | "encerrado"
  | "lista_diferente"
  | "ocorrencias";

export type TravaFinalizarResultado =
  | { ok: true; rascunho: InventarioRascunho }
  | { ok: false; motivo: TravaFinalizarMotivo; rascunho: InventarioRascunho | null; detalhe?: string };

/**
 * Trava o rascunho para subir. Só passa se:
 *  - a versão for a que a tela conferiu (se um colega bipou depois, não vale);
 *  - a lista enviada for a do rascunho;
 *  - ninguém tiver bipe que não entrou (exceto quem foi aceito de propósito).
 * Enquanto travado, os bipes dos colegas não entram (estado "travado").
 */
export async function travarInventarioParaFinalizar(params: {
  id: string;
  versao: number;
  username: string;
  nomeContagem: string;
  itens: Array<{ produto: string; cor: string; quantidade: number }>;
  aceitarOcorrenciasDe?: string[];
}): Promise<TravaFinalizarResultado> {
  const user = normUser(params.username);
  const aceitos = new Set((params.aceitarOcorrenciasDe ?? []).map(normUser));
  const recusa: { motivo: TravaFinalizarMotivo; detalhe?: string } = { motivo: "mudou" };

  const travado = await comRetry<Cab | null>(params.id, async (atual) => {
    if (atual.status === "finalizado" || atual.status === "descartado") {
      recusa.motivo = "encerrado";
      return { pronto: null };
    }
    if (atual.status === "finalizando") {
      recusa.motivo = "finalizando";
      return { pronto: null };
    }
    if (atual.versao !== params.versao) {
      recusa.motivo = "mudou";
      return { pronto: null };
    }
    const pendentes = Object.entries(atual.presenca).filter(([u, p]) => p.ocorrencias > 0 && !aceitos.has(u));
    if (pendentes.length > 0) {
      recusa.motivo = "ocorrencias";
      recusa.detalhe = pendentes.map(([u, p]) => `${u} (${p.ocorrencias})`).join(", ");
      return { pronto: null };
    }
    const somaPorProdutoCor = (lista: Array<{ produto: string; cor: string; quantidade: number }>) => {
      const m = new Map<string, number>();
      for (const l of lista) {
        const k = `${norm(l.produto)}|${norm(l.cor)}`;
        m.set(k, (m.get(k) ?? 0) + Math.trunc(Number(l.quantidade) || 0));
      }
      return m;
    };
    const enviado = somaPorProdutoCor(params.itens);
    const gravado = somaPorProdutoCor(
      (await repo().lerLinhas(atual.id, null)).map((l) => ({ produto: l.produto, cor: l.corProduto ?? "", quantidade: l.quantidade }))
    );
    const iguais =
      enviado.size === gravado.size && [...enviado.entries()].every(([k, n]) => (gravado.get(k) ?? 0) === n);
    if (!iguais) {
      recusa.motivo = "lista_diferente";
      return { pronto: null };
    }
    return {
      novo: {
        ...atual,
        status: "finalizando",
        finalizando_desde: new Date().toISOString(),
        finalizando_nome: norm(params.nomeContagem).slice(0, 25),
        finalizado_por: user,
        versao: atual.versao + 1,
      },
      statusEsperado: ["aberto"],
      depois: (g) => g,
    };
  });
  if (travado) return { ok: true, rascunho: cabParaRascunho(travado) };
  const atual = await repo().lerCab(params.id);
  return {
    ok: false,
    motivo: atual ? recusa.motivo : "nao_encontrado",
    rascunho: atual ? cabParaRascunho(atual) : null,
    detalhe: recusa.detalhe,
  };
}

/** Subir falhou (nada gravado no Linx): o rascunho volta a aceitar bipes. */
export async function liberarInventarioTravado(id: string): Promise<void> {
  await comRetry<null>(id, async (atual) => {
    if (atual.status !== "finalizando") return { pronto: null };
    return {
      novo: {
        ...atual,
        status: "aberto",
        finalizando_desde: null,
        finalizando_nome: null,
        finalizado_por: null,
        versao: atual.versao + 1,
      },
      statusEsperado: ["finalizando"],
      depois: () => null,
    };
  });
}

/** Estoque subiu: lápide com quem subiu (o responsável) e o nome da contagem. */
export async function finalizarInventarioRascunho(params: {
  id: string;
  username: string;
  nomeContagem: string;
}): Promise<void> {
  await comRetry<null>(params.id, async (atual) => {
    if (atual.status === "finalizado") return { pronto: null };
    return {
      novo: {
        ...atual,
        status: "finalizado",
        finalizando_desde: null,
        finalizado_por: normUser(params.username),
        finalizado_em: new Date().toISOString(),
        nome_contagem: norm(params.nomeContagem).slice(0, 25) || atual.nome_contagem,
        versao: atual.versao + 1,
      },
      statusEsperado: ["aberto", "finalizando"],
      depois: () => null,
    };
  });
}

/**
 * Trava vencida (a subida caiu no meio): pergunta ao Linx se a contagem foi
 * gravada. Gravada → finalizado (nunca reabre: subir de novo devolveria ao estoque
 * as vendas feitas no meio tempo). Não gravada → aberto. Linx fora → continua travado.
 */
export async function resolverTravaVencida(
  id: string,
  contagemExisteNoLinx: (nomeContagem: string) => Promise<boolean>
): Promise<"finalizado" | "liberado" | "nada"> {
  const c = await repo().lerCab(id);
  if (!c || !travaVencida(c)) return "nada";
  const nome = c.finalizando_nome;
  let gravada = false;
  if (nome) {
    try {
      gravada = await contagemExisteNoLinx(nome);
    } catch {
      return "nada";
    }
  }
  if (gravada) {
    await finalizarInventarioRascunho({ id, username: c.finalizado_por || c.atualizado_por, nomeContagem: nome ?? "" });
    return "finalizado";
  }
  await liberarInventarioTravado(id);
  return "liberado";
}
