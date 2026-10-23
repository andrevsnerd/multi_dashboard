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

/** Tira da lista o que acabou de subir — e só isso. Peça bipada durante a gravação fica. */
function descontarGravados(lista: LinhaInventario[], gravados: LinhaInventario[]): LinhaInventario[] {
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

/** Assinatura da lista — a confirmação vale só para a lista que foi conferida. */
function assinaturaLista(lista: LinhaInventario[]): string {
  return lista
    .map((p) => `${chaveLinha(p)}=${p.quantidade}`)
    .sort()
    .join(";");
}

/** Rascunho persistido no Neon (ver `lib/utils/inventario-draft-store.ts`). */
interface RascunhoResumo {
  id: string;
  companyKey: string;
  username: string;
  filialCod: string;
  filialNome: string;
  nomeContagem: string;
  nomeEditado: boolean;
  observacao: string;
  zerarNaoContados: boolean;
  itens: Array<{
    produto: string;
    descProduto: string;
    codigoBarra: string | null;
    corProduto: string | null;
    descCor: string;
    quantidade: number;
    tamanho?: number | null;
    tamanhoLabel?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

type RascunhoStatus = "idle" | "salvando" | "salvo" | "erro";

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

async function salvarRascunhoApi(payload: string, username: string, keepalive = false): Promise<void> {
  const response = await fetch("/api/inventario/rascunhos", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: payload,
    keepalive,
  });
  if (!response.ok) throw new Error("Erro ao salvar rascunho");
}

async function removerRascunhoApi(
  params: { id: string } | { companyKey: string; filialCod: string },
  username?: string
): Promise<void> {
  const search = new URLSearchParams(
    "id" in params ? { id: params.id } : { company: params.companyKey, filialCod: params.filialCod }
  );
  const headers: Record<string, string> = {};
  if (username) headers["x-auth-username"] = username;
  await fetch(`/api/inventario/rascunhos?${search.toString()}`, { method: "DELETE", headers });
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
  /** Último payload gravado — evita reenviar o mesmo rascunho a cada render. */
  const rascunhoPayloadRef = useRef<string>("");
  /** Payload esperando o debounce — gravado na hora se a filial trocar ou a aba fechar. */
  const rascunhoPendenteRef = useRef<{ payload: string; username: string } | null>(null);
  /** Já há rascunho gravado neste escopo? Sem isso o 1º render (lista vazia) apagaria o rascunho. */
  const rascunhoSalvoRef = useRef(false);
  /** Estado (não ref) de propósito: o autosave precisa ser reavaliado quando a restauração termina. */
  const [hidratandoRascunho, setHidratandoRascunho] = useState(false);

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
          const idxQtd = alvo.dataset.leitorQtd;
          if (idxQtd !== undefined) {
            const idx = Number(idxQtd);
            const qtd = Math.max(1, parseInt(valorAntes, 10) || 1);
            setProdutosSelecionados((prev) => prev.map((p, i) => (i === idx ? { ...p, quantidade: qtd } : p)));
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

  const atualizarQuantidade = useCallback((index: number, quantidade: number) => {
    if (!Number.isFinite(quantidade) || quantidade < 1) return;
    setProdutosSelecionados((prev) => prev.map((p, i) => (i === index ? { ...p, quantidade: Math.trunc(quantidade) } : p)));
  }, []);

  const removerProduto = useCallback((index: number) => {
    setProdutosSelecionados((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const limparLista = useCallback(() => {
    if (!window.confirm("Limpar a lista inteira deste inventário? O que foi bipado será perdido.")) return;
    setProdutosSelecionados([]);
    zerarBipagem();
  }, [zerarBipagem]);

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
  const escolherTamanho = useCallback((index: number, ordinal: number) => {
    setProdutosSelecionados((prev) => {
      const linha = prev[index];
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

  /** Um rascunho por empresa × usuário × filial. */
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

  /** Grava na hora o que estava esperando o debounce (troca de filial, aba fechando). */
  const gravarRascunhoPendente = useCallback((keepalive = false) => {
    const pendente = rascunhoPendenteRef.current;
    if (!pendente || pendente.payload === rascunhoPayloadRef.current) return;
    rascunhoPendenteRef.current = null;
    rascunhoPayloadRef.current = pendente.payload;
    void salvarRascunhoApi(pendente.payload, pendente.username, keepalive).catch(() => undefined);
  }, []);

  useEffect(() => {
    const aoSair = () => gravarRascunhoPendente(true);
    window.addEventListener("pagehide", aoSair);
    return () => window.removeEventListener("pagehide", aoSair);
  }, [gravarRascunhoPendente]);

  // Trocar de filial: a lista da tela passa a ser a da filial nova (o rascunho da antiga fica salvo).
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
      gravarRascunhoPendente();
      // Limpa no MESMO render da troca: um render com a filial nova e a lista velha
      // faria o autosave gravar a contagem de uma loja no rascunho da outra.
      filialCodRef.current = cod;
      produtosSelecionadosRef.current = [];
      setProdutosSelecionados([]);
      setResultado(null);
      setPreviewServidor(null);
      setNomeEditado(false);
      setObservacao("");
      setFilialCod(cod);
    },
    [gravarRascunhoPendente]
  );

  // Restaura o rascunho do escopo atual (carga da página ou troca de filial).
  useEffect(() => {
    rascunhoPayloadRef.current = "";
    rascunhoPendenteRef.current = null;
    rascunhoSalvoRef.current = false;
    setRascunhoStatus("idle");
    setRascunhoRestauradoEm(null);
    if (!escopoRascunho || !username || !filialCod) return;

    const cod = filialCod;
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
            r.filialCod.trim().toUpperCase() === cod.trim().toUpperCase()
        );
        if (!meu || meu.itens.length === 0) return;

        // Só restaura sobre lista vazia: o que foi bipado enquanto a consulta ia vale mais.
        let aplicou = false;
        setProdutosSelecionados((prev) => {
          if (prev.length > 0) return prev;
          aplicou = true;
          const itens = meu.itens.map((item) => ({
            produto: item.produto,
            descProduto: item.descProduto,
            codigoBarra: item.codigoBarra,
            corProduto: item.corProduto,
            descCor: item.descCor,
            quantidade: item.quantidade,
            tamanho: item.tamanho ?? null,
            tamanhoLabel: item.tamanhoLabel ?? null,
          }));
          produtosSelecionadosRef.current = itens;
          return itens;
        });
        if (!aplicou) return;
        rascunhoSalvoRef.current = true;
        setRascunhoRestauradoEm(meu.updatedAt);
        setObservacao(meu.observacao);
        if (meu.nomeEditado && meu.nomeContagem) {
          setNomeContagem(meu.nomeContagem);
          setNomeEditado(true);
        }
      } catch {
        // sem rascunho recuperado: a tela segue com a lista vazia
      } finally {
        if (!cancelado) setHidratandoRascunho(false);
      }
    })();
    return () => {
      cancelado = true;
      setHidratandoRascunho(false);
    };
    // O escopo (string) é o que define quando recarregar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escopoRascunho, companyKey, username]);

  // Autosave: grava o rascunho pouco depois de cada mudança (bipe, quantidade, obs).
  useEffect(() => {
    if (!username || !filialCod) return;
    if (hidratandoRascunho) return;
    // Lista vazia e nada gravado = estado inicial: um PUT vazio apagaria o rascunho.
    if (produtosSelecionados.length === 0 && !rascunhoSalvoRef.current) return;

    const payload = JSON.stringify({
      company: companyKey,
      filialCod,
      filialNome: filialSelecionada?.nome ?? filialNomeLinx,
      nomeContagem,
      nomeEditado,
      observacao,
      zerarNaoContados,
      itens: produtosSelecionados.map((p) => ({
        produto: p.produto,
        descProduto: p.descProduto,
        codigoBarra: p.codigoBarra,
        corProduto: p.corProduto,
        descCor: p.descCor,
        quantidade: p.quantidade,
        tamanho: p.tamanho ?? null,
        tamanhoLabel: p.tamanhoLabel ?? null,
      })),
    });
    if (payload === rascunhoPayloadRef.current) return;
    rascunhoPendenteRef.current = { payload, username };

    const vazia = produtosSelecionados.length === 0;
    const timeoutId = setTimeout(async () => {
      if (rascunhoPendenteRef.current?.payload !== payload) return;
      setRascunhoStatus("salvando");
      try {
        await salvarRascunhoApi(payload, username);
        rascunhoPayloadRef.current = payload;
        if (rascunhoPendenteRef.current?.payload === payload) rascunhoPendenteRef.current = null;
        rascunhoSalvoRef.current = !vazia;
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
    observacao,
    nomeContagem,
    nomeEditado,
    zerarNaoContados,
    filialCod,
    filialSelecionada,
    filialNomeLinx,
    companyKey,
    username,
    hidratandoRascunho,
    carregarRascunhos,
  ]);

  /**
   * Assume um rascunho (inclusive de outro usuário — o inventário é da LOJA, e
   * quem entra no turno precisa continuar a contagem, não duplicá-la). Grava no
   * MEU escopo antes de apagar o original.
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
      gravarRascunhoPendente();

      const itens: LinhaInventario[] = rascunho.itens.map((item) => ({
        produto: item.produto,
        descProduto: item.descProduto,
        codigoBarra: item.codigoBarra,
        corProduto: item.corProduto,
        descCor: item.descCor,
        quantidade: item.quantidade,
        tamanho: item.tamanho ?? null,
        tamanhoLabel: item.tamanhoLabel ?? null,
      }));

      const payload = JSON.stringify({
        company: companyKey,
        filialCod: rascunho.filialCod,
        filialNome: rascunho.filialNome,
        nomeContagem: rascunho.nomeContagem,
        nomeEditado: rascunho.nomeEditado,
        observacao: rascunho.observacao,
        zerarNaoContados: true,
        itens: rascunho.itens,
      });
      try {
        await salvarRascunhoApi(payload, username);
      } catch {
        // Não gravou: o original continua sendo a única cópia segura — não troca a tela.
        mostrarNotificacao("Não foi possível assumir o rascunho agora. Tente de novo.", "error");
        return;
      }
      const meu = rascunho.username.toLowerCase() === username.toLowerCase();
      if (!meu) {
        await removerRascunhoApi({ id: rascunho.id }, username).catch(() => undefined);
      }

      // Neutraliza o efeito que limpa a lista na troca de filial: aqui a troca é intencional.
      filialCodRef.current = rascunho.filialCod;
      produtosSelecionadosRef.current = itens;
      setFilialCod(rascunho.filialCod);
      setProdutosSelecionados(itens);
      setObservacao(rascunho.observacao);
      setNomeEditado(rascunho.nomeEditado);
      if (rascunho.nomeEditado && rascunho.nomeContagem) setNomeContagem(rascunho.nomeContagem);
      setResultado(null);
      setAbaLateral("historico");
      void carregarRascunhos();
      mostrarNotificacao(
        `Rascunho retomado · ${rascunho.itens.length} produto(s)${meu ? "" : ` de ${rascunho.username}`}`
      );
    },
    [filiais, username, companyKey, gravarRascunhoPendente, carregarRascunhos, mostrarNotificacao]
  );

  const descartarRascunho = useCallback(
    async (rascunho: RascunhoResumo) => {
      if (!window.confirm(`Descartar o rascunho de ${rascunho.filialNome} com ${rascunho.itens.length} produto(s)?`)) {
        return;
      }
      try {
        await removerRascunhoApi({ id: rascunho.id }, username);
        const ehOAtual =
          !!filialCod &&
          rascunho.filialCod.trim().toUpperCase() === filialCod.trim().toUpperCase() &&
          rascunho.username.toLowerCase() === username.toLowerCase();
        if (ehOAtual) {
          rascunhoSalvoRef.current = false;
          rascunhoPayloadRef.current = "";
          rascunhoPendenteRef.current = null;
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
    },
    [username, filialCod, carregarRascunhos, mostrarNotificacao, zerarBipagem]
  );

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
  ]);

  const listaMudouDesdeConferencia =
    previewServidor !== null && assinaturaLista(produtosSelecionados) !== previewAssinatura;

  const subirEstoque = useCallback(async () => {
    if (!previewServidor || executando) return;
    // Bipe lido com o modal aberto (o leitor não para): mesma trava do botão.
    if (bipagem.emVoo.length > 0 || bipagem.ocorrencias.length > 0) return;
    const lista = produtosSelecionadosRef.current;
    if (assinaturaLista(lista) !== previewAssinatura) return;

    const snapBipagem = {
      lidos: bipagem.lidos,
      aceitos: bipagem.aceitos,
      dispensadas: bipagem.dispensadas.map((d) => d.id),
    };
    setExecutando(true);
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
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data) {
        mostrarNotificacao(data?.error ?? "Erro ao subir o inventário.", "error");
        if (resp.status === 409) void fetchRecentes();
        return;
      }

      // O rascunho existe só até o estoque subir. Zerar os controles do autosave
      // ANTES de mexer na lista evita gravar um rascunho velho logo depois.
      rascunhoSalvoRef.current = false;
      rascunhoPayloadRef.current = "";
      rascunhoPendenteRef.current = null;
      setRascunhoStatus("idle");
      setRascunhoRestauradoEm(null);
      await removerRascunhoApi({ companyKey, filialCod }, username).catch(() => undefined);

      // Tira da lista só o que subiu: peça bipada durante a gravação fica.
      const sobra = descontarGravados(produtosSelecionadosRef.current, lista);
      setProdutosSelecionados((prev) => {
        const next = descontarGravados(prev, lista);
        produtosSelecionadosRef.current = next;
        return next;
      });
      produtosSelecionadosRef.current = sobra;
      fecharBipagemDoRegistro(snapBipagem);

      const pecasSobra = sobra.reduce((acc, p) => acc + p.quantidade, 0);
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
      void fetchRecentes();
    } finally {
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
      r.itens.length > 0 &&
      (filiais.ativas.some((f) => f.cod === r.filialCod) || filiais.inativas.some((f) => f.cod === r.filialCod))
  );

  const isBusy = executando || conferindo;
  const podeSubir =
    !!filialCod && produtosSelecionados.length > 0 && !isBusy && !somenteLeitura && !!saldoDaFilial;

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
              ` ${resultado.sobra} peça(s) bipada(s) durante a gravação ficaram na lista para o próximo inventário.`}
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
                  <span className={s.rascunhosAjuda}>Inventários em aberto — somem quando o estoque sobe.</span>
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
                        const pecas = rascunho.itens.reduce((acc, i) => acc + i.quantidade, 0);
                        const ehAtual =
                          !!filialCod &&
                          rascunho.filialCod.trim().toUpperCase() === filialCod.trim().toUpperCase() &&
                          rascunho.username.toLowerCase() === username.toLowerCase();
                        return (
                          <div key={rascunho.id} className={s.rascunhoItem}>
                            <div className={s.rascunhoTopo}>
                              <span className={`${s.rascunhoTipoPill} ${s.rascunhoTipoPillEntrada}`}>Inventário</span>
                              <span className={s.rascunhoFilial}>{rascunho.filialNome}</span>
                              {ehAtual && <span className={`${s.rascunhoAtualPill} ${styles.pillVerde}`}>na tela</span>}
                            </div>
                            <div className={s.rascunhoMeta}>
                              {rascunho.itens.length} prod · {pecas} {pecas === 1 ? "peça" : "peças"}
                            </div>
                            <div className={s.rascunhoMeta}>
                              {rascunho.username} · {fmtDataHora(rascunho.updatedAt)}
                            </div>
                            <div className={s.rascunhoAcoes}>
                              <button
                                type="button"
                                className={`${s.rascunhoRetomarBtn} ${styles.retomarVerde}`}
                                onClick={() => void retomarRascunho(rascunho)}
                                disabled={ehAtual || isBusy}
                                title={ehAtual ? "Este rascunho já é a lista da tela" : "Trazer para a tela"}
                              >
                                {ehAtual ? "Em edição" : "Retomar"}
                              </button>
                              <button
                                type="button"
                                className={s.rascunhoDescartarBtn}
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
                      className={`${s.rascunhoStatus} ${rascunhoStatus === "erro" ? s.rascunhoStatusErro : ""}`}
                      title={
                        rascunhoStatus === "erro"
                          ? "Não foi possível salvar o rascunho — a próxima alteração tenta de novo."
                          : "A contagem é salva automaticamente e sobrevive a queda/fechamento da aba."
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
                    <span className={`${s.badge} ${s.badgeEntrada}`}>
                      {totalProdutos} prod · {totalPecas} peças
                    </span>
                  )}
                </div>
              </div>

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
                    {produtosSelecionados.map((produto, index) => {
                      const corTxt = textoCorProduto(produto.descCor, produto.corProduto);
                      const chaveItem = chaveLinha(produto);
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
                                      onClick={() => escolherTamanho(index, t.ordinal)}
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
                                onClick={() => atualizarQuantidade(index, produto.quantidade - 1)}
                                disabled={produto.quantidade <= 1}
                              >
                                −
                              </button>
                              <input
                                type="number"
                                className={s.qtyInput}
                                data-leitor-qtd={index}
                                value={produto.quantidade}
                                onChange={(e) => atualizarQuantidade(index, parseInt(e.target.value, 10) || 1)}
                                min={1}
                              />
                              <button className={s.qtyBtn} onClick={() => atualizarQuantidade(index, produto.quantidade + 1)}>
                                +
                              </button>
                            </div>
                            <div className={s.stockPill} title="Contado / saldo atual no Linx">
                              {produto.quantidade}/{saldoLinha ?? "?"}
                            </div>
                            <button className={s.removeBtn} onClick={() => removerProduto(index)} title="Remover">
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
                  disabled={!filialCod || isBusy}
                >
                  <span className={s.addProductBtnIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                  Adicionar Produto
                </button>
                {produtosSelecionados.length > 0 && (
                  <button type="button" className={s.clearProductsBtn} onClick={limparLista} disabled={isBusy}>
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
                  A lista mudou depois desta conferência (peça bipada com a janela aberta). Feche e clique em “Subir estoque”
                  de novo para conferir.
                </p>
              )}
              <p className={a.modalWarn}>Altera o estoque real no Linx e registra no extrato. Dá pra desfazer depois.</p>
              <label className={styles.confirmCheck}>
                <input type="checkbox" checked={confirmCheck} onChange={(e) => setConfirmCheck(e.target.checked)} />
                Confirmo que revisei as diferenças e desejo subir o inventário.
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
