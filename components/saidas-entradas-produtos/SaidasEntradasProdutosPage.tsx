"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import {
  type CompanyKey,
  type CompanyConfig,
  resolveCompany,
  getFilialLabelForDisplay,
} from "@/lib/config/company";
import { getDefeitoFilial } from "@/lib/config/filiais-especiais";
import { permiteSaidaEstoqueNegativo } from "@/lib/config/saida-estoque-negativo";
import { useAuth } from "@/components/auth/AuthContext";

import styles from "./SaidasEntradasProdutosPage.module.css";

interface Filial {
  codFilial: string;
  filial: string;
  displayName?: string;
  activeFilial?: string;
  aliases?: string[];
}

interface Produto {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  estoques: Array<{
    filial: string;
    nomeFilial: string;
    estoque: number;
  }>;
}

/** Um tamanho da grade (posição 1..48) com o saldo dele na filial da operação. */
interface TamanhoOpcao {
  ordinal: number;
  label: string;
  estoque: number;
}

interface ProdutoSelecionado {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  filial: string;
  nomeFilial: string;
  /** Saldo na filial — do TAMANHO escolhido, em peça P/M/G. */
  estoque: number;
  quantidade: number;
  /**
   * Grade da peça. `undefined` = ainda não consultada; `[]` = não exige tamanho
   * (tamanho único, lenço, eletrônico); lista = peça P/M/G, tamanho OBRIGATÓRIO.
   */
  tamanhos?: TamanhoOpcao[];
  /** Posição da grade escolhida (peça P/M/G). Cada tamanho é uma linha da lista. */
  tamanho?: number | null;
  tamanhoLabel?: string | null;
}

/** Linha = produto × cor × tamanho: o mesmo item em P e em M são duas linhas. */
function chaveLinha(p: { produto: string; corProduto: string | null; tamanho?: number | null }): string {
  return `${p.produto}|${p.corProduto ?? ""}|${p.tamanho ?? ""}`;
}

/** Peça P/M/G ainda sem tamanho escolhido — bloqueia o registro. */
function faltaTamanho(p: ProdutoSelecionado): boolean {
  return Boolean(p.tamanhos && p.tamanhos.length > 0 && !p.tamanho);
}

interface TransferenciaLog {
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  dataEmissao: string;
  responsavel?: string;
  observacao?: string;
  qtdProdutos: number;
  qtdItens: number;
  status: string;
}

/** Item já resolvido pela bipagem (produto × cor + saldo na filial da operação). */
interface BipeItem {
  produto: string;
  descProduto: string;
  corProduto: string | null;
  descCor: string;
  codigoBarra: string | null;
  grade: string | null;
  estoque: number;
  filial: string;
  /** Tamanho do código de barras (posição da grade), quando ele é de um tamanho só. */
  tamanho?: number | null;
  /** Peça P/M/G: tamanho obrigatório. */
  exigeTamanho?: boolean;
  tamanhos?: TamanhoOpcao[];
}

type BipeStatus = "ok" | "sem_estoque" | "ambiguo" | "nao_encontrado";

interface BipeResposta {
  status: BipeStatus;
  item: BipeItem | null;
  opcoes: BipeItem[];
}

/**
 * Bipe que NÃO entrou na lista. Fica no painel vermelho até o operador resolver
 * (tentar de novo / escolher o produto) ou dispensar de propósito — o feedback do
 * "último bipe" é sobrescrito pela peça seguinte, então não serve de aviso quando
 * se bipa em quantidade. Enquanto houver ocorrência aberta, o registro não sai.
 */
interface BipeOcorrencia {
  id: string;
  codigo: string;
  em: number;
  tipo: "falha" | "nao_encontrado" | "sem_estoque" | "qtd_maxima" | "ambiguo" | "filial_trocada" | "interrompido";
  titulo: string;
  detalhe: string;
  opcoes?: BipeItem[];
}

/**
 * Diário da bipagem da lista atual (por escopo do rascunho). Bate o que foi LIDO
 * com o que ENTROU: lidos = aceitos + ocorrências abertas + dispensadas + em voo.
 * Fica no localStorage para sobreviver a um F5 no meio da conferência.
 */
interface BipagemDiario {
  escopo: string | null;
  lidos: number;
  aceitos: number;
  emVoo: Array<{ id: string; codigo: string; em: number }>;
  ocorrencias: BipeOcorrencia[];
  dispensadas: BipeOcorrencia[];
}

const BIPAGEM_VAZIA: Omit<BipagemDiario, "escopo"> = {
  lidos: 0,
  aceitos: 0,
  emVoo: [],
  ocorrencias: [],
  dispensadas: [],
};

const BIPAGEM_STORAGE_PREFIX = "saidas-entradas:bipagem:";

/** Leitor de código de barras "digita" bem mais rápido que gente: ≥ 4 teclas com ≤ 45ms entre elas. */
const LEITOR_MIN_CHARS = 4;
const LEITOR_GAP_MS = 45;

/** Consultas de bipe simultâneas — o resto espera na fila (bipar em rajada derrubava o proxy). */
const BIPES_EM_PARALELO = 3;

function novoIdBipe(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Roda `fn` quando houver vaga na fila (no máximo BIPES_EM_PARALELO ao mesmo tempo, em ordem). */
async function naFilaDeBipe<T>(fila: { ativos: number; espera: Array<() => void> }, fn: () => Promise<T>): Promise<T> {
  if (fila.ativos >= BIPES_EM_PARALELO) await new Promise<void>((resolve) => fila.espera.push(resolve));
  fila.ativos += 1;
  try {
    return await fn();
  } finally {
    fila.ativos -= 1;
    fila.espera.shift()?.();
  }
}

function carregarBipagem(escopo: string | null): BipagemDiario {
  if (!escopo) return { escopo, ...BIPAGEM_VAZIA };
  try {
    const raw = window.localStorage.getItem(BIPAGEM_STORAGE_PREFIX + escopo);
    if (!raw) return { escopo, ...BIPAGEM_VAZIA };
    const salvo = JSON.parse(raw) as Partial<BipagemDiario>;
    // Consulta que estava no ar quando a página caiu não tem resultado: vira
    // ocorrência para o operador bipar de novo — nunca some calada.
    const interrompidos: BipeOcorrencia[] = (salvo.emVoo ?? []).map((v) => ({
      id: v.id,
      codigo: v.codigo,
      em: v.em,
      tipo: "interrompido",
      titulo: "Consulta interrompida",
      detalhe: "A página recarregou antes da resposta. Confira se a peça está na lista ou bipe de novo.",
    }));
    return {
      escopo,
      lidos: Number(salvo.lidos) || 0,
      aceitos: Number(salvo.aceitos) || 0,
      emVoo: [],
      ocorrencias: [...(salvo.ocorrencias ?? []), ...interrompidos],
      dispensadas: salvo.dispensadas ?? [],
    };
  } catch {
    return { escopo, ...BIPAGEM_VAZIA };
  }
}

function salvarBipagem(diario: BipagemDiario) {
  if (!diario.escopo) return;
  try {
    const key = BIPAGEM_STORAGE_PREFIX + diario.escopo;
    const vazio =
      diario.lidos === 0 && diario.emVoo.length === 0 && diario.ocorrencias.length === 0 && diario.dispensadas.length === 0;
    if (vazio) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(diario));
  } catch {
    // sem localStorage (aba privada): o diário vale só enquanto a página estiver aberta
  }
}

/**
 * Tira da lista o que acabou de ser gravado — e só isso. Peça bipada enquanto o
 * romaneio gravava continua na lista (antes a lista era zerada e ela sumia).
 */
function descontarGravados(lista: ProdutoSelecionado[], gravados: ProdutoSelecionado[]): ProdutoSelecionado[] {
  const restante = new Map<string, number>();
  for (const g of gravados) restante.set(chaveLinha(g), (restante.get(chaveLinha(g)) ?? 0) + g.quantidade);
  return lista.flatMap((p) => {
    const k = chaveLinha(p);
    const r = restante.get(k) ?? 0;
    if (r <= 0) return [p];
    const usado = Math.min(r, p.quantidade);
    restante.set(k, r - usado);
    const sobra = p.quantidade - usado;
    return sobra > 0 ? [{ ...p, quantidade: sobra }] : [];
  });
}

/** Rascunho persistido no Neon (ver `lib/utils/saida-entrada-draft-store.ts`). */
interface RascunhoResumo {
  id: string;
  companyKey: string;
  username: string;
  tipoOperacao: TipoOperacao;
  filial: string;
  filialLabel: string;
  filialDestino: string | null;
  filialDestinoLabel: string | null;
  tipoRomaneio: string;
  observacao: string;
  /** Romaneio de entrada que este rascunho está editando (null = romaneio novo). */
  romaneioEdicao: string | null;
  itens: Array<{
    produto: string;
    descProduto: string;
    codigoBarra: string | null;
    corProduto: string | null;
    descCor: string;
    quantidade: number;
    estoque: number;
    tamanho?: number | null;
    tamanhoLabel?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

/** Estado do autosave, mostrado ao lado do título da lista. */
type RascunhoStatus = "idle" | "salvando" | "salvo" | "erro";

function defeitoFilialOption(companyKey: string): Filial | undefined {
  const nome = getDefeitoFilial(companyKey);
  return nome ? { codFilial: nome, filial: nome } : undefined;
}

// Tipos de romaneio que não possuem filial destino (igual a SAÍDA MKT)
const TIPOS_SEM_FILIAL_DESTINO = [
  'MKT', 'BRINDE', 'DOACAO', 'AJUSTE DE ESTOQUE', 'AMOSTRA', 'SOCIO', 'COMPRA FUNCIONARIO',
  'RETIRADA FUNCIONARIO', 'RETIRADA SOCIO', 'FURTO',
];
function isTipoSemDestino(tipo: string): boolean {
  const norm = tipo.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return TIPOS_SEM_FILIAL_DESTINO.some(t => norm.includes(t));
}

/** Tipos que só existem como saída (não aparecem no select da entrada). */
function isTipoSoSaida(tipo: string): boolean {
  return normalizarTipoRomaneio(tipo) === 'FURTO';
}

function isTransferenciaEntreLojas(tipo: string): boolean {
  const norm = tipo.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return norm.includes('TRANSFERENCIA ENTRE LOJAS');
}

function isTipoDefeito(tipo: string): boolean {
  return tipo.trim().toUpperCase() === 'DEFEITO';
}

/** Romaneio de defeito j\u00e1 emitido hoje pela filial (TRAVA DE DEFEITO). */
interface DefeitoDoDia {
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  responsavel: string;
  dataEmissao: string;
  tipoRomaneio: string;
  qtdProdutos: number;
  qtdItens: number;
}

interface SaidasEntradasProdutosPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface TransferenciaPermissao {
  username: string;
  filiaisOrigem: string[];
  filiaisDestino: string[];
  /** Filiais destino visíveis no controle de transferências (e no select de destino de saída). Vazio = todas visíveis. */
  filiaisDestinoControle?: string[];
  tiposRomaneioPermitidos: string[];
  responsavelPadrao?: string;
  tipoRomaneioPadrao?: string;
  responsavelFixo: boolean;
  tipoRomaneioFixo: boolean;
  /** Filial atribuída ao usuário — usada como fallback quando filiaisOrigem/filiaisDestino está vazio. */
  filialAtribuida?: string | null;
  /** Filiais extras onde o usuário também opera (ex.: NERD DEFEITOS para a logística). */
  filiaisAdicionais?: string[];
}

type TipoOperacao = "saida" | "entrada";

const TIPO_NERD_PRODUCAO = "NERD PRODUÇÃO";

function normalizarTipoRomaneio(value: string): string {
  return (value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Cor na UI: prioriza descrição; a API às vezes manda só descCor com corProduto nulo (igual lista-loja). */
function textoCorProduto(descCor: string, corProduto: string | null): string {
  const d = (descCor || "").trim();
  if (d) return d;
  return (corProduto || "").trim();
}

function parseBackendDateTime(value: string): Date {
  // Normaliza datas que vêm sem timezone (ex: "2026-03-17 16:29:00" ou "2026-03-17T16:29:00")
  // para serem interpretadas no fuso local do usuário (ao invés de UTC implícito / parse inconsistente).
  const v = (value || "").trim();
  if (!v) return new Date(NaN);

  // ISO com timezone explícito (Z ou ±HH:MM) → Date nativo ok
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(v)) return new Date(v);

  // "YYYY-MM-DD HH:mm:ss" → transforma em "YYYY-MM-DDTHH:mm:ss"
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(v)) {
    const isoLike = v.replace(/\s+/, "T");
    const d = new Date(isoLike);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // "YYYY-MM-DDTHH:mm:ss" sem timezone → manter como local
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // fallback
  return new Date(v);
}

function formatLogDateTime(value: string): string {
  const d = parseBackendDateTime(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLogDate(value: string): string {
  const d = parseBackendDateTime(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function formatLogRoute(
  filialOrigem: string | undefined,
  filialDestino: string | undefined,
  company: CompanyConfig | null
): string {
  const label = (raw: string) => {
    const t = raw.trim();
    if (!t || t === "—") return t;
    return getFilialLabelForDisplay(company, t);
  };
  const o = label(filialOrigem || "");
  const d = label(filialDestino || "");
  const hasO = Boolean(o && o !== "—");
  const hasD = Boolean(d && d !== "—");
  if (hasO && hasD) return `${o} → ${d}`;
  if (hasO) return o;
  if (hasD) return d;
  return "";
}

function normalizeFilialValue(v: string | null | undefined): string {
  return (v || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function getFilialMatchTokens(filial: Filial | null | undefined): string[] {
  if (!filial) return [];
  return [
    filial.codFilial,
    filial.filial,
    filial.activeFilial,
    filial.displayName,
    ...(filial.aliases ?? []),
  ].filter(Boolean) as string[];
}

function matchesFilialOption(filial: Filial | null | undefined, value: string | null | undefined): boolean {
  const target = normalizeFilialValue(value);
  if (!target || !filial) return false;
  return getFilialMatchTokens(filial).some((token) => normalizeFilialValue(token) === target);
}

function normalizeDigits(v: string): string {
  const digits = v.replace(/\D/g, "");
  return digits.replace(/^0+/, "") || "0";
}

function matchFilial(logValue: string | null | undefined, filial: Filial | null): boolean {
  if (!filial) return true;
  const lv = normalizeFilialValue(logValue);
  if (!lv) return false;

  const cod = normalizeFilialValue(filial.codFilial);
  const nome = normalizeFilialValue(filial.filial);

  // quebra apenas por separadores comuns (não por espaço, para não confundir "NERD" com "NERD LEBLON")
  const parts = lv
    .split(/\s*[-–—|]\s*/g)
    .map((p) => p.trim())
    .filter(Boolean);

  // match por nome: precisa ser exato (ou em uma das partes)
  if (nome && (lv === nome || parts.includes(nome))) return true;

  // match por código: aceita equivalência numérica (ignorando zeros à esquerda) e também partes
  if (cod) {
    const codDigits = normalizeDigits(cod);
    const lvDigits = normalizeDigits(lv);
    if (codDigits !== "0" && lvDigits !== "0" && codDigits === lvDigits) return true;

    if (lv === cod || parts.includes(cod)) return true;

    // alguns retornos vêm como "COD - NOME" com código colado em prefixo
    if (parts.some((p) => normalizeDigits(p) !== "0" && normalizeDigits(p) === codDigits)) return true;
  }

  return false;
}

function sameModalCart(a: ProdutoSelecionado[], b: ProdutoSelecionado[]): boolean {
  if (a.length !== b.length) return false;
  const key = (p: ProdutoSelecionado) => `${p.filial}|${p.produto}|${p.corProduto ?? ""}`;
  const mapA = new Map<string, number>();
  for (const p of a) mapA.set(key(p), p.quantidade);
  for (const p of b) {
    const k = key(p);
    if (!mapA.has(k)) return false;
    if (mapA.get(k) !== p.quantidade) return false;
  }
  return true;
}

async function fetchPermissoes(username: string): Promise<TransferenciaPermissao | null> {
  try {
    const response = await fetch("/api/transferencia-produtos/permissoes", {
      headers: {
        "x-auth-username": username,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as { data: TransferenciaPermissao | null };
    return json.data || null;
  } catch (error) {
    console.error("Erro ao buscar permissões", error);
    return null;
  }
}

async function fetchFiliais(companyKey?: string): Promise<Filial[]> {
  const params = new URLSearchParams();
  if (companyKey) params.set("company", companyKey);

  const response = await fetch(`/api/transferencia-produtos/filiais${params.toString() ? `?${params.toString()}` : ""}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar filiais");
  }

  const json = (await response.json()) as { data: Filial[] };
  return json.data;
}

async function buscarProdutoPorCodigoBarras(codigoBarras: string, companyKey?: string): Promise<{
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  produtosEncontrados: number;
  todosProdutos: Array<{ produto: string; cor: string; tamanho: string }>;
} | null> {
  const params = new URLSearchParams({ codigoBarras: codigoBarras.trim() });
  if (companyKey) params.set("company", companyKey);
  const response = await fetch(`/api/transferencia-produtos/produto-por-codigo-barras?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const json = (await response.json()) as { data: any };
  return json.data || null;
}

async function searchProdutos(
  searchTerm: string,
  filial?: string,
  corProduto?: string | null,
  companyKey?: string,
  entrada?: boolean,
  barcodeHint?: string | null
): Promise<Produto[]> {
  if (!searchTerm || searchTerm.trim().length < 2) {
    return [];
  }

  const params = new URLSearchParams({
    q: searchTerm.trim(),
  });

  if (filial) {
    params.set("filialOrigem", filial.trim());
  }

  if (corProduto != null && corProduto !== '') {
    params.set("corProduto", String(corProduto).trim());
  }

  if (companyKey) {
    params.set("company", companyKey);
  }

  if (entrada) {
    params.set("entrada", "true");
  }

  if (barcodeHint && barcodeHint.trim()) {
    params.set("barcodeHint", barcodeHint.trim());
  }

  const response = await fetch(`/api/transferencia-produtos/produtos?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const json = (await response.json()) as { data: Produto[] };
  return json.data || [];
}

/**
 * Grade (P/M/G) de cada produto×cor com o saldo de cada tamanho na filial.
 * Ver /api/saidas-entradas-produtos/tamanhos.
 */
async function fetchTamanhos(
  companyKey: string,
  filial: string,
  itens: Array<{ produto: string; corProduto: string | null }>
): Promise<Map<string, TamanhoOpcao[]>> {
  const params = new URLSearchParams({
    company: companyKey,
    filial,
    itens: itens.map((it) => `${it.produto}|${it.corProduto ?? ""}`).join(";"),
  });
  const response = await fetch(`/api/saidas-entradas-produtos/tamanhos?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Erro ao consultar os tamanhos");
  const json = (await response.json()) as {
    data: Array<{ produto: string; cor: string; exigeTamanho: boolean; tamanhos: TamanhoOpcao[] }>;
  };
  const mapa = new Map<string, TamanhoOpcao[]>();
  for (const d of json.data ?? []) mapa.set(`${d.produto}|${d.cor}`, d.exigeTamanho ? d.tamanhos : []);
  return mapa;
}

/**
 * Saldo ATUAL de cada produto×cor na filial (mesma rota dos tamanhos). Usado para
 * reconferir a lista antes de registrar: rascunho e lista montados minutos ou
 * dias antes carregam o saldo daquela hora.
 */
async function fetchSaldosAtuais(
  companyKey: string,
  filial: string,
  itens: Array<{ produto: string; corProduto: string | null }>
): Promise<Map<string, { disponivel: number; tamanhos: TamanhoOpcao[] }>> {
  const params = new URLSearchParams({
    company: companyKey,
    filial,
    itens: itens.map((it) => `${it.produto}|${it.corProduto ?? ""}`).join(";"),
  });
  const response = await fetch(`/api/saidas-entradas-produtos/tamanhos?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Erro ao consultar o saldo atual");
  const json = (await response.json()) as {
    data: Array<{ produto: string; cor: string; disponivel?: number; exigeTamanho: boolean; tamanhos: TamanhoOpcao[] }>;
  };
  const mapa = new Map<string, { disponivel: number; tamanhos: TamanhoOpcao[] }>();
  for (const d of json.data ?? []) {
    mapa.set(`${d.produto}|${d.cor}`, { disponivel: Number(d.disponivel) || 0, tamanhos: d.exigeTamanho ? d.tamanhos : [] });
  }
  return mapa;
}

async function fetchTiposRomaneio(): Promise<string[]> {
  const response = await fetch("/api/transferencia-produtos/tipos-romaneio", {
    cache: "no-store",
  });

  if (!response.ok) {
    return ['TRANSFERENCIA', 'TRANSFERENCIA ENTRE LOJAS', 'DEFEITO'];
  }

  const json = (await response.json()) as { data: string[] };
  return json.data || ['TRANSFERENCIA', 'TRANSFERENCIA ENTRE LOJAS', 'DEFEITO'];
}

async function fetchResponsaveis(): Promise<Array<{ responsavel: string; qtd: number }>> {
  const response = await fetch("/api/transferencia-produtos/responsaveis", {
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const json = (await response.json()) as { data: Array<{ responsavel: string; qtd: number }> };
  return json.data || [];
}

async function executarOperacaoLote(
  tipoOperacao: TipoOperacao,
  itens: Array<{ produto: string; corProduto: string | null; quantidade: number; tamanho?: number | null }>,
  filial: string,
  tipoRomaneio: string,
  responsavel: string,
  username?: string,
  observacao?: string,
  filialDestino?: string | null,
  companyKey?: string
): Promise<{ success: boolean; message: string; romaneio?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (username) headers["x-auth-username"] = username;
  const response = await fetch("/api/saidas-entradas-produtos/executar", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tipoOperacao,
      filial,
      filialDestino: filialDestino || null,
      itens,
      tipoRomaneio,
      responsavel,
      observacao: observacao || null,
      companyKey,
      origemTela: "Saidas e Entradas",
    }),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      error?: string;
      travaEstoqueNegativo?: { faltas: Array<{ produto: string; cor: string; tamanho: string; disponivel: number }> };
    };
    // Recusa por saldo vem com a lista dos itens: a tela marca as linhas.
    throw Object.assign(new Error(error.error || "Erro ao executar operação"), {
      faltas: error.travaEstoqueNegativo?.faltas ?? null,
    });
  }

  const json = (await response.json()) as {
    success: boolean;
    message: string;
    romaneio?: string;
  };

  return json;
}

async function fetchLogSaidas(): Promise<TransferenciaLog[]> {
  const response = await fetch("/api/transferencia-produtos/log-saidas?limit=200", {
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const json = (await response.json()) as { data: TransferenciaLog[] };
  return json.data || [];
}

async function fetchLogEntradas(): Promise<TransferenciaLog[]> {
  const response = await fetch("/api/transferencia-produtos/log?limit=200", {
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const json = (await response.json()) as { data: TransferenciaLog[] };
  return json.data || [];
}

/**
 * Consulta a TRAVA DE DEFEITO: existe romaneio de defeito hoje nesta filial?
 * Só avisa/desabilita — o bloqueio real é na rota `executar` (409).
 */
async function fetchDefeitoDoDia(
  companyKey: string,
  filial: string
): Promise<{ data: DefeitoDoDia | null; mensagem: string | null }> {
  const params = new URLSearchParams({ company: companyKey, filial });
  const response = await fetch(`/api/saidas-entradas-produtos/defeito-do-dia?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) return { data: null, mensagem: null };

  const json = (await response.json()) as { data: DefeitoDoDia | null; mensagem: string | null };
  return { data: json.data ?? null, mensagem: json.mensagem ?? null };
}

/**
 * BIPAGEM — resolve o código de barras direto no item pronto (produto × cor + saldo
 * na filial) em uma única ida ao servidor. O caminho do modal precisa de duas
 * (`produto-por-codigo-barras` → `produtos`), o que é lento demais quando o
 * operador está passando peça atrás de peça no leitor.
 */
async function biparCodigo(
  codigoBarras: string,
  filial: string,
  companyKey: string
): Promise<BipeResposta> {
  const params = new URLSearchParams({
    codigoBarras: codigoBarras.trim(),
    filial,
    company: companyKey,
  });

  // A consulta é só leitura: repetir é seguro. Rede/proxy instável derrubava bipe
  // em rajada e a peça ficava de fora — agora são 3 tentativas antes de desistir.
  const esperas = [0, 400, 1200];
  let response: Response | null = null;
  let ultimoErro: unknown = null;
  for (const espera of esperas) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    try {
      response = await fetch(`/api/transferencia-produtos/bipar?${params.toString()}`, {
        cache: "no-store",
      });
      if (response.ok || response.status < 500) break;
    } catch (err) {
      ultimoErro = err;
      response = null;
    }
  }

  if (!response || !response.ok) {
    throw ultimoErro instanceof Error ? ultimoErro : new Error("Erro ao consultar o código de barras");
  }

  const json = (await response.json()) as BipeResposta;
  return {
    status: json.status ?? "nao_encontrado",
    item: json.item ?? null,
    opcoes: json.opcoes ?? [],
  };
}

async function fetchRascunhos(companyKey: string): Promise<RascunhoResumo[]> {
  const response = await fetch(
    `/api/saidas-entradas-produtos/rascunhos?company=${encodeURIComponent(companyKey)}`,
    { cache: "no-store" }
  );

  if (!response.ok) return [];

  const json = (await response.json()) as { data: RascunhoResumo[] };
  return json.data || [];
}

async function salvarRascunhoApi(payload: string, username: string): Promise<void> {
  const response = await fetch("/api/saidas-entradas-produtos/rascunhos", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: payload,
  });

  if (!response.ok) {
    throw new Error("Erro ao salvar rascunho");
  }
}

async function removerRascunhoApi(
  params:
    | { id: string }
    | {
        companyKey: string;
        tipoOperacao: TipoOperacao;
        filial: string;
        romaneioEdicao?: string | null;
      },
  username?: string
): Promise<void> {
  const search = new URLSearchParams(
    "id" in params
      ? { id: params.id }
      : {
          company: params.companyKey,
          tipoOperacao: params.tipoOperacao,
          filial: params.filial,
          ...(params.romaneioEdicao ? { romaneioEdicao: params.romaneioEdicao } : {}),
        }
  );

  const headers: Record<string, string> = {};
  if (username) headers["x-auth-username"] = username;

  await fetch(`/api/saidas-entradas-produtos/rascunhos?${search.toString()}`, {
    method: "DELETE",
    headers,
  });
}

async function salvarDestinoRomaneio(
  companyKey: string,
  romaneioId: string,
  filialOrigem: string,
  filialDestino: string,
  username?: string
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (username) headers["x-auth-username"] = username;
  await fetch("/api/destino-romaneio", {
    method: "PUT",
    headers,
    body: JSON.stringify({ companyKey, romaneioId, filialOrigem, filialDestino, setandoNaCriacao: true }),
  });
}

// ── EDIÇÃO DE ROMANEIO (SAÍDA E ENTRADA) ─────────────────────────────────────
// O Linx deixa reabrir um romaneio já gravado e continuar digitando itens. Aqui
// é a mesma ideia: a tela volta a mostrar os itens que já foram lançados e o que
// for bipado depois é SOMADO ao mesmo romaneio (não nasce romaneio novo).
// Saída e entrada usam o MESMO contrato — só muda a rota.

interface ItemRomaneioExistente {
  produto: string;
  corProduto: string | null;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  quantidade: number;
  estoque: number;
}

interface RomaneioEditando {
  /** Saída ou entrada: decide a rota, o texto e a cor da tela. */
  tipo: TipoOperacao;
  romaneio: string;
  /** Nome da filial como está no romaneio (ERP) — é por ele que o backend acha o cabeçalho. */
  filial: string;
  itensExistentes: ItemRomaneioExistente[];
  /** Alerta que não bloqueia (ex.: destino da saída já começou a conferir). */
  aviso: string | null;
}

/** Rota de edição de cada tipo — as duas expõem o mesmo GET/POST. */
function rotaEdicaoRomaneio(tipo: TipoOperacao): string {
  return tipo === "saida"
    ? "/api/saidas-entradas-produtos/saida-editar"
    : "/api/saidas-entradas-produtos/entrada-editar";
}

interface RespostaEdicaoRomaneio {
  filial: string;
  editavel: boolean;
  motivo: string | null;
  aviso?: string | null;
  itens: ItemRomaneioExistente[];
}

async function fetchRomaneioParaEdicao(
  tipo: TipoOperacao,
  romaneio: string,
  filial: string,
  username: string,
  companyKey: string
): Promise<RespostaEdicaoRomaneio> {
  const params = new URLSearchParams({ romaneio, filial, company: companyKey });
  const response = await fetch(`${rotaEdicaoRomaneio(tipo)}?${params.toString()}`, {
    cache: "no-store",
    headers: { "x-auth-username": username },
  });

  if (!response.ok) {
    const erro = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(erro?.error || `Erro ao carregar o romaneio de ${tipo === "saida" ? "saída" : "entrada"}`);
  }

  return (await response.json()) as RespostaEdicaoRomaneio;
}

async function salvarItensNoRomaneio(
  tipo: TipoOperacao,
  romaneio: string,
  filial: string,
  itens: Array<{ produto: string; corProduto: string | null; quantidade: number; tamanho?: number | null }>,
  username: string,
  companyKey: string
): Promise<{ romaneio: string; qtdeAdicionada: number; message: string }> {
  const response = await fetch(rotaEdicaoRomaneio(tipo), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify({ romaneio, filial, itens, companyKey }),
  });

  if (!response.ok) {
    const erro = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(erro?.error || "Erro ao salvar os itens no romaneio");
  }

  return (await response.json()) as { romaneio: string; qtdeAdicionada: number; message: string };
}

export default function SaidasEntradasProdutosPage({
  companyKey,
  companyName,
}: SaidasEntradasProdutosPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [tipoOperacao, setTipoOperacao] = useState<TipoOperacao>("saida");
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [filiaisDisponiveis, setFiliaisDisponiveis] = useState<Filial[]>([]);
  const [filialSelecionada, setFilialSelecionada] = useState<Filial | null>(null);
  const [produtosSelecionados, setProdutosSelecionados] = useState<ProdutoSelecionado[]>([]);
  const [produtosSelecionadosModal, setProdutosSelecionadosModal] = useState<ProdutoSelecionado[]>([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [modalConfirmarFecharAberto, setModalConfirmarFecharAberto] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [notificacao, setNotificacao] = useState<{ mensagem: string; tipo: "success" | "error" } | null>(null);
  const [processandoOperacao, setProcessandoOperacao] = useState(false);
  const [logSaidas, setLogSaidas] = useState<TransferenciaLog[]>([]);
  const [logEntradas, setLogEntradas] = useState<TransferenciaLog[]>([]);
  const [loadingLogSaidas, setLoadingLogSaidas] = useState(false);
  const [loadingLogEntradas, setLoadingLogEntradas] = useState(false);
  const [tiposRomaneio, setTiposRomaneio] = useState<string[]>([]);
  const [tiposRomaneioDisponiveis, setTiposRomaneioDisponiveis] = useState<string[]>([]);
  const [tipoRomaneioSelecionado, setTipoRomaneioSelecionado] = useState<string>("TRANSFERENCIA ENTRE LOJAS");
  const [responsaveis, setResponsaveis] = useState<Array<{ responsavel: string; qtd: number }>>([]);
  const [responsavelSelecionado, setResponsavelSelecionado] = useState<string>("LOGISTICA");
  const [responsavelFinal, setResponsavelFinal] = useState<string>("LOGISTICA");
  const [mostrarInputResponsavel, setMostrarInputResponsavel] = useState(false);
  const [inputResponsavelCustomizado, setInputResponsavelCustomizado] = useState("");
  const [observacaoSaida, setObservacaoSaida] = useState("");
  const [observacaoEntrada, setObservacaoEntrada] = useState("");
  const [permissoes, setPermissoes] = useState<TransferenciaPermissao | null>(null);
  const [permissoesCarregadas, setPermissoesCarregadas] = useState(false);

  const notificacaoTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [modalEdicaoAberto, setModalEdicaoAberto] = useState(false);
  const [logEditando, setLogEditando] = useState<TransferenciaLog | null>(null);
  const [observacaoEditando, setObservacaoEditando] = useState("");
  const [processandoEdicao, setProcessandoEdicao] = useState(false);
  const [mostrarConfirmacaoRegistro, setMostrarConfirmacaoRegistro] = useState(false);
  const [filialDestinoSaida, setFilialDestinoSaida] = useState<Filial | null>(null);
  const [filiaisDestinoDisponiveis, setFiliaisDestinoDisponiveis] = useState<Filial[]>([]);
  const [colorPickerProduto, setColorPickerProduto] = useState<Produto | null>(null);
  const [colorPickerOpcoes, setColorPickerOpcoes] = useState<Produto[]>([]);
  const [loadingColorPicker, setLoadingColorPicker] = useState(false);
  const [colorOptionsByProduto, setColorOptionsByProduto] = useState<Record<string, Produto[]>>({});
  // TRAVA DE DEFEITO: romaneio de defeito já emitido hoje pela filial selecionada.
  const [defeitoDoDia, setDefeitoDoDia] = useState<{ romaneio: DefeitoDoDia; mensagem: string } | null>(null);
  const [checandoDefeitoDoDia, setChecandoDefeitoDoDia] = useState(false);
  const [defeitoRefreshKey, setDefeitoRefreshKey] = useState(0);
  // ── EDIÇÃO DE ROMANEIO — SAÍDA E ENTRADA (logística+) ──────────────────────
  const [romaneioEditando, setRomaneioEditando] = useState<RomaneioEditando | null>(null);
  const [carregandoEdicaoRomaneio, setCarregandoEdicaoRomaneio] = useState(false);

  const isEntradaNerd = tipoOperacao === "entrada" && companyKey === "nerd";
  const tiposRomaneioExibidos = useMemo(() => {
    if (tipoOperacao === "entrada" && !isEntradaNerd) {
      return tiposRomaneioDisponiveis.filter((tipo) => !isTipoSoSaida(tipo));
    }
    if (!isEntradaNerd) return tiposRomaneioDisponiveis;

    const tipoCadastrado = tiposRomaneio.find(
      (tipo) => normalizarTipoRomaneio(tipo) === "NERD PRODUCAO"
    ) || TIPO_NERD_PRODUCAO;

    return [
      tipoCadastrado,
      ...tiposRomaneioDisponiveis.filter(
        (tipo) => normalizarTipoRomaneio(tipo) !== "NERD PRODUCAO" && !isTipoSoSaida(tipo)
      ),
    ];
  }, [tipoOperacao, isEntradaNerd, tiposRomaneio, tiposRomaneioDisponiveis]);

  // ── BIPAGEM ────────────────────────────────────────────────────────────────
  // Fluxo alternativo ao modal: o leitor manda o código + Enter e o produto já
  // entra na lista. O campo fica sempre focado para o operador nunca precisar
  // clicar entre uma peça e outra.
  const [codigoBipado, setCodigoBipado] = useState("");
  const [bipagem, setBipagem] = useState<BipagemDiario>({ escopo: null, ...BIPAGEM_VAZIA });
  const bipesEmVoo = bipagem.emVoo.length;
  /** Fila das consultas de bipe (ver BIPES_EM_PARALELO). */
  const filaBipesRef = useRef<{ ativos: number; espera: Array<() => void> }>({ ativos: 0, espera: [] });
  /** Escopo da lista (= do rascunho) no render atual — o bipe confere se ainda é o mesmo quando a consulta volta. */
  const escopoBipeRef = useRef<string | null>(null);
  /** Lista no momento em que o modal abriu — base para não perder o que for bipado com ele aberto. */
  const listaAoAbrirModalRef = useRef<ProdutoSelecionado[]>([]);
  const [ultimoBipe, setUltimoBipe] = useState<{ ok: boolean; titulo: string; detalhe: string } | null>(null);
  const [itemDestacado, setItemDestacado] = useState<string | null>(null);
  /** Linhas (chaveLinha) sem saldo suficiente na última conferência — ficam em vermelho. */
  const [semSaldoChaves, setSemSaldoChaves] = useState<Set<string>>(new Set());
  const [conferindoSaldo, setConferindoSaldo] = useState(false);
  const [somBipeLigado, setSomBipeLigado] = useState(true);
  const bipeInputRef = useRef<HTMLInputElement | null>(null);
  const destaqueTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ── RASCUNHOS ──────────────────────────────────────────────────────────────
  const [abaLateral, setAbaLateral] = useState<"historico" | "rascunhos">("historico");
  const [rascunhos, setRascunhos] = useState<RascunhoResumo[]>([]);
  const [loadingRascunhos, setLoadingRascunhos] = useState(false);
  const [rascunhoStatus, setRascunhoStatus] = useState<RascunhoStatus>("idle");
  const [rascunhoRestauradoEm, setRascunhoRestauradoEm] = useState<string | null>(null);
  /** Último payload gravado — evita reenviar o mesmo rascunho a cada re-render. */
  const rascunhoPayloadRef = useRef<string>("");
  /**
   * Já existe rascunho gravado para o escopo atual? Sem isso o primeiro render
   * (lista vazia) dispararia um PUT vazio que APAGA o rascunho antes mesmo de
   * ele ser restaurado.
   */
  const rascunhoSalvoRef = useRef(false);
  /**
   * Enquanto restaura, o autosave fica mudo (senão grava por cima do que leu).
   * É estado, não ref, DE PROPÓSITO: o autosave precisa ser reavaliado quando a
   * restauração termina — com ref ele ficaria parado até a próxima alteração e a
   * lista recém-trazida do banco poderia passar minutos só na memória do browser.
   */
  const [hidratandoRascunho, setHidratandoRascunho] = useState(false);

  const isAdmin = user?.role === "admin";
  /**
   * Reabrir romaneio (saída OU entrada) é de logística pra cima — a loja registra
   * o movimento dela, mas nunca reabre romaneio já gravado. Espelha
   * `canEditarRomaneioEntrada` / `canEditarRomaneioSaida` (lib/auth/permissions.ts);
   * quem barra de verdade são as rotas /entrada-editar e /saida-editar.
   */
  const podeEditarRomaneio = isAdmin || user?.role === "logistica";

  const companyConfig = useMemo(() => resolveCompany(companyKey), [companyKey]);
  const filialLabel = useCallback(
    (raw: string | null | undefined) =>
      getFilialLabelForDisplay(companyConfig, String(raw ?? "").trim()),
    [companyConfig]
  );
  const filialOptionLabel = useCallback(
    (filial: Filial | null | undefined) =>
      filial?.displayName?.trim() || filialLabel(filial?.filial),
    [filialLabel]
  );

  const filiaisDestinoVisiveis = useMemo<Filial[]>(() => {
    const isDefeito = tipoRomaneioSelecionado.toUpperCase() === 'DEFEITO';
    const defeitoFilial = defeitoFilialOption(companyKey);
    if (isDefeito && defeitoFilial) {
      return [defeitoFilial];
    }
    let lista = defeitoFilial
      ? filiaisDestinoDisponiveis.filter(f => f.codFilial.trim() !== defeitoFilial.codFilial)
      : filiaisDestinoDisponiveis;
    if (filialSelecionada) {
      lista = lista.filter(f => f.codFilial.trim() !== filialSelecionada.codFilial.trim());
    }
    return lista;
  }, [tipoRomaneioSelecionado, filiaisDestinoDisponiveis, companyKey, filialSelecionada]);

  const isSaidaMkt = isTipoSemDestino(tipoRomaneioSelecionado);

  /**
   * TRAVA DE DEFEITO — só UM romaneio de saída de defeito por filial por dia.
   * O objetivo é que a loja junte as peças do dia em um romaneio só, em vez de
   * abrir um romaneio por peça. Aqui é o aviso na tela (e o botão desabilitado);
   * quem bloqueia de verdade é `/api/saidas-entradas-produtos/executar` (409).
   */
  const saidaDeDefeito =
    // Editando um romaneio que já existe, a trava não se aplica: ela existe para
    // que o dia tenha UM romaneio de defeito, e acrescentar item é o caminho certo.
    !romaneioEditando &&
    tipoOperacao === "saida" &&
    (isTipoDefeito(tipoRomaneioSelecionado) ||
      (!!filialDestinoSaida && !!defeitoFilialOption(companyKey) &&
        filialDestinoSaida.codFilial.trim().toUpperCase() ===
          defeitoFilialOption(companyKey)!.codFilial.trim().toUpperCase()));

  // Depende do codFilial, não do objeto: o refresh em foco recria o Filial
  // (mesma loja, nova referência) e não deve refazer a consulta.
  const codFilialSelecionada = filialSelecionada?.codFilial ?? null;

  /**
   * EXCEÇÃO da NERD MATRIZ: a saída pode passar do saldo (item negativo).
   * Ver `lib/config/saida-estoque-negativo.ts`. Só relaxa a trava de estoque
   * da SAÍDA — em qualquer outra filial a saída continua limitada ao saldo.
   */
  const saidaPodeEstourarEstoque = useMemo(
    () =>
      tipoOperacao === "saida" &&
      permiteSaidaEstoqueNegativo(companyKey, getFilialMatchTokens(filialSelecionada)),
    [tipoOperacao, companyKey, filialSelecionada]
  );

  /** True quando a linha não deve ter teto de quantidade (entrada ou MATRIZ). */
  const semTetoDeEstoque = tipoOperacao === "entrada" || saidaPodeEstourarEstoque;

  useEffect(() => {
    if (!saidaDeDefeito || !codFilialSelecionada) {
      setDefeitoDoDia(null);
      setChecandoDefeitoDoDia(false);
      return;
    }

    let cancelado = false;
    setChecandoDefeitoDoDia(true);
    fetchDefeitoDoDia(companyKey, codFilialSelecionada)
      .then(({ data, mensagem }) => {
        if (cancelado) return;
        setDefeitoDoDia(data ? { romaneio: data, mensagem: mensagem || "" } : null);
      })
      .catch(() => {
        // Falha na consulta não trava a tela: o bloqueio final é no servidor.
        if (!cancelado) setDefeitoDoDia(null);
      })
      .finally(() => {
        if (!cancelado) setChecandoDefeitoDoDia(false);
      });

    return () => {
      cancelado = true;
    };
  }, [saidaDeDefeito, codFilialSelecionada, companyKey, defeitoRefreshKey]);

  /** Bloqueia o registro? Admin passa por cima (igual à regra do servidor). */
  const travaDefeitoAtiva = !!defeitoDoDia && saidaDeDefeito && !isAdmin;

  // Resetar filial destino ao TROCAR o tipo de romaneio; auto-selecionar quando só há uma opção.
  // NÃO zerar a seleção quando a lista apenas muda de referência (refresh em foco/visibilidade):
  // nesse caso mantemos a filial escolhida se ela ainda existir na lista (compara por codFilial).
  const tipoRomaneioRef = useRef(tipoRomaneioSelecionado);
  useEffect(() => {
    const tipoMudou = tipoRomaneioRef.current !== tipoRomaneioSelecionado;
    tipoRomaneioRef.current = tipoRomaneioSelecionado;

    setFilialDestinoSaida((prev) => {
      if (isTipoSemDestino(tipoRomaneioSelecionado)) return null;
      if (filiaisDestinoVisiveis.length === 1) return filiaisDestinoVisiveis[0];
      if (tipoMudou) return null;
      // Refresh da lista (nova referência): preserva a seleção atual se ainda for válida.
      if (prev) {
        return filiaisDestinoVisiveis.find((f) => f.codFilial === prev.codFilial) ?? null;
      }
      return null;
    });
  }, [tipoRomaneioSelecionado, filiaisDestinoVisiveis]);

  // Carregar permissões do usuário PRIMEIRO (antes de tudo)
  useEffect(() => {
    async function loadPermissoes() {
      // Aguardar auth terminar de carregar antes de agir
      if (authLoading) return;
      if (!user?.username) {
        setPermissoesCarregadas(true);
        return;
      }
      try {
        const perms = await fetchPermissoes(user.username);
        setPermissoes(perms);
      } catch (error) {
        console.error("Erro ao carregar permissões", error);
      } finally {
        setPermissoesCarregadas(true);
      }
    }
    loadPermissoes();
  }, [user?.username, authLoading]);

  // Carregar filiais e aplicar filtros de permissão (aguardar permissões carregarem)
  const loadFiliais = useCallback(async () => {
    if (!permissoesCarregadas) return;

      try {
        const data = await fetchFiliais(companyKey);
        setFiliais(data);

        // Aplicar filtros de permissão se existirem
        if (permissoes) {
          /**
           * Filiais ADICIONAIS de operação: entram sempre, além do que a lista
           * de origem/destino permite. A filial de defeito não vem da API de
           * filiais (fora do registry), então é acrescentada como opção aqui —
           * sem isso a logística não teria onde lançar a entrada do defeito.
           */
          const adicionais = permissoes.filiaisAdicionais ?? [];
          const candidatas = (() => {
            const defeito = defeitoFilialOption(companyKey);
            const precisaDefeito =
              defeito &&
              adicionais.some((cod) => matchesFilialOption(defeito, cod)) &&
              !data.some((f) => matchesFilialOption(f, defeito.codFilial));
            return precisaDefeito && defeito ? [...data, defeito] : data;
          })();

          const extras = adicionais.length > 0
            ? candidatas.filter((f) => adicionais.some((cod) => matchesFilialOption(f, cod)))
            : [];

          /**
           * Resolve a lista de filiais visíveis para a operação:
           * 1. Se há lista explícita (filiaisOrigem / filiaisDestino) → usa ela
           * 2. Se não há lista mas há filialAtribuida → restringe a essa filial
           * 3. Senão → todas as filiais
           * Em 1 e 2 as filiais adicionais são somadas; em 3 já está tudo liberado.
           */
          const resolveFiliais = (lista: string[]) => {
            const comExtras = (base: Filial[]) => {
              const faltando = extras.filter(
                (e) => !base.some((f) => f.codFilial === e.codFilial)
              );
              return faltando.length > 0 ? [...base, ...faltando] : base;
            };
            if (lista.length > 0) {
              return comExtras(
                candidatas.filter((f) => lista.some((cod) => matchesFilialOption(f, cod)))
              );
            }
            if (permissoes.filialAtribuida) {
              return comExtras(
                candidatas.filter((f) => matchesFilialOption(f, permissoes.filialAtribuida))
              );
            }
            return candidatas;
          };

          const filiaisPermitidas = tipoOperacao === "saida"
            ? resolveFiliais(permissoes.filiaisOrigem)
            : resolveFiliais(permissoes.filiaisDestino);

          setFiliaisDisponiveis(filiaisPermitidas);
          setFilialSelecionada((current) => {
            if (!filiaisPermitidas.length) return null;
            return filiaisPermitidas.find((f) => f.codFilial === current?.codFilial) ?? filiaisPermitidas[0];
          });

          // Filiais destino visíveis no select de destino da saída
          // Usa filiaisDestinoControle (filiais destino visíveis do admin) — vazio = todas visíveis
          const controle = permissoes.filiaisDestinoControle ?? [];
          const destinos = controle.length > 0
            ? data.filter((f) => controle.some((cod) => matchesFilialOption(f, cod)))
            : data;
          setFiliaisDestinoDisponiveis(destinos);
          setFilialDestinoSaida((current) => {
            if (!destinos.length) return null;
            return destinos.find((f) => f.codFilial === current?.codFilial) ?? (destinos.length === 1 ? destinos[0] : null);
          });
        } else {
          setFiliaisDisponiveis(data);
          setFilialSelecionada((current) => {
            if (!data.length) return null;
            return data.find((f) => f.codFilial === current?.codFilial) ?? data[0];
          });
          setFiliaisDestinoDisponiveis(data);
          setFilialDestinoSaida((current) => {
            if (!data.length) return null;
            return data.find((f) => f.codFilial === current?.codFilial) ?? (data.length === 1 ? data[0] : null);
          });
        }
      } catch (error) {
        console.error("Erro ao carregar filiais", error);
      }
  }, [companyKey, permissoes, permissoesCarregadas, tipoOperacao]);

  useEffect(() => {
    void loadFiliais();
  }, [loadFiliais]);

  useEffect(() => {
    if (!permissoesCarregadas) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") return;
      void loadFiliais();
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [loadFiliais, permissoesCarregadas]);

  // Carregar tipos de romaneio e aplicar filtros de permissão
  useEffect(() => {
    if (!permissoesCarregadas) return;

    async function loadTiposRomaneio() {
      try {
        const data = await fetchTiposRomaneio();
        setTiposRomaneio(data);
        
        if (permissoes && permissoes.tiposRomaneioPermitidos.length > 0) {
          const tiposPermitidos = data.filter(tipo =>
            permissoes.tiposRomaneioPermitidos.some(permitido =>
              tipo.toUpperCase() === permitido.toUpperCase()
            )
          );
          setTiposRomaneioDisponiveis(tiposPermitidos);
          
          if (permissoes.tipoRomaneioPadrao) {
            const tipoPadraoPermitido = tiposPermitidos.find(tipo =>
              tipo.toUpperCase() === permissoes.tipoRomaneioPadrao!.toUpperCase()
            );
            if (tipoPadraoPermitido) {
              setTipoRomaneioSelecionado(tipoPadraoPermitido);
            } else if (tiposPermitidos.length > 0) {
              setTipoRomaneioSelecionado(tiposPermitidos[0]);
            }
          } else if (tiposPermitidos.length > 0) {
            setTipoRomaneioSelecionado(tiposPermitidos[0]);
          }
        } else {
          setTiposRomaneioDisponiveis(data);
          if (data.length > 0) {
            if (permissoes?.tipoRomaneioPadrao) {
              const tipoPermitido = data.find(tipo => 
                tipo.toUpperCase() === permissoes.tipoRomaneioPadrao!.toUpperCase()
              );
              if (tipoPermitido) {
                setTipoRomaneioSelecionado(tipoPermitido);
              } else {
                const tipoPadrao = data.find(tipo => tipo.toUpperCase() === 'TRANSFERENCIA ENTRE LOJAS') || data[0];
                setTipoRomaneioSelecionado(tipoPadrao);
              }
            } else {
              const tipoPadrao = data.find(tipo => tipo.toUpperCase() === 'TRANSFERENCIA ENTRE LOJAS') || data[0];
              setTipoRomaneioSelecionado(tipoPadrao);
            }
          }
        }
      } catch (error) {
        console.error("Erro ao carregar tipos de romaneio", error);
      }
    }
    loadTiposRomaneio();
  }, [permissoes, permissoesCarregadas]);

  useEffect(() => {
    if (!isEntradaNerd) return;
    const tipoCadastrado = tiposRomaneio.find(
      (tipo) => normalizarTipoRomaneio(tipo) === "NERD PRODUCAO"
    );
    setTipoRomaneioSelecionado(tipoCadastrado || TIPO_NERD_PRODUCAO);
  }, [isEntradaNerd, tiposRomaneio]);

  // Aplicar responsável padrão imediatamente quando as permissões carregam
  useEffect(() => {
    if (!permissoesCarregadas || !permissoes?.responsavelPadrao) return;
    setResponsavelFinal(permissoes.responsavelPadrao);
    setResponsavelSelecionado(permissoes.responsavelPadrao);
  }, [permissoesCarregadas, permissoes?.responsavelPadrao]);

  // Carregar responsáveis e aplicar padrão de permissão
  useEffect(() => {
    if (!permissoesCarregadas) return;
    
    async function loadResponsaveis() {
      try {
        const data = await fetchResponsaveis();
        setResponsaveis(data);
        
        if (permissoes?.responsavelPadrao) {
          // Usa o responsável padrão configurado diretamente, mesmo que não conste na lista
          setResponsavelSelecionado(permissoes.responsavelPadrao);
          setResponsavelFinal(permissoes.responsavelPadrao);
        } else if (data.length > 0) {
          setResponsavelSelecionado(data[0].responsavel);
          setResponsavelFinal(data[0].responsavel);
        }
      } catch (error) {
        console.error("Erro ao carregar responsáveis", error);
      }
    }
    loadResponsaveis();
  }, [permissoes, permissoesCarregadas]);

  // Atualizar responsável final quando mudar
  useEffect(() => {
    if (permissoes?.responsavelFixo && permissoes.responsavelPadrao) {
      setResponsavelFinal(permissoes.responsavelPadrao);
      setResponsavelSelecionado(permissoes.responsavelPadrao);
      setMostrarInputResponsavel(false);
      return;
    }

    if (mostrarInputResponsavel && inputResponsavelCustomizado.trim()) {
      setResponsavelFinal(inputResponsavelCustomizado.trim().toUpperCase());
    } else {
      setResponsavelFinal(responsavelSelecionado);
    }
  }, [mostrarInputResponsavel, inputResponsavelCustomizado, responsavelSelecionado, permissoes]);

  const mostrarNotificacao = useCallback((mensagem: string, tipo: "success" | "error" = "success") => {
    setNotificacao({ mensagem, tipo });
    
    if (notificacaoTimeoutRef.current) {
      clearTimeout(notificacaoTimeoutRef.current);
    }

    notificacaoTimeoutRef.current = setTimeout(() => {
      setNotificacao(null);
    }, 3000);
  }, []);

  const trocarTipoOperacao = useCallback((next: TipoOperacao) => {
    setTipoOperacao(next);
    if (next === "entrada" && companyKey === "nerd") {
      const tipoCadastrado = tiposRomaneio.find(
        (tipo) => normalizarTipoRomaneio(tipo) === "NERD PRODUCAO"
      );
      setTipoRomaneioSelecionado(tipoCadastrado || TIPO_NERD_PRODUCAO);
    } else if (next === "entrada") {
      setTipoRomaneioSelecionado((atual) => {
        if (!isTipoSoSaida(atual)) return atual;
        return tiposRomaneioDisponiveis.find((tipo) => !isTipoSoSaida(tipo)) || "TRANSFERENCIA ENTRE LOJAS";
      });
    } else if (next === "saida") {
      setTipoRomaneioSelecionado((atual) => {
        if (normalizarTipoRomaneio(atual) !== "NERD PRODUCAO") return atual;
        return tiposRomaneioDisponiveis.find(
          (tipo) => normalizarTipoRomaneio(tipo) === "TRANSFERENCIA ENTRE LOJAS"
        ) || tiposRomaneioDisponiveis[0] || "TRANSFERENCIA ENTRE LOJAS";
      });
    }
    // evitar "cadeia" de updates pós-clique
    setProdutosSelecionados([]);
    setProdutosSelecionadosModal([]);
    setSearchTerm("");
    setProdutos([]);
    setModalAberto(false);
    setFilialDestinoSaida(null);
    // Trocar de operação sai da edição de romaneio: a lista de trabalho passa a
    // ser um romaneio novo, não mais o que estava aberto.
    setRomaneioEditando(null);
  }, [companyKey, tiposRomaneio, tiposRomaneioDisponiveis]);

  const observacaoAtual = tipoOperacao === "saida" ? observacaoSaida : observacaoEntrada;
  const setObservacaoAtual = useCallback((value: string) => {
    if (tipoOperacao === "saida") setObservacaoSaida(value);
    else setObservacaoEntrada(value);
  }, [tipoOperacao]);

  const abrirModalAdicionarProduto = useCallback(() => {
    listaAoAbrirModalRef.current = produtosSelecionados;
    setProdutosSelecionadosModal(produtosSelecionados);
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
    setModalAberto(true);
  }, [produtosSelecionados]);

  const solicitarFecharModalAdicionarProduto = useCallback(() => {
    const mudou = !sameModalCart(produtosSelecionadosModal, produtosSelecionados);
    if (mudou) {
      setModalConfirmarFecharAberto(true);
      return;
    }
    setModalAberto(false);
  }, [produtosSelecionadosModal, produtosSelecionados]);

  const descartarProdutosDoModal = useCallback(() => {
    setModalConfirmarFecharAberto(false);
    setProdutosSelecionadosModal(produtosSelecionados); // volta ao estado confirmado
    setSearchTerm("");
    setProdutos([]);
    setModalAberto(false);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [produtosSelecionados]);

  const continuarNoModal = useCallback(() => {
    setModalConfirmarFecharAberto(false);
  }, []);

  const confirmarProdutosDoModal = useCallback(() => {
    // O modal editou uma CÓPIA da lista. Bipe que chegou depois que ele abriu
    // (consulta ainda no ar) não está na cópia: soma por cima, senão sumiria.
    setProdutosSelecionados((prev) => {
      const base = new Map<string, number>();
      for (const p of listaAoAbrirModalRef.current) base.set(chaveLinha(p), (base.get(chaveLinha(p)) ?? 0) + p.quantidade);
      const next = [...produtosSelecionadosModal];
      for (const p of prev) {
        const k = chaveLinha(p);
        const delta = p.quantidade - (base.get(k) ?? 0);
        if (delta <= 0) continue;
        const i = next.findIndex((n) => chaveLinha(n) === k);
        if (i === -1) next.push({ ...p, quantidade: delta });
        else next[i] = { ...next[i], quantidade: next[i].quantidade + delta };
      }
      produtosSelecionadosRef.current = next;
      return next;
    });
    setModalAberto(false);
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [produtosSelecionadosModal]);

  // Carregar logs de saídas e entradas
  useEffect(() => {
    async function loadLogs() {
      setLoadingLogSaidas(true);
      setLoadingLogEntradas(true);
      try {
        const [saidas, entradas] = await Promise.all([
          fetchLogSaidas(),
          fetchLogEntradas(),
        ]);
        setLogSaidas(saidas);
        setLogEntradas(entradas);
      } catch (error) {
        console.error("Erro ao carregar logs", error);
      } finally {
        setLoadingLogSaidas(false);
        setLoadingLogEntradas(false);
      }
    }
    loadLogs();
  }, []);

  // Buscar produtos ao digitar
  useEffect(() => {
    if (!searchTerm || searchTerm.trim().length < 2) {
      setProdutos([]);
      return;
    }

    let active = true;
    setLoadingProdutos(true);

    const timeoutId = setTimeout(async () => {
      try {
        const searchTermTrimmed = searchTerm.trim();
        let results: Produto[] = [];
        let corProdutoCodigoBarras: string | null = null;
        
        if (searchTermTrimmed.length >= 3) {
          const produtoCodigoBarras = await buscarProdutoPorCodigoBarras(searchTermTrimmed, companyKey);
          
          if (produtoCodigoBarras) {
            corProdutoCodigoBarras = produtoCodigoBarras.corProduto || null;
            
            results = await searchProdutos(
              produtoCodigoBarras.produto,
              filialSelecionada?.codFilial,
              corProdutoCodigoBarras,
              companyKey,
              true,
              produtoCodigoBarras.codigoBarra || searchTermTrimmed
            );

            if (produtoCodigoBarras.produtosEncontrados > 1 && active) {
              mostrarNotificacao(
                `Código de barras encontrado em ${produtoCodigoBarras.produtosEncontrados} produto(s). Usando o primeiro.`,
                "success"
              );
            }

            if (results.length === 0 && corProdutoCodigoBarras) {
              results = await searchProdutos(
                produtoCodigoBarras.produto,
                filialSelecionada?.codFilial,
                null,
                companyKey,
                true,
                produtoCodigoBarras.codigoBarra || searchTermTrimmed
              );
            }
          }
        }

        if (results.length === 0) {
          results = await searchProdutos(searchTermTrimmed, filialSelecionada?.codFilial, null, companyKey, true);
        }
        
        if (active) {
          setProdutos(results);
        }
      } catch (error) {
        if (active) {
          setProdutos([]);
        }
      } finally {
        if (active) {
          setLoadingProdutos(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [searchTerm, filialSelecionada, companyKey, mostrarNotificacao, tipoOperacao]);

  // Fecha color picker quando o termo de busca muda
  useEffect(() => {
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [searchTerm]);

  // Busca cores disponíveis quando o color picker é aberto
  useEffect(() => {
    if (!colorPickerProduto) {
      setColorPickerOpcoes([]);
      setLoadingColorPicker(false);
      return;
    }

    const coresNoResultado = produtos.filter(p =>
      p.produto.trim() === colorPickerProduto.produto.trim() && p.corProduto !== null
    );

    if (coresNoResultado.length > 0) {
      setColorPickerOpcoes(coresNoResultado);
      setLoadingColorPicker(false);
      return;
    }

    let cancelled = false;
    setLoadingColorPicker(true);
    searchProdutos(colorPickerProduto.produto, filialSelecionada?.codFilial, null, companyKey, true)
      .then(result => {
        if (!cancelled) {
          setColorPickerOpcoes(result.filter(p =>
            p.produto.trim() === colorPickerProduto.produto.trim() && p.corProduto !== null
          ));
        }
      })
      .catch(() => { if (!cancelled) setColorPickerOpcoes([]); })
      .finally(() => { if (!cancelled) setLoadingColorPicker(false); });
    return () => { cancelled = true; };
  }, [colorPickerProduto, companyKey, produtos, filialSelecionada, tipoOperacao]);

  const criarProdutoSelecionado = useCallback((produto: Produto): ProdutoSelecionado | null => {
    if (!filialSelecionada) {
      mostrarNotificacao("Selecione uma filial primeiro", "error");
      return null;
    }

    const estoque = produto.estoques.find(e =>
      e.filial.trim() === filialSelecionada.codFilial.trim()
    );
    
    if (!estoque) {
      if (tipoOperacao === "entrada") {
        return {
          produto: produto.produto,
          descProduto: produto.descProduto,
          codigoBarra: produto.codigoBarra ?? null,
          corProduto: produto.corProduto ? produto.corProduto.trim() : null,
          descCor: (produto.descCor || "").trim(),
          filial: filialSelecionada.codFilial,
          nomeFilial: filialOptionLabel(filialSelecionada),
          estoque: 0,
          quantidade: 1,
        };
      }
      mostrarNotificacao(`Produto não possui estoque na filial ${filialOptionLabel(filialSelecionada)}`, "error");
      return null;
    }

    // Saída: item sem saldo nem entra na lista. Antes entrava com estoque 0 e o
    // Linx recusava no meio da gravação (romaneio 033717, 15/10/2026).
    if (tipoOperacao === "saida" && !saidaPodeEstourarEstoque && estoque.estoque <= 0) {
      mostrarNotificacao(
        `SEM ESTOQUE: ${produto.descProduto || produto.produto}${produto.descCor ? ` (${produto.descCor})` : ""} ` +
          `está com saldo ${estoque.estoque} em ${filialOptionLabel(filialSelecionada)} e não pode sair.`,
        "error"
      );
      return null;
    }

    return {
      produto: produto.produto,
      descProduto: produto.descProduto,
      codigoBarra: produto.codigoBarra ?? null,
      corProduto: produto.corProduto ? produto.corProduto.trim() : null,
      descCor: (produto.descCor || "").trim(),
      filial: filialSelecionada.codFilial,
      nomeFilial: filialOptionLabel(filialSelecionada),
      estoque: estoque.estoque,
      quantidade: 1,
    };
  }, [filialSelecionada, mostrarNotificacao, tipoOperacao, filialOptionLabel, saidaPodeEstourarEstoque]);

  const ensureColorOptionsLoaded = useCallback(async (produtoSku: string) => {
    const sku = (produtoSku || "").trim();
    if (!sku) return;
    if (colorOptionsByProduto[sku]?.length) return;
    if (!filialSelecionada) return;
    try {
      const result = await searchProdutos(sku, filialSelecionada.codFilial, null, companyKey, true);
      const options = result
        .map((p) => ({
          ...p,
          corProduto: p.corProduto ? p.corProduto.trim() : null,
          descCor: (p.descCor || "").trim(),
          codigoBarra: p.codigoBarra ? p.codigoBarra.trim() : null,
        }))
        .filter(p => p.produto.trim() === sku && p.corProduto !== null);
      setColorOptionsByProduto(prev => ({ ...prev, [sku]: options }));
    } catch {
      // silencioso: mantém apenas a cor atual
    }
  }, [colorOptionsByProduto, filialSelecionada, companyKey]);

  const trocarCorProdutoSelecionado = useCallback((index: number, novaCorProduto: string) => {
    if (tipoOperacao !== "entrada") return;
    const cor = (novaCorProduto || "").trim();
    if (!cor) return;
    setProdutosSelecionados(prev => {
      const atual = prev[index];
      if (!atual) return prev;
      const options = colorOptionsByProduto[atual.produto]?.filter(o => o.corProduto) ?? [];
      const escolhido = options.find(o => (o.corProduto || "").trim() === cor);
      if (!escolhido) return prev;
      const estoqueFilial = escolhido.estoques.find(e => e.filial.trim() === atual.filial.trim());
      const next = [...prev];
      next[index] = {
        ...atual,
        corProduto: escolhido.corProduto,
        descCor: escolhido.descCor,
        codigoBarra: escolhido.codigoBarra ?? null,
        estoque: estoqueFilial ? estoqueFilial.estoque : atual.estoque,
        // Outra cor, outro saldo por tamanho: a grade é reconsultada.
        tamanhos: undefined,
      };
      return next;
    });
  }, [tipoOperacao, colorOptionsByProduto]);

  const trocarCorProdutoSelecionadoModal = useCallback((index: number, novaCorProduto: string) => {
    if (tipoOperacao !== "entrada") return;
    const cor = (novaCorProduto || "").trim();
    if (!cor) return;
    setProdutosSelecionadosModal(prev => {
      const atual = prev[index];
      if (!atual) return prev;
      const options = colorOptionsByProduto[atual.produto]?.filter(o => o.corProduto) ?? [];
      const escolhido = options.find(o => (o.corProduto || "").trim() === cor);
      if (!escolhido) return prev;
      const estoqueFilial = escolhido.estoques.find(e => e.filial.trim() === atual.filial.trim());
      const next = [...prev];
      next[index] = {
        ...atual,
        corProduto: escolhido.corProduto,
        descCor: escolhido.descCor,
        codigoBarra: escolhido.codigoBarra ?? null,
        estoque: estoqueFilial ? estoqueFilial.estoque : atual.estoque,
        // Outra cor, outro saldo por tamanho: a grade é reconsultada.
        tamanhos: undefined,
      };
      return next;
    });
  }, [tipoOperacao, colorOptionsByProduto]);

  const adicionarProdutoModal = useCallback((produto: Produto) => {
    if (produto.corProduto === null) {
      const temVariantesComCor = produtos.some(
        (p) => p.produto.trim() === produto.produto.trim() && p.corProduto !== null
      );
      if (temVariantesComCor) {
        setColorPickerProduto(produto);
        return;
      }
    }

    const novoItem = criarProdutoSelecionado(produto);
    if (!novoItem) return;

    setProdutosSelecionadosModal((prev) => {
      // Peça P/M/G já com tamanho escolhido não recebe a soma: o item novo abre
      // outra linha, onde o operador escolhe o tamanho dele.
      const idx = prev.findIndex(
        (p) =>
          p.produto === novoItem.produto &&
          p.corProduto === novoItem.corProduto &&
          p.filial === novoItem.filial &&
          !p.tamanho
      );
      if (idx === -1) {
        mostrarNotificacao(`${novoItem.descProduto} adicionado`);
        return [...prev, novoItem];
      }

      const atual = prev[idx];
      const proxQtd = semTetoDeEstoque ? atual.quantidade + 1 : Math.min(atual.estoque, atual.quantidade + 1);
      const next = [...prev];
      next[idx] = { ...atual, quantidade: proxQtd };

      if (tipoOperacao === "saida" && !saidaPodeEstourarEstoque && proxQtd === atual.estoque) {
        mostrarNotificacao(`Quantidade máxima atingida (estoque ${atual.estoque})`, "error");
      } else {
        mostrarNotificacao(`${novoItem.descProduto} adicionado`);
      }

      return next;
    });
  }, [criarProdutoSelecionado, mostrarNotificacao, tipoOperacao, semTetoDeEstoque, saidaPodeEstourarEstoque]);

  const adicionarComCorSelecionada = useCallback((produtoComCor: Produto) => {
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
    const novoItem = criarProdutoSelecionado(produtoComCor);
    if (!novoItem) return;

    setProdutosSelecionadosModal((prev) => {
      // Peça P/M/G já com tamanho escolhido não recebe a soma: o item novo abre
      // outra linha, onde o operador escolhe o tamanho dele.
      const idx = prev.findIndex(
        (p) =>
          p.produto === novoItem.produto &&
          p.corProduto === novoItem.corProduto &&
          p.filial === novoItem.filial &&
          !p.tamanho
      );
      if (idx === -1) {
        mostrarNotificacao(`${novoItem.descProduto} adicionado`);
        return [...prev, novoItem];
      }

      const atual = prev[idx];
      const proxQtd = semTetoDeEstoque ? atual.quantidade + 1 : Math.min(atual.estoque, atual.quantidade + 1);
      const next = [...prev];
      next[idx] = { ...atual, quantidade: proxQtd };

      if (tipoOperacao === "saida" && !saidaPodeEstourarEstoque && proxQtd === atual.estoque) {
        mostrarNotificacao(`Quantidade máxima atingida (estoque ${atual.estoque})`, "error");
      } else {
        mostrarNotificacao(`${novoItem.descProduto} adicionado`);
      }

      return next;
    });
  }, [criarProdutoSelecionado, mostrarNotificacao, tipoOperacao, semTetoDeEstoque, saidaPodeEstourarEstoque]);

  const removerProduto = useCallback((index: number) => {
    setProdutosSelecionados(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ── BIPAGEM ────────────────────────────────────────────────────────────────

  /**
   * Espelho síncrono da lista. Dois bipes em sequência rápida podem cair no mesmo
   * ciclo de render: lendo `produtosSelecionados` do closure, o segundo bipe veria
   * a lista de antes do primeiro. O ref serve para DECIDIR (saldo, quantidade); a
   * gravação na lista é sempre por updater funcional, sobre a lista real.
   */
  const produtosSelecionadosRef = useRef<ProdutoSelecionado[]>(produtosSelecionados);
  useEffect(() => {
    produtosSelecionadosRef.current = produtosSelecionados;
  }, [produtosSelecionados]);

  /** Zera o diário da lista (lista limpa/descartada). Grava na hora: o escopo pode trocar no mesmo clique. */
  const zerarBipagem = useCallback(() => {
    setBipagem((b) => {
      const zerado: BipagemDiario = { ...b, lidos: b.emVoo.length, aceitos: 0, ocorrencias: [], dispensadas: [] };
      salvarBipagem(zerado);
      return zerado;
    });
  }, []);

  const limparProdutosSelecionados = useCallback(() => {
    setProdutosSelecionados([]);
    zerarBipagem();
  }, [zerarBipagem]);

  /**
   * Romaneio gravado: o diário perde o que foi para ele (leituras, aceitos e as
   * dispensadas daquela lista). O que chegou durante a gravação continua.
   */
  const fecharBipagemDoRegistro = useCallback((snap: { lidos: number; aceitos: number; dispensadas: string[] }) => {
    const ids = new Set(snap.dispensadas);
    setBipagem((b) => {
      const next: BipagemDiario = {
        ...b,
        lidos: Math.max(0, b.lidos - snap.lidos),
        aceitos: Math.max(0, b.aceitos - snap.aceitos),
        dispensadas: b.dispensadas.filter((d) => !ids.has(d.id)),
      };
      salvarBipagem(next);
      return next;
    });
  }, []);

  /** Bipe curto e agudo = entrou; erro = três toques graves (dá para ouvir do outro lado do estoque). */
  const tocarBipe = useCallback((ok: boolean) => {
    if (!somBipeLigado) return;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctor();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();

      const toques = ok ? 1 : 3;
      const duracao = ok ? 0.08 : 0.16;
      for (let i = 0; i < toques; i++) {
        const inicio = ctx.currentTime + i * 0.22;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = ok ? "square" : "sawtooth";
        osc.frequency.setValueAtTime(ok ? 1200 : 240, inicio);
        gain.gain.setValueAtTime(ok ? 0.05 : 0.07, inicio);
        gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(inicio);
        osc.stop(inicio + duracao);
      }
    } catch {
      // Sem áudio (navegador bloqueou / sem gesto do usuário): segue sem som.
    }
  }, [somBipeLigado]);

  /** Devolve o cursor ao campo — o operador nunca deve precisar clicar entre peças. */
  const focarCampoBipe = useCallback(() => {
    requestAnimationFrame(() => bipeInputRef.current?.focus());
  }, []);

  /** Idem, mas sem roubar o cursor de quem está digitando quantidade/observação/busca. */
  const devolverFocoSeLivre = useCallback(() => {
    requestAnimationFrame(() => {
      const ativo = document.activeElement as HTMLElement | null;
      const digitando =
        !!ativo &&
        ativo !== bipeInputRef.current &&
        (ativo.tagName === "INPUT" || ativo.tagName === "TEXTAREA" || ativo.isContentEditable);
      if (!digitando) bipeInputRef.current?.focus();
    });
  }, []);

  const registrarBipe = useCallback((ok: boolean, titulo: string, detalhe: string) => {
    setUltimoBipe({ ok, titulo, detalhe });
    tocarBipe(ok);
  }, [tocarBipe]);

  /** Bipe que não entrou: vai para o painel (não some com o próximo bipe) e toca o alarme. */
  const anotarOcorrencia = useCallback(
    (oc: Omit<BipeOcorrencia, "id" | "em"> & { id?: string }) => {
      const completa: BipeOcorrencia = { ...oc, id: oc.id ?? novoIdBipe(), em: Date.now() };
      setBipagem((b) => ({ ...b, ocorrencias: [...b.ocorrencias.filter((o) => o.id !== completa.id), completa] }));
      registrarBipe(false, oc.titulo, oc.detalhe);
    },
    [registrarBipe]
  );

  /** Última linha já rolada para a vista — evita re-scroll a cada render do destaque. */
  const destaqueScrollRef = useRef<string | null>(null);

  const destacarItem = useCallback((chave: string) => {
    destaqueScrollRef.current = null;
    setItemDestacado(chave);
    if (destaqueTimeoutRef.current) clearTimeout(destaqueTimeoutRef.current);
    destaqueTimeoutRef.current = setTimeout(() => setItemDestacado(null), 1600);
  }, []);

  useEffect(() => {
    return () => {
      if (destaqueTimeoutRef.current) clearTimeout(destaqueTimeoutRef.current);
    };
  }, []);

  /** Põe a peça na lista. Devolve false (e anota a ocorrência) quando ela NÃO entra. */
  const adicionarItemBipado = useCallback((item: BipeItem, codigoLido: string): boolean => {
    if (!filialSelecionada) {
      anotarOcorrencia({
        codigo: codigoLido,
        tipo: "filial_trocada",
        titulo: "Selecione a filial — a peça NÃO entrou",
        detalhe: "A bipagem precisa saber de qual loja sai/entra a peça.",
      });
      return false;
    }

    // Peça P/M/G: o código de barras é de UM tamanho — a peça entra nele, com o
    // saldo daquele tamanho. Código sem tamanho definido entra sem tamanho e o
    // operador escolhe na linha (o registro não sai sem ele).
    const grade = item.exigeTamanho ? item.tamanhos ?? [] : [];
    const tamanhoBipado = grade.length > 0 ? grade.find((t) => t.ordinal === item.tamanho) ?? null : null;
    const estoqueBipado = tamanhoBipado ? tamanhoBipado.estoque : item.estoque;

    const corTxt = textoCorProduto(item.descCor, item.corProduto);
    const rotuloBase = corTxt ? `${item.descProduto} · ${corTxt}` : item.descProduto;
    const rotulo = tamanhoBipado ? `${rotuloBase} · ${tamanhoBipado.label}` : rotuloBase;
    const chave = chaveLinha({ produto: item.produto, corProduto: item.corProduto, tamanho: tamanhoBipado?.ordinal ?? null });
    const filialCod = filialSelecionada.codFilial;
    const casaLinha = (p: ProdutoSelecionado) =>
      p.produto === item.produto &&
      (p.corProduto ?? "") === (item.corProduto ?? "") &&
      p.filial === filialCod &&
      (p.tamanho ?? null) === (tamanhoBipado?.ordinal ?? null);

    const linhaAtual = produtosSelecionadosRef.current.find(casaLinha);
    const limitarAoSaldo = tipoOperacao === "saida" && !saidaPodeEstourarEstoque;

    if (!linhaAtual && limitarAoSaldo && estoqueBipado <= 0) {
      anotarOcorrencia({
        codigo: codigoLido,
        tipo: "sem_estoque",
        titulo: `SEM ESTOQUE — ${rotulo}`,
        detalhe: `Saldo ${estoqueBipado}${tamanhoBipado ? ` do tamanho ${tamanhoBipado.label}` : ""} em ${filialOptionLabel(filialSelecionada)}. A peça NÃO entrou na lista.`,
      });
      return false;
    }
    if (linhaAtual && limitarAoSaldo && linhaAtual.quantidade >= estoqueBipado) {
      anotarOcorrencia({
        codigo: codigoLido,
        tipo: "qtd_maxima",
        titulo: `SALDO ESGOTADO — ${rotulo}`,
        detalhe: `A lista já tem ${linhaAtual.quantidade} e o saldo${tamanhoBipado ? ` do tamanho ${tamanhoBipado.label}` : ""} em ${filialOptionLabel(filialSelecionada)} é ${estoqueBipado}. Esta peça NÃO entrou.`,
      });
      return false;
    }

    const aplicar = (lista: ProdutoSelecionado[]): ProdutoSelecionado[] => {
      const idx = lista.findIndex(casaLinha);
      if (idx === -1) {
        return [
          ...lista,
          {
            produto: item.produto,
            descProduto: item.descProduto,
            codigoBarra: item.codigoBarra,
            corProduto: item.corProduto,
            descCor: item.descCor,
            filial: filialCod,
            nomeFilial: filialOptionLabel(filialSelecionada),
            estoque: estoqueBipado,
            quantidade: 1,
            tamanhos: grade,
            tamanho: tamanhoBipado?.ordinal ?? null,
            tamanhoLabel: tamanhoBipado?.label ?? null,
          },
        ];
      }
      const next = [...lista];
      // Reaproveita o saldo recém-consultado: entre um bipe e outro o estoque pode ter mudado.
      next[idx] = { ...lista[idx], quantidade: lista[idx].quantidade + 1, estoque: estoqueBipado, tamanhos: grade };
      return next;
    };

    const quantidade = (linhaAtual?.quantidade ?? 0) + 1;
    produtosSelecionadosRef.current = aplicar(produtosSelecionadosRef.current);
    // Updater funcional: a peça soma sobre a lista REAL do React. Gravar um array
    // montado do ref (que o efeito acima pode ter voltado para um valor velho)
    // apagava a peça do bipe anterior.
    setProdutosSelecionados((prev) => {
      const next = aplicar(prev);
      produtosSelecionadosRef.current = next;
      return next;
    });
    setBipagem((b) => ({ ...b, aceitos: b.aceitos + 1 }));
    destacarItem(chave);
    registrarBipe(
      true,
      rotulo,
      `${item.produto}${item.codigoBarra ? ` · ${item.codigoBarra}` : ""} · qtd ${quantidade}` +
        (grade.length > 0 && !tamanhoBipado ? " · escolha o tamanho na lista" : "")
    );
    return true;
  }, [filialSelecionada, tipoOperacao, saidaPodeEstourarEstoque, filialOptionLabel, registrarBipe, anotarOcorrencia, destacarItem]);

  const processarBipe = useCallback(async (codigoRaw: string, opts?: { repeticao?: boolean }) => {
    const codigo = codigoRaw.trim();
    if (!codigo) return;

    if (!filialSelecionada) {
      registrarBipe(false, "Selecione a filial", "Escolha a loja antes de bipar.");
      return;
    }

    const filialCod = filialSelecionada.codFilial;
    const escopoNaHora = escopoBipeRef.current;
    const id = novoIdBipe();
    setBipagem((b) => ({
      ...b,
      lidos: opts?.repeticao ? b.lidos : b.lidos + 1,
      emVoo: [...b.emVoo, { id, codigo, em: Date.now() }],
    }));
    try {
      const resposta = await naFilaDeBipe(filaBipesRef.current, () => biparCodigo(codigo, filialCod, companyKey));

      // Trocou filial/operação/romaneio enquanto a consulta ia: a peça era da
      // lista anterior. Não entra calada na lista nova — vira aviso.
      if (escopoBipeRef.current !== escopoNaHora) {
        anotarOcorrencia({
          id,
          codigo,
          tipo: "filial_trocada",
          titulo: "Bipe da lista anterior — NÃO entrou",
          detalhe: `O código ${codigo} foi lido antes de trocar a filial/operação. Se a peça é desta lista, bipe de novo.`,
        });
        return;
      }

      if (resposta.status === "ambiguo") {
        anotarOcorrencia({
          id,
          codigo,
          tipo: "ambiguo",
          titulo: "Código em mais de um produto — escolha",
          detalhe: `O código ${codigo} está em ${resposta.opcoes.length} produtos. A peça só entra depois que você escolher.`,
          opcoes: resposta.opcoes,
        });
        return;
      }

      if (resposta.status === "nao_encontrado" || !resposta.item) {
        anotarOcorrencia({
          id,
          codigo,
          tipo: "nao_encontrado",
          titulo: "Código não encontrado — a peça NÃO entrou",
          detalhe: `Nenhum produto cadastrado com o código ${codigo}. Confira a etiqueta ou adicione pelo "Adicionar Produto".`,
        });
        return;
      }

      // Entrada aceita saldo zerado (é justamente o que a entrada vai criar);
      // saída não — `adicionarItemBipado` barra e anota.
      adicionarItemBipado(resposta.item, codigo);
    } catch {
      anotarOcorrencia({
        id,
        codigo,
        tipo: "falha",
        titulo: "Falha na consulta — a peça NÃO entrou",
        detalhe: `Não deu para consultar o código ${codigo} (3 tentativas). Use "Tentar de novo" ou bipe a peça outra vez.`,
      });
    } finally {
      setBipagem((b) => ({ ...b, emVoo: b.emVoo.filter((v) => v.id !== id) }));
      devolverFocoSeLivre();
    }
  }, [filialSelecionada, companyKey, registrarBipe, anotarOcorrencia, adicionarItemBipado, devolverFocoSeLivre]);

  /** O listener global do leitor (abaixo) é montado uma vez: chama sempre a versão atual. */
  const processarBipeRef = useRef(processarBipe);
  useEffect(() => {
    processarBipeRef.current = processarBipe;
  }, [processarBipe]);

  const submeterBipe = useCallback((valor?: string) => {
    // O valor vem do próprio campo no Enter: o estado pode estar um caractere atrás
    // quando o leitor manda o código inteiro de uma vez.
    const codigo = (valor ?? codigoBipado).trim();
    if (!codigo) return;
    // Limpa ANTES de consultar: o próximo bipe já pode estar chegando pelo leitor.
    setCodigoBipado("");
    void processarBipe(codigo);
  }, [codigoBipado, processarBipe]);

  const tirarOcorrencia = useCallback((id: string) => {
    setBipagem((b) => ({ ...b, ocorrencias: b.ocorrencias.filter((o) => o.id !== id) }));
  }, []);

  const tentarBipeDeNovo = useCallback((oc: BipeOcorrencia) => {
    tirarOcorrencia(oc.id);
    void processarBipe(oc.codigo, { repeticao: true });
  }, [tirarOcorrencia, processarBipe]);

  const escolherOpcaoAmbigua = useCallback((oc: BipeOcorrencia, item: BipeItem) => {
    tirarOcorrencia(oc.id);
    adicionarItemBipado(item, oc.codigo);
    focarCampoBipe();
  }, [tirarOcorrencia, adicionarItemBipado, focarCampoBipe]);

  /** Dispensar é decisão consciente: a peça fica registrada como "não vai neste romaneio". */
  const dispensarOcorrencia = useCallback((id: string) => {
    setBipagem((b) => {
      const oc = b.ocorrencias.find((o) => o.id === id);
      if (!oc) return b;
      return { ...b, ocorrencias: b.ocorrencias.filter((o) => o.id !== id), dispensadas: [...b.dispensadas, oc] };
    });
    focarCampoBipe();
  }, [focarCampoBipe]);

  /**
   * "Dispensar todos" pede um 2º clique (sem window.confirm: o Enter do leitor
   * aceitaria o diálogo nativo e a peça bipada nele sumiria).
   */
  const [confirmandoDispensaTodas, setConfirmandoDispensaTodas] = useState(false);
  useEffect(() => {
    if (!confirmandoDispensaTodas) return;
    const t = setTimeout(() => setConfirmandoDispensaTodas(false), 5000);
    return () => clearTimeout(t);
  }, [confirmandoDispensaTodas]);

  const dispensarTodasOcorrencias = useCallback(() => {
    if (bipagem.ocorrencias.length === 0) return;
    if (!confirmandoDispensaTodas) {
      setConfirmandoDispensaTodas(true);
      return;
    }
    setConfirmandoDispensaTodas(false);
    setBipagem((b) => ({ ...b, ocorrencias: [], dispensadas: [...b.dispensadas, ...b.ocorrencias] }));
    focarCampoBipe();
  }, [bipagem.ocorrencias.length, confirmandoDispensaTodas, focarCampoBipe]);

  // Preferência de som do operador (loja barulhenta / loja silenciosa).
  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem("saidas-entradas:som-bipe");
      if (salvo !== null) setSomBipeLigado(salvo === "1");
    } catch {
      // localStorage indisponível (aba privada): mantém o padrão ligado.
    }
  }, []);

  const alternarSomBipe = useCallback(() => {
    setSomBipeLigado((prev) => {
      const proximo = !prev;
      try {
        window.localStorage.setItem("saidas-entradas:som-bipe", proximo ? "1" : "0");
      } catch {
        // sem persistência: vale só para esta sessão
      }
      return proximo;
    });
  }, []);

  // Troca de loja ou de tipo zera o feedback do último bipe: ele não vale mais.
  // As ocorrências não: elas seguem o diário do escopo (ver efeito do diário).
  useEffect(() => {
    setCodigoBipado("");
    setUltimoBipe(null);
  }, [codFilialSelecionada, tipoOperacao]);

  /**
   * Cursor no campo de bipagem por padrão — inclusive quando um modal fecha.
   * Depende do CÓDIGO da filial (string), nunca do objeto: o refresh em foco recria
   * o objeto e roubaria o cursor de quem estivesse digitando a observação.
   */
  useEffect(() => {
    if (!codFilialSelecionada) return;
    if (modalAberto || modalEdicaoAberto || mostrarConfirmacaoRegistro) return;
    focarCampoBipe();
  }, [codFilialSelecionada, modalAberto, modalEdicaoAberto, mostrarConfirmacaoRegistro, focarCampoBipe]);

  const setObservacaoAtualRef = useRef(setObservacaoAtual);
  useEffect(() => {
    setObservacaoAtualRef.current = setObservacaoAtual;
  }, [setObservacaoAtual]);

  /**
   * LEITOR FORA DO CAMPO. O cursor sai do campo de bipe a cada clique (lixeira,
   * +/−, tamanho, Registrar…). Bipar nesse estado perdia a peça: os dígitos não
   * iam para lugar nenhum e o Enter do leitor CLICAVA o botão focado — na lixeira,
   * apagava a linha seguinte. Aqui a rajada do leitor (teclas a ≤45ms) é
   * reconhecida em qualquer lugar da tela e vira bipe normal. Se ela caiu na
   * quantidade ou na observação, o campo volta ao valor de antes.
   * O modal de Adicionar Produto tem busca própria por código: lá não interfere.
   */
  useEffect(() => {
    if (!codFilialSelecionada || modalAberto || modalEdicaoAberto) return;

    let buffer = "";
    let ultimaTecla = 0;
    let inicio: { alvo: HTMLElement | null; valor: string } | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo === bipeInputRef.current) {
        buffer = "";
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Shift" || e.key === "CapsLock") return;

      // SELECT conta como não-editável: a busca por letra dele trocaria a filial e zeraria a lista.
      const editavel =
        !!alvo && (alvo.isContentEditable || alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA");
      const agora = performance.now();

      // Espaço fica de fora: é como gente aciona botão pelo teclado.
      if (e.key.length === 1 && e.key !== " ") {
        if (agora - ultimaTecla > LEITOR_GAP_MS || inicio?.alvo !== alvo) {
          buffer = "";
          inicio = {
            alvo,
            valor: editavel ? String((alvo as HTMLInputElement | HTMLTextAreaElement).value ?? "") : "",
          };
        }
        buffer += e.key;
        ultimaTecla = agora;
        if (!editavel) e.preventDefault();
        return;
      }

      const fimDeLeitura = e.key === "Enter" || e.key === "Tab";
      if (fimDeLeitura && buffer.length >= LEITOR_MIN_CHARS && agora - ultimaTecla <= LEITOR_GAP_MS * 3) {
        e.preventDefault();
        e.stopPropagation();
        const codigo = buffer;
        buffer = "";
        if (editavel && alvo && inicio?.alvo === alvo) {
          const valorAntes = inicio.valor;
          const idxQtd = alvo.dataset.leitorQtd;
          if (idxQtd !== undefined) {
            const idx = Number(idxQtd);
            const qtd = Math.max(1, parseInt(valorAntes, 10) || 1);
            setProdutosSelecionados((prev) => prev.map((p, i) => (i === idx ? { ...p, quantidade: qtd } : p)));
          } else if (alvo.dataset.leitorObs !== undefined) {
            setObservacaoAtualRef.current(valorAntes);
          }
        }
        inicio = null;
        void processarBipeRef.current(codigo);
        focarCampoBipe();
        return;
      }

      buffer = "";
      inicio = null;
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [codFilialSelecionada, modalAberto, modalEdicaoAberto, focarCampoBipe]);

  const atualizarQuantidade = useCallback((index: number, quantidade: number) => {
    if (quantidade < 1) return;
    
    setProdutosSelecionados(prev => {
      const novo = [...prev];
      const produto = novo[index];
      if (tipoOperacao === "saida" && !saidaPodeEstourarEstoque && quantidade > produto.estoque) {
        mostrarNotificacao(`Quantidade não pode ser maior que o estoque disponível (${produto.estoque})`, "error");
        return prev;
      }
      novo[index] = { ...produto, quantidade };
      return novo;
    });
  }, [mostrarNotificacao, tipoOperacao, saidaPodeEstourarEstoque]);

  const atualizarQuantidadeModal = useCallback((index: number, quantidade: number) => {
    if (quantidade < 1) return;
    
    setProdutosSelecionadosModal(prev => {
      const novo = [...prev];
      const produto = novo[index];
      if (!produto) return prev;
      if (tipoOperacao === "saida" && !saidaPodeEstourarEstoque && quantidade > produto.estoque) {
        mostrarNotificacao(`Quantidade não pode ser maior que o estoque disponível (${produto.estoque})`, "error");
        return prev;
      }
      novo[index] = { ...produto, quantidade };
      return novo;
    });
  }, [mostrarNotificacao, tipoOperacao, saidaPodeEstourarEstoque]);

  const removerProdutoModal = useCallback((index: number) => {
    setProdutosSelecionadosModal(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ── TAMANHO (peça P/M/G) ────────────────────────────────────────────────────
  // Toda linha precisa saber a grade do produto: peça P/M/G exige o tamanho, e
  // a saída é travada pelo saldo DAQUELE tamanho. Linha nova sem grade (modal,
  // rascunho, edição de romaneio, troca de cor) é consultada aqui; a bipagem já
  // traz a grade junto.
  const gradeEmVooRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!filialSelecionada) return;
    const filialCod = filialSelecionada.codFilial;
    const pendentes = produtosSelecionados.filter(
      (p) => p.tamanhos === undefined && !gradeEmVooRef.current.has(`${filialCod}|${p.produto}|${p.corProduto ?? ""}`)
    );
    if (pendentes.length === 0) return;
    const chaves = [...new Set(pendentes.map((p) => `${filialCod}|${p.produto}|${p.corProduto ?? ""}`))];
    chaves.forEach((k) => gradeEmVooRef.current.add(k));
    const unicos = [...new Map(pendentes.map((p) => [`${p.produto}|${p.corProduto ?? ""}`, p])).values()];

    fetchTamanhos(companyKey, filialCod, unicos)
      .then((mapa) => {
        setProdutosSelecionados((prev) => {
          const next = prev.map((p) => {
            if (p.tamanhos !== undefined || p.filial !== filialCod) return p;
            const grade = mapa.get(`${p.produto}|${p.corProduto ?? ""}`);
            if (!grade) return p;
            if (grade.length === 0) return { ...p, tamanhos: [], tamanho: null, tamanhoLabel: null };
            const escolhido = p.tamanho ? grade.find((t) => t.ordinal === p.tamanho) : undefined;
            return escolhido
              ? { ...p, tamanhos: grade, tamanhoLabel: escolhido.label, estoque: escolhido.estoque }
              : { ...p, tamanhos: grade, tamanho: null, tamanhoLabel: null };
          });
          produtosSelecionadosRef.current = next;
          return next;
        });
      })
      .catch(() => {
        mostrarNotificacao("Não foi possível consultar os tamanhos. Tente adicionar o produto de novo.", "error");
      })
      .finally(() => {
        chaves.forEach((k) => gradeEmVooRef.current.delete(k));
      });
  }, [produtosSelecionados, filialSelecionada, companyKey, mostrarNotificacao]);

  /**
   * Escolhe o tamanho de uma linha. A linha passa a valer o saldo do tamanho e,
   * se já existe uma linha desse produto×cor no mesmo tamanho, as duas se juntam.
   */
  const escolherTamanho = useCallback((index: number, ordinal: number) => {
    setProdutosSelecionados((prev) => {
      const linha = prev[index];
      const opcao = linha?.tamanhos?.find((t) => t.ordinal === ordinal);
      if (!linha || !opcao) return prev;

      const limitar = tipoOperacao === "saida" && !saidaPodeEstourarEstoque;
      if (limitar && opcao.estoque <= 0) {
        mostrarNotificacao(`Sem saldo do tamanho ${opcao.label} nesta filial.`, "error");
        return prev;
      }

      const destino = prev.findIndex(
        (p, i) =>
          i !== index &&
          p.produto === linha.produto &&
          (p.corProduto ?? "") === (linha.corProduto ?? "") &&
          p.filial === linha.filial &&
          p.tamanho === ordinal
      );

      let next: ProdutoSelecionado[];
      if (destino !== -1) {
        const somada = prev[destino].quantidade + linha.quantidade;
        const quantidade = limitar ? Math.min(somada, opcao.estoque) : somada;
        if (quantidade < somada) {
          mostrarNotificacao(`Quantidade ajustada ao saldo do tamanho ${opcao.label} (${opcao.estoque}).`, "error");
        }
        next = prev
          .map((p, i) => (i === destino ? { ...p, quantidade, estoque: opcao.estoque } : p))
          .filter((_, i) => i !== index);
      } else {
        const quantidade = limitar ? Math.min(linha.quantidade, opcao.estoque) : linha.quantidade;
        if (quantidade < linha.quantidade) {
          mostrarNotificacao(`Quantidade ajustada ao saldo do tamanho ${opcao.label} (${opcao.estoque}).`, "error");
        }
        next = [...prev];
        next[index] = { ...linha, tamanho: ordinal, tamanhoLabel: opcao.label, estoque: opcao.estoque, quantidade };
      }
      produtosSelecionadosRef.current = next;
      return next;
    });
  }, [tipoOperacao, saidaPodeEstourarEstoque, mostrarNotificacao]);

  /** Linha sem saldo para a quantidade pedida (na última conferência). */
  const linhaSemSaldo = useCallback(
    (p: ProdutoSelecionado) => semSaldoChaves.has(chaveLinha(p)) && p.quantidade > p.estoque,
    [semSaldoChaves]
  );

  /**
   * "Ajustar ao saldo": tira da lista o que está sem saldo e reduz à quantidade
   * disponível o que tem menos do que o pedido. Só mexe nas linhas marcadas.
   */
  const ajustarAoSaldo = useCallback(() => {
    setProdutosSelecionados((prev) => {
      const removidos: string[] = [];
      const next = prev
        .map((p) => {
          if (!(semSaldoChaves.has(chaveLinha(p)) && p.quantidade > p.estoque)) return p;
          if (p.estoque <= 0) {
            removidos.push(p.descProduto || p.produto);
            return null;
          }
          return { ...p, quantidade: p.estoque };
        })
        .filter((p): p is ProdutoSelecionado => p !== null);
      produtosSelecionadosRef.current = next;
      mostrarNotificacao(
        removidos.length > 0
          ? `Lista ajustada ao saldo: ${removidos.length} item(ns) sem estoque removido(s).`
          : "Lista ajustada ao saldo disponível."
      );
      return next;
    });
    setSemSaldoChaves(new Set());
  }, [semSaldoChaves, mostrarNotificacao]);

  /** Mensagem de bloqueio quando alguma peça P/M/G está sem tamanho (ou a grade ainda não carregou). */
  const pendenciaTamanho = useCallback((lista: ProdutoSelecionado[]): string | null => {
    const carregando = lista.filter((p) => p.tamanhos === undefined);
    if (carregando.length > 0) return "Aguarde: consultando os tamanhos dos produtos da lista.";
    const sem = lista.filter(faltaTamanho);
    if (sem.length === 0) return null;
    const nomes = [...new Set(sem.map((p) => p.descProduto || p.produto))].slice(0, 5).join(", ");
    return `Escolha o tamanho (P/M/G) de: ${nomes}${sem.length > 5 ? "…" : ""}.`;
  }, []);

  const executarLote = useCallback(async (produtos: ProdutoSelecionado[], observacao: string) => {
    if (produtos.length === 0 || processandoOperacao || !filialSelecionada) return;

    const snapBipagem = {
      lidos: bipagem.lidos,
      aceitos: bipagem.aceitos,
      dispensadas: bipagem.dispensadas.map((d) => d.id),
    };
    setProcessandoOperacao(true);
    try {
      const itens = produtos.map(p => ({
        produto: p.produto,
        corProduto: p.corProduto,
        quantidade: p.quantidade,
        tamanho: p.tamanho ?? null,
      }));

      // A UI mostra o label lógico da loja/grupo, mas a operação sempre segue
      // pela filial ativa real via `codFilial`.
      const resultado = await executarOperacaoLote(
        tipoOperacao,
        itens,
        filialSelecionada.codFilial,
        tipoRomaneioSelecionado,
        responsavelFinal || 'LOGISTICA',
        user?.username,
        observacao.trim() || undefined,
        filialDestinoSaida?.codFilial || null,
        companyKey
      );

      // Salvar filial destino do romaneio gerado (saída) — não aplicável para SAÍDA MKT
      if (tipoOperacao === "saida" && filialDestinoSaida && resultado.romaneio && !isTipoSemDestino(tipoRomaneioSelecionado)) {
        try {
          await salvarDestinoRomaneio(
            companyKey,
            resultado.romaneio,
            filialSelecionada.codFilial,
            filialDestinoSaida.codFilial,
            user?.username
          );
        } catch (err) {
          console.error("Erro ao salvar filial destino do romaneio", err);
        }
      }

      // O rascunho existe só até o romaneio sair. Zerar os controles do autosave
      // ANTES de limpar a lista evita que ele grave um rascunho vazio logo depois.
      rascunhoSalvoRef.current = false;
      rascunhoPayloadRef.current = "";
      setRascunhoStatus("idle");
      setRascunhoRestauradoEm(null);
      try {
        await removerRascunhoApi(
          { companyKey, tipoOperacao, filial: filialSelecionada.codFilial },
          user?.username
        );
      } catch (err) {
        console.error("Erro ao remover rascunho após registrar romaneio", err);
      }

      // Tira da lista só o que foi gravado: peça bipada durante a gravação fica
      // para o próximo romaneio (antes a lista era zerada e ela sumia calada).
      const sobra = descontarGravados(produtosSelecionadosRef.current, produtos);
      setProdutosSelecionados((prev) => {
        const next = descontarGravados(prev, produtos);
        produtosSelecionadosRef.current = next;
        return next;
      });
      produtosSelecionadosRef.current = sobra;
      fecharBipagemDoRegistro(snapBipagem);
      void fetchRascunhos(companyKey).then(setRascunhos).catch(() => undefined);
      // Reconsulta a trava de defeito: o romaneio que acabou de sair fecha o dia.
      setDefeitoRefreshKey((k) => k + 1);

      const label = tipoOperacao === "saida" ? "Saída" : "Entrada";
      const pecasSobra = sobra.reduce((s, p) => s + p.quantidade, 0);
      mostrarNotificacao(
        `${label} registrada com sucesso! Romaneio: ${resultado.romaneio}` +
          (pecasSobra > 0
            ? ` · ${pecasSobra} peça(s) bipada(s) durante a gravação ficaram na lista para o próximo romaneio.`
            : "")
      );
      setSemSaldoChaves(new Set());

      const [novoSaidas, novoEntradas] = await Promise.all([fetchLogSaidas(), fetchLogEntradas()]);
      setLogSaidas(novoSaidas);
      setLogEntradas(novoEntradas);
    } catch (error: any) {
      // Recusa por saldo: marca em vermelho as linhas dos itens recusados (com o
      // saldo que o servidor achou) para o operador ajustar e registrar de novo.
      const faltas = (error?.faltas ?? null) as Array<{ produto: string; cor: string; disponivel: number }> | null;
      if (faltas && faltas.length > 0) {
        const norm = (c: string | null | undefined) => {
          const t = (c ?? "").trim();
          return /^\d+$/.test(t) ? String(Number(t)) : t;
        };
        const recusado = (p: ProdutoSelecionado) =>
          faltas.find((f) => f.produto.trim() === p.produto.trim() && norm(f.cor) === norm(p.corProduto));
        setProdutosSelecionados((prev) => {
          const next = prev.map((p) => {
            const f = recusado(p);
            return f && !p.tamanho ? { ...p, estoque: Math.max(0, f.disponivel) } : p;
          });
          produtosSelecionadosRef.current = next;
          return next;
        });
        setSemSaldoChaves(new Set(produtos.filter((p) => recusado(p)).map(chaveLinha)));
      }
      mostrarNotificacao(error.message || "Erro ao processar operação", "error");
    } finally {
      setProcessandoOperacao(false);
    }
  }, [processandoOperacao, filialSelecionada, tipoOperacao, tipoRomaneioSelecionado, responsavelFinal, user?.username, filialDestinoSaida, companyKey, mostrarNotificacao, bipagem, fecharBipagemDoRegistro]);

  /**
   * Abre um romaneio já gravado (saída OU entrada) para acrescentar itens. Traz
   * os itens que já foram lançados (só para conferência) e deixa a lista de
   * trabalho vazia: o que for bipado agora é o que será SOMADO ao romaneio.
   */
  const abrirEdicaoRomaneio = useCallback(
    async (tipo: TipoOperacao, romaneio: string, filialRomaneio: string): Promise<boolean> => {
      if (!user?.username || !podeEditarRomaneio) return false;
      if (carregandoEdicaoRomaneio || processandoOperacao) return false;

      setCarregandoEdicaoRomaneio(true);
      try {
        const dados = await fetchRomaneioParaEdicao(
          tipo,
          romaneio,
          filialRomaneio,
          user.username,
          companyKey
        );
        if (!dados.editavel) {
          mostrarNotificacao(dados.motivo || "Este romaneio não pode receber novos itens.", "error");
          return false;
        }

        // A operação (bipe, busca de produto, estoque) segue pela filial do
        // romaneio — sem isso o item sairia/entraria na loja errada.
        const filialDoRomaneio =
          filiaisDisponiveis.find((f) => matchesFilialOption(f, dados.filial)) ??
          filiais.find((f) => matchesFilialOption(f, dados.filial)) ??
          null;

        if (!filialDoRomaneio) {
          mostrarNotificacao(
            `Você não opera a filial ${filialLabel(dados.filial)} — não é possível editar este romaneio.`,
            "error"
          );
          return false;
        }

        setTipoOperacao(tipo);
        setModalAberto(false);
        setProdutosSelecionadosModal([]);
        setProdutos([]);
        setSearchTerm("");
        setFilialDestinoSaida(null);
        setProdutosSelecionados([]);
        produtosSelecionadosRef.current = [];
        setObservacaoAtual("");
        setFilialSelecionada(filialDoRomaneio);
        setRomaneioEditando({
          tipo,
          romaneio,
          filial: dados.filial,
          itensExistentes: dados.itens,
          aviso: dados.aviso ?? null,
        });
        setAbaLateral("historico");
        return true;
      } catch (error) {
        mostrarNotificacao(
          error instanceof Error
            ? error.message
            : `Erro ao abrir o romaneio de ${tipo === "saida" ? "saída" : "entrada"}`,
          "error"
        );
        return false;
      } finally {
        setCarregandoEdicaoRomaneio(false);
      }
    },
    [
      user?.username,
      podeEditarRomaneio,
      carregandoEdicaoRomaneio,
      processandoOperacao,
      companyKey,
      filiaisDisponiveis,
      filiais,
      filialLabel,
      mostrarNotificacao,
      setObservacaoAtual,
    ]
  );

  const cancelarEdicaoRomaneio = useCallback(() => {
    zerarBipagem();
    setRomaneioEditando(null);
    setProdutosSelecionados([]);
    produtosSelecionadosRef.current = [];
    setObservacaoAtual("");
  }, [setObservacaoAtual, zerarBipagem]);

  /** Grava os itens novos DENTRO do romaneio aberto (não cria romaneio novo). */
  const salvarItensDaEdicao = useCallback(async () => {
    if (!romaneioEditando || !user?.username) return;
    if (produtosSelecionados.length === 0 || processandoOperacao) return;

    const enviados = produtosSelecionados;
    const snapBipagem = {
      lidos: bipagem.lidos,
      aceitos: bipagem.aceitos,
      dispensadas: bipagem.dispensadas.map((d) => d.id),
    };
    setProcessandoOperacao(true);
    try {
      const resultado = await salvarItensNoRomaneio(
        romaneioEditando.tipo,
        romaneioEditando.romaneio,
        romaneioEditando.filial,
        produtosSelecionados.map((p) => ({
          produto: p.produto,
          corProduto: p.corProduto,
          quantidade: p.quantidade,
          tamanho: p.tamanho ?? null,
        })),
        user.username,
        companyKey
      );

      // O rascunho da edição existe só até os itens entrarem no romaneio. Zerar os
      // controles do autosave ANTES de limpar a lista evita gravar um rascunho
      // vazio logo depois.
      rascunhoSalvoRef.current = false;
      rascunhoPayloadRef.current = "";
      setRascunhoStatus("idle");
      setRascunhoRestauradoEm(null);
      if (filialSelecionada) {
        try {
          await removerRascunhoApi(
            {
              companyKey,
              tipoOperacao: romaneioEditando.tipo,
              filial: filialSelecionada.codFilial,
              romaneioEdicao: romaneioEditando.romaneio,
            },
            user.username
          );
        } catch (err) {
          console.error("Erro ao remover rascunho da edição", err);
        }
      }

      // Só sai da lista o que foi gravado. Peça bipada durante a gravação era
      // para ESTE romaneio: a edição continua aberta para salvá-la também.
      const sobra = descontarGravados(produtosSelecionadosRef.current, enviados);
      setProdutosSelecionados((prev) => {
        const next = descontarGravados(prev, enviados);
        produtosSelecionadosRef.current = next;
        return next;
      });
      produtosSelecionadosRef.current = sobra;
      fecharBipagemDoRegistro(snapBipagem);
      const pecasSobra = sobra.reduce((s, p) => s + p.quantidade, 0);
      if (pecasSobra > 0) {
        setRomaneioEditando((atual) => {
          if (!atual) return atual;
          const itens = [...atual.itensExistentes];
          for (const p of enviados) {
            const i = itens.findIndex((it) => it.produto === p.produto && (it.corProduto ?? "") === (p.corProduto ?? ""));
            if (i === -1) {
              itens.push({
                produto: p.produto,
                corProduto: p.corProduto,
                descProduto: p.descProduto,
                descCor: p.descCor,
                codigoBarra: p.codigoBarra,
                quantidade: p.quantidade,
                estoque: p.estoque,
              });
            } else {
              itens[i] = { ...itens[i], quantidade: itens[i].quantidade + p.quantidade };
            }
          }
          return { ...atual, itensExistentes: itens };
        });
      } else {
        setRomaneioEditando(null);
        setObservacaoAtual("");
      }
      void fetchRascunhos(companyKey).then(setRascunhos).catch(() => undefined);

      mostrarNotificacao(
        (resultado.message ||
          `Romaneio ${romaneioEditando.romaneio} atualizado com ${resultado.qtdeAdicionada} item(ns).`) +
          (pecasSobra > 0
            ? ` · ${pecasSobra} peça(s) bipada(s) durante a gravação continuam na lista — salve de novo para incluí-las.`
            : "")
      );

      const [novoSaidas, novoEntradas] = await Promise.all([fetchLogSaidas(), fetchLogEntradas()]);
      setLogSaidas(novoSaidas);
      setLogEntradas(novoEntradas);
    } catch (error) {
      mostrarNotificacao(
        error instanceof Error ? error.message : "Erro ao salvar os itens no romaneio",
        "error"
      );
    } finally {
      setProcessandoOperacao(false);
    }
  }, [
    romaneioEditando,
    user?.username,
    produtosSelecionados,
    processandoOperacao,
    filialSelecionada,
    companyKey,
    mostrarNotificacao,
    setObservacaoAtual,
    bipagem,
    fecharBipagemDoRegistro,
  ]);

  /**
   * Romaneio aberto a partir do histórico completo:
   * /saidas-entradas-produtos?editarEntrada=016123&filialEntrada=NERD%20MATRIZ
   * /saidas-entradas-produtos?editarSaida=016123&filialSaida=NERD%20MATRIZ
   * Lê de `window.location` (e não de useSearchParams) para não exigir um
   * Suspense em volta da tela inteira. A URL é limpa depois, senão um F5
   * reabriria a edição sozinho.
   */
  const edicaoViaUrlRef = useRef(false);
  useEffect(() => {
    if (edicaoViaUrlRef.current) return;
    if (!permissoesCarregadas || !podeEditarRomaneio) return;
    if (filiaisDisponiveis.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const tipo: TipoOperacao = params.get("editarSaida") ? "saida" : "entrada";
    const romaneio = (params.get(tipo === "saida" ? "editarSaida" : "editarEntrada") || "").trim();
    const filial = (params.get(tipo === "saida" ? "filialSaida" : "filialEntrada") || "").trim();
    if (!romaneio || !filial) return;

    edicaoViaUrlRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void abrirEdicaoRomaneio(tipo, romaneio, filial);
  }, [permissoesCarregadas, podeEditarRomaneio, filiaisDisponiveis, abrirEdicaoRomaneio]);

  const abrirModalEdicao = useCallback((log: TransferenciaLog) => {
    setLogEditando(log);
    setObservacaoEditando(log.observacao || "");
    setModalEdicaoAberto(true);
  }, []);

  const fecharModalEdicao = useCallback(() => {
    setModalEdicaoAberto(false);
    setLogEditando(null);
    setObservacaoEditando("");
  }, []);

  const salvarEdicao = useCallback(async () => {
    if (!logEditando || !user?.username) return;
    
    setProcessandoEdicao(true);
    try {
      // Para saídas isoladas, filialDestino pode ser '—', usar filialOrigem
      // Para entradas isoladas, filialOrigem pode ser '—', usar filialDestino
      const filial = tipoOperacao === "saida" 
        ? (logEditando.filialDestino === '—' ? logEditando.filialOrigem : logEditando.filialOrigem)
        : (logEditando.filialOrigem === '—' || !logEditando.filialOrigem ? logEditando.filialDestino : logEditando.filialDestino);
      
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      headers["x-auth-username"] = user.username;

      const response = await fetch(
        `/api/saidas-entradas-produtos/log/${tipoOperacao}/${logEditando.romaneio}/${encodeURIComponent(filial)}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ observacao: observacaoEditando }),
        }
      );

      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        throw new Error(error.error || "Erro ao salvar edição");
      }

      mostrarNotificacao("Log atualizado com sucesso", "success");
      fecharModalEdicao();
      
      // Recarregar logs
      if (tipoOperacao === "saida") {
        const logs = await fetchLogSaidas();
        setLogSaidas(logs);
      } else {
        const logs = await fetchLogEntradas();
        setLogEntradas(logs);
      }
    } catch (error) {
      mostrarNotificacao(error instanceof Error ? error.message : "Erro ao salvar edição", "error");
    } finally {
      setProcessandoEdicao(false);
    }
  }, [logEditando, observacaoEditando, tipoOperacao, user?.username, mostrarNotificacao, fecharModalEdicao]);

  const removerLog = useCallback(async () => {
    if (!logEditando || !user?.username) return;
    
    if (!confirm(`Tem certeza que deseja remover completamente o log #${logEditando.romaneio}?\n\nEsta ação não pode ser desfeita. O estoque NÃO será revertido.`)) {
      return;
    }

    setProcessandoEdicao(true);
    try {
      // Para saídas isoladas, filialDestino pode ser '—', usar filialOrigem
      // Para entradas isoladas, filialOrigem pode ser '—', usar filialDestino
      const filial = tipoOperacao === "saida" 
        ? (logEditando.filialDestino === '—' ? logEditando.filialOrigem : logEditando.filialOrigem)
        : (logEditando.filialOrigem === '—' || !logEditando.filialOrigem ? logEditando.filialDestino : logEditando.filialDestino);
      
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      headers["x-auth-username"] = user.username;

      const response = await fetch(
        `/api/saidas-entradas-produtos/log/${tipoOperacao}/${logEditando.romaneio}/${encodeURIComponent(filial)}`,
        {
          method: "DELETE",
          headers,
        }
      );

      if (!response.ok) {
        const error = (await response.json()) as { error: string };
        throw new Error(error.error || "Erro ao remover log");
      }

      mostrarNotificacao("Log removido com sucesso", "success");
      fecharModalEdicao();
      
      // Recarregar logs
      if (tipoOperacao === "saida") {
        const logs = await fetchLogSaidas();
        setLogSaidas(logs);
      } else {
        const logs = await fetchLogEntradas();
        setLogEntradas(logs);
      }
    } catch (error) {
      mostrarNotificacao(error instanceof Error ? error.message : "Erro ao remover log", "error");
    } finally {
      setProcessandoEdicao(false);
    }
  }, [logEditando, tipoOperacao, user?.username, mostrarNotificacao, fecharModalEdicao]);

  const abrirConfirmacaoRegistro = useCallback(async () => {
    if (!filialSelecionada) {
      mostrarNotificacao("Selecione uma filial", "error");
      return;
    }
    // Peça bipada que ainda não voltou da consulta, ou que voltou recusada, não
    // pode ficar de fora sem o operador saber: o registro espera/exige decisão.
    if (bipagem.emVoo.length > 0) {
      mostrarNotificacao(
        `Aguarde: ${bipagem.emVoo.length} bipe(s) ainda em consulta. Registre quando o "consultando…" sumir.`,
        "error"
      );
      return;
    }
    if (bipagem.ocorrencias.length > 0) {
      mostrarNotificacao(
        `${bipagem.ocorrencias.length} bipe(s) NÃO entraram na lista. Resolva ou dispense cada um no painel vermelho antes de registrar.`,
        "error"
      );
      focarCampoBipe();
      return;
    }
    if (produtosSelecionados.length === 0) {
      mostrarNotificacao("Adicione pelo menos um produto", "error");
      return;
    }
    // Peça P/M/G sem tamanho não sai: o tamanho é obrigatório (o servidor também recusa).
    const pendencia = pendenciaTamanho(produtosSelecionados);
    if (pendencia) {
      mostrarNotificacao(pendencia, "error");
      return;
    }

    // SAÍDA: reconfere o saldo de TODA a lista agora. A lista (ou o rascunho
    // retomado) guarda o saldo da hora em que o item entrou; se outra saída,
    // venda ou defeito levou a peça, o Linx recusaria no meio da gravação.
    // Item sem saldo fica vermelho e o registro não sai até ser removido/ajustado.
    if (tipoOperacao === "saida" && !saidaPodeEstourarEstoque) {
      setConferindoSaldo(true);
      try {
        const saldos = await fetchSaldosAtuais(companyKey, filialSelecionada.codFilial, produtosSelecionados);
        const atualizados = produtosSelecionados.map((p) => {
          const s = saldos.get(`${p.produto}|${p.corProduto ?? ""}`);
          if (!s) return { ...p, estoque: 0 };
          const doTamanho = p.tamanho ? s.tamanhos.find((t) => t.ordinal === p.tamanho) : undefined;
          return {
            ...p,
            estoque: doTamanho ? doTamanho.estoque : s.disponivel,
            tamanhos: s.tamanhos.length > 0 ? s.tamanhos : p.tamanhos,
          };
        });
        // Mescla o saldo por linha em vez de trocar a lista: peça bipada enquanto a
        // conferência ia e voltava não está em `atualizados` e não pode sumir.
        const porChave = new Map(atualizados.map((p) => [chaveLinha(p), p]));
        setProdutosSelecionados((prev) => {
          const next = prev.map((p) => {
            const a = porChave.get(chaveLinha(p));
            return a ? { ...p, estoque: a.estoque, tamanhos: a.tamanhos } : p;
          });
          produtosSelecionadosRef.current = next;
          return next;
        });
        const sem = atualizados.filter((p) => p.quantidade > p.estoque);
        setSemSaldoChaves(new Set(sem.map(chaveLinha)));
        if (sem.length > 0) {
          const nomes = sem
            .slice(0, 5)
            .map((p) => `${p.descProduto || p.produto}${p.tamanhoLabel ? ` ${p.tamanhoLabel}` : ""} (saldo ${Math.max(0, p.estoque)})`)
            .join(", ");
          mostrarNotificacao(
            `SEM SALDO para ${sem.length} item(ns): ${nomes}${sem.length > 5 ? "…" : ""}. ` +
              `Eles estão em vermelho — use "Ajustar ao saldo" ou remova antes de registrar.`,
            "error"
          );
          return;
        }
      } catch {
        // Sem a conferência da tela, o servidor ainda confere antes de gravar.
      } finally {
        setConferindoSaldo(false);
      }
    }
    // Editando romaneio: não há destino nem trava de defeito a checar — os itens
    // vão para um romaneio que já existe (o cabeçalho não é reescrito).
    if (romaneioEditando) {
      setMostrarConfirmacaoRegistro(true);
      return;
    }
    if (travaDefeitoAtiva && defeitoDoDia) {
      mostrarNotificacao(defeitoDoDia.mensagem || "Já existe romaneio de DEFEITO hoje nesta filial.", "error");
      return;
    }
    if (tipoOperacao === "saida") {
      const tipoExigeDestino = isTransferenciaEntreLojas(tipoRomaneioSelecionado);
      if (tipoExigeDestino && !filialDestinoSaida) {
        mostrarNotificacao("Para 'TRANSFERENCIA ENTRE LOJAS' é obrigatório selecionar filial de destino", "error");
        return;
      }
      if (!tipoExigeDestino && filiaisDestinoVisiveis.length > 1 && !filialDestinoSaida && !isTipoSemDestino(tipoRomaneioSelecionado)) {
        mostrarNotificacao("Selecione uma filial de destino", "error");
        return;
      }
    }
    setMostrarConfirmacaoRegistro(true);
  }, [filialSelecionada, produtosSelecionados, pendenciaTamanho, tipoOperacao, saidaPodeEstourarEstoque, companyKey, filiaisDestinoVisiveis.length, filialDestinoSaida, tipoRomaneioSelecionado, travaDefeitoAtiva, defeitoDoDia, romaneioEditando, mostrarNotificacao, bipagem.emVoo.length, bipagem.ocorrencias.length, focarCampoBipe]);

  const confirmarRegistro = useCallback(() => {
    // Bipe lido com o modal aberto (o leitor não para): o botão já fica travado,
    // isto é a mesma regra para o Enter que escapar.
    if (bipagem.emVoo.length > 0 || bipagem.ocorrencias.length > 0) return;
    setMostrarConfirmacaoRegistro(false);
    // Romaneio aberto para edição: os itens entram NELE, sem gerar romaneio novo.
    if (romaneioEditando) {
      void salvarItensDaEdicao();
      return;
    }
    const obs = observacaoAtual;
    setObservacaoAtual("");
    executarLote(produtosSelecionados, obs);
  }, [executarLote, produtosSelecionados, observacaoAtual, setObservacaoAtual, romaneioEditando, salvarItensDaEdicao, bipagem.emVoo.length, bipagem.ocorrencias.length]);

  // Limpar produtos selecionados somente quando mudar a filial DE FATO (por codFilial real).
  // Comparar por codFilial e não por referência: o refresh em foco/visibilidade recria os
  // objetos Filial (mesma loja, nova referência) e não deve apagar a lista do usuário.
  const filialCodRef = useRef<string | null>(filialSelecionada?.codFilial ?? null);
  useEffect(() => {
    const cod = filialSelecionada?.codFilial ?? null;
    if (filialCodRef.current !== cod) {
      filialCodRef.current = cod;
      setProdutosSelecionados([]);
    }
  }, [filialSelecionada]);

  // ── RASCUNHOS ──────────────────────────────────────────────────────────────
  // A lista da tela É o rascunho: cada alteração é gravada no Neon, então uma
  // queda no meio da conferência não custa o trabalho já bipado. O rascunho some
  // quando o romaneio é registrado.

  const carregarRascunhos = useCallback(async () => {
    setLoadingRascunhos(true);
    try {
      setRascunhos(await fetchRascunhos(companyKey));
    } catch {
      // Aba de rascunhos é auxiliar: falha de leitura não pode travar a operação.
    } finally {
      setLoadingRascunhos(false);
    }
  }, [companyKey]);

  useEffect(() => {
    void carregarRascunhos();
  }, [carregarRascunhos]);

  /**
   * Escopo do rascunho ativo: um por empresa × usuário × tipo × filial × romaneio
   * em edição. Editar o romaneio #X e montar um romaneio novo na MESMA filial são
   * dois trabalhos independentes — cada um com o seu rascunho.
   */
  const romaneioEmEdicao = romaneioEditando?.romaneio ?? null;
  const escopoRascunho =
    user?.username && filialSelecionada
      ? `${companyKey}|${user.username}|${tipoOperacao}|${filialSelecionada.codFilial}|${romaneioEmEdicao ?? ""}`
      : null;

  useEffect(() => {
    escopoBipeRef.current = escopoRascunho;
  }, [escopoRascunho]);

  // Diário da bipagem segue o escopo da lista: cada filial × operação × romaneio
  // tem o seu, e ele volta depois de um F5 (ocorrências abertas inclusive).
  useEffect(() => {
    setBipagem(carregarBipagem(escopoRascunho));
  }, [escopoRascunho]);

  useEffect(() => {
    if (bipagem.escopo === escopoRascunho) salvarBipagem(bipagem);
  }, [bipagem, escopoRascunho]);

  // Restaura o rascunho do escopo atual (carga da página, troca de filial ou de tipo).
  useEffect(() => {
    rascunhoPayloadRef.current = "";
    rascunhoSalvoRef.current = false;
    setRascunhoStatus("idle");
    setRascunhoRestauradoEm(null);

    if (!escopoRascunho || !user?.username || !filialSelecionada) return;

    const username = user.username;
    const filialCod = filialSelecionada.codFilial;
    let cancelado = false;
    setHidratandoRascunho(true);

    (async () => {
      try {
        const lista = await fetchRascunhos(companyKey);
        if (cancelado) return;
        setRascunhos(lista);

        const meu = lista.find(
          (r) =>
            r.username.toLowerCase() === username.toLowerCase() &&
            r.tipoOperacao === tipoOperacao &&
            r.filial.trim().toUpperCase() === filialCod.trim().toUpperCase() &&
            // Rascunho de edição só volta para a MESMA entrada aberta; rascunho de
            // romaneio novo só volta quando não há romaneio aberto.
            (r.romaneioEdicao ?? null) === romaneioEmEdicao
        );
        if (!meu || meu.itens.length === 0) return;

        // Só restaura sobre lista vazia: se o operador já começou a bipar
        // enquanto a consulta ia e voltava, o que ele fez agora vale mais.
        let aplicou = false;
        setProdutosSelecionados((prev) => {
          if (prev.length > 0) return prev;
          aplicou = true;
          return meu.itens.map((item) => ({
            produto: item.produto,
            descProduto: item.descProduto,
            codigoBarra: item.codigoBarra,
            corProduto: item.corProduto,
            descCor: item.descCor,
            filial: filialCod,
            nomeFilial: filialOptionLabel(filialSelecionada),
            estoque: item.estoque,
            quantidade: item.quantidade,
            // Sem isto o F5 devolvia a peça P/M/G sem o tamanho bipado.
            tamanho: item.tamanho ?? null,
            tamanhoLabel: item.tamanhoLabel ?? null,
          }));
        });

        if (!aplicou) return;
        rascunhoSalvoRef.current = true;
        setRascunhoRestauradoEm(meu.updatedAt);
        if (meu.observacao) setObservacaoAtual(meu.observacao);
      } catch {
        // Sem rascunho recuperado: a tela segue com a lista vazia.
      } finally {
        if (!cancelado) setHidratandoRascunho(false);
      }
    })();

    return () => {
      cancelado = true;
      setHidratandoRascunho(false);
    };
    // `filialSelecionada`/`filialOptionLabel` mudam de referência no refresh em foco;
    // o escopo (string) é o que de fato define quando recarregar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escopoRascunho, companyKey, tipoOperacao, user?.username, romaneioEmEdicao]);

  // Autosave: grava o rascunho pouco depois de cada mudança (bipe, quantidade, obs).
  useEffect(() => {
    if (!user?.username || !filialSelecionada) return;
    if (hidratandoRascunho) return;
    // Lista vazia e nada gravado ainda = estado inicial. Não pode virar um PUT
    // vazio, que apagaria o rascunho antes da restauração terminar.
    if (produtosSelecionados.length === 0 && !rascunhoSalvoRef.current) return;

    const username = user.username;
    const payload = JSON.stringify({
      company: companyKey,
      tipoOperacao,
      filial: filialSelecionada.codFilial,
      filialLabel: filialOptionLabel(filialSelecionada),
      filialDestino: filialDestinoSaida?.codFilial ?? null,
      filialDestinoLabel: filialDestinoSaida ? filialOptionLabel(filialDestinoSaida) : null,
      tipoRomaneio: tipoRomaneioSelecionado,
      observacao: observacaoAtual,
      // Amarra o rascunho à entrada aberta: a conferiência da edição sobrevive a
      // queda de energia/internet igual à de um romaneio novo.
      romaneioEdicao: romaneioEmEdicao,
      itens: produtosSelecionados.map((p) => ({
        produto: p.produto,
        descProduto: p.descProduto,
        codigoBarra: p.codigoBarra,
        corProduto: p.corProduto,
        descCor: p.descCor,
        quantidade: p.quantidade,
        estoque: p.estoque,
        tamanho: p.tamanho ?? null,
        tamanhoLabel: p.tamanhoLabel ?? null,
      })),
    });

    if (payload === rascunhoPayloadRef.current) return;

    const timeoutId = setTimeout(async () => {
      setRascunhoStatus("salvando");
      try {
        await salvarRascunhoApi(payload, username);
        rascunhoPayloadRef.current = payload;
        rascunhoSalvoRef.current = produtosSelecionados.length > 0;
        setRascunhoStatus("salvo");
        void carregarRascunhos();
      } catch {
        // Não marca como gravado: a próxima alteração tenta de novo.
        setRascunhoStatus("erro");
      }
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [
    produtosSelecionados,
    observacaoAtual,
    tipoRomaneioSelecionado,
    filialDestinoSaida,
    filialSelecionada,
    filialOptionLabel,
    tipoOperacao,
    companyKey,
    user?.username,
    hidratandoRascunho,
    carregarRascunhos,
    romaneioEmEdicao,
  ]);

  /**
   * Assume um rascunho: traz tipo, filial, destino e itens para a tela.
   * Rascunho de outro usuário é transferido (o original é apagado) — a lista é da
   * LOJA, e quem entra no turno precisa continuar a conferência, não duplicá-la.
   */
  const retomarRascunho = useCallback(async (rascunho: RascunhoResumo) => {
    const filial = filiaisDisponiveis.find((f) => matchesFilialOption(f, rascunho.filial));
    if (!filial) {
      mostrarNotificacao(`Você não opera a filial ${rascunho.filialLabel}`, "error");
      return;
    }

    // Neutraliza os efeitos que limpam a lista ao detectar troca de filial/tipo:
    // aqui a troca é intencional e já vem com os itens do rascunho.
    filialCodRef.current = filial.codFilial;
    tipoRomaneioRef.current = rascunho.tipoRomaneio || tipoRomaneioSelecionado;

    const destino = rascunho.filialDestino
      ? filiaisDestinoDisponiveis.find((f) => matchesFilialOption(f, rascunho.filialDestino)) ?? null
      : null;

    if (rascunho.romaneioEdicao) {
      // Rascunho de EDIÇÃO: volta reabrindo o mesmo romaneio, não montando um
      // romaneio novo. Se o romaneio deixou de aceitar itens, a própria
      // abrirEdicaoRomaneio avisa e nada é sobrescrito na tela.
      const aberto = await abrirEdicaoRomaneio(
        rascunho.tipoOperacao,
        rascunho.romaneioEdicao,
        rascunho.filial
      );
      if (!aberto) return;
    } else {
      // Retomar rascunho comum é montar um romaneio NOVO: sai da edição.
      setRomaneioEditando(null);
      setTipoOperacao(rascunho.tipoOperacao);
      setFilialSelecionada(filial);
      setFilialDestinoSaida(destino);
      if (rascunho.tipoRomaneio) setTipoRomaneioSelecionado(rascunho.tipoRomaneio);
      if (rascunho.tipoOperacao === "saida") setObservacaoSaida(rascunho.observacao);
      else setObservacaoEntrada(rascunho.observacao);
    }

    const itens = rascunho.itens.map((item) => ({
      produto: item.produto,
      descProduto: item.descProduto,
      codigoBarra: item.codigoBarra,
      corProduto: item.corProduto,
      descCor: item.descCor,
      filial: filial.codFilial,
      nomeFilial: filialOptionLabel(filial),
      estoque: item.estoque,
      quantidade: item.quantidade,
      // A grade (e o saldo de cada tamanho) é reconsultada ao entrar na lista.
      tamanho: item.tamanho ?? null,
      tamanhoLabel: item.tamanhoLabel ?? null,
    }));
    produtosSelecionadosRef.current = itens;
    setProdutosSelecionados(itens);

    setModalAberto(false);
    setAbaLateral("historico");

    const meu = rascunho.username.toLowerCase() === (user?.username || "").toLowerCase();

    /**
     * Grava no MEU escopo antes de apagar o original. Se a ordem fosse inversa,
     * entre o DELETE e a próxima gravação a conferência existiria só na memória
     * do browser — exatamente o buraco que o rascunho existe para fechar.
     */
    if (user?.username) {
      const payload = JSON.stringify({
        company: companyKey,
        tipoOperacao: rascunho.tipoOperacao,
        filial: filial.codFilial,
        filialLabel: filialOptionLabel(filial),
        filialDestino: destino?.codFilial ?? null,
        filialDestinoLabel: destino ? filialOptionLabel(destino) : null,
        tipoRomaneio: rascunho.tipoRomaneio,
        observacao: rascunho.observacao,
        romaneioEdicao: rascunho.romaneioEdicao,
        itens: rascunho.itens.map((item) => ({
          produto: item.produto,
          descProduto: item.descProduto,
          codigoBarra: item.codigoBarra,
          corProduto: item.corProduto,
          descCor: item.descCor,
          quantidade: item.quantidade,
          estoque: item.estoque,
          tamanho: item.tamanho ?? null,
          tamanhoLabel: item.tamanhoLabel ?? null,
        })),
      });
      try {
        await salvarRascunhoApi(payload, user.username);
        rascunhoPayloadRef.current = payload;
        rascunhoSalvoRef.current = true;
        setRascunhoStatus("salvo");
      } catch {
        // Não gravou: o autosave tenta de novo na próxima alteração. Nesse caso
        // NÃO apagamos o original — ele continua sendo a única cópia segura.
        setRascunhoStatus("erro");
        mostrarNotificacao("Rascunho retomado, mas não foi possível salvá-lo ainda", "error");
        void carregarRascunhos();
        return;
      }
    }

    if (!meu) {
      try {
        await removerRascunhoApi({ id: rascunho.id }, user?.username);
      } catch {
        // Se não apagar, fica uma cópia duplicada visível na aba — perde-se a
        // limpeza, não o trabalho.
      }
    }

    void carregarRascunhos();
    mostrarNotificacao(
      `Rascunho retomado · ${rascunho.itens.length} produto(s)${meu ? "" : ` de ${rascunho.username}`}`
    );
  }, [
    companyKey,
    filiaisDisponiveis,
    filiaisDestinoDisponiveis,
    filialOptionLabel,
    tipoRomaneioSelecionado,
    user?.username,
    abrirEdicaoRomaneio,
    mostrarNotificacao,
    carregarRascunhos,
  ]);

  const descartarRascunho = useCallback(async (rascunho: RascunhoResumo) => {
    if (!confirm(`Descartar o rascunho de ${rascunho.filialLabel} com ${rascunho.itens.length} produto(s)?`)) {
      return;
    }
    try {
      await removerRascunhoApi({ id: rascunho.id }, user?.username);
      // É o rascunho da tela? Então a lista atual também morre com ele.
      const ehOAtual =
        !!filialSelecionada &&
        rascunho.tipoOperacao === tipoOperacao &&
        rascunho.filial.trim().toUpperCase() === filialSelecionada.codFilial.trim().toUpperCase() &&
        rascunho.username.toLowerCase() === (user?.username || "").toLowerCase() &&
        // Editando o romaneio #X, o rascunho comum da mesma filial NÃO é o da tela.
        (rascunho.romaneioEdicao ?? null) === (romaneioEditando?.romaneio ?? null);
      if (ehOAtual) {
        rascunhoSalvoRef.current = false;
        rascunhoPayloadRef.current = "";
        setRascunhoRestauradoEm(null);
        setRascunhoStatus("idle");
        produtosSelecionadosRef.current = [];
        setProdutosSelecionados([]);
        zerarBipagem();
      }
      void carregarRascunhos();
      mostrarNotificacao("Rascunho descartado");
    } catch {
      mostrarNotificacao("Erro ao descartar o rascunho", "error");
    }
  }, [user?.username, filialSelecionada, tipoOperacao, romaneioEditando, carregarRascunhos, mostrarNotificacao, zerarBipagem]);

  const totalItens = produtosSelecionados.reduce((sum, p) => sum + p.quantidade, 0);
  const totalProdutos = produtosSelecionados.length;

  const logsAtivos = tipoOperacao === "saida" ? logSaidas : logEntradas;
  const loadingLogsAtivos = tipoOperacao === "saida" ? loadingLogSaidas : loadingLogEntradas;

  const logsFiltrados = (() => {
    return logsAtivos.filter((log) => {
      if (tipoOperacao === "saida") return matchFilial(log.filialOrigem, filialSelecionada);
      return matchFilial(log.filialDestino, filialSelecionada);
    });
  })();

  /**
   * Rascunhos pendentes das filiais que ESTE usuário opera. Mostrar os de outras
   * lojas só encheria a aba com trabalho que ele não pode retomar.
   */
  const rascunhosVisiveis = rascunhos.filter(
    (r) =>
      r.itens.length > 0 &&
      (filiaisDisponiveis.length === 0 ||
        filiaisDisponiveis.some((f) => matchesFilialOption(f, r.filial)))
  );

  if (!permissoesCarregadas) {
    return (
      <div className={styles.wrapper}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center", 
          minHeight: "50vh",
          color: "#6b7280"
        }}>
          Carregando permissões...
        </div>
      </div>
    );
  }

  const isBusy = processandoOperacao || conferindoSaldo;
  const historicoCompletoHref = `/${companyKey}/saidas-entradas-produtos/historico?tipo=${tipoOperacao}&filial=${encodeURIComponent(
    filialSelecionada?.codFilial || ""
  )}`;

  return (
    <div className={styles.wrapper}>
      {/* Top bar: toggle + título */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <div className={styles.segControl} role="tablist" aria-label="Tipo de operação">
            <button
              type="button"
              className={`${styles.segBtn} ${tipoOperacao === "saida" ? styles.segBtnSaidaActive : ""}`}
              onClick={() => trocarTipoOperacao("saida")}
              aria-selected={tipoOperacao === "saida"}
            >
              <span className={styles.segBtnIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M7 17 17 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M10 7h7v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              Saída
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${tipoOperacao === "entrada" ? styles.segBtnEntradaActive : ""}`}
              onClick={() => trocarTipoOperacao("entrada")}
              aria-selected={tipoOperacao === "entrada"}
            >
              <span className={styles.segBtnIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M7 7 17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M10 17h7v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              Entrada
            </button>
          </div>

          <div className={styles.headerIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2 20 6.5v11L12 22l-8-4.5v-11L12 2Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M12 22V12" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M20 6.5 12 12 4 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </div>

          <div>
            <h1 className={styles.title}>{tipoOperacao === "saida" ? "Registrar Saída" : "Registrar Entrada"}</h1>
            <p className={styles.subtitle}>
              {tipoOperacao === "saida" ? "Saída de produtos do estoque" : "Entrada de produtos do estoque"}
            </p>
          </div>
        </div>
      </div>

      {/* Config bar horizontal: filial | tipo romaneio | responsável */}
      <div className={styles.configGrid}>
        {/* Filial (alinha com Histórico) */}
        <div className={styles.configCard}>
          <div className={styles.configIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M6 20V7l6-3 6 3v13" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M10 20v-6h4v6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          <div className={styles.configBody}>
          <span className={styles.configBarLabel}>
            {tipoOperacao === "saida" ? "Filial de Saída" : "Filial de Entrada"}
          </span>
          {/* Romaneio aberto para edição fica preso à filial dele: trocar de loja aqui
              mandaria a peça para o estoque errado. */}
          {(filiaisDisponiveis.length === 1 || romaneioEditando) && filialSelecionada ? (
            <span className={styles.configBarText}>{filialOptionLabel(filialSelecionada)}</span>
          ) : (
            <div className={styles.selectWrap}>
              <select
                className={styles.configBarSelect}
                value={filialSelecionada?.codFilial || ""}
                onChange={(e) => {
                  const filial = filiaisDisponiveis.find(f => f.codFilial === e.target.value);
                  setFilialSelecionada(filial || null);
                  setProdutosSelecionados([]);
                }}
              >
                <option value="">Selecione...</option>
                {filiaisDisponiveis.map(f => (
                  <option key={f.codFilial} value={f.codFilial}>{filialOptionLabel(f)}</option>
                ))}
              </select>
              <span className={styles.selectChevron} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          )}
          </div>
        </div>

        {/* Tipo Romaneio + Responsável (alinha com Produtos) */}
        <div className={styles.configCardWide}>
          {/* Filial Destino (apenas saída, e nunca na edição: acrescentar item não
              reescreve o cabeçalho, então o destino continua o do romaneio aberto) */}
          {tipoOperacao === "saida" && !romaneioEditando && (
            <div className={styles.configSegment}>
              <div className={styles.configIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M6 20V7l6-3 6 3v13" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M10 20v-6h4v6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M17 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className={styles.configBody}>
                <span className={styles.configBarLabel}>Filial Destino</span>
                {isSaidaMkt ? (
                  <span className={styles.configBarText} style={{ opacity: 0.45 }}>— Não se aplica —</span>
                ) : filiaisDestinoVisiveis.length === 1 ? (
                  <span className={styles.configBarText}>{filialOptionLabel(filiaisDestinoVisiveis[0])}</span>
                ) : (
                  <div className={styles.selectWrap}>
                    <select
                      className={styles.configBarSelect}
                      value={filialDestinoSaida?.codFilial || ""}
                      onChange={(e) => {
                        const filial = filiaisDestinoVisiveis.find(f => f.codFilial === e.target.value);
                        setFilialDestinoSaida(filial || null);
                      }}
                    >
                      <option value="" disabled>— Selecionar filial —</option>
                      {filiaisDestinoVisiveis.map(f => (
                        <option key={f.codFilial} value={f.codFilial}>{filialOptionLabel(f)}</option>
                      ))}
                    </select>
                    <span className={styles.selectChevron} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tipo Romaneio */}
          <div className={styles.configSegment}>
            <div className={styles.configIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M5 4h14v16H5V4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
            <div className={styles.configBody}>
              <span className={styles.configBarLabel}>Tipo de Romaneio</span>
              {/* Acrescentar item não reescreve o cabeçalho: o tipo continua o do
                  romaneio aberto, então o seletor sai de cena para não enganar. */}
              {romaneioEditando ? (
                <span className={styles.configBarText}>
                  Romaneio #{romaneioEditando.romaneio} (tipo não muda)
                </span>
              ) : tiposRomaneioExibidos.length === 1 || permissoes?.tipoRomaneioFixo ? (
                <span className={styles.configBarText}>{tipoRomaneioSelecionado}</span>
              ) : (
                <div className={styles.selectWrap}>
                  <select
                    className={styles.configBarSelect}
                    value={tipoRomaneioSelecionado}
                    onChange={(e) => setTipoRomaneioSelecionado(e.target.value)}
                  >
                    {[...tiposRomaneioExibidos].sort((a, b) => {
                      const ordem = (s: string) => {
                        const u = s.toUpperCase();
                        if (isEntradaNerd && normalizarTipoRomaneio(u) === 'NERD PRODUCAO') return -1;
                        if (u === 'TRANSFERENCIA ENTRE LOJAS') return 0;
                        if (u === 'DEFEITO') return 1;
                        return 2;
                      };
                      return ordem(a) - ordem(b);
                    }).map(tipo => (
                      <option key={tipo} value={tipo}>{tipo}</option>
                    ))}
                  </select>
                  <span className={styles.selectChevron} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Responsável removido do layout — implícito pelo usuário logado; valor ainda é registrado no romaneio */}
        </div>
      </div>

      {/* Layout: logs | operação */}
      <div className={styles.layout}>

        {/* Coluna de logs (esquerda) */}
        <div className={styles.logColumn}>
          <div className={styles.card}>
            {/* Abas: histórico (já registrado) × rascunhos (conferência em aberto) */}
            <div className={styles.abasLaterais} role="tablist" aria-label="Painel lateral">
              <button
                type="button"
                role="tab"
                aria-selected={abaLateral === "historico"}
                className={`${styles.abaLateralBtn} ${abaLateral === "historico" ? styles.abaLateralBtnAtiva : ""}`}
                onClick={() => setAbaLateral("historico")}
              >
                Histórico
                {logsFiltrados.length > 0 && (
                  <span className={styles.abaLateralContador}>{logsFiltrados.length}</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={abaLateral === "rascunhos"}
                className={`${styles.abaLateralBtn} ${abaLateral === "rascunhos" ? styles.abaLateralBtnAtiva : ""}`}
                onClick={() => setAbaLateral("rascunhos")}
              >
                Rascunhos
                {rascunhosVisiveis.length > 0 && (
                  <span className={`${styles.abaLateralContador} ${styles.abaLateralContadorAlerta}`}>
                    {rascunhosVisiveis.length}
                  </span>
                )}
              </button>
            </div>

            {abaLateral === "rascunhos" ? (
              <>
                <div className={styles.historicoActionRow}>
                  <span className={styles.rascunhosAjuda}>
                    Listas em aberto — somem quando a saída/entrada é registrada.
                  </span>
                </div>

                {loadingRascunhos && rascunhosVisiveis.length === 0 ? (
                  <div className={styles.emptyLog}>Carregando...</div>
                ) : rascunhosVisiveis.length === 0 ? (
                  <div className={styles.emptyLog}>
                    <div className={styles.emptyLogIcon}>📝</div>
                    <div>Nenhum rascunho pendente</div>
                  </div>
                ) : (
                  <div className={styles.logScrollContainer}>
                    <div className={styles.logList}>
                      {rascunhosVisiveis.map((rascunho) => {
                        const totalPecas = rascunho.itens.reduce((sum, i) => sum + i.quantidade, 0);
                        const ehAtual =
                          !!filialSelecionada &&
                          rascunho.tipoOperacao === tipoOperacao &&
                          rascunho.filial.trim().toUpperCase() ===
                            filialSelecionada.codFilial.trim().toUpperCase() &&
                          rascunho.username.toLowerCase() === (user?.username || "").toLowerCase() &&
                          (rascunho.romaneioEdicao ?? null) === (romaneioEditando?.romaneio ?? null);
                        return (
                          <div key={rascunho.id} className={styles.rascunhoItem}>
                            <div className={styles.rascunhoTopo}>
                              <span
                                className={`${styles.rascunhoTipoPill} ${
                                  rascunho.tipoOperacao === "saida"
                                    ? styles.rascunhoTipoPillSaida
                                    : styles.rascunhoTipoPillEntrada
                                }`}
                              >
                                {rascunho.tipoOperacao === "saida" ? "Saída" : "Entrada"}
                              </span>
                              {/* Rascunho de edição é outro trabalho: precisa se distinguir
                                  do rascunho de romaneio novo da mesma filial. */}
                              {rascunho.romaneioEdicao && (
                                <span className={styles.rascunhoEdicaoPill}>
                                  edição #{rascunho.romaneioEdicao}
                                </span>
                              )}
                              <span className={styles.rascunhoFilial}>
                                {filialLabel(rascunho.filialLabel || rascunho.filial)}
                              </span>
                              {ehAtual && <span className={styles.rascunhoAtualPill}>na tela</span>}
                            </div>
                            <div className={styles.rascunhoMeta}>
                              {rascunho.itens.length} prod · {totalPecas}{" "}
                              {totalPecas === 1 ? "item" : "itens"}
                              {rascunho.filialDestinoLabel
                                ? ` · → ${filialLabel(rascunho.filialDestinoLabel)}`
                                : ""}
                            </div>
                            <div className={styles.rascunhoMeta}>
                              {rascunho.username} · {formatLogDateTime(rascunho.updatedAt)}
                            </div>
                            <div className={styles.rascunhoAcoes}>
                              <button
                                type="button"
                                className={styles.rascunhoRetomarBtn}
                                onClick={() => void retomarRascunho(rascunho)}
                                disabled={ehAtual || isBusy}
                                title={ehAtual ? "Este rascunho já é a lista da tela" : "Trazer para a tela"}
                              >
                                {ehAtual ? "Em edição" : "Retomar"}
                              </button>
                              <button
                                type="button"
                                className={styles.rascunhoDescartarBtn}
                                onClick={() => void descartarRascunho(rascunho)}
                                disabled={isBusy}
                              >
                                Descartar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
            <>
            <div className={styles.historicoActionRow}>
              <Link href={historicoCompletoHref} className={styles.historicoActionLink}>
                Ver histórico completo →
              </Link>
            </div>

            {loadingLogsAtivos ? (
              <div className={styles.emptyLog}>Carregando...</div>
            ) : logsFiltrados.length === 0 ? (
              <div className={styles.emptyLog}>
                <div className={styles.emptyLogIcon}>📋</div>
                <div>Nenhum registro ainda</div>
              </div>
            ) : (
              <div className={styles.logScrollContainer}>
                <div className={styles.logList}>
                  {logsFiltrados.map((log, index) => {
                    const detailUrl = `/${companyKey}/romaneios/${encodeURIComponent(log.romaneio)}?tipo=${tipoOperacao}&filialOrigem=${encodeURIComponent(log.filialOrigem)}&filialDestino=${encodeURIComponent(log.filialDestino)}&dataEmissao=${encodeURIComponent(log.dataEmissao)}&responsavel=${encodeURIComponent(log.responsavel || "")}&tipoRomaneio=`;
                    return (
                      <div key={index} className={styles.logItemWrapper}>
                        <div className={styles.logItem}>
                          <div className={styles.logMain}>
                            <div className={styles.logTopLine}>
                              <span className={styles.logRomaneio}>#{log.romaneio}</span>
                              <span className={styles.logCount}>
                                {log.qtdProdutos} prod · {log.qtdItens} {log.qtdItens === 1 ? "item" : "itens"}
                              </span>
                              {/* Reabrir o romaneio e acrescentar itens (igual ao Linx) — só
                                  logistica+. Na saída a filial é a de ORIGEM; na entrada, a que
                                  recebeu. */}
                              {podeEditarRomaneio && (
                                <button
                                  className={`${styles.logAddItensBtn} ${
                                    tipoOperacao === "saida" ? styles.logAddItensBtnSaida : ""
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void abrirEdicaoRomaneio(
                                      tipoOperacao,
                                      log.romaneio,
                                      tipoOperacao === "saida" ? log.filialOrigem : log.filialDestino
                                    );
                                  }}
                                  disabled={isBusy || carregandoEdicaoRomaneio}
                                  title={`Editar romaneio: adicionar mais itens a esta ${tipoOperacao === "saida" ? "saída" : "entrada"}`}
                                >
                                  {romaneioEditando?.romaneio === log.romaneio ? "editando" : "+ itens"}
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  className={styles.logEditBtn}
                                  onClick={(e) => { e.stopPropagation(); abrirModalEdicao(log); }}
                                  title="Editar"
                                >✏️</button>
                              )}
                            </div>
                            <div className={styles.logRoute}>
                              <span className={styles.logRouteText}>
                                {formatLogRoute(log.filialOrigem, log.filialDestino, companyConfig)}
                              </span>
                              <Link
                                href={detailUrl}
                                className={styles.logOpenLink}
                                title="Abrir romaneio detalhado"
                                aria-label={`Abrir romaneio #${log.romaneio}`}
                              >
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="m10 4 8-1m0 0 1 8m-1-8-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </Link>
                            </div>
                            {log.responsavel && (
                              <div className={styles.logResponsavel}>{log.responsavel}</div>
                            )}
                          </div>
                          <div className={styles.logRight}>
                            <span className={styles.logStatusPill}>
                              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              {log.status}
                            </span>
                            <span className={styles.logDate}>
                              {formatLogDate(log.dataEmissao)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </>
            )}
          </div>
        </div>

        {/* Coluna principal — operação (direita) */}
        <div className={styles.mainColumn}>
          <div className={styles.card}>
            {/* Produtos */}
            <div
              className={`${styles.produtosArea} ${produtosSelecionados.length === 0 ? styles.produtosAreaEmpty : styles.produtosAreaHasItems}`}
            >
              <div className={styles.cardHeader}>
                <span className={styles.cardLabelWithIcon}>
                  <span className={styles.cardHeaderIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 2 20 6.5v11L12 22l-8-4.5v-11L12 2Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                      <path d="M20 6.5 12 12 4 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      <path d="M12 12v10" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {romaneioEditando
                    ? `Itens a acrescentar ao romaneio #${romaneioEditando.romaneio}`
                    : `Produtos para ${tipoOperacao === "saida" ? "Saída" : "Entrada"}`}
                </span>
                <div className={styles.cardHeaderRight}>
                  {/* Estado do autosave: o operador precisa VER que o que ele bipou já está salvo. */}
                  {rascunhoStatus !== "idle" && (
                    <span
                      className={`${styles.rascunhoStatus} ${
                        rascunhoStatus === "erro" ? styles.rascunhoStatusErro : ""
                      }`}
                      title={
                        rascunhoStatus === "erro"
                          ? "Não foi possível salvar o rascunho — a próxima alteração tenta de novo."
                          : "A lista é salva automaticamente e sobrevive a queda/fechamento da aba."
                      }
                    >
                      {rascunhoStatus === "salvando"
                        ? "salvando rascunho…"
                        : rascunhoStatus === "salvo"
                          ? "rascunho salvo"
                          : "rascunho não salvo"}
                    </span>
                  )}
                  {totalProdutos > 0 && (
                    <span className={`${styles.badge} ${tipoOperacao === "saida" ? styles.badgeSaida : styles.badgeEntrada}`}>
                      {totalProdutos} prod · {totalItens} itens
                    </span>
                  )}
                </div>
              </div>

              {/* EDIÇÃO DE ROMANEIO: deixa evidente que a tela não está montando um
                  romaneio novo — o que for bipado agora entra no romaneio aberto. */}
              {romaneioEditando && (
                <div
                  className={`${styles.edicaoRomaneioBanner} ${
                    romaneioEditando.tipo === "saida"
                      ? styles.edicaoRomaneioBannerSaida
                      : styles.edicaoRomaneioBannerEntrada
                  }`}
                >
                  <div className={styles.edicaoRomaneioBannerTexto}>
                    <strong>
                      Editando a {romaneioEditando.tipo === "saida" ? "saída" : "entrada"} #
                      {romaneioEditando.romaneio}
                    </strong>
                    <span>
                      {filialLabel(romaneioEditando.filial)} · {romaneioEditando.itensExistentes.length} produto(s)
                      já {romaneioEditando.tipo === "saida" ? "lançados" : "entrados"}. O que você adicionar aqui
                      será somado a este romaneio
                      {romaneioEditando.tipo === "saida" ? " e sai do estoque da filial na hora" : ""}.
                    </span>
                    {/* Conferência já iniciada no destino: avisa, mas não trava. */}
                    {romaneioEditando.aviso && (
                      <span className={styles.edicaoRomaneioAviso}>{romaneioEditando.aviso}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.edicaoRomaneioCancelarBtn}
                    onClick={cancelarEdicaoRomaneio}
                    disabled={isBusy}
                  >
                    Cancelar edição
                  </button>
                </div>
              )}

              {/* ── BIPAGEM ── caminho rápido: leitor manda código + Enter e a peça
                  entra na lista, sem abrir modal (igual ao campo do próprio Linx). */}
              <div
                className={`${styles.bipeArea} ${tipoOperacao === "saida" ? styles.bipeAreaSaida : styles.bipeAreaEntrada} ${bipagem.ocorrencias.length > 0 ? styles.bipeAreaAlerta : ""}`}
                onClick={focarCampoBipe}
              >
                <div className={styles.bipeRow}>
                  <span className={styles.bipeIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M3 5v14M6.5 5v14M10 5v14M13.5 5v10M17 5v14M20.5 5v14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    ref={bipeInputRef}
                    type="text"
                    className={styles.bipeInput}
                    value={codigoBipado}
                    onChange={(e) => setCodigoBipado(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter, ou Tab no leitor configurado com sufixo Tab.
                      if (e.key === "Enter" || (e.key === "Tab" && e.currentTarget.value.trim())) {
                        e.preventDefault();
                        submeterBipe(e.currentTarget.value);
                      }
                    }}
                    placeholder={
                      filialSelecionada
                        ? "Bipe o código de barras (ou digite e tecle Enter)"
                        : "Selecione a filial para começar a bipar"
                    }
                    // Não trava durante a gravação: campo desabilitado engole a leitura
                    // calado. O que for bipado agora fica para depois da gravação.
                    disabled={!filialSelecionada}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Código de barras"
                  />
                  {bipesEmVoo > 0 && <span className={styles.bipeLoading}>consultando {bipesEmVoo}…</span>}
                  <button
                    type="button"
                    className={styles.bipeAddBtn}
                    onClick={() => submeterBipe()}
                    disabled={!codigoBipado.trim() || !filialSelecionada}
                  >
                    Adicionar
                  </button>
                  <button
                    type="button"
                    className={styles.bipeSomBtn}
                    onClick={(e) => { e.stopPropagation(); alternarSomBipe(); }}
                    title={somBipeLigado ? "Desligar o som do bipe" : "Ligar o som do bipe"}
                    aria-pressed={somBipeLigado}
                  >
                    {somBipeLigado ? "🔊" : "🔇"}
                  </button>
                </div>

                {/* Confirmação do último bipe: o operador está olhando a peça, não a lista. */}
                {ultimoBipe && (
                  <div className={`${styles.bipeFeedback} ${ultimoBipe.ok ? styles.bipeFeedbackOk : styles.bipeFeedbackErro}`}>
                    <span className={styles.bipeFeedbackIcon} aria-hidden="true">{ultimoBipe.ok ? "✓" : "!"}</span>
                    <span className={styles.bipeFeedbackTexto}>
                      <strong>{ultimoBipe.titulo}</strong>
                      <span>{ultimoBipe.detalhe}</span>
                    </span>
                  </div>
                )}

                {/* Contagem da bipagem: o que foi LIDO tem que bater com o que ENTROU. */}
                {(bipagem.lidos > 0 || bipagem.ocorrencias.length > 0) && (
                  <div className={styles.bipeContador}>
                    <span>Lidos <strong>{bipagem.lidos}</strong></span>
                    <span className={styles.bipeContadorOk}>Entraram <strong>{bipagem.aceitos}</strong></span>
                    {bipagem.ocorrencias.length > 0 && (
                      <span className={styles.bipeContadorAlerta}>
                        Não entraram <strong>{bipagem.ocorrencias.length}</strong>
                      </span>
                    )}
                    {bipagem.dispensadas.length > 0 && (
                      <span>Dispensados <strong>{bipagem.dispensadas.length}</strong></span>
                    )}
                    {bipesEmVoo > 0 && <span>Consultando <strong>{bipesEmVoo}</strong></span>}
                  </div>
                )}

                {/* Bipes que NÃO entraram: ficam aqui até o operador resolver ou dispensar.
                    O feedback de cima é do último bipe e some com o próximo — este não. */}
                {bipagem.ocorrencias.length > 0 && (
                  <div className={styles.bipeOcorrencias} role="alert" onClick={(e) => e.stopPropagation()}>
                    <div className={styles.bipeOcorrenciasTopo}>
                      <div className={styles.bipeOcorrenciasTitulo}>
                        <strong>⚠ {bipagem.ocorrencias.length} bipe(s) NÃO entraram na lista</strong>
                        <span>
                          Separe estas peças e resolva cada uma. O registro fica travado até não sobrar nenhuma aqui.
                        </span>
                      </div>
                      {bipagem.ocorrencias.length > 1 && (
                        <button
                          type="button"
                          className={confirmandoDispensaTodas ? styles.bipeOcorrenciaBtn : styles.bipeOcorrenciaBtnSec}
                          onClick={dispensarTodasOcorrencias}
                        >
                          {confirmandoDispensaTodas
                            ? `Confirmar: ${bipagem.ocorrencias.length} peça(s) fora do romaneio`
                            : "Dispensar todos"}
                        </button>
                      )}
                    </div>
                    <ul className={styles.bipeOcorrenciasLista}>
                      {bipagem.ocorrencias.map((oc) => (
                        <li key={oc.id} className={styles.bipeOcorrencia}>
                          <div className={styles.bipeOcorrenciaInfo}>
                            <div className={styles.bipeOcorrenciaLinha1}>
                              <span className={styles.bipeOcorrenciaCodigo}>{oc.codigo}</span>
                              <strong>{oc.titulo}</strong>
                              <span className={styles.bipeOcorrenciaHora}>
                                {new Date(oc.em).toLocaleTimeString("pt-BR")}
                              </span>
                            </div>
                            <span className={styles.bipeOcorrenciaDetalhe}>{oc.detalhe}</span>
                            {oc.tipo === "ambiguo" && oc.opcoes && oc.opcoes.length > 0 && (
                              <div className={styles.bipeOpcoes}>
                                {oc.opcoes.map((opcao) => {
                                  const corTxt = textoCorProduto(opcao.descCor, opcao.corProduto);
                                  return (
                                    <button
                                      key={`${opcao.produto}|${opcao.corProduto ?? ""}`}
                                      type="button"
                                      className={styles.bipeOpcaoBtn}
                                      onClick={() => escolherOpcaoAmbigua(oc, opcao)}
                                    >
                                      <span className={styles.bipeOpcaoNome}>{opcao.descProduto}</span>
                                      <span className={styles.bipeOpcaoMeta}>
                                        {opcao.produto}
                                        {corTxt ? ` · ${corTxt}` : ""} · estoque {opcao.estoque}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className={styles.bipeOcorrenciaAcoes}>
                            {oc.tipo !== "ambiguo" && (
                              <button
                                type="button"
                                className={styles.bipeOcorrenciaBtn}
                                onClick={() => tentarBipeDeNovo(oc)}
                                disabled={!filialSelecionada}
                              >
                                Tentar de novo
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.bipeOcorrenciaBtnSec}
                              onClick={() => dispensarOcorrencia(oc.id)}
                              title="A peça NÃO vai para o romaneio"
                            >
                              Dispensar
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Rascunho recuperado do banco: deixa claro que a lista não é nova. */}
              {rascunhoRestauradoEm && produtosSelecionados.length > 0 && (
                <div className={styles.rascunhoRestauradoAviso}>
                  Rascunho recuperado — última gravação em {formatLogDateTime(rascunhoRestauradoEm)}
                </div>
              )}

              {/* Itens que JÁ estão neste romaneio — conferência, não edição.
                  Mudar quantidade de item já lançado continua sendo a tela de
                  Romaneios (editar-qtd); aqui só se acrescenta. */}
              {romaneioEditando && romaneioEditando.itensExistentes.length > 0 && (
                <div className={styles.itensJaLancadosBloco}>
                  <div className={styles.itensJaLancadosTitulo}>
                    Já {romaneioEditando.tipo === "saida" ? "lançados" : "entrados"} no romaneio #
                    {romaneioEditando.romaneio}
                    <span
                      className={`${styles.itensJaLancadosBadge} ${
                        romaneioEditando.tipo === "saida"
                          ? styles.itensJaLancadosBadgeSaida
                          : styles.itensJaLancadosBadgeEntrada
                      }`}
                    >
                      {romaneioEditando.itensExistentes.length} prod ·{" "}
                      {romaneioEditando.itensExistentes.reduce((sum, i) => sum + i.quantidade, 0)} itens
                    </span>
                  </div>
                  <div className={styles.itensJaLancadosLista}>
                    {romaneioEditando.itensExistentes.map((item) => {
                      const corTxt = textoCorProduto(item.descCor, item.corProduto);
                      return (
                        <div
                          key={`${item.produto}|${item.corProduto ?? ""}`}
                          className={styles.itemJaLancado}
                        >
                          <div className={styles.produtoInfo}>
                            <div className={styles.produtoName}>{item.descProduto || item.produto}</div>
                            <div className={styles.produtoSku}>
                              {item.produto}
                              {corTxt ? ` · ${corTxt}` : ""}
                              {item.codigoBarra ? ` · ${item.codigoBarra}` : ""}
                            </div>
                          </div>
                          <span className={styles.itemJaLancadoQtd}>{item.quantidade}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {produtosSelecionados.length === 0 ? (
                <div className={styles.emptyProducts}>
                  <div className={styles.emptyProductsIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 2 20 6.5v11L12 22l-8-4.5v-11L12 2Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                      <path d="M20 6.5 12 12 4 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className={styles.emptyProductsTitle}>Nenhum produto adicionado</div>
                  <div className={styles.emptyProductsSub}>
                    {romaneioEditando
                      ? `Bipe o código de barras acima ou use “Adicionar Produto” para acrescentar ao romaneio #${romaneioEditando.romaneio}`
                      : `Bipe o código de barras acima ou use “Adicionar Produto” para montar a ${tipoOperacao === "saida" ? "saída" : "entrada"}`}
                  </div>
                </div>
              ) : (
                <div
                  className={styles.produtosList}
                  onClick={(e) => {
                    // Clique em lixeira/+/−/tamanho deixava o cursor no botão: o
                    // próximo bipe ia para ele. Volta para o campo de bipe.
                    if ((e.target as HTMLElement).closest("button")) focarCampoBipe();
                  }}
                >
                  {produtosSelecionados.map((produto, index) => {
                    const corTxt = textoCorProduto(produto.descCor, produto.corProduto);
                    const chaveItem = chaveLinha(produto);
                    const destacado = itemDestacado === chaveItem;
                    const semTamanho = faltaTamanho(produto);
                    const semSaldo = linhaSemSaldo(produto);
                    return (
                    <div
                      key={index}
                      className={`${styles.produtoItem} ${destacado ? styles.produtoItemBipado : ""} ${semTamanho || semSaldo ? styles.produtoItemSemTamanho : ""}`}
                      ref={(el) => {
                        // Traz a linha recém-bipada para a vista (a lista rola).
                        if (!destacado || !el) return;
                        if (destaqueScrollRef.current === chaveItem) return;
                        destaqueScrollRef.current = chaveItem;
                        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                      }}
                    >
                      <div className={styles.produtoInfo}>
                        <div className={styles.produtoName}>{produto.descProduto}</div>
                        <div className={styles.produtoSku}>
                          {produto.produto}
                          {corTxt ? ` · ${corTxt}` : ""}
                          {produto.codigoBarra && ` · ${produto.codigoBarra}`}
                        </div>
                        {/* Peça P/M/G: tamanho obrigatório — cada tamanho é uma linha. */}
                        {produto.tamanhos && produto.tamanhos.length > 0 && (
                          <div className={styles.tamanhoRow} role="group" aria-label="Tamanho">
                            <span className={semTamanho ? styles.tamanhoLabelFaltando : styles.tamanhoLabel}>
                              {semTamanho ? "Escolha o tamanho:" : "Tamanho:"}
                            </span>
                            {produto.tamanhos.map((t) => {
                              const ativo = produto.tamanho === t.ordinal;
                              const semSaldo = tipoOperacao === "saida" && !saidaPodeEstourarEstoque && t.estoque <= 0;
                              return (
                                <button
                                  key={t.ordinal}
                                  type="button"
                                  className={`${styles.tamanhoChip} ${ativo ? styles.tamanhoChipAtivo : ""}`}
                                  onClick={() => escolherTamanho(index, t.ordinal)}
                                  disabled={isBusy || (semSaldo && !ativo)}
                                  title={`${t.label} — saldo ${t.estoque}`}
                                >
                                  {t.label}
                                  <span className={styles.tamanhoChipSaldo}>{t.estoque}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className={styles.produtoControls}>
                        <div className={styles.qtyControl}>
                          <button
                            className={styles.qtyBtn}
                            onClick={() => atualizarQuantidade(index, produto.quantidade - 1)}
                            disabled={produto.quantidade <= 1}
                          >−</button>
                          <input
                            type="number"
                            className={styles.qtyInput}
                            data-leitor-qtd={index}
                            value={produto.quantidade}
                            onChange={(e) => atualizarQuantidade(index, parseInt(e.target.value) || 1)}
                            min={1}
                            max={semTetoDeEstoque ? undefined : produto.estoque}
                          />
                          <button
                            className={styles.qtyBtn}
                            onClick={() => atualizarQuantidade(index, produto.quantidade + 1)}
                            disabled={!semTetoDeEstoque && produto.quantidade >= produto.estoque}
                          >+</button>
                        </div>
                        <div className={styles.stockPill}>{produto.quantidade}/{produto.estoque}</div>
                        {semSaldo && (
                          <div className={styles.semSaldoTag} title="Saldo atual menor que a quantidade da lista">
                            SEM SALDO ({Math.max(0, produto.estoque)})
                          </div>
                        )}
                        <button className={styles.removeBtn} onClick={() => removerProduto(index)} title="Remover">🗑</button>
                      </div>
                    </div>
                  );
                  })}
                </div>
              )}

              <div className={styles.produtosActionsRow}>
                <button
                  type="button"
                  className={`${styles.addProductBtn} ${tipoOperacao === "saida" ? styles.addProductBtnSaida : styles.addProductBtnEntrada}`}
                  onClick={abrirModalAdicionarProduto}
                  disabled={!filialSelecionada || isBusy}
                >
                  <span className={styles.addProductBtnIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                  Adicionar Produto
                </button>
                {produtosSelecionados.some(linhaSemSaldo) && (
                  <button
                    type="button"
                    className={styles.ajustarSaldoBtn}
                    onClick={ajustarAoSaldo}
                    disabled={isBusy}
                    title="Remove os itens sem estoque e reduz os demais ao saldo disponível"
                  >
                    Ajustar ao saldo ({produtosSelecionados.filter(linhaSemSaldo).length})
                  </button>
                )}
                {produtosSelecionados.length > 0 && (
                  <button
                    type="button"
                    className={styles.clearProductsBtn}
                    onClick={limparProdutosSelecionados}
                    disabled={isBusy}
                  >
                    Limpar lista
                  </button>
                )}
              </div>
            </div>

            {/* Obs + Submit */}
            <div className={styles.bottomArea}>
              {/* Observação pertence ao cabeçalho do romaneio; acrescentar item não
                  reescreve o cabeçalho, então o campo sai de cena na edição. */}
              {!romaneioEditando && (
                <>
                  <div className={styles.obsLabel}>Observação (opcional)</div>
                  <textarea
                    className={styles.obsTextarea}
                    data-leitor-obs=""
                    value={observacaoAtual}
                    onChange={(e) => setObservacaoAtual(e.target.value)}
                    placeholder="Adicione uma observação sobre esta movimentação..."
                    rows={3}
                    maxLength={2000}
                    disabled={isBusy}
                  />
                  <div className={styles.obsCounter}>{observacaoAtual.length}/2000</div>
                </>
              )}
              {/* TRAVA DE DEFEITO: um romaneio de defeito por filial por dia */}
              {defeitoDoDia && saidaDeDefeito && (
                <div className={travaDefeitoAtiva ? styles.travaAviso : styles.travaAvisoAdmin}>
                  <strong>
                    {travaDefeitoAtiva
                      ? "Defeito do dia já enviado"
                      : "Já existe defeito hoje nesta filial"}
                  </strong>
                  <span>
                    Romaneio #{defeitoDoDia.romaneio.romaneio} às{" "}
                    {formatLogDateTime(defeitoDoDia.romaneio.dataEmissao)} ·{" "}
                    {defeitoDoDia.romaneio.qtdProdutos} produto(s) /{" "}
                    {defeitoDoDia.romaneio.qtdItens} item(ns)
                    {defeitoDoDia.romaneio.responsavel ? ` · ${defeitoDoDia.romaneio.responsavel}` : ""}
                  </span>
                  <span>
                    {travaDefeitoAtiva
                      ? "É permitido apenas UM romaneio de defeito por dia por filial. Junte todas as peças com defeito no mesmo romaneio e envie o próximo amanhã."
                      : "Como admin, você pode registrar outro romaneio de defeito hoje."}
                  </span>
                </div>
              )}
              <div className={styles.submitRow}>
                <div className={styles.submitCounts}>
                  <div className={styles.submitCountItem}>
                    <div className={styles.submitCountValue}>{totalProdutos}</div>
                    <div className={styles.submitCountLabel}>Produtos</div>
                  </div>
                  <div className={styles.submitCountItem}>
                    <div className={styles.submitCountValue}>{totalItens}</div>
                    <div className={styles.submitCountLabel}>Itens</div>
                  </div>
                </div>
                <button
                  className={`${styles.submitBtn} ${isBusy || travaDefeitoAtiva || !filialSelecionada || produtosSelecionados.length === 0 ? "" : tipoOperacao === "saida" ? styles.submitBtnSaida : styles.submitBtnEntrada}`}
                  onClick={() => void abrirConfirmacaoRegistro()}
                  disabled={!filialSelecionada || produtosSelecionados.length === 0 || isBusy || travaDefeitoAtiva || checandoDefeitoDoDia}
                  title={travaDefeitoAtiva && defeitoDoDia ? defeitoDoDia.mensagem : undefined}
                >
                  <span className={styles.submitBtnIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path
                        d="M22 2 11 13"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M22 2 15 22l-4-9-9-4 20-7Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {conferindoSaldo
                    ? "⏳ Conferindo saldo…"
                    : isBusy
                    ? "⏳ Processando…"
                    : romaneioEditando
                      ? `Salvar no romaneio #${romaneioEditando.romaneio}`
                      : travaDefeitoAtiva
                        ? "Defeito do dia já enviado"
                        : tipoOperacao === "saida" ? "Registrar Saída" : "Registrar Entrada"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal – Confirmação Registrar Saída/Entrada */}
      {mostrarConfirmacaoRegistro && (
        <div className={styles.modalOverlay} onClick={() => setMostrarConfirmacaoRegistro(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {romaneioEditando
                  ? `Adicionar ao romaneio #${romaneioEditando.romaneio}?`
                  : tipoOperacao === "saida" ? "Confirma a SAÍDA?" : "Confirma a ENTRADA?"}
              </h2>
              <button className={styles.modalCloseBtn} onClick={() => setMostrarConfirmacaoRegistro(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.confirmacaoTexto}>
                {romaneioEditando
                  ? `Os ${totalProdutos} produto(s) / ${totalItens} item(ns) da lista serão somados à ${romaneioEditando.tipo === "saida" ? "saída" : "entrada"} #${romaneioEditando.romaneio} em ${filialLabel(romaneioEditando.filial)}. O estoque da filial ${romaneioEditando.tipo === "saida" ? "baixa" : "sobe"} na hora.`
                  : tipoOperacao === "saida"
                    ? `Deseja registrar a saída de ${totalProdutos} produto(s) / ${totalItens} peça(s)?`
                    : `Deseja registrar a entrada de ${totalProdutos} produto(s) / ${totalItens} peça(s)?`}
              </p>
              {bipagem.lidos > 0 && (
                <p className={styles.confirmacaoBipagem}>
                  Bipagem: <strong>{bipagem.lidos}</strong> leitura(s) · <strong>{bipagem.aceitos}</strong> entraram na lista
                  {bipagem.dispensadas.length > 0 && <> · <strong>{bipagem.dispensadas.length}</strong> dispensada(s)</>}
                </p>
              )}
              {bipagem.dispensadas.length > 0 && (
                <div className={styles.confirmacaoDispensadas}>
                  <strong>NÃO vão neste romaneio (dispensados por você):</strong>
                  <ul>
                    {bipagem.dispensadas.slice(0, 10).map((d) => (
                      <li key={d.id}>
                        {d.codigo} — {d.titulo}
                      </li>
                    ))}
                    {bipagem.dispensadas.length > 10 && <li>… e mais {bipagem.dispensadas.length - 10}</li>}
                  </ul>
                </div>
              )}
              {(bipesEmVoo > 0 || bipagem.ocorrencias.length > 0) && (
                <p className={styles.confirmacaoBloqueio}>
                  {bipesEmVoo > 0
                    ? `Aguarde: ${bipesEmVoo} bipe(s) ainda em consulta.`
                    : `${bipagem.ocorrencias.length} bipe(s) NÃO entraram na lista — feche e resolva antes de confirmar.`}
                </p>
              )}
              {tipoOperacao === "saida" && filialDestinoSaida && (
                <p className={styles.confirmacaoTexto} style={{ marginTop: "8px" }}>
                  Destino: <strong>{filialOptionLabel(filialDestinoSaida)}</strong>
                </p>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnSecondary} onClick={() => setMostrarConfirmacaoRegistro(false)}>
                Cancelar
              </button>
              <button
                className={tipoOperacao === "saida" ? styles.btnConfirmarSaida : styles.btnConfirmarEntrada}
                onClick={confirmarRegistro}
                disabled={bipesEmVoo > 0 || bipagem.ocorrencias.length > 0}
              >
                {romaneioEditando
                  ? "Adicionar ao romaneio"
                  : tipoOperacao === "saida" ? "Confirmar Saída" : "Confirmar Entrada"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal – Adicionar Produto */}
      {modalAberto && (
        <div className={styles.modalOverlay} onClick={solicitarFecharModalAdicionarProduto}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Adicionar Produto</h2>
              <button className={styles.modalCloseBtn} onClick={solicitarFecharModalAdicionarProduto}>×</button>
            </div>
            <div className={styles.modalContent}>
              <div className={styles.searchBox}>
                <span className={styles.searchIcon}>🔍</span>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Buscar por nome, SKU ou código de barras..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoFocus
                />
              </div>
              {loadingProdutos ? (
                <div className={styles.loadingText}>Buscando produtos...</div>
              ) : produtos.length === 0 && searchTerm.length >= 2 ? (
                <div className={styles.emptyLog}>Nenhum produto encontrado</div>
              ) : (
                <div className={styles.produtosModalList}>
                  {produtos
                    .filter((produto) => {
                      const noCarrinho = produtosSelecionadosModal.some(
                        (p) =>
                          p.produto === produto.produto &&
                          p.corProduto === produto.corProduto &&
                          p.filial === filialSelecionada?.codFilial
                      );
                      return !noCarrinho;
                    })
                    .map((produto, index) => {
                    const estoque = produto.estoques.find(e =>
                      e.filial.trim() === (filialSelecionada?.codFilial ?? '').trim()
                    );
                    const corModalTxt = textoCorProduto(produto.descCor, produto.corProduto);
                    const isPickerActive = colorPickerProduto?.produto === produto.produto && produto.corProduto === null;
                    return (
                      <div key={index} className={`${styles.produtoModalItem}${isPickerActive ? ` ${styles.produtoModalItemPickerActive}` : ''}`}>
                        <div className={styles.produtoModalIcon}>📦</div>
                        <div className={styles.produtoModalInfo}>
                          <div className={styles.produtoModalName}>{produto.descProduto}</div>
                          <div className={styles.produtoModalDetails}>
                            {produto.produto}
                            {corModalTxt ? ` · ${corModalTxt}` : ""}
                            {estoque && ` · Estoque: ${estoque.estoque}`}
                          </div>
                        </div>
                        {!isPickerActive && (
                          <button
                            className={`${styles.addModalBtn} ${tipoOperacao === "saida" ? styles.addModalBtnSaida : styles.addModalBtnEntrada}`}
                            onClick={() => adicionarProdutoModal(produto)}
                            disabled={tipoOperacao === "saida" && !estoque}
                            title={estoque
                              ? `Estoque: ${estoque.estoque}`
                              : tipoOperacao === "saida"
                                ? `Sem estoque em ${filialOptionLabel(filialSelecionada)}`
                                : `Sem estoque cadastrado em ${filialOptionLabel(filialSelecionada)}`}
                          >+</button>
                        )}
                        {isPickerActive && (
                          <div className={styles.colorPickerRow}>
                            {loadingColorPicker ? (
                              <span className={styles.colorPickerLoading}>Buscando cores...</span>
                            ) : colorPickerOpcoes.length > 0 ? (
                              <div className={styles.colorChips}>
                                {colorPickerOpcoes.map((opcao) => {
                                  const estoqueOpcao = opcao.estoques.find(e => e.filial.trim() === (filialSelecionada?.codFilial ?? '').trim());
                                  return (
                                    <button
                                      key={opcao.corProduto}
                                      className={`${styles.colorChip} ${tipoOperacao === "saida" ? styles.colorChipSaida : styles.colorChipEntrada}`}
                                      onClick={() => adicionarComCorSelecionada(opcao)}
                                      disabled={tipoOperacao === "saida" && !estoqueOpcao}
                                      title={estoqueOpcao ? `Estoque: ${estoqueOpcao.estoque}` : `Sem estoque em ${filialOptionLabel(filialSelecionada)}`}
                                    >
                                      {opcao.descCor || opcao.corProduto}
                                      {estoqueOpcao && <span className={styles.colorChipEstoque}> ({estoqueOpcao.estoque})</span>}
                                    </button>
                                  );
                                })}
                                <button
                                  className={styles.colorChipCancel}
                                  onClick={() => { setColorPickerProduto(null); setColorPickerOpcoes([]); }}
                                  title="Cancelar"
                                >✕</button>
                              </div>
                            ) : (
                              <div className={styles.colorPickerNenhuma}>
                                <span>Nenhuma cor disponível</span>
                                <button
                                  className={styles.colorChipCancel}
                                  onClick={() => { setColorPickerProduto(null); setColorPickerOpcoes([]); }}
                                >✕</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {produtosSelecionadosModal.length > 0 && (
                <div className={styles.modalCartBlock}>
                  <div className={styles.modalCartHeader}>
                    <span className={styles.modalCartTitle}>Selecionados</span>
                    <span className={styles.modalCartMeta}>
                      {produtosSelecionadosModal.length} prod ·{" "}
                      {produtosSelecionadosModal.reduce((s, p) => s + p.quantidade, 0)} itens
                    </span>
                  </div>
                  <div className={styles.modalCartList}>
                    {produtosSelecionadosModal.map((p, idx) => {
                      const corCartTxt = textoCorProduto(p.descCor, p.corProduto);
                      return (
                      <div key={`${p.produto}-${p.corProduto ?? ""}-${p.filial}-${idx}`} className={styles.produtoItem}>
                        <div className={styles.produtoInfo}>
                          <div className={styles.produtoName}>{p.descProduto}</div>
                          <div className={styles.produtoSku}>
                            {p.produto}
                            {corCartTxt ? ` · ${corCartTxt}` : ""}
                            {p.codigoBarra && ` · ${p.codigoBarra}`}
                          </div>
                        </div>
                        <div className={styles.produtoControls}>
                          {tipoOperacao === "entrada" && p.corProduto && (
                            <div className={styles.inlineColorSelectWrap}>
                              <select
                                className={styles.inlineColorSelect}
                                value={(p.corProduto || "").trim()}
                                onFocus={() => ensureColorOptionsLoaded(p.produto)}
                                onChange={(e) => trocarCorProdutoSelecionadoModal(idx, e.target.value)}
                                title="Trocar cor"
                              >
                                {colorOptionsByProduto[p.produto]?.length ? (
                                  colorOptionsByProduto[p.produto].map((op) => (
                                    <option key={`${op.produto}-${op.corProduto}`} value={(op.corProduto || "").trim()}>
                                      {op.descCor || op.corProduto}
                                    </option>
                                  ))
                                ) : (
                                  <option value={(p.corProduto || "").trim()}>
                                    {p.descCor || p.corProduto}
                                  </option>
                                )}
                              </select>
                            </div>
                          )}
                          <div className={styles.qtyControl}>
                            <button
                              className={styles.qtyBtn}
                              onClick={() => atualizarQuantidadeModal(idx, p.quantidade - 1)}
                              disabled={p.quantidade <= 1}
                            >−</button>
                            <input
                              type="number"
                              className={styles.qtyInput}
                              value={p.quantidade}
                              onChange={(e) => atualizarQuantidadeModal(idx, parseInt(e.target.value) || 1)}
                              min={1}
                              max={semTetoDeEstoque ? undefined : p.estoque}
                            />
                            <button
                              className={styles.qtyBtn}
                              onClick={() => atualizarQuantidadeModal(idx, p.quantidade + 1)}
                              disabled={!semTetoDeEstoque && p.quantidade >= p.estoque}
                            >+</button>
                          </div>
                          <div className={styles.stockPill}>{p.quantidade}/{p.estoque}</div>
                          <button className={styles.removeBtn} onClick={() => removerProdutoModal(idx)} title="Remover">🗑</button>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.btnPrimary}
                onClick={confirmarProdutosDoModal}
                disabled={produtosSelecionadosModal.length === 0}
              >
                Confirmar ({produtosSelecionadosModal.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal – Confirmar fechar carrinho do modal */}
      {modalConfirmarFecharAberto && (
        <div className={styles.modalOverlay} onClick={continuarNoModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Descartar itens?</h2>
              <button className={styles.modalCloseBtn} onClick={continuarNoModal}>×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.confirmacaoTexto}>
                Você adicionou/alterou produtos no modal, mas ainda não confirmou. Deseja descartar essas alterações?
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnSecondary} onClick={continuarNoModal}>
                Continuar no modal
              </button>
              <button className={styles.btnDanger} onClick={descartarProdutosDoModal}>
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {notificacao && (
        <div className={`${styles.toast} ${notificacao.tipo === "success" ? styles.toastSuccess : styles.toastError}`}>
          <span className={styles.toastIcon}>{notificacao.tipo === "success" ? "✓" : "✕"}</span>
          <span>{notificacao.mensagem}</span>
        </div>
      )}

      {/* Modal – Editar Log */}
      {modalEdicaoAberto && logEditando && (
        <div className={styles.modalOverlayEdit} onClick={fecharModalEdicao}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Editar Log #{logEditando.romaneio}</h2>
              <button className={styles.modalCloseBtn} onClick={fecharModalEdicao}>×</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.modalInfoBox}>
                <div><strong>Tipo:</strong> {tipoOperacao === "saida" ? "Saída" : "Entrada"}</div>
                <div><strong>Filial:</strong> {filialLabel(tipoOperacao === "saida" ? logEditando.filialOrigem : logEditando.filialDestino)}</div>
                <div><strong>Data:</strong> {formatLogDateTime(logEditando.dataEmissao)}</div>
                <div><strong>Produtos:</strong> {logEditando.qtdProdutos} · <strong>Itens:</strong> {logEditando.qtdItens}</div>
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalFieldLabel}>Observação</label>
                <textarea
                  className={styles.modalTextarea}
                  value={observacaoEditando}
                  onChange={(e) => setObservacaoEditando(e.target.value)}
                  placeholder="Adicione uma observação..."
                  rows={4}
                  maxLength={2000}
                  disabled={processandoEdicao}
                />
                <div className={styles.modalCharCount}>{observacaoEditando.length}/2000</div>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnDanger} onClick={removerLog} disabled={processandoEdicao}>
                {processandoEdicao ? "Removendo..." : "🗑 Remover Log"}
              </button>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className={styles.btnSecondary} onClick={fecharModalEdicao} disabled={processandoEdicao}>Cancelar</button>
                <button className={styles.btnPrimary} onClick={salvarEdicao} disabled={processandoEdicao}>
                  {processandoEdicao ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
