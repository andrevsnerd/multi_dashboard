"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CompanyKey } from "@/lib/config/company";
import { isReadOnlyRole } from "@/lib/auth/permissions";
import { useAuth } from "@/components/auth/AuthContext";

import s from "@/components/saidas-entradas-produtos/SaidasEntradasProdutosPage.module.css";
import a from "@/components/ajuste-estoque/AjusteEstoquePage.module.css";
import styles from "./InventarioBipagemPage.module.css";

/* ════════════════════════════════════════════════════════════════════════
 *  INVENTÁRIO POR BIPAGEM — fusão de Saídas/Entradas com o Inventário do
 *  Ajuste de Estoque. Bipagem, busca, rascunho e travas contra perda de bipe
 *  são os da tela de Saídas/Entradas; as diferenças, a gravação (contagem
 *  nativa do Linx) e o histórico são os do Ajuste de Estoque — só que a
 *  contagem vem da lista bipada, não de um arquivo.
 * ════════════════════════════════════════════════════════════════════════ */

interface FilialInventario {
  cod: string;
  nome: string;
  display: string;
  apelido: string | null;
  estoquePositivo: number;
  linhas: number;
  company: CompanyKey | null;
  vendaRecente: boolean;
}

interface Produto {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  estoques: Array<{ filial: string; nomeFilial: string; estoque: number }>;
}

/** Um tamanho da grade (posição 1..48). */
interface TamanhoOpcao {
  ordinal: number;
  label: string;
  estoque: number;
}

/** Linha da lista = produto × cor × tamanho (o mesmo item em P e em M são duas linhas). */
interface LinhaInventario {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  quantidade: number;
  /** `undefined` = grade ainda não consultada; `[]` = não exige tamanho; lista = peça P/M/G. */
  tamanhos?: TamanhoOpcao[];
  tamanho?: number | null;
  tamanhoLabel?: string | null;
}

function chaveLinha(p: { produto: string; corProduto: string | null; tamanho?: number | null }): string {
  return `${p.produto}|${p.corProduto ?? ""}|${p.tamanho ?? ""}`;
}

function faltaTamanho(p: LinhaInventario): boolean {
  return Boolean(p.tamanhos && p.tamanhos.length > 0 && !p.tamanho);
}

/** Saldo atual da filial (ver /api/inventario/saldo). */
interface SaldoItem {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  estoque: number;
  tamanhos: Record<string, number>;
}

interface SaldoFilial {
  filialCod: string;
  filialNome: string;
  itens: SaldoItem[];
  carregadoEm: string;
}

/** Item resolvido pela bipagem (/api/transferencia-produtos/bipar). */
interface BipeItem {
  produto: string;
  descProduto: string;
  corProduto: string | null;
  descCor: string;
  codigoBarra: string | null;
  grade: string | null;
  estoque: number;
  filial: string;
  tamanho?: number | null;
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
 * ou dispensar de propósito; enquanto houver ocorrência aberta, o estoque não sobe.
 */
interface BipeOcorrencia {
  id: string;
  codigo: string;
  em: number;
  tipo: "falha" | "nao_encontrado" | "ambiguo" | "filial_trocada" | "interrompido";
  titulo: string;
  detalhe: string;
  opcoes?: BipeItem[];
}

/** Diário da bipagem (lidos = aceitos + ocorrências + dispensadas + em voo), no localStorage. */
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

const BIPAGEM_STORAGE_PREFIX = "inventario:bipagem:";
const SOM_STORAGE_KEY = "saidas-entradas:som-bipe";

/** Leitor de código de barras "digita" bem mais rápido que gente: ≥ 4 teclas com ≤ 45ms entre elas. */
const LEITOR_MIN_CHARS = 4;
const LEITOR_GAP_MS = 45;

/** Consultas de bipe simultâneas — o resto espera na fila (bipar em rajada derrubava o proxy). */
const BIPES_EM_PARALELO = 3;

/** Linhas renderizadas na tabela de diferenças (a gravação usa todas). */
const DIFERENCAS_MAX_LINHAS = 1000;

function novoIdBipe(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
    // Consulta no ar quando a página caiu não tem resultado: vira ocorrência.
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

/** Assinatura da lista — a confirmação vale só para a lista que foi conferida. */
function assinaturaLista(lista: LinhaInventario[]): string {
  return [...qtdPorChave(lista).entries()]
    .map(([k, q]) => `${k}=${q}`)
    .sort()
    .join(";");
}

/* ── RASCUNHO COMPARTILHADO ─────────────────────────────────────────────────
 * Um rascunho por filial (ver `lib/utils/inventario-draft-store.ts`): quem abre
 * a filial conta na mesma lista. A tela nunca manda "a lista é esta" — manda só
 * as linhas que mexeu (quantidade na BASE e agora), e o servidor soma por cima do
 * que os colegas já gravaram. A resposta traz só o que mudou desde a versão que a
 * tela conhecia, e a tela REBASEIA: lista = servidor + (o que ainda não subiu).
 *
 * Não há consulta automática: a tela fala com o servidor quando muda algo, quando
 * a pessoa clica em "Atualizar agora" e, obrigatoriamente, antes de subir.
 * ────────────────────────────────────────────────────────────────────────── */

/** Item do rascunho no servidor (quantidade 0 = removido, só em "o que mudou"). */
interface RascunhoItemServidor {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  quantidade: number;
  tamanho?: number | null;
  tamanhoLabel?: string | null;
  /** Quantas peças desta linha cada usuário contou. */
  porUsuario?: Record<string, number>;
}

interface ParticipanteRascunho {
  username: string;
  pecas: number;
  ultimoBipeEm: string | null;
  /** Bipes dessa pessoa que NÃO entraram (painel vermelho da tela dela). */
  ocorrencias: number;
  ocorrenciasEm: string | null;
}

/** Cabeçalho do rascunho (os itens vêm à parte). */
interface RascunhoResumo {
  id: string;
  companyKey: string;
  /** Quem começou. */
  username: string;
  filialCod: string;
  filialNome: string;
  nomeContagem: string;
  nomeEditado: boolean;
  observacao: string;
  createdAt: string;
  updatedAt: string;
  /** false = rascunho antigo (por usuário, antes de 04/11/2026). */
  compartilhado: boolean;
  versao: number;
  status: "aberto" | "finalizando" | "finalizado" | "descartado";
  travaVencida: boolean;
  atualizadoPor: string;
  finalizadoPor: string | null;
  finalizadoEm: string | null;
  participantes: ParticipanteRascunho[];
  totalPecas: number;
  totalLinhas: number;
}

/** Rascunho + itens: completo, ou só o que mudou desde a versão pedida. */
interface SnapshotRascunho {
  rascunho: RascunhoResumo;
  itens: RascunhoItemServidor[];
  completo: boolean;
}

type RascunhoStatus = "idle" | "salvando" | "salvo" | "erro" | "aguardando";

/** Descrição/observação: compartilhadas, a última gravação vence. */
interface CabecalhoInventario {
  nomeContagem: string;
  nomeEditado: boolean;
  observacao: string;
}

const CAB_VAZIO: CabecalhoInventario = { nomeContagem: "", nomeEditado: false, observacao: "" };

function cabecalhoLocal(nomeContagem: string, nomeEditado: boolean, observacao: string): CabecalhoInventario {
  // Descrição automática não é dado: cada tela calcula a sugestão.
  return { nomeEditado, nomeContagem: nomeEditado ? nomeContagem.trim().slice(0, 25) : "", observacao: observacao.trim() };
}

function cabecalhoDoServidor(r: RascunhoResumo): CabecalhoInventario {
  return cabecalhoLocal(r.nomeContagem, r.nomeEditado, r.observacao);
}

function mesmoCabecalho(x: CabecalhoInventario, y: CabecalhoInventario): boolean {
  return x.nomeEditado === y.nomeEditado && x.nomeContagem === y.nomeContagem && x.observacao === y.observacao;
}

/** Reenvio do que ficou sem resposta (só enquanto há bipe desta tela não gravado). */
const REENVIO_MS = 5000;

/** Mesma chave do servidor (`chaveItemInventario`): produto × cor × tamanho, aparados. */
function chaveSync(p: { produto: string; corProduto: string | null; tamanho?: number | null }): string {
  return `${(p.produto ?? "").trim()}|${(p.corProduto ?? "").trim()}|${p.tamanho ?? ""}`;
}

function qtdPorChave(
  lista: Iterable<{ produto: string; corProduto: string | null; tamanho?: number | null; quantidade: number }>
): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of lista) m.set(chaveSync(p), (m.get(chaveSync(p)) ?? 0) + p.quantidade);
  return m;
}

function mesmasQuantidades(x: Map<string, number>, y: Map<string, number>): boolean {
  if (x.size !== y.size) return false;
  for (const [k, n] of x) if (y.get(k) !== n) return false;
  return true;
}

function linhaDoServidor(it: RascunhoItemServidor): LinhaInventario {
  return {
    produto: it.produto,
    descProduto: it.descProduto,
    codigoBarra: it.codigoBarra,
    corProduto: it.corProduto,
    descCor: it.descCor,
    quantidade: it.quantidade,
    tamanho: it.tamanho ?? null,
    tamanhoLabel: it.tamanhoLabel ?? null,
  };
}

/**
 * REBASE: lista = servidor + (lista da tela − referência), onde a referência é o
 * que a tela mandou (ou a base que ela conhecia). O que a tela mexeu e ainda não
 * subiu continua; o que os colegas biparam entra. A ordem da tela é mantida;
 * linha nova do servidor vai para o fim.
 */
function rebaseLista(
  prev: LinhaInventario[],
  referencia: Map<string, number>,
  servidor: Map<string, RascunhoItemServidor>
): LinhaInventario[] {
  const naTela = qtdPorChave(prev);
  const feitas = new Set<string>();
  const out: LinhaInventario[] = [];
  const emitir = (k: string, modelo: LinhaInventario | null) => {
    if (feitas.has(k)) return;
    feitas.add(k);
    const srv = servidor.get(k);
    const q = (srv?.quantidade ?? 0) + (naTela.get(k) ?? 0) - (referencia.get(k) ?? 0);
    if (q <= 0) return;
    if (modelo) out.push({ ...modelo, quantidade: q });
    else if (srv) out.push(linhaDoServidor(srv));
  };
  for (const p of prev) emitir(chaveSync(p), p);
  for (const k of servidor.keys()) emitir(k, null);
  return out;
}

/** O que está na tela além da base (o que não subiu): parte positiva de (lista − base). */
function alemDaBase(lista: LinhaInventario[], base: Map<string, number>): LinhaInventario[] {
  const restante = new Map(base);
  return lista.flatMap((p) => {
    const k = chaveSync(p);
    const r = restante.get(k) ?? 0;
    const usado = Math.min(r, p.quantidade);
    restante.set(k, r - usado);
    const sobra = p.quantidade - usado;
    return sobra > 0 ? [{ ...p, quantidade: sobra }] : [];
  });
}

function itemParaServidor(p: LinhaInventario | RascunhoItemServidor, quantidade: number): RascunhoItemServidor {
  return {
    produto: p.produto,
    descProduto: p.descProduto,
    codigoBarra: p.codigoBarra,
    corProduto: p.corProduto,
    descCor: p.descCor,
    quantidade,
    tamanho: p.tamanho ?? null,
    tamanhoLabel: p.tamanhoLabel ?? null,
  };
}

/** Um envio ao servidor. Fica "incerto" até a resposta: o reenvio usa o MESMO syncId (idempotente). */
interface EnvioSync {
  body: string;
  enviado: LinhaInventario[];
  cabEnviado: CabecalhoInventario;
  /** Bipes que não entraram, informados neste envio (null = não mudou). */
  ocorrencias: number | null;
}

/** Contexto de sincronização de UMA filial na tela. Troca de filial / fim do inventário = contexto novo. */
interface SyncCtx {
  filialCod: string;
  rascunhoId: string | null;
  base: { versao: number; itens: Map<string, RascunhoItemServidor>; cab: CabecalhoInventario } | null;
  emVoo: Promise<void> | null;
  incerto: EnvioSync | null;
  abandonado: boolean;
  /** Abandonado com envio no ar: a lista que esse envio levou (referência do resto). */
  refAbandono: { itens: LinhaInventario[]; cab: CabecalhoInventario } | null;
  ocorrenciasEnviadas: number | null;
  /** Chave no localStorage onde ESTE contexto guarda o que ainda não foi gravado. */
  chaveLocal: string | null;
}

function novoSyncCtx(filialCod: string): SyncCtx {
  return {
    filialCod,
    rascunhoId: null,
    base: null,
    emVoo: null,
    incerto: null,
    abandonado: false,
    refAbandono: null,
    ocorrenciasEnviadas: null,
    chaveLocal: null,
  };
}

/* ── BIPE NUNCA SE PERDE ─────────────────────────────────────────────────────
 * Peça que entrou na tela e ainda não foi gravada no servidor (sem internet,
 * servidor fora) fica guardada NO NAVEGADOR, como os envios exatos que faltam:
 *   1º o envio que saiu e não teve resposta (mesmo syncId → reenviar não soma 2×);
 *   2º o resto, que nunca saiu.
 * Regra: o envio é guardado ANTES de sair. Se a página fechar/travar, ao reabrir
 * a filial esses envios são mandados de novo; o que não puder mais entrar (o
 * inventário já subiu) aparece na tela, peça por peça.
 * ────────────────────────────────────────────────────────────────────────── */

const PENDENTE_PREFIX = "inventario:pendente:";

interface PendenteGuardado {
  envios: Array<{ body: string; pecas: Array<{ rotulo: string; quantidade: number }> }>;
  /** Quantos envios já foram aceitos na recuperação (não repete). */
  enviados: number;
  em: string;
}

function prefixoPendente(companyKey: string, username: string, filialCod: string): string {
  return `${PENDENTE_PREFIX}${companyKey}|${username.toLowerCase()}|${filialCod}|`;
}

function rotuloPeca(p: LinhaInventario): string {
  const cor = textoCorProduto(p.descCor, p.corProduto);
  return `${p.descProduto || p.produto}${cor ? ` · ${cor}` : ""}${p.tamanhoLabel ? ` · ${p.tamanhoLabel}` : ""}`;
}

function pecasDe(lista: LinhaInventario[]): Array<{ rotulo: string; quantidade: number }> {
  return lista.map((p) => ({ rotulo: rotuloPeca(p), quantidade: p.quantidade }));
}

function lerPendente(chave: string): PendenteGuardado | null {
  try {
    const raw = window.localStorage.getItem(chave);
    return raw ? (JSON.parse(raw) as PendenteGuardado) : null;
  } catch {
    return null;
  }
}

function gravarPendente(chave: string, valor: PendenteGuardado | null) {
  try {
    if (!valor || valor.envios.length <= valor.enviados) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // sem localStorage (aba privada): vale só o aviso na tela
  }
}

function chavesPendentes(prefixo: string): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefixo)) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

function baseLista(ctx: SyncCtx): RascunhoItemServidor[] {
  return ctx.base ? [...ctx.base.itens.values()] : [];
}

/**
 * Monta o envio: só as linhas que mudaram em relação à referência (o inventário
 * da loja inteira pode ter milhares de linhas — mandar tudo a cada bipe pesa).
 */
function montarEnvio(
  ctx: SyncCtx,
  referencia: Array<LinhaInventario | RascunhoItemServidor>,
  lista: LinhaInventario[],
  cab: CabecalhoInventario,
  cabReferencia: CabecalhoInventario,
  vivo: { companyKey: string; filialNome: string; ocorrencias: number }
): EnvioSync | null {
  const refQ = qtdPorChave(referencia);
  const locQ = qtdPorChave(lista);
  const modeloLocal = new Map(lista.map((p) => [chaveSync(p), p]));
  const modeloRef = new Map(referencia.map((p) => [chaveSync(p), p]));
  const base: RascunhoItemServidor[] = [];
  const itens: RascunhoItemServidor[] = [];
  for (const k of new Set([...refQ.keys(), ...locQ.keys()])) {
    const r = refQ.get(k) ?? 0;
    const l = locQ.get(k) ?? 0;
    if (r === l) continue;
    const modelo = modeloLocal.get(k) ?? modeloRef.get(k);
    if (!modelo) continue;
    if (r > 0) base.push(itemParaServidor(modelo, r));
    if (l > 0) itens.push(itemParaServidor(modelo, l));
  }
  const mudouCab = !mesmoCabecalho(cab, cabReferencia);
  const ocorrencias = vivo.ocorrencias !== (ctx.ocorrenciasEnviadas ?? 0) ? vivo.ocorrencias : null;
  if (base.length === 0 && itens.length === 0 && !mudouCab && ocorrencias === null) return null;
  // Sem rascunho ainda e nada na tela: não cria rascunho vazio.
  if (!ctx.rascunhoId && itens.length === 0 && !mudouCab) return null;
  return {
    enviado: lista,
    cabEnviado: cab,
    ocorrencias,
    body: JSON.stringify({
      company: vivo.companyKey,
      filialCod: ctx.filialCod,
      filialNome: vivo.filialNome,
      rascunhoId: ctx.rascunhoId,
      versaoBase: ctx.base?.versao ?? -1,
      syncId: novoIdBipe(),
      base,
      itens,
      cabecalho: mudouCab ? cab : null,
      ocorrencias,
    }),
  };
}

type SyncResposta =
  | ({ estado: "ok" } & SnapshotRascunho)
  | { estado: "travado"; rascunho: RascunhoResumo }
  | { estado: "encerrado"; rascunho: RascunhoResumo | null };

/** O inventário que estava nesta tela acabou (subido ou descartado): não dá mais para bipar nele. */
interface EncerramentoInventario {
  status: "finalizado" | "descartado";
  por: string | null;
  em: string | null;
  nome: string;
  /** Peças bipadas nesta tela que não chegaram a entrar. */
  sobra: LinhaInventario[];
}

/* ── Histórico (o mesmo do Ajuste de Estoque) ── */

interface AjusteRecente {
  nome: string;
  filial: string;
  emissao: string;
  itens: number;
  soma: number;
}

interface AjusteDetalheItem {
  produto: string;
  descProduto: string;
  cor: string;
  descCor: string;
  qtde: number;
  saldoAnterior?: number | null;
  saldoFinal?: number | null;
}

interface TotaisKpi {
  itens: number | null;
  comDiferenca: number;
  positivos: number;
  negativos: number;
  somaDelta: number;
  saldoAtualTotal: number | null;
  saldoFinalTotal: number | null;
  itensSaldoNegativo: number | null;
}

interface AjusteKpis {
  fonte: "snapshot" | "contagem" | "movimento" | "ajuste";
  totais: TotaisKpi;
  naoEncontrados: number;
  ambiguos: number;
  invalidas: number;
}

interface AjusteDetalhe {
  itens: AjusteDetalheItem[];
  kpis: AjusteKpis | null;
}

/** Conferência do servidor antes de subir (/api/inventario/preview). */
interface PreviewServidor {
  filialNome: string;
  totais: {
    itens: number;
    comDiferenca: number;
    positivos: number;
    negativos: number;
    somaDelta: number;
    saldoAtualTotal: number;
    saldoFinalTotal: number;
    itensSaldoNegativo: number;
  };
  naoBipados: number;
  pendenciasTamanho: string[];
  nomeSugerido: string | null;
}

/** Linha das diferenças em tempo real (contagem bipada × saldo carregado). */
interface DiferencaLinha {
  produto: string;
  cor: string;
  descProduto: string;
  descCor: string;
  saldo: number;
  contagem: number;
  delta: number;
  ajustaTamanho: boolean;
  bipado: boolean;
}

interface Props {
  companyKey: CompanyKey;
  companyName: string;
}

function hojeISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Data como gravada no Linx (sem conversão de fuso — evita 02/10 virar 01/10).
function fmtDataLinx(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : new Date(iso).toLocaleDateString("pt-BR");
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtNum(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("pt-BR");
}

/** Mesma sugestão do Inventário (arquivo) do Ajuste de Estoque: INV + filial + DDMM. */
function sugerirNome(display: string, dataISO: string): string {
  const compact = (display || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "");
  const [, mm, dd] = dataISO.split("-");
  return `INV${compact}${dd ?? ""}${mm ?? ""}`.slice(0, 25);
}

function textoCorProduto(descCor: string, corProduto: string | null): string {
  const d = (descCor || "").trim();
  if (d) return d;
  return (corProduto || "").trim();
}

/** '06' e '6' são a mesma cor — o saldo e o código de barras divergem no formato. */
function normCor(cor: string | null | undefined): string {
  const c = (cor ?? "").trim();
  return /^\d+$/.test(c) ? String(Number(c)) : c.toUpperCase();
}

function chaveNorm(produto: string, cor: string | null | undefined): string {
  return `${(produto ?? "").trim().toUpperCase()}|${normCor(cor)}`;
}

function mesmosTamanhos(x: Record<string, number>, y: Record<string, number>): boolean {
  const chaves = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of chaves) if ((x[k] ?? 0) !== (y[k] ?? 0)) return false;
  return true;
}

/**
 * Diferenças em tempo real — espelho de `calcularDiferencasBipagem` (servidor),
 * sobre o saldo carregado ao abrir a filial. O servidor refaz a conta com o saldo
 * de agora na confirmação e na gravação.
 */
function calcularDiferencasLocal(saldo: SaldoItem[], lista: LinhaInventario[], zerarNaoContados: boolean) {
  const saldoPorNorm = new Map(saldo.map((it) => [chaveNorm(it.produto, it.cor), it]));
  const contados = new Map<
    string,
    { produto: string; cor: string; descProduto: string; descCor: string; qtd: number; tamanhos: Record<string, number> | null }
  >();

  for (const l of lista) {
    const sal = saldoPorNorm.get(chaveNorm(l.produto, l.corProduto));
    const produto = sal?.produto ?? l.produto;
    const cor = sal?.cor ?? (l.corProduto ?? "");
    const chave = chaveNorm(produto, cor);
    const atual = contados.get(chave) ?? {
      produto,
      cor,
      descProduto: l.descProduto,
      descCor: l.descCor,
      qtd: 0,
      tamanhos: {} as Record<string, number> | null,
    };
    atual.qtd += l.quantidade;
    const exige = Boolean(l.tamanhos && l.tamanhos.length > 0);
    if (!exige || !l.tamanho || atual.tamanhos === null) {
      atual.tamanhos = null;
    } else {
      atual.tamanhos[String(l.tamanho)] = (atual.tamanhos[String(l.tamanho)] ?? 0) + l.quantidade;
    }
    contados.set(chave, atual);
  }

  const linhas: DiferencaLinha[] = [];
  let naoBipados = 0;
  for (const [chave, c] of contados) {
    const sal = saldoPorNorm.get(chave);
    const saldoQtd = sal?.estoque ?? 0;
    const delta = c.qtd - saldoQtd;
    linhas.push({
      produto: c.produto,
      cor: c.cor,
      descProduto: sal?.descProduto || c.descProduto,
      descCor: sal?.descCor || c.descCor,
      saldo: saldoQtd,
      contagem: c.qtd,
      delta,
      ajustaTamanho: delta === 0 && c.tamanhos !== null && !mesmosTamanhos(sal?.tamanhos ?? {}, c.tamanhos),
      bipado: true,
    });
  }
  if (zerarNaoContados) {
    for (const [chave, it] of saldoPorNorm) {
      if (contados.has(chave)) continue;
      naoBipados += 1;
      linhas.push({
        produto: it.produto,
        cor: it.cor,
        descProduto: it.descProduto,
        descCor: it.descCor,
        saldo: it.estoque,
        contagem: 0,
        delta: -it.estoque,
        ajustaTamanho: false,
        bipado: false,
      });
    }
  }

  linhas.sort((x, y) => (x.produto === y.produto ? x.cor.localeCompare(y.cor) : x.produto.localeCompare(y.produto)));
  const comDiferenca = linhas.filter((l) => l.delta !== 0 || l.ajustaTamanho);
  return {
    linhas,
    comDiferenca,
    naoBipados,
    totais: {
      itens: linhas.length,
      comDiferenca: comDiferenca.length,
      positivos: comDiferenca.filter((l) => l.delta > 0).length,
      negativos: comDiferenca.filter((l) => l.delta < 0).length,
      somaDelta: comDiferenca.reduce((acc, l) => acc + l.delta, 0),
      saldoAtualTotal: linhas.reduce((acc, l) => acc + l.saldo, 0),
      saldoFinalTotal: linhas.reduce((acc, l) => acc + l.contagem, 0),
      itensSaldoNegativo: linhas.filter((l) => l.saldo < 0).length,
    },
  };
}

/* ── chamadas de API ── */

async function biparCodigo(codigoBarras: string, filial: string, companyKey: string): Promise<BipeResposta> {
  const params = new URLSearchParams({ codigoBarras: codigoBarras.trim(), filial, company: companyKey });
  // Só leitura: repetir é seguro. 3 tentativas antes de desistir.
  const esperas = [0, 400, 1200];
  let response: Response | null = null;
  let ultimoErro: unknown = null;
  for (const espera of esperas) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    try {
      response = await fetch(`/api/transferencia-produtos/bipar?${params.toString()}`, { cache: "no-store" });
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
  return { status: json.status ?? "nao_encontrado", item: json.item ?? null, opcoes: json.opcoes ?? [] };
}

async function buscarProdutoPorCodigoBarras(
  codigoBarras: string,
  companyKey: string
): Promise<{ produto: string; codigoBarra: string | null; corProduto: string | null } | null> {
  const params = new URLSearchParams({ codigoBarras: codigoBarras.trim(), company: companyKey });
  const response = await fetch(`/api/transferencia-produtos/produto-por-codigo-barras?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { data: { produto: string; codigoBarra: string | null; corProduto: string | null } | null };
  return json.data || null;
}

async function searchProdutos(
  termo: string,
  filial: string,
  companyKey: string,
  corProduto?: string | null,
  barcodeHint?: string | null
): Promise<Produto[]> {
  if (!termo || termo.trim().length < 2) return [];
  const params = new URLSearchParams({ q: termo.trim(), filialOrigem: filial, company: companyKey, entrada: "true" });
  if (corProduto) params.set("corProduto", corProduto.trim());
  if (barcodeHint) params.set("barcodeHint", barcodeHint.trim());
  const response = await fetch(`/api/transferencia-produtos/produtos?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: Produto[] };
  return json.data || [];
}

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
  const response = await fetch(`/api/saidas-entradas-produtos/tamanhos?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Erro ao consultar os tamanhos");
  const json = (await response.json()) as {
    data: Array<{ produto: string; cor: string; exigeTamanho: boolean; tamanhos: TamanhoOpcao[] }>;
  };
  const mapa = new Map<string, TamanhoOpcao[]>();
  for (const d of json.data ?? []) mapa.set(`${d.produto}|${d.cor}`, d.exigeTamanho ? d.tamanhos : []);
  return mapa;
}

async function fetchRascunhos(companyKey: string): Promise<RascunhoResumo[]> {
  const response = await fetch(`/api/inventario/rascunhos?company=${encodeURIComponent(companyKey)}`, {
    cache: "no-store",
  });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: RascunhoResumo[] };
  return json.data || [];
}

async function sincronizarApi(body: string, username: string, keepalive = false): Promise<SyncResposta> {
  const response = await fetch("/api/inventario/rascunhos", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body,
    keepalive,
  });
  if (!response.ok) throw new Error("Erro ao salvar rascunho");
  return (await response.json()) as SyncResposta;
}

/** "Atualizar agora": o que mudou desde a versão (null = o rascunho não existe mais). */
async function atualizarRascunhoApi(id: string, versao: number): Promise<SnapshotRascunho | null> {
  const params = new URLSearchParams({ id, versao: String(versao) });
  const response = await fetch(`/api/inventario/rascunhos?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Erro ao atualizar o rascunho");
  const json = (await response.json()) as { data: SnapshotRascunho | null };
  return json.data ?? null;
}

/** Entra na filial: o compartilhado completo (convertendo o rascunho antigo do usuário, se for o caso). */
async function abrirFilialApi(companyKey: string, filialCod: string, username: string): Promise<SnapshotRascunho | null> {
  const response = await fetch("/api/inventario/rascunhos", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify({ acao: "abrir", company: companyKey, filialCod }),
  });
  if (!response.ok) throw new Error("Erro ao abrir o rascunho");
  const json = (await response.json()) as { data: SnapshotRascunho | null };
  return json.data ?? null;
}

async function adotarRascunhoApi(
  id: string,
  somar: boolean,
  username: string
): Promise<
  | { estado: "ok"; rascunho: RascunhoResumo }
  | { estado: "conflito"; existente: RascunhoResumo; antigo: RascunhoResumo }
  | { estado: "nao_encontrado" }
> {
  const response = await fetch("/api/inventario/rascunhos", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify({ acao: "adotar", id, somar }),
  });
  if (!response.ok) throw new Error("Erro ao continuar o rascunho");
  return response.json();
}

async function descartarRascunhoApi(id: string, username: string): Promise<void> {
  const response = await fetch(`/api/inventario/rascunhos?${new URLSearchParams({ id }).toString()}`, {
    method: "DELETE",
    headers: { "x-auth-username": username },
  });
  if (!response.ok) throw new Error("Erro ao descartar o rascunho");
}

function fmtHora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/* ── KPIs (mesmos quadros do Ajuste de Estoque) ── */

function KpiStrip({
  totais,
  naoBipados,
  zerarNaoContados,
}: {
  totais: ReturnType<typeof calcularDiferencasLocal>["totais"];
  naoBipados: number;
  zerarNaoContados: boolean;
}) {
  return (
    <div className={styles.kpiStrip}>
      <div className={`${styles.kpiBox} ${styles.kpiDestaque}`}>
        <span className={styles.kpiLabel}>Saldo atual</span>
        <span className={styles.kpiValor}>{fmtNum(totais.saldoAtualTotal)}</span>
      </div>
      <div className={`${styles.kpiBox} ${styles.kpiDestaque}`}>
        <span className={styles.kpiLabel}>Saldo final</span>
        <span className={`${styles.kpiValor} ${styles.final}`}>{fmtNum(totais.saldoFinalTotal)}</span>
      </div>
      <div className={styles.kpiBox}>
        <span className={styles.kpiLabel}>Variação líquida</span>
        <span className={`${styles.kpiValor} ${totais.somaDelta < 0 ? styles.neg : styles.pos}`}>
          {totais.somaDelta > 0 ? "+" : ""}
          {fmtNum(totais.somaDelta)}
        </span>
      </div>
      <div className={styles.kpiBox}>
        <span className={styles.kpiLabel}>Com diferença</span>
        <span className={styles.kpiValor}>{fmtNum(totais.comDiferenca)}</span>
      </div>
      <div className={styles.kpiBox}>
        <span className={styles.kpiLabel}>Entradas (+)</span>
        <span className={`${styles.kpiValor} ${styles.pos}`}>{fmtNum(totais.positivos)}</span>
      </div>
      <div className={styles.kpiBox}>
        <span className={styles.kpiLabel}>Saídas (−)</span>
        <span className={`${styles.kpiValor} ${styles.neg}`}>{fmtNum(totais.negativos)}</span>
      </div>
      {zerarNaoContados && (
        <div className={`${styles.kpiBox} ${naoBipados > 0 ? styles.kpiAlerta : ""}`}>
          <span className={styles.kpiLabel} title="Itens com saldo que ainda não foram bipados: viram 0 ao subir">
            Não bipados (zeram)
          </span>
          <span className={`${styles.kpiValor} ${naoBipados > 0 ? styles.neg : ""}`}>{fmtNum(naoBipados)}</span>
        </div>
      )}
    </div>
  );
}

/** Quadros de um ajuste já feito (cópia do Ajuste de Estoque, modo histórico). */
function AjusteKpisResumo({ kpis }: { kpis: AjusteKpis }) {
  const t = kpis.totais;
  const semDado = "Não guardado para este ajuste";
  return (
    <div className={a.detalheKpis}>
      <div className={a.totaisBar}>
        <div className={`${a.totalBox} ${a.totalBoxDestaque} ${styles.boxVerde}`}>
          <span className={a.totalLabel}>Saldo anterior</span>
          <span className={a.totalValor} title={t.saldoAtualTotal == null ? semDado : undefined}>
            {fmtNum(t.saldoAtualTotal)}
          </span>
        </div>
        <div className={`${a.totalBox} ${a.totalBoxDestaque} ${styles.boxVerde}`}>
          <span className={a.totalLabel}>Saldo final após ajuste</span>
          <span className={`${a.totalValor} ${styles.final}`} title={t.saldoFinalTotal == null ? semDado : undefined}>
            {fmtNum(t.saldoFinalTotal)}
          </span>
        </div>
        <div className={a.totalBox}>
          <span className={a.totalLabel}>Variação líquida</span>
          <span className={`${a.totalValor} ${t.somaDelta < 0 ? a.neg : a.pos}`}>
            {t.somaDelta > 0 ? "+" : ""}
            {fmtNum(t.somaDelta)}
          </span>
        </div>
        <div className={a.totalBox}>
          <span className={a.totalLabel}>Itens no escopo</span>
          <span className={a.totalValor} title={t.itens == null ? semDado : undefined}>
            {fmtNum(t.itens)}
          </span>
        </div>
        <div className={a.totalBox}>
          <span className={a.totalLabel}>Com diferença</span>
          <span className={a.totalValor}>{fmtNum(t.comDiferenca)}</span>
        </div>
        <div className={a.totalBox}>
          <span className={a.totalLabel}>Entradas (+)</span>
          <span className={`${a.totalValor} ${a.pos}`}>{t.positivos ?? "—"}</span>
        </div>
        <div className={a.totalBox}>
          <span className={a.totalLabel}>Saídas (−)</span>
          <span className={`${a.totalValor} ${a.neg}`}>{t.negativos ?? "—"}</span>
        </div>
      </div>
      {kpis.fonte === "ajuste" && (
        <p className={a.fileHintMuted}>
          Saldos e escopo não foram guardados para este ajuste — o Linx só grava os itens com diferença.
        </p>
      )}
      {kpis.fonte === "movimento" && (
        <p className={a.fileHintMuted}>
          Saldos reconstruídos pelos movimentos do Linx (estoque atual − o que entrou e saiu depois do ajuste),
          somando só os itens ajustados.
        </p>
      )}
      {kpis.fonte === "contagem" && <p className={a.fileHintMuted}>Saldos lidos da contagem física registrada no Linx.</p>}
    </div>
  );
}

export default function InventarioBipagemPage({ companyKey, companyName }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";
  const somenteLeitura = isReadOnlyRole(user?.role);

  // ── FILIAL ─────────────────────────────────────────────────────────────────
  const [filiais, setFiliais] = useState<{ ativas: FilialInventario[]; inativas: FilialInventario[] }>({
    ativas: [],
    inativas: [],
  });
  const [carregandoFiliais, setCarregandoFiliais] = useState(true);
  const [filialCod, setFilialCod] = useState("");
  const filialSelecionada = useMemo(
    () => filiais.ativas.find((f) => f.cod === filialCod) ?? filiais.inativas.find((f) => f.cod === filialCod) ?? null,
    [filiais, filialCod]
  );

  const [nomeContagem, setNomeContagem] = useState("");
  const [nomeEditado, setNomeEditado] = useState(false);
  const [observacao, setObservacao] = useState("");
  /**
   * Inventário é SEMPRE completo (o que tem saldo e não foi bipado vira 0) — regra
   * do dono: não existe opção de parcial, para evitar erro humano. O servidor
   * também força (ver /api/inventario/preview e /executar).
   */
  const zerarNaoContados = true;

  // ── SALDO (base das diferenças em tempo real) ──────────────────────────────
  const [saldo, setSaldo] = useState<SaldoFilial | null>(null);
  const [carregandoSaldo, setCarregandoSaldo] = useState(false);
  const [erroSaldo, setErroSaldo] = useState<string | null>(null);
  const [saldoRefreshKey, setSaldoRefreshKey] = useState(0);

  // ── LISTA ──────────────────────────────────────────────────────────────────
  const [produtosSelecionados, setProdutosSelecionados] = useState<LinhaInventario[]>([]);
  const [notificacao, setNotificacao] = useState<{ mensagem: string; tipo: "success" | "error" } | null>(null);
  const notificacaoTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [view, setView] = useState<"bipados" | "diferencas">("bipados");
  const [mostrarTodos, setMostrarTodos] = useState(false);

  // ── MODAL DE BUSCA ─────────────────────────────────────────────────────────
  const [modalAberto, setModalAberto] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [colorPickerProduto, setColorPickerProduto] = useState<Produto | null>(null);
  const [colorPickerOpcoes, setColorPickerOpcoes] = useState<Produto[]>([]);
  const [loadingColorPicker, setLoadingColorPicker] = useState(false);

  // ── BIPAGEM ────────────────────────────────────────────────────────────────
  const [codigoBipado, setCodigoBipado] = useState("");
  const [bipagem, setBipagem] = useState<BipagemDiario>({ escopo: null, ...BIPAGEM_VAZIA });
  const bipesEmVoo = bipagem.emVoo.length;
  const filaBipesRef = useRef<{ ativos: number; espera: Array<() => void> }>({ ativos: 0, espera: [] });
  /** Escopo da lista no render atual — o bipe confere se ainda é o mesmo quando a consulta volta. */
  const escopoBipeRef = useRef<string | null>(null);
  const [ultimoBipe, setUltimoBipe] = useState<{ ok: boolean; titulo: string; detalhe: string } | null>(null);
  const [itemDestacado, setItemDestacado] = useState<string | null>(null);
  const [somBipeLigado, setSomBipeLigado] = useState(true);
  const bipeInputRef = useRef<HTMLInputElement | null>(null);
  const destaqueTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ── SUBIR ESTOQUE ──────────────────────────────────────────────────────────
  const [conferindo, setConferindo] = useState(false);
  const [previewServidor, setPreviewServidor] = useState<PreviewServidor | null>(null);
  const [previewAssinatura, setPreviewAssinatura] = useState("");
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [resultado, setResultado] = useState<{
    nomeContagem: string;
    filialNome: string;
    itensAjustados: number;
    somaDelta: number;
    sobra: number;
  } | null>(null);

  // ── HISTÓRICO (Ajustes recentes do Ajuste de Estoque) ───────────────────────
  const [abaLateral, setAbaLateral] = useState<"historico" | "rascunhos">("historico");
  const [recentes, setRecentes] = useState<AjusteRecente[]>([]);
  const [carregandoRecentes, setCarregandoRecentes] = useState(false);
  const [historicoTodas, setHistoricoTodas] = useState(false);
  const [detalheAberto, setDetalheAberto] = useState<AjusteRecente | null>(null);
  const [detalheCache, setDetalheCache] = useState<Record<string, AjusteDetalhe>>({});
  const [detalheCarregando, setDetalheCarregando] = useState(false);
  const [estornandoNome, setEstornandoNome] = useState<string | null>(null);

  // ── RASCUNHOS ──────────────────────────────────────────────────────────────
  const [rascunhos, setRascunhos] = useState<RascunhoResumo[]>([]);
  const [loadingRascunhos, setLoadingRascunhos] = useState(false);
  const [rascunhoStatus, setRascunhoStatus] = useState<RascunhoStatus>("idle");
  const [rascunhoRestauradoEm, setRascunhoRestauradoEm] = useState<string | null>(null);
  /** Estado (não ref) de propósito: o autosave precisa ser reavaliado quando a abertura termina. */
  const [hidratandoRascunho, setHidratandoRascunho] = useState(false);
  /** Sincronização com o rascunho compartilhado da filial (ver `SyncCtx`). */
  const syncRef = useRef<SyncCtx>(novoSyncCtx(""));
  /** Última versão do servidor aplicada na tela (participantes, rastro por linha). */
  const [rascunhoAtual, setRascunhoAtual] = useState<RascunhoResumo | null>(null);
  /** Quem está subindo este inventário agora (bipes esperam). */
  const [travadoPor, setTravadoPor] = useState<string | null>(null);
  const travadoPorRef = useRef<string | null>(null);
  /** Alguém subiu/descartou o inventário que estava nesta tela. */
  const [encerramento, setEncerramento] = useState<EncerramentoInventario | null>(null);
  /** "fulana bipou +2 peças" — o que chegou dos colegas na última consulta. */
  const [atividadeRemota, setAtividadeRemota] = useState<string | null>(null);
  /** Esta tela está subindo: resposta de "encerrado" no meio é da própria subida. */
  const executandoRef = useRef(false);
  /** O inventário desta tela acabou: não aceita bipe até "Começar novo inventário". */
  const encerradoRef = useRef(false);
  /** Itens do servidor conhecidos pela tela (rastro de quem bipou cada linha). */
  const [baseItens, setBaseItens] = useState<Map<string, RascunhoItemServidor>>(() => new Map());
  const [atualizando, setAtualizando] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string | null>(null);
  /** Na confirmação: subir mesmo com bipes que não entraram na tela de colegas. */
  const [aceitarOcorrencias, setAceitarOcorrencias] = useState(false);
  /** Bipes guardados no navegador (de antes de recarregar/trocar de filial) ainda não gravados. */
  const [pecasRecuperando, setPecasRecuperando] = useState(0);
  /** Bipes guardados que não puderam mais entrar (o inventário deles já tinha subido). */
  const [pecasPerdidas, setPecasPerdidas] = useState<Array<{ rotulo: string; quantidade: number }>>([]);

  const mostrarNotificacao = useCallback((mensagem: string, tipo: "success" | "error" = "success") => {
    setNotificacao({ mensagem, tipo });
    if (notificacaoTimeoutRef.current) clearTimeout(notificacaoTimeoutRef.current);
    notificacaoTimeoutRef.current = setTimeout(() => setNotificacao(null), tipo === "error" ? 6000 : 3000);
  }, []);

  // Filiais: a mesma lista do Ajuste de Estoque (ativas da empresa + não utilizadas).
  useEffect(() => {
    let ativo = true;
    setCarregandoFiliais(true);
    fetch(`/api/ajuste-estoque/filiais?company=${companyKey}`)
      .then((r) => r.json())
      .then((data) => {
        if (!ativo) return;
        if (data?.ativas) setFiliais({ ativas: data.ativas, inativas: data.inativas ?? [] });
      })
      .catch(() => {})
      .finally(() => ativo && setCarregandoFiliais(false));
    return () => {
      ativo = false;
    };
  }, [companyKey]);

  // Descrição sugerida (igual ao Ajuste de Estoque) enquanto o usuário não editar.
  useEffect(() => {
    if (nomeEditado || !filialSelecionada) return;
    setNomeContagem(sugerirNome(filialSelecionada.display, hojeISO()));
  }, [filialSelecionada, nomeEditado]);

  // Saldo da filial: base das diferenças em tempo real.
  useEffect(() => {
    if (!filialCod) {
      setSaldo(null);
      setErroSaldo(null);
      return;
    }
    let cancelado = false;
    setCarregandoSaldo(true);
    setErroSaldo(null);
    fetch(`/api/inventario/saldo?filialCod=${encodeURIComponent(filialCod)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error || "Erro ao carregar o saldo da filial.");
        return d as { filialNome: string; itens: SaldoItem[]; carregadoEm: string };
      })
      .then((d) => {
        if (cancelado) return;
        setSaldo({ filialCod, filialNome: d.filialNome, itens: d.itens ?? [], carregadoEm: d.carregadoEm });
      })
      .catch((err: Error) => {
        if (cancelado) return;
        setSaldo((prev) => (prev?.filialCod === filialCod ? prev : null));
        setErroSaldo(err.message);
      })
      .finally(() => {
        if (!cancelado) setCarregandoSaldo(false);
      });
    return () => {
      cancelado = true;
    };
  }, [filialCod, saldoRefreshKey]);

  const saldoDaFilial = saldo && saldo.filialCod === filialCod ? saldo : null;
  /** Nome exato da filial no Linx — é por ele que a bipagem e a busca consultam. */
  const filialNomeLinx = saldoDaFilial?.filialNome ?? filialSelecionada?.nome ?? "";

  const saldoPorNorm = useMemo(
    () => new Map((saldoDaFilial?.itens ?? []).map((it) => [chaveNorm(it.produto, it.cor), it])),
    [saldoDaFilial]
  );

  /** Saldo de uma linha da lista (do tamanho, em peça P/M/G). */
  const saldoDaLinha = useCallback(
    (p: LinhaInventario): number | null => {
      if (!saldoDaFilial) return null;
      const it = saldoPorNorm.get(chaveNorm(p.produto, p.corProduto));
      if (!it) return 0;
      if (p.tamanho && p.tamanhos && p.tamanhos.length > 0) return it.tamanhos[String(p.tamanho)] ?? 0;
      return it.estoque;
    },
    [saldoDaFilial, saldoPorNorm]
  );

  const diferencas = useMemo(
    () => calcularDiferencasLocal(saldoDaFilial?.itens ?? [], produtosSelecionados, zerarNaoContados),
    [saldoDaFilial, produtosSelecionados, zerarNaoContados]
  );

  // ── HISTÓRICO ──────────────────────────────────────────────────────────────

  const fetchRecentes = useCallback(async () => {
    if (!username) return;
    setCarregandoRecentes(true);
    try {
      const r = await fetch("/api/ajuste-estoque/recentes", { headers: { "x-auth-username": username } });
      const d = await r.json();
      setRecentes(Array.isArray(d?.recentes) ? d.recentes : []);
    } catch {
      /* silencioso */
    } finally {
      setCarregandoRecentes(false);
    }
  }, [username]);

  useEffect(() => {
    void fetchRecentes();
  }, [fetchRecentes]);

  const abrirDetalhe = useCallback(
    async (r: AjusteRecente) => {
      setDetalheAberto(r);
      if (detalheCache[r.nome]) return;
      setDetalheCarregando(true);
      try {
        const resp = await fetch(`/api/ajuste-estoque/detalhe?nome=${encodeURIComponent(r.nome)}`);
        const d = await resp.json();
        setDetalheCache((prev) => ({
          ...prev,
          [r.nome]: { itens: Array.isArray(d?.itens) ? d.itens : [], kpis: d?.kpis ?? null },
        }));
      } catch {
        setDetalheCache((prev) => ({ ...prev, [r.nome]: { itens: [], kpis: null } }));
      } finally {
        setDetalheCarregando(false);
      }
    },
    [detalheCache]
  );

  const desfazer = useCallback(
    async (nome: string) => {
      if (
        !window.confirm(
          `Desfazer o inventário "${nome}"? Será criado um estorno que devolve o estoque ao estado anterior (registrado no histórico).`
        )
      ) {
        return;
      }
      setEstornandoNome(nome);
      try {
        const r = await fetch("/api/ajuste-estoque/estornar", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ nomeOriginal: nome }),
        });
        const d = await r.json();
        if (!r.ok) {
          mostrarNotificacao(d?.error ?? "Erro ao desfazer o inventário.", "error");
          return;
        }
        mostrarNotificacao(`Estorno "${d.nomeContagem}" aplicado — ${d.itensAjustados} item(ns) revertido(s).`);
        setResultado((prev) => (prev?.nomeContagem === nome ? null : prev));
        setDetalheAberto(null);
        void fetchRecentes();
        setSaldoRefreshKey((k) => k + 1);
      } catch {
        mostrarNotificacao("Erro de conexão ao desfazer o inventário.", "error");
      } finally {
        setEstornandoNome(null);
      }
    },
    [username, fetchRecentes, mostrarNotificacao]
  );

  // ── BIPAGEM ────────────────────────────────────────────────────────────────

  /**
   * Espelho síncrono da lista. O ref serve para DECIDIR; a gravação na lista é
   * sempre por updater funcional, sobre a lista real.
   */
  const produtosSelecionadosRef = useRef<LinhaInventario[]>(produtosSelecionados);
  useEffect(() => {
    produtosSelecionadosRef.current = produtosSelecionados;
  }, [produtosSelecionados]);

  const zerarBipagem = useCallback(() => {
    setBipagem((b) => {
      const zerado: BipagemDiario = { ...b, lidos: b.emVoo.length, aceitos: 0, ocorrencias: [], dispensadas: [] };
      salvarBipagem(zerado);
      return zerado;
    });
  }, []);

  /** Inventário subido: o diário perde o que foi para ele. O que chegou durante a gravação continua. */
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

  /** Bipe curto e agudo = entrou; erro = três toques graves. */
  const tocarBipe = useCallback(
    (ok: boolean) => {
      if (!somBipeLigado) return;
      try {
        const Ctor =
          window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
        // Sem áudio: segue sem som.
      }
    },
    [somBipeLigado]
  );

  const focarCampoBipe = useCallback(() => {
    requestAnimationFrame(() => bipeInputRef.current?.focus());
  }, []);

  /** Devolve o cursor ao campo sem roubar de quem está digitando quantidade/observação/descrição. */
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

  const registrarBipe = useCallback(
    (ok: boolean, titulo: string, detalhe: string) => {
      setUltimoBipe({ ok, titulo, detalhe });
      tocarBipe(ok);
    },
    [tocarBipe]
  );

  const anotarOcorrencia = useCallback(
    (oc: Omit<BipeOcorrencia, "id" | "em"> & { id?: string }) => {
      const completa: BipeOcorrencia = { ...oc, id: oc.id ?? novoIdBipe(), em: Date.now() };
      setBipagem((b) => ({ ...b, ocorrencias: [...b.ocorrencias.filter((o) => o.id !== completa.id), completa] }));
      registrarBipe(false, oc.titulo, oc.detalhe);
    },
    [registrarBipe]
  );

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
      if (notificacaoTimeoutRef.current) clearTimeout(notificacaoTimeoutRef.current);
    };
  }, []);

  /** Põe a peça na lista. No inventário não há teto: saldo zerado/negativo também entra. */
  const adicionarItemBipado = useCallback(
    (item: BipeItem, codigoLido: string): boolean => {
      // Bipe que estava em consulta quando o inventário subiu: não entra mais nele.
      if (encerradoRef.current) {
        registrarBipe(false, "Inventário encerrado — a peça NÃO entrou", `O código ${codigoLido} chegou depois que o inventário subiu.`);
        return false;
      }
      if (!filialCod) {
        anotarOcorrencia({
          codigo: codigoLido,
          tipo: "filial_trocada",
          titulo: "Selecione a filial — a peça NÃO entrou",
          detalhe: "O inventário precisa saber de qual loja é a contagem.",
        });
        return false;
      }

      // Peça P/M/G: o código de barras é de UM tamanho — a peça entra nele.
      const grade = item.exigeTamanho ? item.tamanhos ?? [] : [];
      const tamanhoBipado = grade.length > 0 ? grade.find((t) => t.ordinal === item.tamanho) ?? null : null;

      const corTxt = textoCorProduto(item.descCor, item.corProduto);
      const rotuloBase = corTxt ? `${item.descProduto} · ${corTxt}` : item.descProduto;
      const rotulo = tamanhoBipado ? `${rotuloBase} · ${tamanhoBipado.label}` : rotuloBase;
      const chave = chaveLinha({ produto: item.produto, corProduto: item.corProduto, tamanho: tamanhoBipado?.ordinal ?? null });
      const casaLinha = (p: LinhaInventario) =>
        p.produto === item.produto &&
        (p.corProduto ?? "") === (item.corProduto ?? "") &&
        (p.tamanho ?? null) === (tamanhoBipado?.ordinal ?? null);

      const aplicar = (lista: LinhaInventario[]): LinhaInventario[] => {
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
              quantidade: 1,
              tamanhos: grade,
              tamanho: tamanhoBipado?.ordinal ?? null,
              tamanhoLabel: tamanhoBipado?.label ?? null,
            },
          ];
        }
        const next = [...lista];
        next[idx] = { ...lista[idx], quantidade: lista[idx].quantidade + 1, tamanhos: grade };
        return next;
      };

      const quantidade = (produtosSelecionadosRef.current.find(casaLinha)?.quantidade ?? 0) + 1;
      produtosSelecionadosRef.current = aplicar(produtosSelecionadosRef.current);
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
        `${item.produto}${item.codigoBarra ? ` · ${item.codigoBarra}` : ""} · contado ${quantidade}` +
          (grade.length > 0 && !tamanhoBipado ? " · escolha o tamanho na lista" : "")
      );
      return true;
    },
    [filialCod, registrarBipe, anotarOcorrencia, destacarItem]
  );

  const processarBipe = useCallback(
    async (codigoRaw: string, opts?: { repeticao?: boolean }) => {
      const codigo = codigoRaw.trim();
      if (!codigo) return;
      if (!filialCod || !filialNomeLinx) {
        registrarBipe(false, "Selecione a filial", "Escolha a loja antes de bipar.");
        return;
      }
      if (encerradoRef.current) {
        registrarBipe(
          false,
          "Inventário encerrado — a peça NÃO entrou",
          "Este inventário já subiu. Para contar de novo, clique em “Começar novo inventário”."
        );
        return;
      }

      const escopoNaHora = escopoBipeRef.current;
      const id = novoIdBipe();
      setBipagem((b) => ({
        ...b,
        lidos: opts?.repeticao ? b.lidos : b.lidos + 1,
        emVoo: [...b.emVoo, { id, codigo, em: Date.now() }],
      }));
      try {
        const resposta = await naFilaDeBipe(filaBipesRef.current, () => biparCodigo(codigo, filialNomeLinx, companyKey));

        // Trocou de filial enquanto a consulta ia: a peça era da lista anterior.
        if (escopoBipeRef.current !== escopoNaHora) {
          anotarOcorrencia({
            id,
            codigo,
            tipo: "filial_trocada",
            titulo: "Bipe da lista anterior — NÃO entrou",
            detalhe: `O código ${codigo} foi lido antes de trocar a filial. Se a peça é deste inventário, bipe de novo.`,
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
        // Inventário conta o que está na loja: saldo zerado (sem_estoque) também entra.
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
    },
    [filialCod, filialNomeLinx, companyKey, registrarBipe, anotarOcorrencia, adicionarItemBipado, devolverFocoSeLivre]
  );

  /** O listener global do leitor é montado uma vez: chama sempre a versão atual. */
  const processarBipeRef = useRef(processarBipe);
  useEffect(() => {
    processarBipeRef.current = processarBipe;
  }, [processarBipe]);

  const submeterBipe = useCallback(
    (valor?: string) => {
      const codigo = (valor ?? codigoBipado).trim();
      if (!codigo) return;
      // Limpa ANTES de consultar: o próximo bipe já pode estar chegando pelo leitor.
      setCodigoBipado("");
      void processarBipe(codigo);
    },
    [codigoBipado, processarBipe]
  );

  const tirarOcorrencia = useCallback((id: string) => {
    setBipagem((b) => ({ ...b, ocorrencias: b.ocorrencias.filter((o) => o.id !== id) }));
  }, []);

  const tentarBipeDeNovo = useCallback(
    (oc: BipeOcorrencia) => {
      tirarOcorrencia(oc.id);
      void processarBipe(oc.codigo, { repeticao: true });
    },
    [tirarOcorrencia, processarBipe]
  );

  const escolherOpcaoAmbigua = useCallback(
    (oc: BipeOcorrencia, item: BipeItem) => {
      tirarOcorrencia(oc.id);
      adicionarItemBipado(item, oc.codigo);
      focarCampoBipe();
    },
    [tirarOcorrencia, adicionarItemBipado, focarCampoBipe]
  );

  /** Dispensar é decisão consciente: a peça fica registrada como "não entra neste inventário". */
  const dispensarOcorrencia = useCallback(
    (id: string) => {
      setBipagem((b) => {
        const oc = b.ocorrencias.find((o) => o.id === id);
        if (!oc) return b;
        return { ...b, ocorrencias: b.ocorrencias.filter((o) => o.id !== id), dispensadas: [...b.dispensadas, oc] };
      });
      focarCampoBipe();
    },
    [focarCampoBipe]
  );

  /** "Dispensar todos" pede 2º clique (sem window.confirm: o Enter do leitor aceitaria o diálogo). */
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

  // Preferência de som (a mesma da tela de Saídas/Entradas).
  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(SOM_STORAGE_KEY);
      if (salvo !== null) setSomBipeLigado(salvo === "1");
    } catch {
      // mantém o padrão ligado
    }
  }, []);

  const alternarSomBipe = useCallback(() => {
    setSomBipeLigado((prev) => {
      const proximo = !prev;
      try {
        window.localStorage.setItem(SOM_STORAGE_KEY, proximo ? "1" : "0");
      } catch {
        // vale só para esta sessão
      }
      return proximo;
    });
  }, []);

  // Troca de loja zera o feedback do último bipe.
  useEffect(() => {
    setCodigoBipado("");
    setUltimoBipe(null);
  }, [filialCod]);

  const confirmacaoAberta = previewServidor !== null;

  // Cursor no campo de bipagem por padrão — inclusive quando um modal fecha.
  useEffect(() => {
    if (!filialCod || modalAberto || confirmacaoAberta || detalheAberto) return;
    focarCampoBipe();
  }, [filialCod, modalAberto, confirmacaoAberta, detalheAberto, focarCampoBipe]);

  /**
   * LEITOR FORA DO CAMPO: a rajada do leitor (teclas a ≤45ms) é reconhecida em
   * qualquer lugar da tela e vira bipe normal — senão o Enter do leitor clicaria o
   * botão focado (na lixeira, apagava a linha seguinte). Se caiu na quantidade, na
   * observação ou na descrição, o campo volta ao valor de antes.
   */
  useEffect(() => {
    if (!filialCod || modalAberto) return;

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

      // SELECT conta como não-editável: a busca por letra dele trocaria a filial.
      const editavel = !!alvo && (alvo.isContentEditable || alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA");
      const agora = performance.now();

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
          const chaveQtd = alvo.dataset.leitorQtd;
          if (chaveQtd !== undefined) {
            const qtd = Math.max(1, parseInt(valorAntes, 10) || 1);
            setProdutosSelecionados((prev) => prev.map((p) => (chaveLinha(p) === chaveQtd ? { ...p, quantidade: qtd } : p)));
          } else if (alvo.dataset.leitorObs !== undefined) {
            setObservacao(valorAntes);
          } else if (alvo.dataset.leitorNome !== undefined) {
            setNomeContagem(valorAntes);
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
  }, [filialCod, modalAberto, focarCampoBipe]);

  // ── LISTA: quantidade, tamanho, remover ────────────────────────────────────

  // Por CHAVE, não por posição: a lista é rebaseada com os bipes dos colegas a qualquer momento.
  const atualizarQuantidade = useCallback((chave: string, quantidade: number) => {
    if (!Number.isFinite(quantidade) || quantidade < 1) return;
    setProdutosSelecionados((prev) =>
      prev.map((p) => (chaveLinha(p) === chave ? { ...p, quantidade: Math.trunc(quantidade) } : p))
    );
  }, []);

  const removerProduto = useCallback((chave: string) => {
    setProdutosSelecionados((prev) => prev.filter((p) => chaveLinha(p) !== chave));
  }, []);

  const limparLista = useCallback(() => {
    const eu = username.toLowerCase();
    const outros = (rascunhoAtual?.participantes ?? []).filter((p) => p.username !== eu).map((p) => p.username);
    const aviso =
      outros.length > 0
        ? `Limpar a lista inteira deste inventário? Apaga também o que ${outros.join(", ")} bipou.`
        : "Limpar a lista inteira deste inventário? O que foi bipado será perdido.";
    if (!window.confirm(aviso)) return;
    setProdutosSelecionados([]);
    zerarBipagem();
  }, [zerarBipagem, username, rascunhoAtual]);

  /**
   * Grade das linhas que ainda não a conhecem (adicionadas pela busca ou vindas do
   * rascunho). A bipagem já traz a grade junto.
   */
  const gradeEmVooRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!filialCod || !filialNomeLinx) return;
    const pendentes = produtosSelecionados.filter(
      (p) => p.tamanhos === undefined && !gradeEmVooRef.current.has(`${filialCod}|${p.produto}|${p.corProduto ?? ""}`)
    );
    if (pendentes.length === 0) return;
    const chaves = [...new Set(pendentes.map((p) => `${filialCod}|${p.produto}|${p.corProduto ?? ""}`))];
    chaves.forEach((k) => gradeEmVooRef.current.add(k));
    const unicos = [...new Map(pendentes.map((p) => [`${p.produto}|${p.corProduto ?? ""}`, p])).values()];

    fetchTamanhos(companyKey, filialNomeLinx, unicos)
      .then((mapa) => {
        setProdutosSelecionados((prev) => {
          const next = prev.map((p) => {
            if (p.tamanhos !== undefined) return p;
            const grade = mapa.get(`${p.produto}|${p.corProduto ?? ""}`);
            if (!grade) return p;
            if (grade.length === 0) return { ...p, tamanhos: [], tamanho: null, tamanhoLabel: null };
            const escolhido = p.tamanho ? grade.find((t) => t.ordinal === p.tamanho) : undefined;
            return escolhido
              ? { ...p, tamanhos: grade, tamanhoLabel: escolhido.label }
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
  }, [produtosSelecionados, filialCod, filialNomeLinx, companyKey, mostrarNotificacao]);

  /** Escolhe o tamanho de uma linha; se já há linha no mesmo tamanho, as duas se juntam. */
  const escolherTamanho = useCallback((chave: string, ordinal: number) => {
    setProdutosSelecionados((prev) => {
      const index = prev.findIndex((p) => chaveLinha(p) === chave);
      const linha = index === -1 ? undefined : prev[index];
      const opcao = linha?.tamanhos?.find((t) => t.ordinal === ordinal);
      if (!linha || !opcao) return prev;
      const destino = prev.findIndex(
        (p, i) =>
          i !== index &&
          p.produto === linha.produto &&
          (p.corProduto ?? "") === (linha.corProduto ?? "") &&
          p.tamanho === ordinal
      );
      let next: LinhaInventario[];
      if (destino !== -1) {
        next = prev
          .map((p, i) => (i === destino ? { ...p, quantidade: p.quantidade + linha.quantidade } : p))
          .filter((_, i) => i !== index);
      } else {
        next = [...prev];
        next[index] = { ...linha, tamanho: ordinal, tamanhoLabel: opcao.label };
      }
      produtosSelecionadosRef.current = next;
      return next;
    });
  }, []);

  const pendenciaTamanho = useCallback((lista: LinhaInventario[]): string | null => {
    if (lista.some((p) => p.tamanhos === undefined)) return "Aguarde: consultando os tamanhos dos produtos da lista.";
    const sem = lista.filter(faltaTamanho);
    if (sem.length === 0) return null;
    const nomes = [...new Set(sem.map((p) => p.descProduto || p.produto))].slice(0, 5).join(", ");
    return `Escolha o tamanho (P/M/G) de: ${nomes}${sem.length > 5 ? "…" : ""}.`;
  }, []);

  // ── MODAL "ADICIONAR PRODUTO" (busca por nome / SKU / código) ───────────────

  const abrirModalAdicionarProduto = useCallback(() => {
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
    setModalAberto(true);
  }, []);

  const fecharModalAdicionarProduto = useCallback(() => {
    setModalAberto(false);
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, []);

  useEffect(() => {
    if (!modalAberto || !searchTerm || searchTerm.trim().length < 2 || !filialNomeLinx) {
      setProdutos([]);
      return;
    }
    let active = true;
    setLoadingProdutos(true);
    const timeoutId = setTimeout(async () => {
      try {
        const termo = searchTerm.trim();
        let results: Produto[] = [];
        if (termo.length >= 3) {
          const porCodigo = await buscarProdutoPorCodigoBarras(termo, companyKey);
          if (porCodigo) {
            results = await searchProdutos(
              porCodigo.produto,
              filialNomeLinx,
              companyKey,
              porCodigo.corProduto,
              porCodigo.codigoBarra || termo
            );
            if (results.length === 0 && porCodigo.corProduto) {
              results = await searchProdutos(porCodigo.produto, filialNomeLinx, companyKey, null, porCodigo.codigoBarra || termo);
            }
          }
        }
        if (results.length === 0) results = await searchProdutos(termo, filialNomeLinx, companyKey);
        if (active) setProdutos(results);
      } catch {
        if (active) setProdutos([]);
      } finally {
        if (active) setLoadingProdutos(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [modalAberto, searchTerm, filialNomeLinx, companyKey]);

  useEffect(() => {
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [searchTerm]);

  // Cores disponíveis quando o seletor de cor é aberto.
  useEffect(() => {
    if (!colorPickerProduto) {
      setColorPickerOpcoes([]);
      setLoadingColorPicker(false);
      return;
    }
    const coresNoResultado = produtos.filter(
      (p) => p.produto.trim() === colorPickerProduto.produto.trim() && p.corProduto !== null
    );
    if (coresNoResultado.length > 0) {
      setColorPickerOpcoes(coresNoResultado);
      setLoadingColorPicker(false);
      return;
    }
    let cancelled = false;
    setLoadingColorPicker(true);
    searchProdutos(colorPickerProduto.produto, filialNomeLinx, companyKey)
      .then((result) => {
        if (!cancelled) {
          setColorPickerOpcoes(
            result.filter((p) => p.produto.trim() === colorPickerProduto.produto.trim() && p.corProduto !== null)
          );
        }
      })
      .catch(() => {
        if (!cancelled) setColorPickerOpcoes([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingColorPicker(false);
      });
    return () => {
      cancelled = true;
    };
  }, [colorPickerProduto, companyKey, produtos, filialNomeLinx]);

  /** Peça adicionada pela busca entra direto na lista (+1), como um bipe. */
  const adicionarProdutoBusca = useCallback(
    (produto: Produto) => {
      if (encerradoRef.current) {
        mostrarNotificacao("Este inventário já subiu. Clique em “Começar novo inventário”.", "error");
        return;
      }
      if (!filialCod) {
        mostrarNotificacao("Selecione uma filial primeiro", "error");
        return;
      }
      if (produto.corProduto === null) {
        const temVariantesComCor = produtos.some(
          (p) => p.produto.trim() === produto.produto.trim() && p.corProduto !== null
        );
        if (temVariantesComCor) {
          setColorPickerProduto(produto);
          return;
        }
      }
      setColorPickerProduto(null);
      setColorPickerOpcoes([]);
      const cor = produto.corProduto ? produto.corProduto.trim() : null;
      setProdutosSelecionados((prev) => {
        // Peça P/M/G já com tamanho escolhido não recebe a soma: abre outra linha,
        // onde o operador escolhe o tamanho dela.
        const idx = prev.findIndex((p) => p.produto === produto.produto && (p.corProduto ?? null) === cor && !p.tamanho);
        const next =
          idx === -1
            ? [
                ...prev,
                {
                  produto: produto.produto,
                  descProduto: produto.descProduto,
                  codigoBarra: produto.codigoBarra ?? null,
                  corProduto: cor,
                  descCor: (produto.descCor || "").trim(),
                  quantidade: 1,
                },
              ]
            : prev.map((p, i) => (i === idx ? { ...p, quantidade: p.quantidade + 1 } : p));
        produtosSelecionadosRef.current = next;
        return next;
      });
      mostrarNotificacao(`${produto.descProduto} adicionado`);
    },
    [filialCod, produtos, mostrarNotificacao]
  );

  // ── RASCUNHOS ──────────────────────────────────────────────────────────────

  const carregarRascunhos = useCallback(async () => {
    setLoadingRascunhos(true);
    try {
      setRascunhos(await fetchRascunhos(companyKey));
    } catch {
      // aba auxiliar: falha de leitura não trava a operação
    } finally {
      setLoadingRascunhos(false);
    }
  }, [companyKey]);

  useEffect(() => {
    void carregarRascunhos();
  }, [carregarRascunhos]);

  /** Escopo da tela (diário da bipagem, que é de cada um): empresa × usuário × filial. */
  const escopoRascunho = username && filialCod ? `${companyKey}|${username}|${filialCod}` : null;

  useEffect(() => {
    escopoBipeRef.current = escopoRascunho;
  }, [escopoRascunho]);

  // Diário da bipagem segue o escopo e volta depois de um F5 (ocorrências inclusive).
  useEffect(() => {
    setBipagem(carregarBipagem(escopoRascunho));
  }, [escopoRascunho]);

  useEffect(() => {
    if (bipagem.escopo === escopoRascunho) salvarBipagem(bipagem);
  }, [bipagem, escopoRascunho]);

  // ── RASCUNHO COMPARTILHADO: sincronização ──────────────────────────────────

  /** Valores de agora para a sincronização (que roda fora do render). Declarado antes do autosave. */
  const vivoRef = useRef({
    username,
    companyKey: companyKey as string,
    filialNome: "",
    cab: CAB_VAZIO,
    ocorrencias: 0,
  });
  useEffect(() => {
    vivoRef.current = {
      username,
      companyKey,
      filialNome: filialSelecionada?.nome ?? filialNomeLinx,
      cab: cabecalhoLocal(nomeContagem, nomeEditado, observacao),
      ocorrencias: bipagem.ocorrencias.length,
    };
  }, [username, companyKey, filialSelecionada, filialNomeLinx, nomeContagem, nomeEditado, observacao, bipagem.ocorrencias.length]);

  useEffect(() => {
    travadoPorRef.current = travadoPor;
  }, [travadoPor]);

  const eu = username.toLowerCase();
  const participantes = rascunhoAtual?.participantes ?? [];
  const contandoJunto = participantes.some((p) => p.username !== eu && p.pecas > 0);
  /** Colegas com bipe que não entrou na contagem (painel vermelho da tela deles). */
  const colegasComOcorrencia = participantes.filter((p) => p.username !== eu && p.ocorrencias > 0);

  // "fulana bipou +2" some depois de uns segundos.
  useEffect(() => {
    if (!atividadeRemota) return;
    const t = setTimeout(() => setAtividadeRemota(null), 12000);
    return () => clearTimeout(t);
  }, [atividadeRemota]);

  /**
   * Aplica uma resposta do servidor (REBASE): base nova = base + o que mudou;
   * lista = base nova + (tela − referência). `referencia` = o que a tela tinha
   * mandado/conhecia. O cabeçalho do servidor só entra se a pessoa não mexeu nele.
   */
  const aplicarServidor = useCallback(
    (
      ctx: SyncCtx,
      snap: SnapshotRascunho,
      referencia: Array<LinhaInventario | RascunhoItemServidor>,
      cabReferencia: CabecalhoInventario | null
    ) => {
      const r = snap.rascunho;
      const mesmoRascunho = !!ctx.base && ctx.rascunhoId === r.id;
      const antes = mesmoRascunho && ctx.base ? ctx.base.itens : new Map<string, RascunhoItemServidor>();
      const novaBase = snap.completo || !mesmoRascunho ? new Map<string, RascunhoItemServidor>() : new Map(antes);
      for (const it of snap.itens) {
        const k = chaveSync(it);
        if (it.quantidade > 0) novaBase.set(k, it);
        else novaBase.delete(k);
      }

      const refQ = qtdPorChave(referencia);
      const transformar = (lista: LinhaInventario[]) => rebaseLista(lista, refQ, novaBase);
      // O ref é atualizado JÁ: o próximo envio (pode ser no mesmo tick) compara com a base nova.
      produtosSelecionadosRef.current = transformar(produtosSelecionadosRef.current);
      setProdutosSelecionados((prev) => {
        const next = transformar(prev);
        produtosSelecionadosRef.current = next;
        return next;
      });

      const cabServidor = cabecalhoDoServidor(r);
      const cabTela = vivoRef.current.cab;
      if ((cabReferencia === null || mesmoCabecalho(cabTela, cabReferencia)) && !mesmoCabecalho(cabTela, cabServidor)) {
        setNomeEditado(cabServidor.nomeEditado);
        if (cabServidor.nomeEditado) setNomeContagem(cabServidor.nomeContagem);
        setObservacao(cabServidor.observacao);
        vivoRef.current = { ...vivoRef.current, cab: cabServidor };
      }

      // Rastro: o que os colegas biparam desde a última versão que esta tela viu.
      if (mesmoRascunho) {
        const euAgora = vivoRef.current.username.toLowerCase();
        const ganhos = new Map<string, number>();
        for (const it of snap.itens) {
          const pu0 = antes.get(chaveSync(it))?.porUsuario ?? {};
          for (const [u, n] of Object.entries(it.porUsuario ?? {})) {
            if (u === euAgora) continue;
            const d = n - (pu0[u] ?? 0);
            if (d > 0) ganhos.set(u, (ganhos.get(u) ?? 0) + d);
          }
        }
        if (ganhos.size > 0) {
          setAtividadeRemota(
            [...ganhos.entries()].map(([u, n]) => `${u} bipou +${n} ${n === 1 ? "peça" : "peças"}`).join(" · ")
          );
        }
      }

      ctx.base = { versao: r.versao, itens: novaBase, cab: cabServidor };
      ctx.rascunhoId = r.id;
      setRascunhoAtual(r);
      setBaseItens(novaBase);
    },
    []
  );

  /**
   * Guarda no navegador o que esta tela ainda não gravou: o envio sem resposta
   * (exato, mesmo syncId) e o resto que nunca saiu. Chamado ANTES de cada envio e
   * a cada mudança na lista. Lista igual ao servidor = nada guardado.
   */
  const persistirPendente = useCallback((ctx: SyncCtx) => {
    if (!ctx.filialCod || ctx.abandonado || encerradoRef.current) return;
    const vivo = vivoRef.current;
    if (!vivo.username) return;
    const lista = produtosSelecionadosRef.current;
    const base = baseLista(ctx);
    const envios: PendenteGuardado["envios"] = [];
    if (ctx.incerto) {
      envios.push({ body: ctx.incerto.body, pecas: pecasDe(alemDaBase(ctx.incerto.enviado, qtdPorChave(base))) });
    }
    const ref = ctx.incerto ? ctx.incerto.enviado : base;
    const cabRef = ctx.incerto ? ctx.incerto.cabEnviado : ctx.base?.cab ?? CAB_VAZIO;
    const resto = montarEnvio(ctx, ref, lista, vivo.cab, cabRef, { ...vivo, ocorrencias: ctx.ocorrenciasEnviadas ?? 0 });
    if (resto) envios.push({ body: resto.body, pecas: pecasDe(alemDaBase(lista, qtdPorChave(ref))) });
    if (!ctx.chaveLocal) {
      if (envios.length === 0) return;
      ctx.chaveLocal = prefixoPendente(vivo.companyKey, vivo.username, ctx.filialCod) + novoIdBipe();
    }
    gravarPendente(ctx.chaveLocal, envios.length > 0 ? { envios, enviados: 0, em: new Date().toISOString() } : null);
  }, []);

  /** Esquece o que um contexto guardou (o conteúdo já está na tela de outro jeito ou foi mostrado). */
  const esquecerPendente = useCallback((ctx: SyncCtx) => {
    if (ctx.chaveLocal) gravarPendente(ctx.chaveLocal, null);
  }, []);

  /**
   * Manda, EXATAMENTE como foram guardados, os envios de um contexto que não está
   * mais na tela (página recarregada, filial trocada). O que não puder mais entrar
   * (inventário já subiu) vai para a lista de peças que não entraram, na tela.
   */
  const enviarGuardado = useCallback(async (chave: string): Promise<number> => {
    const user = vivoRef.current.username;
    const g = lerPendente(chave);
    if (!g || !user) return 0;
    for (let i = g.enviados; i < g.envios.length; i += 1) {
      let r: SyncResposta;
      try {
        r = await sincronizarApi(g.envios[i].body, user);
      } catch {
        return g.envios.slice(i).reduce((acc, e) => acc + e.pecas.reduce((a, p) => a + p.quantidade, 0), 0);
      }
      if (r.estado === "ok") {
        g.enviados = i + 1;
        gravarPendente(chave, g);
        continue;
      }
      if (r.estado === "travado") {
        return g.envios.slice(i).reduce((acc, e) => acc + e.pecas.reduce((a, p) => a + p.quantidade, 0), 0);
      }
      // Encerrado: o inventário desses bipes já subiu (ou foi descartado).
      const perdidas = g.envios.slice(i).flatMap((e) => e.pecas);
      gravarPendente(chave, null);
      if (perdidas.length > 0) setPecasPerdidas((prev) => [...prev, ...perdidas]);
      return 0;
    }
    gravarPendente(chave, null);
    return 0;
  }, []);

  /** Recupera os bipes guardados desta filial (menos os do contexto na tela). Devolve as peças ainda pendentes. */
  const recuperandoRef = useRef<Promise<number> | null>(null);
  const pendentesGuardadosRef = useRef(0);
  const recuperarPendentes = useCallback((): Promise<number> => {
    if (recuperandoRef.current) return recuperandoRef.current;
    const rodada = (async () => {
      const ctx = syncRef.current;
      const vivo = vivoRef.current;
      if (!ctx.filialCod || !vivo.username) return 0;
      const chaves = chavesPendentes(prefixoPendente(vivo.companyKey, vivo.username, ctx.filialCod)).filter(
        (k) => k !== ctx.chaveLocal
      );
      let pendentes = 0;
      for (const chave of chaves) pendentes += await enviarGuardado(chave);
      pendentesGuardadosRef.current = pendentes;
      setPecasRecuperando(pendentes);
      return pendentes;
    })().finally(() => {
      recuperandoRef.current = null;
    });
    recuperandoRef.current = rodada;
    return rodada;
  }, [enviarGuardado]);

  /**
   * Fecha o inventário NESTA tela: a lista some, o que não chegou a entrar fica
   * listado no aviso e a tela trava — para bipar de novo, "Começar novo inventário".
   */
  const fecharNaTela = useCallback(
    (ctx: SyncCtx, info: Omit<EncerramentoInventario, "sobra">) => {
      const sobra = alemDaBase(produtosSelecionadosRef.current, qtdPorChave(baseLista(ctx)));
      // A sobra é mostrada no aviso — e não pode mais entrar em lugar nenhum.
      esquecerPendente(ctx);
      ctx.abandonado = true;
      syncRef.current = novoSyncCtx(ctx.filialCod);
      encerradoRef.current = true;
      produtosSelecionadosRef.current = [];
      setProdutosSelecionados([]);
      setRascunhoAtual(null);
      setBaseItens(new Map());
      setTravadoPor(null);
      setPreviewServidor(null);
      setRascunhoStatus("idle");
      setRascunhoRestauradoEm(null);
      setEncerramento({ ...info, sobra });
      setSaldoRefreshKey((k) => k + 1);
      void fetchRecentes();
      void carregarRascunhos();
    },
    [fetchRecentes, carregarRascunhos, esquecerPendente]
  );

  /** O servidor disse que o inventário acabou (alguém subiu ou descartou). */
  const encerrarRascunho = useCallback(
    (ctx: SyncCtx, r: RascunhoResumo | null) => {
      // Esta tela está subindo: quem fecha é a própria subida, com o resultado dela.
      if (executandoRef.current || syncRef.current !== ctx) return;
      if (!r || (r.status !== "finalizado" && r.status !== "descartado")) {
        // Rascunho sumiu sem ser fechado (limpeza de vazio): recomeça com TUDO o que
        // está na tela (o contexto novo guarda/manda; o guardado do velho sairia 2×).
        esquecerPendente(ctx);
        ctx.abandonado = true;
        syncRef.current = novoSyncCtx(ctx.filialCod);
        setRascunhoAtual(null);
        setBaseItens(new Map());
        persistirPendente(syncRef.current);
        return;
      }
      fecharNaTela(ctx, { status: r.status, por: r.finalizadoPor, em: r.finalizadoEm, nome: r.nomeContagem });
    },
    [fecharNaTela, esquecerPendente, persistirPendente]
  );

  /**
   * Manda o que mudou nesta tela e rebaseia com a resposta, em volta até não sobrar
   * diferença. Uma rodada por vez; quem chama durante uma rodada recebe a mesma promessa.
   */
  const sincronizar = useCallback((): Promise<void> => {
    const ctx = syncRef.current;
    if (!ctx.filialCod || ctx.abandonado || encerradoRef.current) return Promise.resolve();
    if (ctx.emVoo) return ctx.emVoo;
    const rodada = (async () => {
      for (let volta = 0; volta < 25; volta += 1) {
        if (syncRef.current !== ctx || ctx.abandonado) return;
        const vivo = vivoRef.current;
        if (!vivo.username) return;
        const envio =
          ctx.incerto ??
          montarEnvio(ctx, baseLista(ctx), produtosSelecionadosRef.current, vivo.cab, ctx.base?.cab ?? CAB_VAZIO, vivo);
        if (!envio) {
          setRascunhoStatus((st) => (st === "salvando" || st === "erro" ? "salvo" : st));
          return;
        }
        // Incerto até a resposta: se falhar, o reenvio é o MESMO (o servidor reconhece o syncId).
        // Guardado no navegador ANTES de sair: se a página cair agora, ele é reenviado ao reabrir.
        ctx.incerto = envio;
        persistirPendente(ctx);
        setRascunhoStatus("salvando");
        let resposta: SyncResposta;
        try {
          resposta = await sincronizarApi(envio.body, vivo.username);
        } catch {
          if (syncRef.current === ctx) setRascunhoStatus("erro");
          return;
        }
        // Contexto abandonado no meio (troca de filial): quem manda o guardado agora é a recuperação.
        if (ctx.abandonado) return;
        ctx.incerto = null;
        if (resposta.estado === "ok") {
          ctx.rascunhoId = resposta.rascunho.id;
          if (envio.ocorrencias !== null) ctx.ocorrenciasEnviadas = envio.ocorrencias;
          if (syncRef.current !== ctx) return;
          aplicarServidor(ctx, resposta, envio.enviado, envio.cabEnviado);
          persistirPendente(ctx);
          setTravadoPor(null);
          setRascunhoStatus("salvo");
          continue;
        }
        if (syncRef.current !== ctx) return;
        if (resposta.estado === "travado") {
          // Alguém está subindo: nada foi aplicado; o que está na tela espera (e é reenviado).
          persistirPendente(ctx);
          setTravadoPor(resposta.rascunho.finalizadoPor || "alguém");
          setRascunhoAtual(resposta.rascunho);
          setRascunhoStatus("aguardando");
          return;
        }
        encerrarRascunho(ctx, resposta.rascunho);
        return;
      }
    })();
    const emVoo = rodada.finally(() => {
      if (ctx.emVoo === emVoo) ctx.emVoo = null;
    });
    ctx.emVoo = emVoo;
    return emVoo;
  }, [aplicarServidor, encerrarRascunho, persistirPendente]);

  /**
   * ATUALIZAR AGORA: manda o que é desta tela e traz o que os colegas biparam.
   * Também roda, obrigatoriamente, antes de conferir e antes de subir.
   * Devolve false se não deu para falar com o servidor.
   */
  const atualizarAgora = useCallback(async (): Promise<boolean> => {
    if (!username) return true;
    setAtualizando(true);
    try {
      // Primeiro, os bipes guardados de antes (página recarregada, filial trocada).
      await recuperarPendentes();
      if (encerradoRef.current) return true;
      for (let tentativa = 0; tentativa < 4; tentativa += 1) {
        await sincronizar();
        const ctx = syncRef.current;
        if (encerradoRef.current || ctx.abandonado || !ctx.filialCod) return true;
        if (ctx.incerto) return false; // o que é desta tela não subiu
        if (ctx.rascunhoId) {
          const snap = await atualizarRascunhoApi(ctx.rascunhoId, ctx.base?.versao ?? -1);
          if (syncRef.current !== ctx || ctx.abandonado) return true;
          // Um envio começou enquanto a consulta ia: aplicar agora contaria peça 2×. Refaz.
          if (ctx.emVoo || ctx.incerto) continue;
          if (!snap) {
            encerrarRascunho(ctx, null);
            continue;
          }
          const r = snap.rascunho;
          if (r.status === "aberto") {
            aplicarServidor(ctx, snap, baseLista(ctx), ctx.base?.cab ?? CAB_VAZIO);
            setTravadoPor(null);
            setRascunhoStatus((st) => (st === "aguardando" ? "salvo" : st));
          } else if (r.status === "finalizando") {
            setTravadoPor(r.finalizadoPor || "alguém");
            setRascunhoAtual(r);
          } else {
            encerrarRascunho(ctx, r);
          }
        } else {
          // Ainda sem rascunho: alguém já começou o desta filial? Entra nele.
          const snap = await abrirFilialApi(companyKey, ctx.filialCod, username);
          if (syncRef.current !== ctx || ctx.abandonado) return true;
          if (ctx.emVoo || ctx.incerto || ctx.rascunhoId) continue;
          if (snap && (snap.rascunho.status === "aberto" || snap.rascunho.status === "finalizando")) {
            aplicarServidor(ctx, snap, [], CAB_VAZIO);
            if (snap.rascunho.status === "finalizando") setTravadoPor(snap.rascunho.finalizadoPor || "alguém");
            continue; // manda o que esta tela tinha para o rascunho em que acabou de entrar
          }
        }
        setUltimaAtualizacao(new Date().toISOString());
        return true;
      }
      return !syncRef.current.incerto;
    } catch {
      return false;
    } finally {
      setAtualizando(false);
    }
  }, [username, companyKey, sincronizar, aplicarServidor, encerrarRascunho, recuperarPendentes]);

  /**
   * A tela deixa esta filial: guarda o que faltava e manda EXATAMENTE o guardado
   * (o envio no ar vai junto, com o mesmo syncId — se ele já tinha entrado, não
   * soma de novo). Se não der agora, fica guardado e sai quando a filial reabrir.
   */
  const abandonarContexto = useCallback(
    (ctx: SyncCtx) => {
      if (ctx.abandonado) return;
      persistirPendente(ctx);
      ctx.abandonado = true;
      const chave = ctx.chaveLocal;
      if (!chave) return;
      void (async () => {
        try {
          if (ctx.emVoo) await ctx.emVoo;
        } catch {
          // segue: o guardado tem tudo
        }
        await enviarGuardado(chave);
      })();
    },
    [persistirPendente, enviarGuardado]
  );

  // Aba fechando: manda o que estava esperando o debounce (keepalive). Fica guardado
  // ANTES de sair — se o envio não chegar, sai de novo (mesmo syncId) ao reabrir.
  useEffect(() => {
    const aoSair = () => {
      const ctx = syncRef.current;
      const vivo = vivoRef.current;
      if (!ctx.filialCod || !vivo.username || ctx.abandonado || ctx.emVoo || encerradoRef.current) return;
      const envio =
        ctx.incerto ??
        montarEnvio(ctx, baseLista(ctx), produtosSelecionadosRef.current, vivo.cab, ctx.base?.cab ?? CAB_VAZIO, vivo);
      if (!envio) return;
      ctx.incerto = envio;
      persistirPendente(ctx);
      void sincronizarApi(envio.body, vivo.username, true).catch(() => undefined);
    };
    window.addEventListener("pagehide", aoSair);
    return () => window.removeEventListener("pagehide", aoSair);
  }, [persistirPendente]);

  // Cada mudança na lista/cabeçalho atualiza o guardado no navegador (antes do envio).
  useEffect(() => {
    persistirPendente(syncRef.current);
  }, [produtosSelecionados, observacao, nomeContagem, nomeEditado, persistirPendente]);

  // Trocar de filial: a lista da tela passa a ser a da filial nova (a da antiga fica no rascunho dela).
  const filialCodRef = useRef<string>(filialCod);
  useEffect(() => {
    if (filialCodRef.current !== filialCod) {
      filialCodRef.current = filialCod;
      setProdutosSelecionados([]);
      setResultado(null);
      setPreviewServidor(null);
    }
  }, [filialCod]);

  const trocarFilial = useCallback(
    (cod: string) => {
      abandonarContexto(syncRef.current);
      // Limpa no MESMO render da troca: um render com a filial nova e a lista velha
      // faria a sincronização mandar a contagem de uma loja para o rascunho da outra.
      filialCodRef.current = cod;
      produtosSelecionadosRef.current = [];
      encerradoRef.current = false;
      setProdutosSelecionados([]);
      setResultado(null);
      setPreviewServidor(null);
      setEncerramento(null);
      setNomeEditado(false);
      setObservacao("");
      setFilialCod(cod);
    },
    [abandonarContexto]
  );

  // Abre a filial: entra no rascunho compartilhado dela (carga da página ou troca de filial).
  useEffect(() => {
    syncRef.current.abandonado = true;
    const ctx = novoSyncCtx(filialCod);
    syncRef.current = ctx;
    encerradoRef.current = false;
    setEncerramento(null);
    setRascunhoAtual(null);
    setBaseItens(new Map());
    setTravadoPor(null);
    setRascunhoStatus("idle");
    setRascunhoRestauradoEm(null);
    setAtividadeRemota(null);
    setUltimaAtualizacao(null);
    if (!escopoRascunho || !username || !filialCod) {
      setHidratandoRascunho(false);
      return;
    }

    let cancelado = false;
    setHidratandoRascunho(true);
    setPecasRecuperando(0);
    (async () => {
      try {
        // Bipes desta pessoa nesta filial que ficaram guardados (página caiu/fechou,
        // filial trocada sem conexão): saem ANTES de carregar, para a lista já vir com eles.
        await recuperarPendentes();
        if (cancelado || syncRef.current !== ctx) return;
        const snap = await abrirFilialApi(companyKey, filialCod, username);
        if (cancelado || syncRef.current !== ctx) return;
        setUltimaAtualizacao(new Date().toISOString());
        if (!snap) return;
        const r = snap.rascunho;
        if (r.status !== "aberto" && r.status !== "finalizando") return;
        // Soma ao que já foi bipado enquanto a consulta ia (nada se perde).
        aplicarServidor(ctx, snap, [], null);
        if (r.status === "finalizando") setTravadoPor(r.finalizadoPor || "alguém");
        if (snap.itens.length > 0) setRascunhoRestauradoEm(r.updatedAt);
      } catch {
        // Sem rascunho agora: o primeiro envio entra no da filial (ou cria). "Atualizar agora" tenta de novo.
      } finally {
        if (!cancelado) setHidratandoRascunho(false);
      }
    })();
    void carregarRascunhos();
    return () => {
      cancelado = true;
      setHidratandoRascunho(false);
    };
    // O escopo (string) é o que define quando recarregar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escopoRascunho, companyKey, username]);

  // Autosave: manda pouco depois de cada mudança (bipe, quantidade, descrição, obs, bipe recusado).
  useEffect(() => {
    if (!username || !filialCod || hidratandoRascunho || encerramento) return;
    const timeoutId = setTimeout(() => void sincronizar(), 400);
    return () => clearTimeout(timeoutId);
  }, [
    produtosSelecionados,
    observacao,
    nomeContagem,
    nomeEditado,
    bipagem.ocorrencias.length,
    filialCod,
    username,
    hidratandoRascunho,
    encerramento,
    sincronizar,
  ]);

  // Sem consulta automática. Só REENVIA o que é desta tela e ficou sem gravar
  // (rede caiu, ou alguém estava subindo, ou bipe guardado de antes) — nada se perde.
  useEffect(() => {
    if (rascunhoStatus !== "erro" && rascunhoStatus !== "aguardando" && pecasRecuperando === 0) return;
    const intervalo = window.setInterval(() => {
      if (pecasRecuperando > 0) void recuperarPendentes();
      if (rascunhoStatus === "erro" || rascunhoStatus === "aguardando") void sincronizar();
    }, REENVIO_MS);
    return () => window.clearInterval(intervalo);
  }, [rascunhoStatus, pecasRecuperando, sincronizar, recuperarPendentes]);

  /** Novo inventário depois que o anterior subiu: tela destrava, lista vazia. */
  const comecarNovoInventario = useCallback(() => {
    esquecerPendente(syncRef.current);
    syncRef.current.abandonado = true;
    syncRef.current = novoSyncCtx(filialCod);
    encerradoRef.current = false;
    produtosSelecionadosRef.current = [];
    setProdutosSelecionados([]);
    setEncerramento(null);
    setResultado(null);
    setRascunhoAtual(null);
    setBaseItens(new Map());
    setNomeEditado(false);
    setObservacao("");
    zerarBipagem();
    // Se um colega já começou o novo inventário desta filial, entra nele.
    void atualizarAgora();
    focarCampoBipe();
  }, [filialCod, zerarBipagem, atualizarAgora, focarCampoBipe, esquecerPendente]);

  /**
   * "Continuar" um rascunho: o inventário é da LOJA — quem entra conta na MESMA
   * lista (não numa cópia). Rascunho antigo (por usuário) vira o compartilhado da
   * filial; se ela já tiver um, a pessoa decide se soma.
   */
  const retomarRascunho = useCallback(
    async (rascunho: RascunhoResumo) => {
      const existe =
        filiais.ativas.some((f) => f.cod === rascunho.filialCod) || filiais.inativas.some((f) => f.cod === rascunho.filialCod);
      if (!existe) {
        mostrarNotificacao(`Filial ${rascunho.filialNome} não está disponível nesta empresa`, "error");
        return;
      }
      if (!username) return;

      let alvo = rascunho;
      if (!rascunho.compartilhado) {
        try {
          let resp = await adotarRascunhoApi(rascunho.id, false, username);
          if (resp.estado === "conflito") {
            const ex = resp.existente;
            const quem = ex.participantes.map((p) => p.username).join(", ") || ex.username;
            const ok = window.confirm(
              `${rascunho.filialNome} já tem um inventário em andamento (${quem} · ${ex.totalPecas} peças).\n\n` +
                `Somar as ${rascunho.totalPecas} peças deste rascunho antigo de ${rascunho.username} a ele?\n\n` +
                "Só some se forem peças que ainda não foram contadas no outro — a mesma peça nos dois fica contada duas vezes."
            );
            if (!ok) return;
            resp = await adotarRascunhoApi(rascunho.id, true, username);
          }
          if (resp.estado !== "ok") {
            mostrarNotificacao("Este rascunho não existe mais.", "error");
            void carregarRascunhos();
            return;
          }
          alvo = resp.rascunho;
        } catch {
          mostrarNotificacao("Não foi possível continuar o rascunho agora. Tente de novo.", "error");
          return;
        }
      }

      const mesmaFilial = !!filialCod && alvo.filialCod.trim().toUpperCase() === filialCod.trim().toUpperCase();
      if (!mesmaFilial) {
        trocarFilial(alvo.filialCod); // a abertura da filial entra no rascunho dela
      } else {
        if (encerradoRef.current) comecarNovoInventario();
        else void atualizarAgora();
      }
      setAbaLateral("historico");
      void carregarRascunhos();
      const outros = [
        ...new Set([...alvo.participantes.map((p) => p.username), alvo.username.toLowerCase()].filter((u) => u && u !== eu)),
      ];
      mostrarNotificacao(
        outros.length > 0
          ? `Você está contando junto com ${outros.join(", ")} — o que você bipar soma na mesma contagem.`
          : `Inventário de ${alvo.filialNome} na tela.`
      );
    },
    [filiais, username, eu, filialCod, trocarFilial, atualizarAgora, comecarNovoInventario, carregarRascunhos, mostrarNotificacao]
  );

  const descartarRascunho = useCallback(
    async (rascunho: RascunhoResumo) => {
      const outros = rascunho.participantes.filter((p) => p.username !== eu);
      const mensagem =
        outros.length > 0
          ? `Descartar o inventário de ${rascunho.filialNome} (${rascunho.totalPecas} peças)?\n\nApaga a contagem de TODOS que estão contando: ${rascunho.participantes
              .map((p) => `${p.username} (${p.pecas})`)
              .join(", ")}.`
          : `Descartar o rascunho de ${rascunho.filialNome} com ${rascunho.totalLinhas} produto(s)?`;
      if (!window.confirm(mensagem)) return;
      try {
        await descartarRascunhoApi(rascunho.id, username);
        const ctx = syncRef.current;
        if (ctx.rascunhoId === rascunho.id) {
          esquecerPendente(ctx); // descarte é decisão consciente: o que não tinha subido vai junto
          ctx.abandonado = true;
          syncRef.current = novoSyncCtx(ctx.filialCod);
          produtosSelecionadosRef.current = [];
          setProdutosSelecionados([]);
          setRascunhoAtual(null);
          setBaseItens(new Map());
          setTravadoPor(null);
          setRascunhoStatus("idle");
          setRascunhoRestauradoEm(null);
          setPreviewServidor(null);
          zerarBipagem();
        }
        void carregarRascunhos();
        mostrarNotificacao("Rascunho descartado");
      } catch {
        mostrarNotificacao("Erro ao descartar o rascunho", "error");
      }
    },
    [username, eu, carregarRascunhos, mostrarNotificacao, zerarBipagem, esquecerPendente]
  );

  /**
   * Antes de conferir/subir: ATUALIZA na hora (manda o desta tela, o guardado de
   * antes e traz o dos colegas) e só libera se a tela estiver igual ao rascunho
   * compartilhado. Devolve o motivo quando não dá.
   */
  const garantirSincronizado = useCallback(async (): Promise<string | null> => {
    const conectou = await atualizarAgora();
    const ctx = syncRef.current;
    if (encerradoRef.current) return "Este inventário já foi encerrado — veja o aviso na tela.";
    if (!conectou || ctx.incerto) {
      return "Sem conexão com o rascunho compartilhado: não dá para garantir que a contagem de todos está aqui. Tente de novo em instantes.";
    }
    if (pendentesGuardadosRef.current > 0) {
      return `${pendentesGuardadosRef.current} peça(s) bipada(s) antes nesta tela ainda não foram gravadas — aguarde enviar (aviso na tela) e tente de novo.`;
    }
    if (travadoPorRef.current) return `${travadoPorRef.current} está subindo este inventário agora.`;
    if (produtosSelecionadosRef.current.length === 0) return null; // a conferência avisa "bipe pelo menos um produto"
    if (!ctx.rascunhoId || !ctx.base) {
      return "Esta tela ainda não está ligada ao rascunho compartilhado da filial. Clique em “Atualizar agora” e tente de novo.";
    }
    if (ctx.emVoo || !mesmasQuantidades(qtdPorChave(produtosSelecionadosRef.current), qtdPorChave(baseLista(ctx)))) {
      return "Ainda chegando bipe (desta tela ou de quem conta junto). Aguarde um instante e tente de novo.";
    }
    return null;
  }, [atualizarAgora]);

  // ── SUBIR ESTOQUE ──────────────────────────────────────────────────────────

  const linhasParaServidor = useCallback(
    (lista: LinhaInventario[]) =>
      lista.map((p) => ({
        produto: p.produto,
        cor: p.corProduto ?? "",
        quantidade: p.quantidade,
        tamanho: p.tamanhos && p.tamanhos.length > 0 ? p.tamanho ?? null : null,
      })),
    []
  );

  /** Confere tudo na tela e pede ao servidor a foto de AGORA antes de abrir a confirmação. */
  const abrirConfirmacao = useCallback(async () => {
    if (!filialCod) {
      mostrarNotificacao("Selecione a filial", "error");
      return;
    }
    if (somenteLeitura) {
      mostrarNotificacao("Acesso somente leitura: sua função não pode subir inventário.", "error");
      return;
    }
    // Peça bipada sem resposta ou recusada não pode ficar de fora sem o operador saber.
    if (bipagem.emVoo.length > 0) {
      mostrarNotificacao(`Aguarde: ${bipagem.emVoo.length} bipe(s) ainda em consulta.`, "error");
      return;
    }
    if (bipagem.ocorrencias.length > 0) {
      mostrarNotificacao(
        `${bipagem.ocorrencias.length} bipe(s) NÃO entraram na lista. Resolva ou dispense cada um no painel vermelho antes de subir.`,
        "error"
      );
      focarCampoBipe();
      return;
    }
    // A conferência é da contagem de TODOS (rascunho compartilhado), não só desta tela.
    setConferindo(true);
    const naoSincronizou = await garantirSincronizado().finally(() => setConferindo(false));
    if (naoSincronizou) {
      mostrarNotificacao(naoSincronizou, "error");
      return;
    }
    const lista = produtosSelecionadosRef.current;
    if (lista.length === 0) {
      mostrarNotificacao("Bipe pelo menos um produto", "error");
      return;
    }
    const pendencia = pendenciaTamanho(lista);
    if (pendencia) {
      mostrarNotificacao(pendencia, "error");
      return;
    }
    const nome = nomeContagem.trim();
    if (!nome || nome.length > 25) {
      mostrarNotificacao("Informe a descrição do inventário (até 25 caracteres).", "error");
      return;
    }

    setConferindo(true);
    try {
      const resp = await fetch("/api/inventario/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filialCod,
          itens: linhasParaServidor(lista),
          zerarNaoContados,
          nomeContagem: nome,
          nomeAutomatico: !nomeEditado,
        }),
      });
      const data = (await resp.json().catch(() => null)) as (PreviewServidor & { error?: string }) | null;
      if (!resp.ok || !data) {
        mostrarNotificacao(data?.error ?? "Erro ao conferir as diferenças.", "error");
        return;
      }
      if (data.pendenciasTamanho.length > 0) {
        mostrarNotificacao(`Escolha o tamanho (P/M/G) de: ${data.pendenciasTamanho.slice(0, 5).join(", ")}.`, "error");
        return;
      }
      if (data.nomeSugerido) setNomeContagem(data.nomeSugerido);
      setConfirmCheck(false);
      setAceitarOcorrencias(false);
      setPreviewAssinatura(assinaturaLista(lista));
      setPreviewServidor(data);
    } catch {
      mostrarNotificacao("Erro de conexão ao conferir as diferenças.", "error");
    } finally {
      setConferindo(false);
    }
  }, [
    filialCod,
    somenteLeitura,
    bipagem.emVoo.length,
    bipagem.ocorrencias.length,
    pendenciaTamanho,
    nomeContagem,
    nomeEditado,
    zerarNaoContados,
    linhasParaServidor,
    mostrarNotificacao,
    focarCampoBipe,
    garantirSincronizado,
  ]);

  const listaMudouDesdeConferencia =
    previewServidor !== null && assinaturaLista(produtosSelecionados) !== previewAssinatura;

  const subirEstoque = useCallback(async () => {
    if (!previewServidor || executando) return;
    // Bipe lido com o modal aberto (o leitor não para): mesma trava do botão.
    if (bipagem.emVoo.length > 0 || bipagem.ocorrencias.length > 0) return;
    setExecutando(true);
    const naoSincronizou = await garantirSincronizado();
    const lista = produtosSelecionadosRef.current;
    if (naoSincronizou || assinaturaLista(lista) !== previewAssinatura) {
      setExecutando(false);
      mostrarNotificacao(
        naoSincronizou ??
          "A contagem mudou depois da conferência (peça bipada por você ou por quem conta junto). Feche e confira de novo.",
        "error"
      );
      return;
    }
    const ctxSubida = syncRef.current;

    const snapBipagem = {
      lidos: bipagem.lidos,
      aceitos: bipagem.aceitos,
      dispensadas: bipagem.dispensadas.map((d) => d.id),
    };
    executandoRef.current = true;
    try {
      const resp = await fetch("/api/inventario/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-username": username },
        body: JSON.stringify({
          companyKey,
          filialCod,
          nomeContagem: nomeContagem.trim(),
          dataContagem: hojeISO(),
          obs: observacao.trim() || null,
          zerarNaoContados,
          itens: linhasParaServidor(lista),
          rascunhoId: ctxSubida.rascunhoId,
          rascunhoVersao: ctxSubida.base?.versao ?? null,
          aceitarOcorrenciasDe: aceitarOcorrencias ? colegasComOcorrencia.map((p) => p.username) : [],
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data) {
        mostrarNotificacao(data?.error ?? "Erro ao subir o inventário.", "error");
        if (data?.motivo === "encerrado" && data.rascunho) {
          executandoRef.current = false;
          encerrarRascunho(ctxSubida, data.rascunho as RascunhoResumo);
        } else if (["mudou", "lista_diferente", "ocorrencias", "sem_rascunho", "finalizando"].includes(data?.motivo)) {
          // Traz o que mudou: a lista/os avisos na tela passam a mostrar o porquê.
          executandoRef.current = false;
          void atualizarAgora();
        } else if (resp.status === 409) {
          void fetchRecentes();
        }
        return;
      }

      // O servidor já fechou o rascunho compartilhado (quem subiu = responsável).
      // Esta tela trava: o inventário acabou. Peça bipada durante a gravação NÃO
      // entrou e fica listada no aviso (não vira inventário novo sozinha).
      const pecasSobra = alemDaBase(produtosSelecionadosRef.current, qtdPorChave(baseLista(ctxSubida))).reduce(
        (acc, p) => acc + p.quantidade,
        0
      );
      fecharNaTela(ctxSubida, {
        status: "finalizado",
        por: eu,
        em: new Date().toISOString(),
        nome: data.nomeContagem,
      });
      fecharBipagemDoRegistro(snapBipagem);

      setResultado({
        nomeContagem: data.nomeContagem,
        filialNome: data.filialNome,
        itensAjustados: data.itensAjustados,
        somaDelta: data.somaDelta,
        sobra: pecasSobra,
      });
      setPreviewServidor(null);
      setObservacao("");
      setNomeEditado(false);
      setView("bipados");
      mostrarNotificacao(`Inventário ${data.nomeContagem} aplicado — ${data.itensAjustados} item(ns) ajustado(s).`);
      void fetchRecentes();
      void carregarRascunhos();
      setSaldoRefreshKey((k) => k + 1);
    } catch {
      mostrarNotificacao(
        "Sem resposta do servidor. O inventário pode ter sido aplicado — confira o Histórico antes de subir de novo.",
        "error"
      );
      // Depois que a tela sair do modo "subindo", descobre se o inventário fechou.
      setTimeout(() => void atualizarAgora(), 1500);
      void fetchRecentes();
    } finally {
      executandoRef.current = false;
      setExecutando(false);
      setConfirmCheck(false);
    }
  }, [
    previewServidor,
    executando,
    bipagem,
    previewAssinatura,
    username,
    companyKey,
    filialCod,
    nomeContagem,
    observacao,
    zerarNaoContados,
    linhasParaServidor,
    mostrarNotificacao,
    fetchRecentes,
    carregarRascunhos,
    fecharBipagemDoRegistro,
    garantirSincronizado,
    encerrarRascunho,
    atualizarAgora,
    fecharNaTela,
    eu,
    aceitarOcorrencias,
    colegasComOcorrencia,
  ]);

  // ── DERIVADOS ──────────────────────────────────────────────────────────────

  const totalPecas = produtosSelecionados.reduce((acc, p) => acc + p.quantidade, 0);
  const totalProdutos = produtosSelecionados.length;
  const linhasDiferencaExibidas = mostrarTodos ? diferencas.linhas : diferencas.comDiferenca;

  const recentesVisiveis = useMemo(() => {
    if (historicoTodas || !filialSelecionada) return recentes;
    const alvo = filialSelecionada.nome.replace(/\s+/g, " ").trim().toUpperCase();
    return recentes.filter((r) => r.filial.replace(/\s+/g, " ").trim().toUpperCase() === alvo);
  }, [recentes, historicoTodas, filialSelecionada]);

  const rascunhosVisiveis = rascunhos.filter(
    (r) =>
      r.totalLinhas > 0 &&
      (filiais.ativas.some((f) => f.cod === r.filialCod) || filiais.inativas.some((f) => f.cod === r.filialCod))
  );

  const isBusy = executando || conferindo;
  /** Peças na tela que o servidor ainda não tem (o que ainda não foi gravado). */
  const pecasNaoGravadasTela = useMemo(
    () => alemDaBase(produtosSelecionados, qtdPorChave(baseItens.values())).reduce((acc, p) => acc + p.quantidade, 0),
    [produtosSelecionados, baseItens]
  );
  const podeSubir =
    !!filialCod &&
    produtosSelecionados.length > 0 &&
    !isBusy &&
    !somenteLeitura &&
    !!saldoDaFilial &&
    !encerramento &&
    !travadoPor;

  const detalhe = detalheAberto ? detalheCache[detalheAberto.nome] : undefined;
  const detalheComSaldo = (detalhe?.itens ?? []).some((it) => it.saldoFinal != null);

  return (
    <div className={`${s.wrapper} ${styles.temaVerde}`}>
      {/* Top bar */}
      <div className={s.topBar}>
        <div className={s.topBarLeft}>
          <div className={`${s.headerIcon} ${styles.headerIconVerde}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M9 4h6M9 4a2 2 0 0 0-2 2v0h10v0a2 2 0 0 0-2-2M9 4V3h6v1" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M7 6H5v15h14V6h-2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="m8.5 13 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1 className={s.title}>Inventário</h1>
            <p className={s.subtitle}>
              Bipe a contagem da loja e suba o estoque direto no Linx — {companyName}
            </p>
          </div>
        </div>
      </div>

      {/* Config: filial | descrição · responsável · inventário completo */}
      <div className={s.configGrid}>
        <div className={s.configCard}>
          <div className={s.configIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 20h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M6 20V7l6-3 6 3v13" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M10 20v-6h4v6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          <div className={s.configBody}>
            <span className={s.configBarLabel}>Filial do inventário</span>
            <div className={s.selectWrap}>
              <select
                className={`${s.configBarSelect} ${styles.selectVerde}`}
                value={filialCod}
                onChange={(e) => trocarFilial(e.target.value)}
                disabled={carregandoFiliais || isBusy}
              >
                <option value="">{carregandoFiliais ? "Carregando…" : "Selecione…"}</option>
                <optgroup label="Filiais ativas (venda recente)">
                  {filiais.ativas.map((f) => (
                    <option key={f.cod} value={f.cod}>
                      {f.nome} ({f.cod}) — {f.estoquePositivo.toLocaleString("pt-BR")} un
                    </option>
                  ))}
                </optgroup>
                {filiais.inativas.length > 0 && (
                  <optgroup label="Filiais não utilizadas (todas)">
                    {filiais.inativas.map((f) => (
                      <option key={f.cod} value={f.cod}>
                        {f.nome} ({f.cod}) — {f.estoquePositivo.toLocaleString("pt-BR")} un
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span className={s.selectChevron} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>
        </div>

        <div className={s.configCardWide}>
          <label className={s.configSegment}>
            <div className={s.configIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M5 4h14v16H5V4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
            <div className={s.configBody}>
              <span className={s.configBarLabel}>
                Descrição (extrato)
                <span className={styles.nomeContador}>{nomeContagem.length}/25</span>
              </span>
              <input
                type="text"
                className={styles.nomeInput}
                data-leitor-nome=""
                value={nomeContagem}
                maxLength={25}
                placeholder="Ex.: INVLEBLON2310"
                disabled={!filialCod || isBusy}
                onChange={(e) => {
                  setNomeContagem(e.target.value.toUpperCase());
                  setNomeEditado(true);
                }}
              />
            </div>
          </label>
          <div className={s.configSegment}>
            <div className={s.configIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
                <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className={s.configBody}>
              <span className={s.configBarLabel}>Responsável</span>
              <span className={s.configBarText}>{username || "—"}</span>
              <span className={styles.notaCompleto}>
                <strong>Inventário completo</strong>: o que tem saldo e não for bipado é zerado.
              </span>
            </div>
          </div>
        </div>
      </div>

      {filialCod && (
        <div className={styles.saldoInfo}>
          {carregandoSaldo ? (
            <span>Carregando o saldo atual da filial…</span>
          ) : erroSaldo && !saldoDaFilial ? (
            <span className={styles.saldoInfoErro}>{erroSaldo} As diferenças só aparecem com o saldo carregado.</span>
          ) : saldoDaFilial ? (
            <span>
              Saldo de <strong>{saldoDaFilial.filialNome}</strong> carregado em {fmtDataHora(saldoDaFilial.carregadoEm)} ·{" "}
              {saldoDaFilial.itens.length.toLocaleString("pt-BR")} item(ns) com estoque. Ao subir, a conta é refeita com o
              saldo do momento.
            </span>
          ) : null}
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => setSaldoRefreshKey((k) => k + 1)}
            disabled={carregandoSaldo}
          >
            Atualizar saldo
          </button>
        </div>
      )}

      {resultado && (
        <div className={styles.resultadoBanner}>
          <p>
            ✅ Inventário <strong>{resultado.nomeContagem}</strong> aplicado em {resultado.filialNome}:{" "}
            <strong>{resultado.itensAjustados}</strong> item(ns) ajustado(s), variação líquida{" "}
            <strong>
              {resultado.somaDelta > 0 ? "+" : ""}
              {resultado.somaDelta}
            </strong>{" "}
            un. Já aparece no extrato dos produtos.
            {resultado.sobra > 0 &&
              ` ${resultado.sobra} peça(s) bipada(s) durante a gravação NÃO entraram — veja a lista no aviso da contagem.`}
          </p>
          <div className={styles.resultadoAcoes}>
            <button
              type="button"
              className={styles.btnSecundario}
              onClick={() => void desfazer(resultado.nomeContagem)}
              disabled={estornandoNome === resultado.nomeContagem || somenteLeitura}
            >
              {estornandoNome === resultado.nomeContagem ? "Desfazendo…" : "↩ Desfazer"}
            </button>
            <button type="button" className={styles.btnSecundario} onClick={() => setResultado(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}

      <div className={s.layout}>
        {/* Coluna esquerda: histórico × rascunhos */}
        <div className={s.logColumn}>
          <div className={s.card}>
            <div className={s.abasLaterais} role="tablist" aria-label="Painel lateral">
              <button
                type="button"
                role="tab"
                aria-selected={abaLateral === "historico"}
                className={`${s.abaLateralBtn} ${abaLateral === "historico" ? `${s.abaLateralBtnAtiva} ${styles.abaAtivaVerde}` : ""}`}
                onClick={() => setAbaLateral("historico")}
              >
                Histórico
                {recentesVisiveis.length > 0 && <span className={s.abaLateralContador}>{recentesVisiveis.length}</span>}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={abaLateral === "rascunhos"}
                className={`${s.abaLateralBtn} ${abaLateral === "rascunhos" ? `${s.abaLateralBtnAtiva} ${styles.abaAtivaVerde}` : ""}`}
                onClick={() => setAbaLateral("rascunhos")}
              >
                Rascunhos
                {rascunhosVisiveis.length > 0 && (
                  <span className={`${s.abaLateralContador} ${s.abaLateralContadorAlerta}`}>{rascunhosVisiveis.length}</span>
                )}
              </button>
            </div>

            {abaLateral === "rascunhos" ? (
              <>
                <div className={`${s.historicoActionRow} ${styles.histActionRow}`}>
                  <span className={s.rascunhosAjuda}>Inventários em aberto — um por filial, de quem estiver contando. Somem quando o estoque sobe.</span>
                </div>
                {loadingRascunhos && rascunhosVisiveis.length === 0 ? (
                  <div className={s.emptyLog}>Carregando...</div>
                ) : rascunhosVisiveis.length === 0 ? (
                  <div className={s.emptyLog}>
                    <div className={s.emptyLogIcon}>📝</div>
                    <div>Nenhum rascunho pendente</div>
                  </div>
                ) : (
                  <div className={s.logScrollContainer}>
                    <div className={s.logList}>
                      {rascunhosVisiveis.map((rascunho) => {
                        const pecas = rascunho.totalPecas;
                        const ehAtual = rascunhoAtual?.id === rascunho.id;
                        const quem =
                          rascunho.participantes.length > 0
                            ? rascunho.participantes.map((p) => `${p.username} (${p.pecas})`).join(", ")
                            : rascunho.username;
                        return (
                          <div key={rascunho.id} className={s.rascunhoItem}>
                            <div className={s.rascunhoTopo}>
                              <span className={`${s.rascunhoTipoPill} ${s.rascunhoTipoPillEntrada}`}>
                                {rascunho.compartilhado ? "Inventário" : "Rascunho antigo"}
                              </span>
                              <span className={s.rascunhoFilial}>{rascunho.filialNome}</span>
                              {ehAtual && <span className={`${s.rascunhoAtualPill} ${styles.pillVerde}`}>na tela</span>}
                              {rascunho.status === "finalizando" && (
                                <span className={`${s.rascunhoAtualPill} ${styles.pillVerde}`}>subindo…</span>
                              )}
                            </div>
                            <div className={s.rascunhoMeta}>
                              {rascunho.totalLinhas} prod · {pecas} {pecas === 1 ? "peça" : "peças"}
                            </div>
                            <div className={s.rascunhoMeta}>
                              {quem} · {fmtDataHora(rascunho.updatedAt)}
                            </div>
                            <div className={s.rascunhoAcoes}>
                              <button
                                type="button"
                                className={`${s.rascunhoRetomarBtn} ${styles.retomarVerde}`}
                                onClick={() => void retomarRascunho(rascunho)}
                                disabled={ehAtual || isBusy || rascunho.status === "finalizando"}
                                title={
                                  ehAtual
                                    ? "Este inventário já está na tela"
                                    : "Entrar neste inventário: o que você bipar soma na mesma contagem"
                                }
                              >
                                {ehAtual ? "Na tela" : "Continuar"}
                              </button>
                              <button
                                type="button"
                                className={s.rascunhoDescartarBtn}
                                onClick={() => void descartarRascunho(rascunho)}
                                disabled={isBusy || rascunho.status === "finalizando"}
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
                <div className={`${s.historicoActionRow} ${styles.histActionRow}`}>
                  {filialSelecionada ? (
                    <label className={styles.histFiltro}>
                      <input type="checkbox" checked={historicoTodas} onChange={(e) => setHistoricoTodas(e.target.checked)} />
                      Todas as filiais
                    </label>
                  ) : (
                    <span className={s.rascunhosAjuda}>Seus 30 últimos ajustes.</span>
                  )}
                  <Link href={`/${companyKey}/ajuste-estoque`} className={`${s.historicoActionLink} ${styles.linkVerde}`}>
                    Ajuste de Estoque →
                  </Link>
                </div>
                {carregandoRecentes && recentes.length === 0 ? (
                  <div className={s.emptyLog}>Carregando...</div>
                ) : recentesVisiveis.length === 0 ? (
                  <div className={s.emptyLog}>
                    <div className={s.emptyLogIcon}>📋</div>
                    <div>Nenhum inventário {filialSelecionada && !historicoTodas ? "desta filial " : ""}ainda</div>
                  </div>
                ) : (
                  <div className={s.logScrollContainer}>
                    <div className={s.logList}>
                      {recentesVisiveis.map((r) => (
                        <div key={r.nome} className={s.logItemWrapper}>
                          <button type="button" className={styles.histItemBtn} onClick={() => void abrirDetalhe(r)}>
                            <div className={s.logItem}>
                              <div className={s.logMain}>
                                <div className={s.logTopLine}>
                                  <span className={styles.histNome}>{r.nome}</span>
                                  <span className={s.logCount}>{r.itens} itens</span>
                                </div>
                                <div className={s.logRoute}>
                                  <span className={s.logRouteText}>{r.filial}</span>
                                </div>
                              </div>
                              <div className={s.logRight}>
                                <span className={`${styles.kpiLabel} ${r.soma < 0 ? styles.neg : styles.pos}`}>
                                  {r.soma > 0 ? "+" : ""}
                                  {r.soma}
                                </span>
                                <span className={s.logDate}>{r.emissao ? fmtDataLinx(r.emissao) : "—"}</span>
                              </div>
                            </div>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Coluna principal — bipagem + diferenças */}
        <div className={s.mainColumn}>
          <div className={s.card}>
            <div
              className={`${s.produtosArea} ${produtosSelecionados.length === 0 ? s.produtosAreaEmpty : s.produtosAreaHasItems}`}
            >
              <div className={s.cardHeader}>
                <span className={s.cardLabelWithIcon}>
                  <span className={s.cardHeaderIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M3 5v14M6.5 5v14M10 5v14M13.5 5v10M17 5v14M20.5 5v14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                  Contagem {filialSelecionada ? `· ${filialSelecionada.nome}` : ""}
                </span>
                <div className={s.cardHeaderRight}>
                  {rascunhoStatus !== "idle" && (
                    <span
                      className={`${s.rascunhoStatus} ${rascunhoStatus === "erro" || rascunhoStatus === "aguardando" ? s.rascunhoStatusErro : ""}`}
                      title={
                        rascunhoStatus === "erro"
                          ? "Não foi possível sincronizar — tentando de novo a cada poucos segundos. Nada do que está na tela se perde."
                          : rascunhoStatus === "aguardando"
                            ? "Alguém está subindo este inventário: o que você bipar agora espera na tela."
                            : "A contagem é salva automaticamente e é a mesma para todos que abrirem esta filial."
                      }
                    >
                      {rascunhoStatus === "salvando"
                        ? "sincronizando…"
                        : rascunhoStatus === "salvo"
                          ? "rascunho salvo"
                          : rascunhoStatus === "aguardando"
                            ? "aguardando envio"
                            : "sem conexão — tentando de novo"}
                    </span>
                  )}
                  {totalProdutos > 0 && (
                    <span className={`${s.badge} ${s.badgeEntrada}`}>
                      {totalProdutos} prod · {totalPecas} peças
                    </span>
                  )}
                </div>
              </div>

              {encerramento && (
                <div className={styles.encerramentoAviso} role="status">
                  <div className={styles.encerramentoTexto}>
                    <strong>
                      {encerramento.status === "descartado"
                        ? "Este inventário foi descartado"
                        : `Inventário ${encerramento.nome ? `${encerramento.nome} ` : ""}subido para o estoque`}
                    </strong>
                    {encerramento.por ? ` por ${encerramento.por === eu ? "você" : encerramento.por}` : ""}
                    {encerramento.em ? ` às ${fmtHora(encerramento.em)}` : ""}
                    {encerramento.status === "finalizado" && encerramento.por ? " (responsável no Linx)" : ""}. Esta contagem
                    está encerrada — não dá mais para bipar nela.
                    {encerramento.sobra.length > 0 && (
                      <div className={styles.encerramentoSobra}>
                        <strong>
                          {encerramento.sobra.reduce((acc, p) => acc + p.quantidade, 0)} peça(s) bipada(s) nesta tela NÃO
                          entraram no inventário
                        </strong>{" "}
                        (bipadas depois da última sincronização ou durante a subida):
                        <ul>
                          {encerramento.sobra.slice(0, 15).map((p) => (
                            <li key={chaveLinha(p)}>
                              {p.quantidade}× {p.descProduto || p.produto}
                              {textoCorProduto(p.descCor, p.corProduto) ? ` · ${textoCorProduto(p.descCor, p.corProduto)}` : ""}
                              {p.tamanhoLabel ? ` · ${p.tamanhoLabel}` : ""}
                            </li>
                          ))}
                          {encerramento.sobra.length > 15 && <li>… e mais {encerramento.sobra.length - 15} produto(s)</li>}
                        </ul>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className={`${styles.btnSecundario} ${styles.novoInventarioBtn}`}
                    onClick={comecarNovoInventario}
                    disabled={isBusy}
                  >
                    Começar novo inventário
                  </button>
                </div>
              )}

              {rascunhoStatus === "erro" && pecasNaoGravadasTela > 0 && (
                <div className={styles.naoGravadoAviso} role="alert">
                  ⚠{" "}
                  <strong>
                    {pecasNaoGravadasTela} peça(s) bipada(s) nesta tela ainda NÃO foram gravadas no servidor
                  </strong>{" "}
                  (sem conexão). Estão guardadas neste navegador e são enviadas sozinhas quando a conexão voltar —{" "}
                  <strong>não limpe os dados do navegador</strong> até este aviso sumir.
                </div>
              )}

              {pecasRecuperando > 0 && (
                <div className={styles.naoGravadoAviso} role="alert">
                  ⚠{" "}
                  <strong>
                    {pecasRecuperando} peça(s) bipada(s) antes (página recarregada ou filial trocada) ainda NÃO foram
                    gravadas
                  </strong>{" "}
                  — tentando de novo a cada 5 segundos. O inventário não sobe enquanto elas não entrarem.{" "}
                  <button type="button" className={styles.btnSecundario} onClick={() => void atualizarAgora()} disabled={atualizando}>
                    Tentar agora
                  </button>
                </div>
              )}

              {pecasPerdidas.length > 0 && (
                <div className={styles.naoGravadoAviso} role="alert">
                  <div>
                    ⚠{" "}
                    <strong>
                      {pecasPerdidas.reduce((acc, p) => acc + p.quantidade, 0)} peça(s) bipada(s) antes nesta tela NÃO
                      entraram
                    </strong>
                    : quando a conexão voltou, o inventário delas já tinha subido (ou sido descartado). Confira se precisam
                    entrar na contagem nova:
                    <ul className={styles.listaPecas}>
                      {pecasPerdidas.slice(0, 20).map((p, i) => (
                        <li key={`${p.rotulo}-${i}`}>
                          {p.quantidade}× {p.rotulo}
                        </li>
                      ))}
                      {pecasPerdidas.length > 20 && <li>… e mais {pecasPerdidas.length - 20} linha(s)</li>}
                    </ul>
                  </div>
                  <button type="button" className={styles.btnSecundario} onClick={() => setPecasPerdidas([])}>
                    Entendi
                  </button>
                </div>
              )}

              {travadoPor && (
                <div className={styles.travadoAviso} role="status">
                  ⏳ <strong>{travadoPor === eu ? "Você está" : `${travadoPor} está`}</strong> subindo este inventário para
                  o estoque. O que for bipado agora fica nesta tela e não entra neste envio.
                </div>
              )}

              {filialCod && !encerramento && (
                <div className={styles.equipeBar}>
                  <span className={styles.equipeTitulo}>{contandoJunto ? "Contando juntos" : "Contagem compartilhada"}</span>
                  {participantes
                    .filter((p) => p.pecas > 0 || p.ocorrencias > 0)
                    .map((p) => (
                      <span
                        key={p.username}
                        className={`${styles.equipeChip} ${p.username === eu ? styles.equipeChipEu : ""} ${
                          p.ocorrencias > 0 ? styles.equipeChipAlerta : ""
                        }`}
                        title={
                          (p.ultimoBipeEm ? `Último bipe às ${fmtHora(p.ultimoBipeEm)}` : "") +
                          (p.ocorrencias > 0 ? ` · ${p.ocorrencias} bipe(s) que NÃO entraram (painel vermelho da tela dela/dele)` : "")
                        }
                      >
                        {p.username === eu ? "você" : p.username} · {p.pecas.toLocaleString("pt-BR")}
                        {p.username !== eu && p.ultimoBipeEm ? ` · ${fmtHora(p.ultimoBipeEm)}` : ""}
                        {p.ocorrencias > 0 ? ` · ⚠ ${p.ocorrencias} não entraram` : ""}
                      </span>
                    ))}
                  {!contandoJunto && (
                    <span className={styles.equipeHint}>quem abrir esta filial no inventário conta nesta mesma lista</span>
                  )}
                  {atividadeRemota && <span className={styles.equipeAtividade}>{atividadeRemota}</span>}
                  <span className={styles.equipeAtualizar}>
                    {ultimaAtualizacao && (
                      <span className={styles.equipeHint}>
                        atualizado às{" "}
                        {new Date(ultimaAtualizacao).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    )}
                    <button
                      type="button"
                      className={styles.btnSecundario}
                      onClick={() => {
                        void atualizarAgora().then((ok) => {
                          if (!ok) mostrarNotificacao("Sem conexão com o rascunho — tente de novo.", "error");
                        });
                      }}
                      disabled={atualizando || isBusy}
                      title="Traz o que os colegas biparam e manda o que é desta tela"
                    >
                      {atualizando ? "Atualizando…" : "↻ Atualizar agora"}
                    </button>
                  </span>
                </div>
              )}

              {saldoDaFilial && (
                <KpiStrip totais={diferencas.totais} naoBipados={diferencas.naoBipados} zerarNaoContados={zerarNaoContados} />
              )}

              {/* ── BIPAGEM ── leitor manda código + Enter e a peça entra na contagem. */}
              <div
                className={`${s.bipeArea} ${s.bipeAreaEntrada} ${bipagem.ocorrencias.length > 0 ? s.bipeAreaAlerta : ""}`}
                onClick={focarCampoBipe}
              >
                <div className={s.bipeRow}>
                  <span className={s.bipeIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M3 5v14M6.5 5v14M10 5v14M13.5 5v10M17 5v14M20.5 5v14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    ref={bipeInputRef}
                    type="text"
                    className={`${s.bipeInput} ${styles.bipeInputVerde}`}
                    value={codigoBipado}
                    onChange={(e) => setCodigoBipado(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || (e.key === "Tab" && e.currentTarget.value.trim())) {
                        e.preventDefault();
                        submeterBipe(e.currentTarget.value);
                      }
                    }}
                    placeholder={
                      filialCod ? "Bipe o código de barras (ou digite e tecle Enter)" : "Selecione a filial para começar a bipar"
                    }
                    // Não trava durante a gravação: campo desabilitado engole a leitura calado.
                    disabled={!filialCod}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Código de barras"
                  />
                  {bipesEmVoo > 0 && <span className={s.bipeLoading}>consultando {bipesEmVoo}…</span>}
                  <button
                    type="button"
                    className={s.bipeAddBtn}
                    onClick={() => submeterBipe()}
                    disabled={!codigoBipado.trim() || !filialCod}
                  >
                    Adicionar
                  </button>
                  <button
                    type="button"
                    className={s.bipeSomBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      alternarSomBipe();
                    }}
                    title={somBipeLigado ? "Desligar o som do bipe" : "Ligar o som do bipe"}
                    aria-pressed={somBipeLigado}
                  >
                    {somBipeLigado ? "🔊" : "🔇"}
                  </button>
                </div>

                {ultimoBipe && (
                  <div className={`${s.bipeFeedback} ${ultimoBipe.ok ? s.bipeFeedbackOk : s.bipeFeedbackErro}`}>
                    <span className={s.bipeFeedbackIcon} aria-hidden="true">
                      {ultimoBipe.ok ? "✓" : "!"}
                    </span>
                    <span className={s.bipeFeedbackTexto}>
                      <strong>{ultimoBipe.titulo}</strong>
                      <span>{ultimoBipe.detalhe}</span>
                    </span>
                  </div>
                )}

                {(bipagem.lidos > 0 || bipagem.ocorrencias.length > 0) && (
                  <div className={s.bipeContador}>
                    <span>
                      Lidos <strong>{bipagem.lidos}</strong>
                    </span>
                    <span className={s.bipeContadorOk}>
                      Entraram <strong>{bipagem.aceitos}</strong>
                    </span>
                    {bipagem.ocorrencias.length > 0 && (
                      <span className={s.bipeContadorAlerta}>
                        Não entraram <strong>{bipagem.ocorrencias.length}</strong>
                      </span>
                    )}
                    {bipagem.dispensadas.length > 0 && (
                      <span>
                        Dispensados <strong>{bipagem.dispensadas.length}</strong>
                      </span>
                    )}
                    {bipesEmVoo > 0 && (
                      <span>
                        Consultando <strong>{bipesEmVoo}</strong>
                      </span>
                    )}
                  </div>
                )}

                {bipagem.ocorrencias.length > 0 && (
                  <div className={s.bipeOcorrencias} role="alert" onClick={(e) => e.stopPropagation()}>
                    <div className={s.bipeOcorrenciasTopo}>
                      <div className={s.bipeOcorrenciasTitulo}>
                        <strong>⚠ {bipagem.ocorrencias.length} bipe(s) NÃO entraram na contagem</strong>
                        <span>Separe estas peças e resolva cada uma. O estoque não sobe até não sobrar nenhuma aqui.</span>
                      </div>
                      {bipagem.ocorrencias.length > 1 && (
                        <button
                          type="button"
                          className={confirmandoDispensaTodas ? s.bipeOcorrenciaBtn : s.bipeOcorrenciaBtnSec}
                          onClick={dispensarTodasOcorrencias}
                        >
                          {confirmandoDispensaTodas
                            ? `Confirmar: ${bipagem.ocorrencias.length} peça(s) fora do inventário`
                            : "Dispensar todos"}
                        </button>
                      )}
                    </div>
                    <ul className={s.bipeOcorrenciasLista}>
                      {bipagem.ocorrencias.map((oc) => (
                        <li key={oc.id} className={s.bipeOcorrencia}>
                          <div className={s.bipeOcorrenciaInfo}>
                            <div className={s.bipeOcorrenciaLinha1}>
                              <span className={s.bipeOcorrenciaCodigo}>{oc.codigo}</span>
                              <strong>{oc.titulo}</strong>
                              <span className={s.bipeOcorrenciaHora}>{new Date(oc.em).toLocaleTimeString("pt-BR")}</span>
                            </div>
                            <span className={s.bipeOcorrenciaDetalhe}>{oc.detalhe}</span>
                            {oc.tipo === "ambiguo" && oc.opcoes && oc.opcoes.length > 0 && (
                              <div className={s.bipeOpcoes}>
                                {oc.opcoes.map((opcao) => {
                                  const corTxt = textoCorProduto(opcao.descCor, opcao.corProduto);
                                  return (
                                    <button
                                      key={`${opcao.produto}|${opcao.corProduto ?? ""}`}
                                      type="button"
                                      className={s.bipeOpcaoBtn}
                                      onClick={() => escolherOpcaoAmbigua(oc, opcao)}
                                    >
                                      <span className={s.bipeOpcaoNome}>{opcao.descProduto}</span>
                                      <span className={s.bipeOpcaoMeta}>
                                        {opcao.produto}
                                        {corTxt ? ` · ${corTxt}` : ""}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className={s.bipeOcorrenciaAcoes}>
                            {oc.tipo !== "ambiguo" && (
                              <button
                                type="button"
                                className={s.bipeOcorrenciaBtn}
                                onClick={() => tentarBipeDeNovo(oc)}
                                disabled={!filialCod}
                              >
                                Tentar de novo
                              </button>
                            )}
                            <button
                              type="button"
                              className={s.bipeOcorrenciaBtnSec}
                              onClick={() => dispensarOcorrencia(oc.id)}
                              title="A peça NÃO entra neste inventário"
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

              {rascunhoRestauradoEm && produtosSelecionados.length > 0 && (
                <div className={s.rascunhoRestauradoAviso}>
                  Rascunho recuperado — última gravação em {fmtDataHora(rascunhoRestauradoEm)}
                </div>
              )}

              {/* Abas: o que foi bipado × diferenças contra o saldo */}
              <div className={styles.viewTabs} role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "bipados"}
                  className={`${styles.viewTab} ${view === "bipados" ? styles.viewTabAtiva : ""}`}
                  onClick={() => setView("bipados")}
                >
                  Itens bipados
                  <span className={styles.viewTabContador}>{totalProdutos}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "diferencas"}
                  className={`${styles.viewTab} ${view === "diferencas" ? styles.viewTabAtiva : ""}`}
                  onClick={() => setView("diferencas")}
                >
                  Diferenças
                  <span className={styles.viewTabContador}>{saldoDaFilial ? diferencas.totais.comDiferenca : "—"}</span>
                </button>
              </div>

              {view === "bipados" ? (
                produtosSelecionados.length === 0 ? (
                  <div className={s.emptyProducts}>
                    <div className={s.emptyProductsIcon} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M12 2 20 6.5v11L12 22l-8-4.5v-11L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                        <path d="M20 6.5 12 12 4 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className={s.emptyProductsTitle}>Nenhuma peça contada</div>
                    <div className={s.emptyProductsSub}>
                      Bipe o código de barras acima ou use “Adicionar Produto” para contar a loja
                    </div>
                  </div>
                ) : (
                  <div
                    className={s.produtosList}
                    onClick={(e) => {
                      // Clique em lixeira/+/−/tamanho deixava o cursor no botão: volta para o bipe.
                      if ((e.target as HTMLElement).closest("button")) focarCampoBipe();
                    }}
                  >
                    {produtosSelecionados.map((produto) => {
                      const corTxt = textoCorProduto(produto.descCor, produto.corProduto);
                      const chaveItem = chaveLinha(produto);
                      const quemContou = contandoJunto
                        ? Object.entries(baseItens.get(chaveSync(produto))?.porUsuario ?? {}).sort((x, y) => y[1] - x[1])
                        : [];
                      const destacado = itemDestacado === chaveItem;
                      const semTamanho = faltaTamanho(produto);
                      const saldoLinha = saldoDaLinha(produto);
                      const saldoTam = saldoPorNorm.get(chaveNorm(produto.produto, produto.corProduto));
                      return (
                        <div
                          key={chaveItem}
                          className={`${s.produtoItem} ${destacado ? s.produtoItemBipado : ""} ${semTamanho ? s.produtoItemSemTamanho : ""}`}
                          ref={(el) => {
                            if (!destacado || !el) return;
                            if (destaqueScrollRef.current === chaveItem) return;
                            destaqueScrollRef.current = chaveItem;
                            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                          }}
                        >
                          <div className={s.produtoInfo}>
                            <div className={s.produtoName}>{produto.descProduto}</div>
                            <div className={s.produtoSku}>
                              {produto.produto}
                              {corTxt ? ` · ${corTxt}` : ""}
                              {produto.codigoBarra && ` · ${produto.codigoBarra}`}
                            </div>
                            {quemContou.length > 0 && (
                              <div className={styles.linhaQuem} title="Quem contou estas peças">
                                {quemContou.map(([u, n]) => (
                                  <span key={u} className={u === username.toLowerCase() ? styles.linhaQuemEu : undefined}>
                                    {u === username.toLowerCase() ? "você" : u} {n}
                                  </span>
                                ))}
                              </div>
                            )}
                            {produto.tamanhos && produto.tamanhos.length > 0 && (
                              <div className={s.tamanhoRow} role="group" aria-label="Tamanho">
                                <span className={semTamanho ? s.tamanhoLabelFaltando : s.tamanhoLabel}>
                                  {semTamanho ? "Escolha o tamanho:" : "Tamanho:"}
                                </span>
                                {produto.tamanhos.map((t) => {
                                  const ativo = produto.tamanho === t.ordinal;
                                  const saldoT = saldoTam?.tamanhos[String(t.ordinal)] ?? 0;
                                  return (
                                    <button
                                      key={t.ordinal}
                                      type="button"
                                      className={`${s.tamanhoChip} ${ativo ? s.tamanhoChipAtivo : ""}`}
                                      onClick={() => escolherTamanho(chaveItem, t.ordinal)}
                                      disabled={isBusy}
                                      title={`${t.label} — saldo ${saldoT}`}
                                    >
                                      {t.label}
                                      <span className={s.tamanhoChipSaldo}>{saldoT}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className={s.produtoControls}>
                            <div className={s.qtyControl}>
                              <button
                                className={s.qtyBtn}
                                onClick={() => atualizarQuantidade(chaveItem, produto.quantidade - 1)}
                                disabled={produto.quantidade <= 1}
                              >
                                −
                              </button>
                              <input
                                type="number"
                                className={s.qtyInput}
                                data-leitor-qtd={chaveItem}
                                value={produto.quantidade}
                                onChange={(e) => atualizarQuantidade(chaveItem, parseInt(e.target.value, 10) || 1)}
                                min={1}
                              />
                              <button className={s.qtyBtn} onClick={() => atualizarQuantidade(chaveItem, produto.quantidade + 1)}>
                                +
                              </button>
                            </div>
                            <div className={s.stockPill} title="Contado / saldo atual no Linx">
                              {produto.quantidade}/{saldoLinha ?? "?"}
                            </div>
                            <button className={s.removeBtn} onClick={() => removerProduto(chaveItem)} title="Remover">
                              🗑
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : !saldoDaFilial ? (
                <div className={styles.diffVazio}>
                  {filialCod ? "Carregando o saldo da filial…" : "Selecione a filial para ver as diferenças."}
                </div>
              ) : (
                <>
                  <div className={styles.diffHeader}>
                    <p className={styles.hint}>
                      Contagem bipada × saldo atual.
                      {zerarNaoContados
                        ? " Itens com saldo ainda não bipados aparecem como saída (viram 0 ao subir)."
                        : " Inventário parcial: só os itens bipados."}
                    </p>
                    <label className={styles.diffToggle}>
                      <input type="checkbox" checked={mostrarTodos} onChange={(e) => setMostrarTodos(e.target.checked)} />
                      Mostrar itens sem diferença
                    </label>
                  </div>
                  <div className={styles.diffScroll}>
                    <table className={styles.diffTable}>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th>Descrição</th>
                          <th>Cor</th>
                          <th className={styles.num}>Saldo atual</th>
                          <th className={styles.num}>Contado</th>
                          <th className={styles.num}>Diferença</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhasDiferencaExibidas.slice(0, DIFERENCAS_MAX_LINHAS).map((l) => (
                          <tr key={`${l.produto}|${l.cor}`} className={l.bipado ? "" : styles.rowNaoBipado}>
                            <td className={styles.mono}>{l.produto}</td>
                            <td>
                              {l.descProduto}
                              {!l.bipado && <span className={styles.tagNaoBipado}>não bipado</span>}
                            </td>
                            <td>{l.descCor || l.cor}</td>
                            <td className={styles.num}>{l.saldo}</td>
                            <td className={`${styles.num} ${styles.final}`}>{l.contagem}</td>
                            <td className={`${styles.num} ${l.delta < 0 ? styles.neg : l.delta > 0 ? styles.pos : ""}`}>
                              {l.ajustaTamanho ? (
                                <span title="O total bate, mas a quantidade por tamanho muda">tamanhos</span>
                              ) : (
                                <>
                                  {l.delta > 0 ? "+" : ""}
                                  {l.delta}
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                        {linhasDiferencaExibidas.length === 0 && (
                          <tr>
                            <td colSpan={6} className={styles.diffVazio}>
                              {produtosSelecionados.length === 0 && !zerarNaoContados
                                ? "Bipe as peças para ver as diferenças."
                                : "Nenhuma diferença."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {linhasDiferencaExibidas.length > DIFERENCAS_MAX_LINHAS && (
                    <p className={styles.hint}>
                      Mostrando {DIFERENCAS_MAX_LINHAS} de {linhasDiferencaExibidas.length.toLocaleString("pt-BR")} linhas. O
                      inventário aplica todas.
                    </p>
                  )}
                </>
              )}

              <div className={s.produtosActionsRow}>
                <button
                  type="button"
                  className={`${s.addProductBtn} ${s.addProductBtnEntrada} ${styles.addVerde}`}
                  onClick={abrirModalAdicionarProduto}
                  disabled={!filialCod || isBusy || !!encerramento}
                >
                  <span className={s.addProductBtnIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                  Adicionar Produto
                </button>
                {produtosSelecionados.length > 0 && (
                  <button type="button" className={s.clearProductsBtn} onClick={limparLista} disabled={isBusy || !!encerramento}>
                    Limpar lista
                  </button>
                )}
              </div>
            </div>

            {/* Obs + Subir estoque */}
            <div className={s.bottomArea}>
              <div className={s.obsLabel}>Observação (opcional)</div>
              <textarea
                className={s.obsTextarea}
                data-leitor-obs=""
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Observações do inventário…"
                rows={2}
                maxLength={2000}
                disabled={isBusy}
              />
              {zerarNaoContados && saldoDaFilial && diferencas.naoBipados > 0 && produtosSelecionados.length > 0 && (
                <div className={styles.alertaZerar}>
                  <span>
                    <strong>Inventário completo:</strong> {diferencas.naoBipados.toLocaleString("pt-BR")} item(ns) com saldo
                    ainda não foram bipados e serão <strong>ZERADOS</strong> ao subir.
                  </span>
                  <span>Bipe a loja inteira antes de subir o estoque.</span>
                </div>
              )}
              <div className={s.submitRow}>
                <div className={s.submitCounts}>
                  <div className={s.submitCountItem}>
                    <div className={s.submitCountValue}>{totalProdutos}</div>
                    <div className={s.submitCountLabel}>Produtos</div>
                  </div>
                  <div className={s.submitCountItem}>
                    <div className={s.submitCountValue}>{totalPecas}</div>
                    <div className={s.submitCountLabel}>Peças</div>
                  </div>
                  <div className={s.submitCountItem}>
                    <div className={s.submitCountValue}>{saldoDaFilial ? diferencas.totais.comDiferenca : "—"}</div>
                    <div className={s.submitCountLabel}>Diferenças</div>
                  </div>
                </div>
                <button
                  className={`${s.submitBtn} ${podeSubir ? `${s.submitBtnEntrada} ${styles.submitVerde}` : ""}`}
                  onClick={() => void abrirConfirmacao()}
                  disabled={!podeSubir}
                  title={somenteLeitura ? "Acesso somente leitura" : undefined}
                >
                  <span className={s.submitBtnIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {conferindo ? "⏳ Conferindo saldo…" : executando ? "⏳ Subindo…" : "Subir estoque"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal – Confirmação de subir o estoque */}
      {previewServidor && (
        <div className={s.modalOverlay} onClick={() => !executando && setPreviewServidor(null)}>
          <div className={`${s.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <h2 className={s.modalTitle}>Subir o inventário?</h2>
              <button className={s.modalCloseBtn} onClick={() => !executando && setPreviewServidor(null)}>
                ×
              </button>
            </div>
            <div className={s.modalBody}>
              <p className={styles.confirmLinha}>
                Filial: <strong>{previewServidor.filialNome}</strong> · Descrição: <strong>{nomeContagem}</strong> ·
                Responsável: <strong>{username}</strong>
              </p>
              <p className={styles.confirmLinha}>
                Contagem atualizada agora com o que todos biparam
                {ultimaAtualizacao ? ` (às ${new Date(ultimaAtualizacao).toLocaleTimeString("pt-BR")})` : ""}. Quem sobe fica
                como responsável no Linx.
              </p>
              {contandoJunto && (
                <p className={styles.confirmLinha}>
                  Contado por:{" "}
                  <strong>
                    {participantes
                      .filter((p) => p.pecas > 0)
                      .map(
                        (p) =>
                          `${p.username === eu ? "você" : p.username} (${p.pecas}${
                            p.username !== eu && p.ultimoBipeEm ? `, último bipe ${fmtHora(p.ultimoBipeEm)}` : ""
                          })`
                      )
                      .join(" · ")}
                  </strong>
                </p>
              )}
              {colegasComOcorrencia.length > 0 && (
                <div className={styles.alertaZerar}>
                  <span>
                    <strong>
                      Bipes que NÃO entraram na contagem na tela de:{" "}
                      {colegasComOcorrencia.map((p) => `${p.username} (${p.ocorrencias})`).join(", ")}
                    </strong>
                    . Peça para resolverem no painel vermelho da tela deles — se subir agora, essas peças contam como não
                    bipadas (viram 0).
                  </span>
                  <label className={styles.confirmCheck}>
                    <input
                      type="checkbox"
                      checked={aceitarOcorrencias}
                      onChange={(e) => setAceitarOcorrencias(e.target.checked)}
                    />
                    Subir mesmo assim, sem esses bipes.
                  </label>
                </div>
              )}
              {previewServidor.nomeSugerido && (
                <p className={styles.confirmLinha}>
                  Já existe um inventário com a descrição sugerida hoje — usando <strong>{previewServidor.nomeSugerido}</strong>.
                </p>
              )}
              <div className={a.totaisBar}>
                <div className={`${a.totalBox} ${a.totalBoxDestaque} ${styles.boxVerde}`}>
                  <span className={a.totalLabel}>Saldo atual (total)</span>
                  <span className={a.totalValor}>{fmtNum(previewServidor.totais.saldoAtualTotal)}</span>
                </div>
                <div className={`${a.totalBox} ${a.totalBoxDestaque} ${styles.boxVerde}`}>
                  <span className={a.totalLabel}>Saldo final (após ajuste)</span>
                  <span className={`${a.totalValor} ${styles.final}`}>{fmtNum(previewServidor.totais.saldoFinalTotal)}</span>
                </div>
                <div className={a.totalBox}>
                  <span className={a.totalLabel}>Variação líquida</span>
                  <span className={`${a.totalValor} ${previewServidor.totais.somaDelta < 0 ? a.neg : a.pos}`}>
                    {previewServidor.totais.somaDelta > 0 ? "+" : ""}
                    {fmtNum(previewServidor.totais.somaDelta)}
                  </span>
                </div>
                <div className={a.totalBox}>
                  <span className={a.totalLabel}>Itens a ajustar</span>
                  <span className={a.totalValor}>{fmtNum(previewServidor.totais.comDiferenca)}</span>
                </div>
              </div>
              {zerarNaoContados && previewServidor.naoBipados > 0 && (
                <div className={styles.alertaZerar}>
                  <span>
                    <strong>{previewServidor.naoBipados.toLocaleString("pt-BR")} item(ns) não bipados serão ZERADOS</strong>{" "}
                    (inventário completo).
                  </span>
                </div>
              )}
              {bipagem.lidos > 0 && (
                <p className={s.confirmacaoBipagem}>
                  Bipagem: <strong>{bipagem.lidos}</strong> leitura(s) · <strong>{bipagem.aceitos}</strong> entraram na contagem
                  {bipagem.dispensadas.length > 0 && (
                    <>
                      {" "}
                      · <strong>{bipagem.dispensadas.length}</strong> dispensada(s)
                    </>
                  )}
                </p>
              )}
              {bipagem.dispensadas.length > 0 && (
                <div className={s.confirmacaoDispensadas}>
                  <strong>NÃO entram neste inventário (dispensados por você):</strong>
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
              {previewServidor.totais.comDiferenca === 0 && (
                <p className={styles.avisoLista}>Nada a ajustar: a contagem já bate com o saldo.</p>
              )}
              {(bipesEmVoo > 0 || bipagem.ocorrencias.length > 0) && (
                <p className={s.confirmacaoBloqueio}>
                  {bipesEmVoo > 0
                    ? `Aguarde: ${bipesEmVoo} bipe(s) ainda em consulta.`
                    : `${bipagem.ocorrencias.length} bipe(s) NÃO entraram na contagem — feche e resolva antes de subir.`}
                </p>
              )}
              {listaMudouDesdeConferencia && (
                <p className={styles.avisoLista}>
                  A lista mudou depois desta conferência (peça bipada com a janela aberta, aqui ou por quem conta junto).
                  Feche e clique em “Subir estoque” de novo para conferir.
                </p>
              )}
              <p className={a.modalWarn}>Altera o estoque real no Linx e registra no extrato. Dá pra desfazer depois.</p>
              <label className={styles.confirmCheck}>
                <input type="checkbox" checked={confirmCheck} onChange={(e) => setConfirmCheck(e.target.checked)} />
                {contandoJunto
                  ? `Confirmo que revisei as diferenças, que todos que estão contando (${participantes
                      .filter((p) => p.pecas > 0 && p.username !== eu)
                      .map((p) => p.username)
                      .join(", ")}) já terminaram, e desejo subir o inventário.`
                  : "Confirmo que revisei as diferenças e desejo subir o inventário."}
              </label>
            </div>
            <div className={s.modalFooter}>
              <button className={s.btnSecondary} onClick={() => setPreviewServidor(null)} disabled={executando}>
                Cancelar
              </button>
              <button
                className={`${s.btnConfirmarEntrada} ${styles.confirmarVerde}`}
                onClick={() => void subirEstoque()}
                disabled={
                  !confirmCheck ||
                  (colegasComOcorrencia.length > 0 && !aceitarOcorrencias) ||
                  executando ||
                  bipesEmVoo > 0 ||
                  bipagem.ocorrencias.length > 0 ||
                  listaMudouDesdeConferencia ||
                  previewServidor.totais.comDiferenca === 0
                }
              >
                {executando ? "Subindo…" : "Subir estoque"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal – Detalhe de um inventário do histórico */}
      {detalheAberto && (
        <div className={s.modalOverlay} onClick={() => setDetalheAberto(null)}>
          <div className={`${s.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <h2 className={s.modalTitle}>
                <span className={styles.mono}>{detalheAberto.nome}</span> · {detalheAberto.filial}
              </h2>
              <button className={s.modalCloseBtn} onClick={() => setDetalheAberto(null)}>
                ×
              </button>
            </div>
            <div className={s.modalBody}>
              {detalheCarregando && !detalhe ? (
                <p className={a.fileHintMuted}>Carregando itens…</p>
              ) : (
                <>
                  {detalhe?.kpis && <AjusteKpisResumo kpis={detalhe.kpis} />}
                  <div className={styles.detalheScroll}>
                    <table className={styles.diffTable}>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th>Descrição</th>
                          <th>Cor</th>
                          {detalheComSaldo && <th className={styles.num}>Saldo anterior</th>}
                          <th className={styles.num}>Ajuste</th>
                          {detalheComSaldo && <th className={styles.num}>Saldo após</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {(detalhe?.itens ?? []).map((it, idx) => (
                          <tr key={`${it.produto}|${it.cor}|${idx}`}>
                            <td className={styles.mono}>{it.produto}</td>
                            <td>{it.descProduto}</td>
                            <td>{it.descCor || it.cor}</td>
                            {detalheComSaldo && <td className={styles.num}>{fmtNum(it.saldoAnterior ?? null)}</td>}
                            <td className={`${styles.num} ${it.qtde < 0 ? styles.neg : styles.pos}`}>
                              {it.qtde > 0 ? "+" : ""}
                              {it.qtde}
                            </td>
                            {detalheComSaldo && (
                              <td className={`${styles.num} ${styles.final}`}>{fmtNum(it.saldoFinal ?? null)}</td>
                            )}
                          </tr>
                        ))}
                        {(detalhe?.itens.length ?? 0) === 0 && !detalheCarregando && (
                          <tr>
                            <td colSpan={detalheComSaldo ? 6 : 4} className={styles.diffVazio}>
                              Nenhum item encontrado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            <div className={s.modalFooter}>
              <button className={s.btnSecondary} onClick={() => setDetalheAberto(null)}>
                Fechar
              </button>
              <button
                className={styles.btnSecundario}
                onClick={() => void desfazer(detalheAberto.nome)}
                disabled={estornandoNome === detalheAberto.nome || somenteLeitura}
                title="Cria um estorno (ajuste inverso) registrado"
              >
                {estornandoNome === detalheAberto.nome ? "Desfazendo…" : "↩ Desfazer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal – Adicionar Produto (busca) */}
      {modalAberto && (
        <div className={s.modalOverlay} onClick={fecharModalAdicionarProduto}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <h2 className={s.modalTitle}>Adicionar Produto</h2>
              <button className={s.modalCloseBtn} onClick={fecharModalAdicionarProduto}>
                ×
              </button>
            </div>
            <div className={s.modalContent}>
              <div className={s.searchBox}>
                <span className={s.searchIcon}>🔍</span>
                <input
                  type="text"
                  className={s.searchInput}
                  placeholder="Buscar por nome, SKU ou código de barras..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoFocus
                />
              </div>
              {loadingProdutos ? (
                <div className={s.loadingText}>Buscando produtos...</div>
              ) : produtos.length === 0 && searchTerm.length >= 2 ? (
                <div className={s.emptyLog}>Nenhum produto encontrado</div>
              ) : (
                <div className={s.produtosModalList}>
                  {produtos.map((produto, index) => {
                    const corModalTxt = textoCorProduto(produto.descCor, produto.corProduto);
                    const isPickerActive = colorPickerProduto?.produto === produto.produto && produto.corProduto === null;
                    const saldoItem = produto.corProduto
                      ? saldoPorNorm.get(chaveNorm(produto.produto, produto.corProduto))
                      : undefined;
                    const contado = produtosSelecionados
                      .filter((p) => p.produto === produto.produto && (p.corProduto ?? null) === (produto.corProduto?.trim() ?? null))
                      .reduce((acc, p) => acc + p.quantidade, 0);
                    return (
                      <div
                        key={index}
                        className={`${s.produtoModalItem}${isPickerActive ? ` ${s.produtoModalItemPickerActive}` : ""}`}
                      >
                        <div className={s.produtoModalIcon}>📦</div>
                        <div className={s.produtoModalInfo}>
                          <div className={s.produtoModalName}>{produto.descProduto}</div>
                          <div className={s.produtoModalDetails}>
                            {produto.produto}
                            {corModalTxt ? ` · ${corModalTxt}` : ""}
                            {saldoItem ? ` · Saldo: ${saldoItem.estoque}` : ""}
                            {contado > 0 ? ` · Contado: ${contado}` : ""}
                          </div>
                        </div>
                        {!isPickerActive && (
                          <button
                            className={`${s.addModalBtn} ${s.addModalBtnEntrada}`}
                            onClick={() => adicionarProdutoBusca(produto)}
                            title="Contar +1"
                          >
                            +
                          </button>
                        )}
                        {isPickerActive && (
                          <div className={s.colorPickerRow}>
                            {loadingColorPicker ? (
                              <span className={s.colorPickerLoading}>Buscando cores...</span>
                            ) : colorPickerOpcoes.length > 0 ? (
                              <div className={s.colorChips}>
                                {colorPickerOpcoes.map((opcao) => (
                                  <button
                                    key={opcao.corProduto}
                                    className={`${s.colorChip} ${s.colorChipEntrada}`}
                                    onClick={() => adicionarProdutoBusca(opcao)}
                                  >
                                    {opcao.descCor || opcao.corProduto}
                                  </button>
                                ))}
                                <button
                                  className={s.colorChipCancel}
                                  onClick={() => {
                                    setColorPickerProduto(null);
                                    setColorPickerOpcoes([]);
                                  }}
                                  title="Cancelar"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <div className={s.colorPickerNenhuma}>
                                <span>Nenhuma cor disponível</span>
                                <button
                                  className={s.colorChipCancel}
                                  onClick={() => {
                                    setColorPickerProduto(null);
                                    setColorPickerOpcoes([]);
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className={s.modalFooter}>
              <button className={s.btnPrimary} onClick={fecharModalAdicionarProduto}>
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {notificacao && (
        <div className={`${s.toast} ${notificacao.tipo === "success" ? s.toastSuccess : s.toastError}`}>
          <span className={s.toastIcon}>{notificacao.tipo === "success" ? "✓" : "✕"}</span>
          <span>{notificacao.mensagem}</span>
        </div>
      )}
    </div>
  );
}
