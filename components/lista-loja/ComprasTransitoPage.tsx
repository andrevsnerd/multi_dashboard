"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import type { CompanyKey } from "@/lib/config/company";
import {
  COMPRA_GASTO_CANAL_CURTO,
  COMPRA_GASTO_TIPO_LABEL,
  type CompraGastoParcela,
  type CompraGastoTipo,
} from "@/lib/types/compra-gasto";
import type {
  CompraTransito,
  CompraTransitoItemRow,
  CompraTransitoListEntry,
  CompraTransitoPagamento,
  CompraTransitoStatus,
  CompraTransitoItemReconciliacao,
  CompraTransitoReconciliacaoResposta,
  CompraTransitoStatusReal,
} from "@/lib/types/compra-transito";
import {
  COMPRA_GASTO_FORNECEDORES,
  cents,
  ehFornecedorConhecido,
  modeloDoFornecedor,
} from "@/lib/utils/compra-gastos-agregacao";
import {
  PAGAMENTO_PADRAO,
  parcelasDoPagamento,
  planoDeParcelas,
} from "@/lib/utils/compra-transito-pagamento";
import { getCompraTransitoItemStatus } from "@/lib/utils/compra-transito-status";
import { useAuth } from "@/components/auth/AuthContext";
import { canSeeCusto, userHasPagePermission } from "@/lib/auth/permissions";
import ParcelasEditor from "@/components/compras/ParcelasEditor";
import {
  brl as brlGasto,
  dataBrasiliaDeIso,
  dataBrCompleta,
  hojeIso,
} from "@/components/compras/gastos-compra-format";

import ComprasTransitoPickerModal from "./ComprasTransitoPickerModal";
import styles from "./ComprasTransitoPage.module.css";

/** Resultado do lançamento automático em Gastos de Compra, devolvido pela API. */
type GastoSyncResposta = {
  status: "criado" | "atualizado" | "ignorado" | "preservado" | "erro";
  loteId?: string;
  mensagem: string;
};

/**
 * Valor sentinela do select de fornecedor: "Outro (digitar)". Não é fornecedor
 * nenhum — só liga o campo de texto para nomes fora da lista (os que não têm
 * calendário de pagamento cadastrado).
 */
const OUTRO_FORNECEDOR = "__outro";

const TIPOS_GASTO: CompraGastoTipo[] = [
  "mercadoria",
  "frete",
  "adiantamento",
  "material",
  "outros",
];

/**
 * Hoje em Brasília (YYYY-MM-DD) — a data que a compra terá em Gastos de Compra.
 *
 * O servidor deriva a data da compra de `confirmedAt` em UTC-3; calcular pelo
 * fuso do navegador faria a tela ancorar o parcelamento num dia e o lançamento
 * cair em outro para quem confirma de madrugada.
 */
const hojeBrasilia = hojeIso;

type ViewMode = "list" | "editor" | "detail";

type ToastState = {
  tipo: "success" | "error";
  mensagem: string;
} | null;

async function fetchCompras(companyKey: CompanyKey): Promise<CompraTransitoListEntry[]> {
  const params = new URLSearchParams({ company: companyKey });
  const res = await fetch(`/api/compras-transito?${params.toString()}`, { cache: "no-store" });
  const json = (await res.json()) as { data?: CompraTransitoListEntry[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar compras em transito");
  return json.data ?? [];
}

/**
 * Índice de busca por compra: junta nome da compra + (código, descrição, código de
 * barras e cor) de cada item num texto normalizado, para o filtro instantâneo da
 * search bar achar tanto pela compra quanto por qualquer produto dentro dela.
 */
async function fetchComprasSearchIndex(
  companyKey: CompanyKey
): Promise<Record<string, string>> {
  const params = new URLSearchParams({ company: companyKey, includeItems: "1" });
  const res = await fetch(`/api/compras-transito?${params.toString()}`, { cache: "no-store" });
  const json = (await res.json()) as { data?: CompraTransito[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao indexar compras em transito");
  const index: Record<string, string> = {};
  for (const compra of json.data ?? []) {
    const parts: string[] = [compra.title];
    for (const item of compra.items ?? []) {
      parts.push(
        item.produto,
        item.descricao,
        item.codigoBarra ?? "",
        item.corProduto ?? "",
        item.corDescricao ?? ""
      );
    }
    index[compra.id] = parts.join(" ").toLowerCase();
  }
  return index;
}

/** True quando o termo parece um código de barras (só dígitos, 4+). */
function pareceCodigoBarras(term: string): boolean {
  const v = term.trim();
  return v.length >= 4 && /^\d+$/.test(v);
}

/**
 * Resolve um código de barras ao código do produto. A busca da lista casa pelo texto
 * indexado dos itens (que inclui o código do produto), então isto faz o filtro por
 * código de barras funcionar MESMO quando o item foi salvo sem `codigoBarra` — o caso
 * comum de itens importados de coleção/grade ou de lista. Usa o mesmo endpoint do picker.
 */
async function resolveProdutoPorCodigoBarras(
  companyKey: CompanyKey,
  codigoBarras: string
): Promise<string | null> {
  const params = new URLSearchParams({ company: companyKey, codigoBarras: codigoBarras.trim() });
  const res = await fetch(
    `/api/transferencia-produtos/produto-por-codigo-barras?${params.toString()}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { produto?: string } | null };
  return json.data?.produto?.trim() || null;
}

async function fetchCompra(companyKey: CompanyKey, id: string): Promise<CompraTransito> {
  const params = new URLSearchParams({ company: companyKey });
  const res = await fetch(`/api/compras-transito/${id}?${params.toString()}`, { cache: "no-store" });
  const json = (await res.json()) as { data?: CompraTransito; error?: string };
  if (!res.ok || !json.data) throw new Error(json.error ?? "Erro ao carregar compra");
  return json.data;
}

async function fetchReconciliacao(
  companyKey: CompanyKey,
  id: string
): Promise<CompraTransitoReconciliacaoResposta> {
  const params = new URLSearchParams({ company: companyKey });
  const res = await fetch(`/api/compras-transito/${id}/reconciliacao?${params.toString()}`, {
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: CompraTransitoReconciliacaoResposta; error?: string };
  if (!res.ok || !json.data) throw new Error(json.error ?? "Erro ao reconciliar compra");
  return json.data;
}

type ReconResumo = CompraTransitoReconciliacaoResposta["resumo"];

async function fetchReconciliacaoLista(
  companyKey: CompanyKey
): Promise<Record<string, ReconResumo>> {
  const params = new URLSearchParams({ company: companyKey });
  const res = await fetch(`/api/compras-transito/reconciliacao?${params.toString()}`, {
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: Record<string, ReconResumo>; error?: string };
  if (!res.ok || !json.data) throw new Error(json.error ?? "Erro ao reconciliar lista");
  return json.data;
}

type ProdutoBarcodeLookupRow = {
  produto: string;
  corProduto: string | null;
  codigoBarra: string | null;
};

function compareBarcodePreference(
  current: string | null | undefined,
  candidate: string | null | undefined
): number {
  const currentNorm = String(current ?? "").trim();
  const candidateNorm = String(candidate ?? "").trim();

  if (!candidateNorm) return 1;
  if (!currentNorm) return -1;

  if (candidateNorm.length !== currentNorm.length) {
    return candidateNorm.length - currentNorm.length;
  }

  const currentNum = Number(currentNorm);
  const candidateNum = Number(candidateNorm);

  if (Number.isFinite(currentNum) && Number.isFinite(candidateNum) && candidateNum !== currentNum) {
    return candidateNum < currentNum ? -1 : 1;
  }

  return candidateNorm.localeCompare(currentNorm);
}

function choosePreferredBarcode(
  current: string | null | undefined,
  candidate: string | null | undefined
): string {
  return compareBarcodePreference(current, candidate) < 0
    ? String(candidate ?? "").trim()
    : String(current ?? "").trim();
}

async function fetchCodigoBarraProduto(
  companyKey: CompanyKey,
  item: CompraTransitoItemRow
): Promise<string> {
  const produto = item.produto.trim();
  if (!produto) return "";

  const params = new URLSearchParams({
    company: companyKey,
    q: produto,
    entrada: "true",
  });
  if (item.corProduto?.trim()) {
    params.set("corProduto", item.corProduto.trim());
  }

  const res = await fetch(`/api/transferencia-produtos/produtos?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return "";

  const json = (await res.json()) as { data?: ProdutoBarcodeLookupRow[] };
  const rows = json.data ?? [];
  const corProduto = item.corProduto?.trim() ?? "";

  let preferred = "";
  for (const row of rows) {
    if (row.produto.trim() !== produto) continue;
    if (corProduto && (row.corProduto?.trim() ?? "") !== corProduto) continue;
    preferred = choosePreferredBarcode(preferred, row.codigoBarra);
  }

  if (preferred) return preferred;

  for (const row of rows) {
    if (row.produto.trim() !== produto) continue;
    preferred = choosePreferredBarcode(preferred, row.codigoBarra);
  }

  return preferred;
}

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function fmtBRL2(n: number) {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(value?: string | null) {
  if (!value) return "-";
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR");
}

function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusLabel(status: CompraTransitoStatus) {
  if (status === "em_transito") return "Em trânsito";
  if (status === "rascunho") return "Rascunho";
  return "Recebida";
}

function getStatusRealLabel(status: CompraTransitoStatusReal) {
  if (status === "recebido") return "Recebido";
  if (status === "parcial") return "Parcial";
  if (status === "atrasado") return "Atrasado";
  if (status === "rascunho") return "Rascunho";
  return "Em trânsito";
}

/**
 * Texto do tooltip com o detalhamento das entradas reconhecidas de um item.
 * Deixa explícito que o reconhecimento é por PRODUTO × COR (cabeçalho), e lista
 * cada romaneio com quantidade e custo TOTAL. Encerra com o total recebido.
 */
function buildEntriesTitle(item: CompraTransitoItemRow, rec: CompraTransitoItemReconciliacao): string {
  if (!rec.allocatedEntries.length) return "";
  const cor = item.corDescricao || item.corProduto || "sem cor";
  const lines: string[] = [];
  lines.push(`${item.descricao || item.produto}  (cód ${item.produto})`);
  lines.push(`Cor: ${cor}`);
  lines.push(
    rec.allocatedEntries.length > 1
      ? `Entradas reconhecidas (${rec.allocatedEntries.length}):`
      : "Entrada reconhecida:"
  );
  let custoTotalGeral = 0;
  for (const e of rec.allocatedEntries) {
    const parts = [fmtDate(e.data), `Romaneio ${e.romaneio || "?"}`, `${fmt(e.qtde)} un`];
    if (e.custoUnitario && e.custoUnitario > 0) {
      const total = Math.round(e.custoUnitario * e.qtde);
      custoTotalGeral += total;
      parts.push(`total ${fmtBRL(total)}`);
    }
    if (e.excess) parts.push("(excedente)");
    lines.push(`• ${parts.join("  ·  ")}`);
  }
  const totalParts = [`${fmt(rec.recebidoQtd)} un`];
  if (custoTotalGeral > 0) totalParts.push(fmtBRL(custoTotalGeral));
  lines.push(`Total recebido: ${totalParts.join("  ·  ")}`);
  return lines.join("\n");
}

function calcDaysUntilReceipt(minDate: string | null): string | null {
  if (!minDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recv = new Date(`${minDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(recv.getTime())) return null;
  const diff = Math.round((recv.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff > 0) return `Chega em ${diff} dia${diff !== 1 ? "s" : ""}`;
  if (diff === 0) return "Chega hoje";
  return null;
}

export default function ComprasTransitoPage({
  companyKey,
  companyName,
}: {
  companyKey: CompanyKey;
  companyName: string;
  companySlug: string;
}) {
  const { user } = useAuth();
  const podeVerCusto = canSeeCusto(user);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const draftFromQuery = searchParams.get("draft");
  const handledDraftRef = useRef<string | null>(null);
  const [view, setView] = useState<ViewMode>("list");
  const [compras, setCompras] = useState<CompraTransitoListEntry[]>([]);
  const [selectedCompra, setSelectedCompra] = useState<CompraTransito | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [draftItems, setDraftItems] = useState<CompraTransitoItemRow[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkDate, setBulkDate] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  // Forma de pagamento da compra: é ela que faz a confirmação já nascer lançada
  // em Gastos de Compra, sem redigitar nada lá.
  const [pagamento, setPagamento] = useState<CompraTransitoPagamento>(PAGAMENTO_PADRAO);
  /**
   * O usuário pediu para digitar um fornecedor fora da lista. Fornecedor já
   * gravado em texto livre (compra antiga) cai sozinho nesse modo — daí o `||`.
   */
  const [fornecedorOutro, setFornecedorOutro] = useState(false);
  const [parcelas, setParcelas] = useState<CompraGastoParcela[]>([]);
  const [recon, setRecon] = useState<Record<string, CompraTransitoItemReconciliacao> | null>(null);
  const [reconResumo, setReconResumo] = useState<
    CompraTransitoReconciliacaoResposta["resumo"] | null
  >(null);
  const [reconLoading, setReconLoading] = useState(false);
  const reconReqRef = useRef(0);
  const [listRecon, setListRecon] = useState<Record<string, ReconResumo> | null>(null);
  const [search, setSearch] = useState("");
  const [searchIndex, setSearchIndex] = useState<Record<string, string> | null>(null);
  // Quando o termo de busca é um código de barras, guardamos aqui o código de produto
  // resolvido — assim o filtro acha a compra mesmo que o item não tenha barcode gravado.
  const [barcodeProduto, setBarcodeProduto] = useState<string | null>(null);

  const loadCompras = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCompras(companyKey);
      setCompras(data);
      // Reconciliação real da lista chega depois (progressivo); recolore os cards.
      setListRecon(null);
      fetchReconciliacaoLista(companyKey)
        .then(setListRecon)
        .catch(() => setListRecon(null));
      // Índice de busca (itens de cada compra) também chega depois; até lá o filtro
      // funciona só pelo nome da compra.
      setSearchIndex(null);
      fetchComprasSearchIndex(companyKey)
        .then(setSearchIndex)
        .catch(() => setSearchIndex(null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar compras em transito");
    } finally {
      setLoading(false);
    }
  }, [companyKey]);

  useEffect(() => {
    void loadCompras();
  }, [loadCompras]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const totals = useMemo(() => {
    const totalItens = draftItems.length;
    const totalQuantidade = draftItems.reduce(
      (sum, item) => sum + Math.max(0, Math.round(item.quantidade ?? 0)),
      0
    );
    const totalValor = draftItems.reduce((sum, item) => {
      const custo = Number(item.custoUnitario ?? 0);
      return custo > 0 ? sum + Math.round((item.quantidade ?? 0) * custo) : sum;
    }, 0);
    return { totalItens, totalQuantidade, totalValor };
  }, [draftItems]);

  /**
   * Quem pode configurar o pagamento: a mesma porta do painel de Gastos de
   * Compra (admin/diretor/logística — gerente e supervisor nunca veem custo), e
   * só nas empresas que têm o painel.
   */
  const podeLancarGasto =
    userHasPagePermission(user, "gastos-compra") &&
    (companyKey === "nerd" || companyKey === "scarfme");

  /** Data que a compra terá no painel: o dia da confirmação, que é hoje. */
  const dataCompraPrevista = useMemo(() => hojeBrasilia(), []);

  const pagamentoRef = useRef(pagamento);
  useEffect(() => {
    pagamentoRef.current = pagamento;
  }, [pagamento]);

  /** Fornecedor fora da lista (digitado agora ou vindo de compra antiga). */
  const fornecedorLivre =
    fornecedorOutro || (!!pagamento.fornecedor && !ehFornecedorConhecido(pagamento.fornecedor));

  /**
   * O parcelamento acompanha o valor da compra: adicionar produto não pode
   * deixar as parcelas sem fechar. Reescala pelas PROPORÇÕES atuais (que é o
   * que será gravado), preservando datas e canais — e sem depender das próprias
   * parcelas, senão editar uma linha reentraria aqui em laço.
   */
  useEffect(() => {
    const total = totals.totalValor;
    setParcelas((anteriores) => {
      if (total <= 0) return [];
      if (anteriores.length === 0) {
        return parcelasDoPagamento(total, dataCompraPrevista, pagamentoRef.current);
      }
      const base = cents(anteriores.reduce((soma, p) => soma + (Number(p.valor) || 0), 0));
      const plano = planoDeParcelas(anteriores, dataCompraPrevista, base);
      return parcelasDoPagamento(total, dataCompraPrevista, {
        ...pagamentoRef.current,
        plano,
      });
    });
  }, [totals.totalValor, dataCompraPrevista]);

  /**
   * O pagamento da compra aberta no detalhe, já como parcelas de verdade:
   * o plano (dias/%) reancorado na data em que ela foi confirmada e no valor
   * dos itens. É a leitura do que foi (ou será) lançado em Gastos de Compra.
   */
  const pagamentoDoDetalhe = useMemo(() => {
    const compra = selectedCompra;
    if (!compra?.pagamento || compra.pagamento.lancar === false) return null;
    const total = compra.items.reduce((soma, item) => {
      const custo = Number(item.custoUnitario ?? 0);
      return custo > 0 ? soma + Math.round((item.quantidade ?? 0) * custo) : soma;
    }, 0);
    const dataCompra = dataBrasiliaDeIso(compra.confirmedAt);
    return {
      config: compra.pagamento,
      dataCompra,
      total,
      parcelas: parcelasDoPagamento(total, dataCompra, compra.pagamento),
    };
  }, [selectedCompra]);

  const statusCounts = useMemo(() => {
    let emTransito = 0;
    let recebidas = 0;
    let rascunhos = 0;
    compras.forEach((compra) => {
      if (compra.status === "em_transito") emTransito += 1;
      else if (compra.status === "rascunho") rascunhos += 1;
      else recebidas += 1;
    });
    return { emTransito, recebidas, rascunhos };
  }, [compras]);

  // Termo é código de barras → resolve para o código do produto (debounce) para o filtro
  // achar pela referência do produto, mesmo sem `codigoBarra` salvo no item.
  useEffect(() => {
    const term = search.trim();
    if (!pareceCodigoBarras(term)) {
      setBarcodeProduto(null);
      return;
    }
    let active = true;
    const id = window.setTimeout(() => {
      resolveProdutoPorCodigoBarras(companyKey, term)
        .then((produto) => {
          if (active) setBarcodeProduto(produto ? produto.toLowerCase() : null);
        })
        .catch(() => {
          if (active) setBarcodeProduto(null);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(id);
    };
  }, [search, companyKey]);

  const filteredCompras = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return compras;
    // Cada termo separado por espaço precisa bater (em nome da compra ou em algum item).
    const terms = q.split(/\s+/).filter(Boolean);
    return compras.filter((compra) => {
      const haystack = `${compra.title.toLowerCase()} ${searchIndex?.[compra.id] ?? ""}`;
      if (terms.every((term) => haystack.includes(term))) return true;
      // Código de barras digitado: casa pelo produto resolvido (itens podem não ter o
      // código de barras gravado, então buscar pelo barcode cru não acharia nada).
      if (barcodeProduto && haystack.includes(barcodeProduto)) return true;
      return false;
    });
  }, [compras, search, searchIndex, barcodeProduto]);

  const canConfirm = useMemo(
    () =>
      draftItems.length > 0 &&
      draftItems.every(
        (item) =>
          // Item automático será datado pelo servidor na confirmação (hoje + produção);
          // só itens MANUAIS precisam ter a data preenchida aqui.
          (item.dataRecebimento.trim() !== "" || item.dataRecebimentoManual !== true) &&
          Math.max(0, Math.round(item.quantidade ?? 0)) > 0
      ),
    [draftItems]
  );

  const canSaveDraft = draftItems.length > 0;

  const startNew = useCallback(() => {
    setDraftItems([]);
    setDraftTitle("");
    setEditingId(null);
    setBulkDate("");
    setSelectedCompra(null);
    setPagamento(PAGAMENTO_PADRAO);
    setFornecedorOutro(false);
    setParcelas([]);
    setView("editor");
  }, []);

  const startEdit = useCallback((compra: CompraTransito) => {
    reconReqRef.current += 1;
    setRecon(null);
    setReconResumo(null);
    setReconLoading(false);
    // Ao editar uma compra existente, datas já definidas são tratadas como MANUAIS para não
    // serem recalculadas silenciosamente numa reconfirmação. O usuário pode limpar p/ voltar ao automático.
    setDraftItems(
      compra.items.map((item) => ({
        ...item,
        dataRecebimentoManual:
          item.dataRecebimentoManual ?? (item.dataRecebimento?.trim() ? true : false),
      }))
    );
    setDraftTitle(compra.title);
    setEditingId(compra.id);
    setBulkDate("");
    // Reabre a forma de pagamento gravada. O plano é em dias/% sobre a data da
    // compra, então reancora sozinho na data desta (re)confirmação.
    const pag = compra.pagamento ?? PAGAMENTO_PADRAO;
    const total = compra.items.reduce((soma, item) => {
      const custo = Number(item.custoUnitario ?? 0);
      return custo > 0 ? soma + Math.round((item.quantidade ?? 0) * custo) : soma;
    }, 0);
    setPagamento(pag);
    setFornecedorOutro(false);
    setParcelas(total > 0 ? parcelasDoPagamento(total, hojeBrasilia(), pag) : []);
    setView("editor");
  }, []);

  useEffect(() => {
    if (!draftFromQuery || loading) return;
    if (handledDraftRef.current === draftFromQuery) return;

    handledDraftRef.current = draftFromQuery;
    let cancelled = false;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("draft");
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;

    setLoadingDetail(true);
    setError(null);
    fetchCompra(companyKey, draftFromQuery)
      .then((data) => {
        if (cancelled) return;
        startEdit(data);
      })
      .catch((err) => {
        if (cancelled) return;
        handledDraftRef.current = null;
        setToast({
          tipo: "error",
          mensagem: err instanceof Error ? err.message : "Erro ao abrir rascunho",
        });
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
          router.replace(nextUrl);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [companyKey, draftFromQuery, loading, pathname, router, searchParams, startEdit]);

  const applyBulkDate = useCallback((date: string) => {
    if (!date) return;
    // Definir data em massa é ação manual → fixa (não será recalculada na confirmação).
    setDraftItems((prev) =>
      prev.map((item) => ({ ...item, dataRecebimento: date, dataRecebimentoManual: true }))
    );
  }, []);

  const clearAllDates = useCallback(() => {
    // Limpar volta ao modo automático: a data será calculada na confirmação (produção).
    setDraftItems((prev) =>
      prev.map((item) => ({ ...item, dataRecebimento: "", dataRecebimentoManual: false }))
    );
  }, []);

  const openList = useCallback(() => {
    reconReqRef.current += 1;
    setRecon(null);
    setReconResumo(null);
    setReconLoading(false);
    setSelectedCompra(null);
    setEditingId(null);
    setBulkDate("");
    setView("list");
  }, []);

  const openDetail = useCallback(
    async (id: string) => {
      setLoadingDetail(true);
      setError(null);
      // Reseta a reconciliação anterior e renderiza o detalhe na hora; a
      // reconciliação real chega depois (carregamento progressivo).
      const reqId = (reconReqRef.current += 1);
      setRecon(null);
      setReconResumo(null);
      try {
        const data = await fetchCompra(companyKey, id);
        setSelectedCompra(data);
        setView("detail");
        setReconLoading(true);
        fetchReconciliacao(companyKey, id)
          .then((rec) => {
            if (reconReqRef.current !== reqId) return;
            setRecon(rec.itens);
            setReconResumo(rec.resumo);
          })
          .catch(() => {
            if (reconReqRef.current !== reqId) return;
            setRecon(null);
            setReconResumo(null);
          })
          .finally(() => {
            if (reconReqRef.current !== reqId) return;
            setReconLoading(false);
          });
      } catch (err) {
        setToast({
          tipo: "error",
          mensagem: err instanceof Error ? err.message : "Erro ao abrir compra",
        });
      } finally {
        setLoadingDetail(false);
      }
    },
    [companyKey]
  );

  const updateDraftItem = useCallback(
    (itemKey: string, patch: Partial<CompraTransitoItemRow>) => {
      setDraftItems((prev) =>
        prev.map((item) => (item.itemKey === itemKey ? { ...item, ...patch } : item))
      );
    },
    []
  );

  const removeDraftItem = useCallback((itemKey: string) => {
    setDraftItems((prev) => prev.filter((item) => item.itemKey !== itemKey));
  }, []);

  const saveCompra = useCallback(
    async (isDraft: boolean) => {
      if (saving) return;
      if (!isDraft && !canConfirm) return;
      if (isDraft && !canSaveDraft) return;
      setSaving(true);
      try {
        const displayName = user ? (user.nomeExibicao?.trim() || user.username) : undefined;
        const authHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          ...(displayName ? { "x-auth-username": displayName } : {}),
        };
        // O que é gravado é o PLANO (dias + % sobre a data da compra), não as
        // datas e valores da tela: quem define a data e o valor final é a
        // confirmação, que pode acontecer depois — e aí o plano reancora sozinho.
        const pagamentoParaSalvar: CompraTransitoPagamento | null = podeLancarGasto
          ? {
              ...pagamento,
              plano: planoDeParcelas(parcelas, dataCompraPrevista, totals.totalValor),
            }
          : null;

        const payload = {
          companyKey,
          title: draftTitle.trim() || undefined,
          items: draftItems,
          draft: isDraft,
          // Sem permissão para o painel, a tela não manda pagamento: `undefined`
          // preserva o que já estava gravado em vez de apagá-lo.
          ...(pagamentoParaSalvar ? { pagamento: pagamentoParaSalvar } : {}),
        };

        let res: Response;
        if (editingId) {
          res = await fetch(`/api/compras-transito/${editingId}`, {
            method: "PUT",
            headers: authHeaders,
            body: JSON.stringify(payload),
          });
        } else {
          res = await fetch("/api/compras-transito", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify(payload),
          });
        }
        const json = (await res.json()) as {
          data?: CompraTransito;
          gasto?: GastoSyncResposta | null;
          error?: string;
        };
        if (!res.ok || !json.data) {
          throw new Error(json.error ?? "Erro ao salvar compra");
        }
        const savedId = json.data.id;
        const wasEditing = !!editingId;
        const gasto = json.gasto ?? null;
        setDraftItems([]);
        setDraftTitle("");
        setEditingId(null);
        setBulkDate("");
        setModalOpen(false);
        setPagamento(PAGAMENTO_PADRAO);
        setParcelas([]);
        await loadCompras();
        if (!isDraft && wasEditing) {
          await openDetail(savedId);
        } else {
          setView("list");
        }
        const base = isDraft
          ? "Rascunho salvo. Você pode editar as datas depois."
          : wasEditing
          ? "Compra atualizada e reconfirmada."
          : "Compra confirmada e marcada como em trânsito.";
        // O lançamento em Gastos de Compra nunca é silencioso: deu certo, foi
        // ignorado ou falhou, a tela diz qual dos três.
        const detalhe =
          gasto && gasto.status !== "ignorado" ? ` ${gasto.mensagem}` : "";
        setToast({
          tipo: gasto?.status === "erro" ? "error" : "success",
          mensagem: `${base}${detalhe}`,
        });
      } catch (err) {
        setToast({
          tipo: "error",
          mensagem: err instanceof Error ? err.message : "Erro ao salvar compra",
        });
      } finally {
        setSaving(false);
      }
    },
    [
      canConfirm,
      canSaveDraft,
      companyKey,
      dataCompraPrevista,
      draftItems,
      draftTitle,
      editingId,
      loadCompras,
      openDetail,
      pagamento,
      parcelas,
      podeLancarGasto,
      saving,
      totals.totalValor,
      user,
    ]
  );

  const cancelCompra = useCallback(async () => {
    if (!selectedCompra || deleting) return;
    if (!window.confirm("Cancelar e remover esta compra? Essa acao nao pode ser desfeita.")) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/compras-transito/${selectedCompra.id}?company=${encodeURIComponent(companyKey)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Erro ao cancelar compra");
      }
      setSelectedCompra(null);
      await loadCompras();
      setView("list");
      setToast({ tipo: "success", mensagem: "Compra cancelada e removida." });
    } catch (err) {
      setToast({
        tipo: "error",
        mensagem: err instanceof Error ? err.message : "Erro ao cancelar compra",
      });
    } finally {
      setDeleting(false);
    }
  }, [selectedCompra, deleting, companyKey, loadCompras]);

  const exportListXlsx = useCallback(() => {
    const rows = compras.map((c) => ({
      Título: c.title,
      Status: getStatusLabel(c.status),
      Itens: c.itemCount,
      "Quantidade Total": c.totalQuantidade,
      "Valor Total (R$)": c.totalValor,
      "Recebimento Início": c.minDataRecebimento ? fmtDate(c.minDataRecebimento) : "",
      "Recebimento Fim": c.maxDataRecebimento ? fmtDate(c.maxDataRecebimento) : "",
      "Criada em": fmtDateTime(c.confirmedAt),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Compras em Trânsito");
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `compras-transito-${companyKey}-${dateStr}.xlsx`);
  }, [compras, companyKey]);

  const exportDetailXlsx = useCallback(async () => {
    if (!selectedCompra) return;
    const barcodeCache = new Map<string, string>();
    const resolvedItems = await Promise.all(
      selectedCompra.items.map(async (item) => {
        const cacheKey = `${item.produto}::${item.corProduto ?? ""}`;
        const barcodeAtual = item.codigoBarra?.trim() ?? "";
        if (barcodeCache.has(cacheKey)) {
          const barcodePreferido = choosePreferredBarcode(
            barcodeAtual,
            barcodeCache.get(cacheKey) ?? ""
          );
          return { ...item, codigoBarra: barcodePreferido };
        }

        const fetchedBarcode = await fetchCodigoBarraProduto(companyKey, item);
        const barcodePreferido = choosePreferredBarcode(barcodeAtual, fetchedBarcode);
        barcodeCache.set(cacheKey, barcodePreferido);
        return { ...item, codigoBarra: barcodePreferido };
      })
    );

    const rows = resolvedItems.map((item) => {
      const custo = Number(item.custoUnitario ?? 0);
      const qtd = Math.max(0, Math.round(item.quantidade ?? 0));
      const estoque = Math.round(Number(item.estoqueAtual ?? 0));
      const itemRecon = recon?.[item.itemKey];
      const shownStatus: CompraTransitoStatusReal = itemRecon
        ? itemRecon.statusReal
        : item.dataRecebimento
        ? getCompraTransitoItemStatus(item.dataRecebimento)
        : "rascunho";
      return {
        "Data Recebimento": item.dataRecebimento ? fmtDate(item.dataRecebimento) : "",
        Status: getStatusRealLabel(shownStatus),
        Produto: item.produto,
        Descrição: item.descricao,
        "Codigo de Barras": item.codigoBarra || "",
        Cor: item.corDescricao || item.corProduto || "",
        Grade: item.grade || "",
        Pedido: qtd,
        Recebido: itemRecon ? itemRecon.recebidoQtd : "",
        Faltou: itemRecon && itemRecon.faltou > 0 ? itemRecon.faltou : "",
        Excedeu: itemRecon && itemRecon.excedeu > 0 ? itemRecon.excedeu : "",
        "Chegou em": itemRecon?.recebidoEm ? fmtDate(itemRecon.recebidoEm) : "",
        ...(podeVerCusto ? {
          "Custo Unitário (R$)": custo > 0 ? custo : "",
          "Custo Total (R$)": custo > 0 ? Math.round(custo * qtd) : "",
        } : {}),
        "Estoque Atual": estoque,
        "Estoque Final": estoque + qtd,
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Itens");
    const dateStr = new Date().toISOString().slice(0, 10);
    const slug = selectedCompra.title.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 40);
    XLSX.writeFile(wb, `compra-${slug}-${dateStr}.xlsx`);
  }, [companyKey, selectedCompra, recon]);

  const renderTableRows = (items: CompraTransitoItemRow[], readOnly: boolean) => (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Data Recebimento</th>
            <th>Produto</th>
            <th>Descricao</th>
            <th>Cor</th>
            <th className={styles.right}>Pedido</th>
            {readOnly && <th className={styles.right}>Recebido</th>}
            <th>Grade</th>
            {podeVerCusto && <th className={styles.right}>Custo</th>}
            {podeVerCusto && <th className={styles.right}>Custo Total</th>}
            <th className={styles.right}>Estoque</th>
            <th className={styles.right}>Estoque Final</th>
            {!readOnly && <th aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const custo = Number(item.custoUnitario ?? 0);
            const estoque = Math.round(Number(item.estoqueAtual ?? 0));
            const qtd = Math.max(0, Math.round(item.quantidade ?? 0));
            const custoTotal = custo > 0 ? Math.round(custo * qtd) : 0;
            const estoqueFinal = estoque + qtd;
            const itemRecon = readOnly ? recon?.[item.itemKey] : undefined;
            const dateStatus = item.dataRecebimento
              ? getCompraTransitoItemStatus(item.dataRecebimento)
              : "rascunho";
            // Status exibido: o real (por entrada) quando já reconciliado; senão o por data.
            const shownStatus: CompraTransitoStatusReal = itemRecon
              ? itemRecon.statusReal
              : dateStatus;
            const durationLabel =
              readOnly && !itemRecon && item.dataRecebimento
                ? calcDaysUntilReceipt(item.dataRecebimento)
                : null;
            return (
              <tr
                key={item.itemKey}
                className={
                  readOnly
                    ? shownStatus === "recebido"
                      ? styles.rowReceived
                      : shownStatus === "atrasado"
                      ? styles.rowAtrasado
                      : shownStatus === "parcial"
                      ? styles.rowParcial
                      : shownStatus === "rascunho"
                      ? styles.rowDraft
                      : styles.rowConfirmed
                    : undefined
                }
              >
                <td>
                  {readOnly ? (
                    <div className={styles.readOnlyDateCell}>
                      <span>{item.dataRecebimento ? fmtDate(item.dataRecebimento) : "Sem data"}</span>
                      <span
                        className={`${styles.inlineStatusBadge} ${
                          shownStatus === "recebido"
                            ? styles.inlineStatusBadgeRecebido
                            : shownStatus === "atrasado"
                            ? styles.inlineStatusBadgeAtrasado
                            : shownStatus === "parcial"
                            ? styles.inlineStatusBadgeParcial
                            : shownStatus === "rascunho"
                            ? styles.inlineStatusBadgeDraft
                            : styles.inlineStatusBadgeTransit
                        }`}
                      >
                        {getStatusRealLabel(shownStatus)}
                      </span>
                      {itemRecon?.statusReal === "recebido" && itemRecon.recebidoEm && (
                        <span className={styles.durationChip}>
                          Chegou {fmtDate(itemRecon.recebidoEm)}
                        </span>
                      )}
                      {itemRecon?.statusReal === "parcial" && (
                        <span className={styles.durationChip}>
                          Resto em trânsito
                          {itemRecon.recebidoEm ? ` · parcial ${fmtDate(itemRecon.recebidoEm)}` : ""}
                        </span>
                      )}
                      {durationLabel && (
                        <span className={styles.durationChip}>{durationLabel}</span>
                      )}
                      {!itemRecon && reconLoading && (
                        <span className={styles.durationChip}>verificando entrada…</span>
                      )}
                    </div>
                  ) : (
                    <div className={styles.readOnlyDateCell}>
                      <input
                        type="date"
                        className={styles.input}
                        value={item.dataRecebimento}
                        onChange={(e) =>
                          updateDraftItem(item.itemKey, {
                            dataRecebimento: e.target.value,
                            dataRecebimentoManual: true,
                          })
                        }
                      />
                      {item.dataRecebimentoManual !== true && (
                        <span
                          className={styles.durationChip}
                          title="Data automática = data da confirmação + tempo de produção do produto. Editar fixa a data; este preview é recalculado quando você confirma."
                        >
                          auto · produção
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className={styles.codeCell}>{item.produto}</td>
                <td>
                  <div className={styles.descriptionCell}>{item.descricao}</div>
                </td>
                <td>{item.corDescricao || item.corProduto || "-"}</td>
                <td className={styles.right}>
                  {readOnly ? (
                    fmt(qtd)
                  ) : (
                    <input
                      type="number"
                      min={1}
                      className={`${styles.input} ${styles.inputQty}`}
                      value={qtd}
                      onChange={(e) =>
                        updateDraftItem(item.itemKey, {
                          quantidade: Math.max(0, Math.round(Number(e.target.value ?? 0))),
                        })
                      }
                    />
                  )}
                </td>
                {readOnly && (
                  <td className={styles.right}>
                    {itemRecon ? (
                      <div
                        className={`${styles.recebidoCell} ${
                          itemRecon.allocatedEntries.length > 0 ? styles.recebidoCellHover : ""
                        }`}
                        title={buildEntriesTitle(item, itemRecon) || undefined}
                      >
                        <span
                          className={
                            itemRecon.recebidoQtd > 0 ? styles.recebidoQtd : styles.recebidoZero
                          }
                        >
                          {fmt(itemRecon.recebidoQtd)}
                          {itemRecon.allocatedEntries.length > 1 && (
                            <span className={styles.recebidoEntradasCount}>
                              {" "}
                              ({itemRecon.allocatedEntries.length} entradas)
                            </span>
                          )}
                        </span>
                        {itemRecon.faltou > 0 && (
                          <span className={styles.faltouBadge}>faltou {fmt(itemRecon.faltou)}</span>
                        )}
                        {itemRecon.excedeu > 0 && (
                          <span className={styles.excedeuBadge}>+{fmt(itemRecon.excedeu)}</span>
                        )}
                      </div>
                    ) : reconLoading ? (
                      <span className={styles.reconDots}>…</span>
                    ) : (
                      "-"
                    )}
                  </td>
                )}
                <td>{item.grade || "-"}</td>
                {podeVerCusto && <td className={styles.right}>{custo > 0 ? fmtBRL2(custo) : "-"}</td>}
                {podeVerCusto && <td className={styles.right}>{custoTotal > 0 ? fmtBRL(custoTotal) : "-"}</td>}
                <td className={styles.right}>{fmt(estoque)}</td>
                <td className={styles.right}>{fmt(estoqueFinal)}</td>
                {!readOnly && (
                  <td className={styles.right}>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeDraftItem(item.itemKey)}
                    >
                      Remover
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={styles.wrapper}>
      {toast && (
        <div
          className={`${styles.toast} ${
            toast.tipo === "error" ? styles.toastError : styles.toastSuccess
          }`}
        >
          {toast.mensagem}
        </div>
      )}

      <div className={styles.topBar}>
        <div>
          <h1 className={styles.title}>Compras em Trânsito</h1>
          <p className={styles.subtitle}>{companyName}</p>
        </div>
        <div className={styles.topBarActions}>
          {view !== "editor" && (
            <>
              {view === "list" && compras.length > 0 && (
                <button type="button" className={styles.secondaryBtn} onClick={exportListXlsx}>
                  Exportar XLSX
                </button>
              )}
              <button type="button" className={styles.primaryBtn} onClick={startNew}>
                + Nova Compra
              </button>
            </>
          )}
          {view === "editor" && (
            <>
              <button type="button" className={styles.secondaryBtn} onClick={openList}>
                Ver Compras
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={() => setModalOpen(true)}>
                {draftItems.length > 0 ? "Editar produtos" : "Adicionar produtos"}
              </button>
              <button
                type="button"
                className={styles.draftBtn}
                onClick={() => void saveCompra(true)}
                disabled={!canSaveDraft || saving}
              >
                {saving ? "Salvando..." : "Salvar rascunho"}
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => void saveCompra(false)}
                disabled={!canConfirm || saving}
              >
                {saving ? "Confirmando..." : "Confirmar Compra"}
              </button>
            </>
          )}
        </div>
      </div>

      {view === "list" && (
        <>
          <div className={styles.summaryCard}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Compras confirmadas</span>
              <strong className={styles.summaryValue}>{fmt(compras.length)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Em trânsito</span>
              <strong className={styles.summaryValueGreen}>{fmt(statusCounts.emTransito)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Recebidas</span>
              <strong className={styles.summaryValue}>{fmt(statusCounts.recebidas)}</strong>
            </div>
            {statusCounts.rascunhos > 0 && (
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Rascunhos</span>
                <strong className={styles.summaryValueDraft}>{fmt(statusCounts.rascunhos)}</strong>
              </div>
            )}
          </div>

          {!loading && !error && compras.length > 0 && (
            <div className={styles.searchBar}>
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Buscar por nome da compra, código, código de barras ou produto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search.trim() && (
                <span className={styles.searchCount}>
                  {filteredCompras.length} de {compras.length}
                  {searchIndex === null && " · indexando produtos…"}
                </span>
              )}
            </div>
          )}

          {loading && <div className={styles.emptyState}>Carregando compras em trânsito...</div>}
          {!loading && error && <div className={styles.errorBox}>{error}</div>}
          {!loading && !error && compras.length === 0 && (
            <div className={styles.emptyState}>
              <p>Nenhuma compra em trânsito confirmada ainda.</p>
              <button type="button" className={styles.primaryBtn} onClick={startNew}>
                Criar primeira compra
              </button>
            </div>
          )}
          {!loading && !error && compras.length > 0 && filteredCompras.length === 0 && (
            <div className={styles.emptyState}>
              <p>Nenhuma compra encontrada para “{search.trim()}”.</p>
              <button type="button" className={styles.ghostBtn} onClick={() => setSearch("")}>
                Limpar busca
              </button>
            </div>
          )}
          {!loading && !error && filteredCompras.length > 0 && (
            <div className={styles.cardsList}>
              {filteredCompras.map((compra) => {
                const periodoRecebimento =
                  compra.minDataRecebimento && compra.maxDataRecebimento
                    ? compra.minDataRecebimento === compra.maxDataRecebimento
                      ? fmtDate(compra.minDataRecebimento)
                      : `${fmtDate(compra.minDataRecebimento)} – ${fmtDate(compra.maxDataRecebimento)}`
                    : "Sem data";

                // Status real (reconciliação) quando já carregado; senão o por data.
                const resumo = listRecon?.[compra.id];
                const effStatus: CompraTransitoStatusReal = resumo ? resumo.statusGeral : compra.status;
                const isDraft = effStatus === "rascunho";
                const isTransit = effStatus === "em_transito";
                const isParcial = effStatus === "parcial";
                const isAtrasado = effStatus === "atrasado";
                const isRecebido = effStatus === "recebido";

                const daysLabel =
                  isParcial && resumo
                    ? `${fmt(resumo.parciais)} item(ns) faltando`
                    : isTransit
                    ? calcDaysUntilReceipt(compra.minDataRecebimento)
                    : null;

                const cardClass = isDraft || isParcial
                  ? styles.cardRowDraft
                  : isAtrasado
                  ? styles.cardRowAtrasado
                  : isRecebido
                  ? styles.cardRowReceived
                  : "";

                return (
                  <button
                    key={compra.id}
                    type="button"
                    className={`${styles.cardRow} ${cardClass}`}
                    onClick={() => void openDetail(compra.id)}
                    disabled={loadingDetail}
                  >
                    <div className={styles.cardRowLeft}>
                      <span
                        className={`${styles.statusBadge} ${
                          isDraft || isParcial
                            ? styles.statusBadgeDraft
                            : isAtrasado
                            ? styles.statusBadgeAtrasado
                            : isRecebido
                            ? styles.statusBadgeReceived
                            : styles.statusBadgeTransit
                        }`}
                      >
                        {resumo ? getStatusRealLabel(effStatus) : getStatusLabel(compra.status)}
                      </span>
                      <div className={styles.cardRowTitleGroup}>
                        <span className={`${styles.cardRowTitle} ${isDraft ? styles.cardRowTitleDraft : ""}`}>
                          {compra.title}
                        </span>
                        <div className={styles.cardRowMeta}>
                          {compra.createdByName && (
                            <span className={styles.cardRowMetaUser}>{compra.createdByName}</span>
                          )}
                          <span className={styles.cardRowMetaDate}>{fmtDateTime(compra.confirmedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.cardRowStats}>
                      <div className={styles.cardRowStat}>
                        <span className={styles.cardRowStatLabel}>Itens</span>
                        <span className={styles.cardRowStatValue}>{compra.itemCount}</span>
                      </div>
                      <div className={styles.cardRowStat}>
                        <span className={styles.cardRowStatLabel}>Qtd.</span>
                        <span className={styles.cardRowStatValue}>{fmt(compra.totalQuantidade)}</span>
                      </div>
                      <div className={styles.cardRowStat}>
                        <span className={styles.cardRowStatLabel}>Valor</span>
                        <span className={styles.cardRowStatValue}>{fmtBRL(compra.totalValor)}</span>
                      </div>
                    </div>
                    <div className={styles.cardRowDates}>
                      <span
                        className={`${styles.cardRowRecepBadge} ${
                          isDraft || isParcial
                            ? styles.cardRowRecepBadgeDraft
                            : isTransit
                            ? ""
                            : styles.cardRowRecepBadgeReceived
                        }`}
                      >
                        Recebimento: {periodoRecebimento}
                      </span>
                      {daysLabel && <span className={styles.cardRowDaysLabel}>{daysLabel}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {view === "editor" && (
        <>
          <div className={styles.titleInputWrap}>
            <label className={styles.titleInputLabel} htmlFor="draft-title">
              Nome da compra
            </label>
            <input
              id="draft-title"
              type="text"
              className={styles.titleInput}
              placeholder="Ex: Compra fornecedor X – maio 2026 (opcional)"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
          </div>

          <div className={styles.summaryCard}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Itens</span>
              <strong className={styles.summaryValue}>{fmt(totals.totalItens)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Quantidade total</span>
              <strong className={styles.summaryValue}>{fmt(totals.totalQuantidade)}</strong>
            </div>
            {podeVerCusto && (
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Custo total</span>
                <strong className={styles.summaryValue}>{fmtBRL(totals.totalValor)}</strong>
              </div>
            )}
          </div>

          {draftItems.length === 0 ? (
            <div className={styles.emptyState}>
              <p>Adicione produtos para montar a compra em trânsito.</p>
              <button type="button" className={styles.primaryBtn} onClick={() => setModalOpen(true)}>
                Adicionar produtos
              </button>
              <button type="button" className={styles.ghostBtn} onClick={openList}>
                Voltar para lista
              </button>
            </div>
          ) : (
            <>
              <div className={styles.helperText}>
                As datas de recebimento são automáticas: ao confirmar, cada item recebe a data
                da confirmação + o tempo de produção do produto. Edite uma data para fixá-la, ou
                use os controles abaixo. &quot;Limpar todas&quot; volta tudo para automático.
              </div>
              <div className={styles.bulkDateBar}>
                <label className={styles.bulkDateLabel} htmlFor="bulk-date">
                  Data para todos:
                </label>
                <div className={styles.bulkDateControls}>
                  <input
                    id="bulk-date"
                    type="date"
                    className={styles.input}
                    value={bulkDate}
                    onChange={(e) => setBulkDate(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={!bulkDate}
                    onClick={() => {
                      applyBulkDate(bulkDate);
                      setBulkDate("");
                    }}
                  >
                    Aplicar a todos
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={clearAllDates}
                  >
                    Limpar todas as datas
                  </button>
                </div>
              </div>
              {renderTableRows(draftItems, false)}
              {!canConfirm && (
                <div className={styles.helperText}>
                  Para confirmar, cada item precisa de quantidade maior que zero (a data é automática). Itens com data fixada manualmente precisam ter a data preenchida — ou limpe para voltar ao automático.
                </div>
              )}

              {podeLancarGasto && (
                <section className={styles.pagamentoBox}>
                  <header className={styles.pagamentoHead}>
                    <div>
                      <h2 className={styles.pagamentoTitle}>Pagamento</h2>
                      <p className={styles.pagamentoSub}>
                        Ao confirmar, esta compra entra automaticamente em{" "}
                        <strong>Gastos de Compra</strong> com o parcelamento definido aqui. O plano
                        é gravado em dias e percentual sobre a data da compra — então vale mesmo se
                        a confirmação acontecer daqui a uma semana, e o valor acompanha o total real
                        dos itens.
                      </p>
                    </div>
                    <label className={styles.pagamentoToggle}>
                      <input
                        type="checkbox"
                        checked={pagamento.lancar}
                        onChange={(e) =>
                          setPagamento((prev) => ({ ...prev, lancar: e.target.checked }))
                        }
                      />
                      <span>Lançar em Gastos de Compra</span>
                    </label>
                  </header>

                  {!pagamento.lancar ? (
                    <p className={styles.helperText}>
                      Confirmar não vai criar compra em Gastos de Compra. Dá para lançar depois, à
                      mão, pelo painel.
                    </p>
                  ) : (
                    <>
                      <div className={styles.pagamentoGrid}>
                        <label className={styles.pagamentoField}>
                          <span>Fornecedor</span>
                          <select
                            className={styles.input}
                            value={fornecedorLivre ? OUTRO_FORNECEDOR : (pagamento.fornecedor ?? "")}
                            onChange={(e) => {
                              const escolhido = e.target.value;
                              if (escolhido === OUTRO_FORNECEDOR) {
                                setFornecedorOutro(true);
                                return;
                              }
                              setFornecedorOutro(false);
                              setPagamento((prev) => ({ ...prev, fornecedor: escolhido || null }));
                            }}
                          >
                            <option value="">— sem fornecedor —</option>
                            {COMPRA_GASTO_FORNECEDORES.map((f) => (
                              <option key={f.valor} value={f.valor}>
                                {f.label}
                              </option>
                            ))}
                            <option value={OUTRO_FORNECEDOR}>Outro (digitar)</option>
                          </select>
                          {fornecedorLivre && (
                            <input
                              type="text"
                              className={styles.input}
                              placeholder="ex: Consuelo Annexe"
                              value={pagamento.fornecedor ?? ""}
                              onChange={(e) =>
                                setPagamento((prev) => ({
                                  ...prev,
                                  fornecedor: e.target.value || null,
                                }))
                              }
                            />
                          )}
                        </label>
                        <label className={styles.pagamentoField}>
                          <span>Tipo de gasto</span>
                          <select
                            className={styles.input}
                            value={pagamento.tipo}
                            onChange={(e) =>
                              setPagamento((prev) => ({
                                ...prev,
                                tipo: e.target.value as CompraGastoTipo,
                              }))
                            }
                          >
                            {TIPOS_GASTO.map((t) => (
                              <option key={t} value={t}>
                                {COMPRA_GASTO_TIPO_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.pagamentoField}>
                          <span>Observação</span>
                          <input
                            type="text"
                            className={styles.input}
                            placeholder="ex: sinal de 30% já dentro das parcelas"
                            value={pagamento.observacao ?? ""}
                            onChange={(e) =>
                              setPagamento((prev) => ({ ...prev, observacao: e.target.value }))
                            }
                          />
                        </label>
                      </div>

                      {totals.totalValor > 0 ? (
                        <ParcelasEditor
                          total={totals.totalValor}
                          parcelas={parcelas}
                          onChange={setParcelas}
                          vencimentoSugerido={dataCompraPrevista}
                          modelo={modeloDoFornecedor(pagamento.fornecedor)}
                          rodape="Soma das parcelas (valor exato confirmado ao lançar)"
                        />
                      ) : (
                        <p className={styles.helperText}>
                          Os itens ainda não têm custo: sem valor não há parcelamento a definir. A
                          compra será lançada em Gastos de Compra como estimativa, à vista.
                        </p>
                      )}

                      <p className={styles.helperText}>
                        Escolher o <strong>fornecedor</strong> acima já monta o parcelamento dele:
                        Salete, Telma e Roseli pagam 2x (90 e 120 dias); os importados (China,
                        Índia, Nepal) pagam transferência 40% + Alibaba 60%, cada um 30% no pedido,
                        50% no despacho e 20% depois. Fornecedor digitado à mão (“Outro”) não tem
                        calendário — o parcelamento fica por sua conta. Mexer em qualquer linha
                        para de aplicar o modelo: o que você digitou nunca é sobrescrito.
                      </p>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}

      {view === "detail" && (
        <>
          <div className={styles.detailHeader}>
            <button type="button" className={styles.secondaryBtn} onClick={openList}>
              Voltar para lista
            </button>
            <div className={styles.detailHeaderRight}>
              {selectedCompra && (
                <>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={exportDetailXlsx}
                    disabled={loadingDetail}
                  >
                    Exportar XLSX
                  </button>
                  <button
                    type="button"
                    className={
                      selectedCompra.status === "rascunho"
                        ? styles.draftBtn
                        : styles.secondaryBtn
                    }
                    onClick={() => startEdit(selectedCompra)}
                    disabled={loadingDetail}
                  >
                    {selectedCompra.status === "rascunho"
                      ? "Editar rascunho"
                      : "Editar / Reabrir"}
                  </button>
                </>
              )}
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void cancelCompra()}
                disabled={deleting || loadingDetail}
              >
                {deleting ? "Cancelando..." : "Cancelar compra"}
              </button>
            </div>
          </div>

          {loadingDetail && <div className={styles.emptyState}>Carregando compra...</div>}
          {!loadingDetail && selectedCompra && (
            <>
              <div
                className={`${styles.summaryCard} ${
                  reconResumo
                    ? reconResumo.statusGeral === "recebido"
                      ? styles.summaryCardReceived
                      : reconResumo.statusGeral === "parcial" || reconResumo.statusGeral === "atrasado"
                      ? styles.summaryCardDraft
                      : styles.summaryCardConfirmed
                    : selectedCompra.status === "em_transito"
                    ? styles.summaryCardConfirmed
                    : selectedCompra.status === "rascunho"
                    ? styles.summaryCardDraft
                    : styles.summaryCardReceived
                }`}
              >
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Status</span>
                  <strong
                    className={
                      reconResumo
                        ? reconResumo.statusGeral === "recebido"
                          ? styles.summaryValue
                          : reconResumo.statusGeral === "parcial"
                          ? styles.summaryValueDraft
                          : reconResumo.statusGeral === "atrasado"
                          ? styles.summaryValueDanger
                          : styles.summaryValueGreen
                        : selectedCompra.status === "em_transito"
                        ? styles.summaryValueGreen
                        : selectedCompra.status === "rascunho"
                        ? styles.summaryValueDraft
                        : styles.summaryValue
                    }
                  >
                    {reconResumo
                      ? getStatusRealLabel(reconResumo.statusGeral)
                      : getStatusLabel(selectedCompra.status)}
                  </strong>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Criada em</span>
                  <strong className={styles.summaryValue}>{fmtDateTime(selectedCompra.confirmedAt)}</strong>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Itens</span>
                  <strong className={styles.summaryValue}>{fmt(selectedCompra.items.length)}</strong>
                </div>
                {reconResumo && (
                  <>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>Recebidos (entrada real)</span>
                      <strong className={styles.summaryValueGreen}>
                        {fmt(reconResumo.recebidos)} / {fmt(reconResumo.totalItens)}
                      </strong>
                    </div>
                    {reconResumo.parciais > 0 && (
                      <div className={styles.summaryItem}>
                        <span className={styles.summaryLabel}>Parciais (falta chegar)</span>
                        <strong className={styles.summaryValueDraft}>
                          {fmt(reconResumo.parciais)}
                        </strong>
                      </div>
                    )}
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>Atrasados</span>
                      <strong
                        className={
                          reconResumo.atrasados > 0 ? styles.summaryValueDanger : styles.summaryValue
                        }
                      >
                        {fmt(reconResumo.atrasados)}
                      </strong>
                    </div>
                  </>
                )}
                {!reconResumo && reconLoading && (
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>Entradas reais</span>
                    <strong className={styles.summaryValue}>verificando…</strong>
                  </div>
                )}
              </div>
              <div className={styles.detailTitleBox}>
                <h2 className={styles.detailTitle}>{selectedCompra.title}</h2>
              </div>

              {podeLancarGasto && pagamentoDoDetalhe && (
                <section className={styles.pagamentoBox}>
                  <header className={styles.pagamentoHead}>
                    <div>
                      <h2 className={styles.pagamentoTitle}>Pagamento</h2>
                      <p className={styles.pagamentoSub}>
                        Lançado em <strong>Gastos de Compra</strong> como{" "}
                        {COMPRA_GASTO_TIPO_LABEL[pagamentoDoDetalhe.config.tipo]}
                        {pagamentoDoDetalhe.config.fornecedor
                          ? ` · ${pagamentoDoDetalhe.config.fornecedor}`
                          : ""}
                        , compra de {dataBrCompleta(pagamentoDoDetalhe.dataCompra)}.
                      </p>
                    </div>
                    <strong className={styles.summaryValue}>
                      {brlGasto(pagamentoDoDetalhe.total)}
                    </strong>
                  </header>
                  <ul className={styles.parcelaLista}>
                    {pagamentoDoDetalhe.parcelas.map((p, i) => (
                      <li className={styles.parcelaLinha} key={i}>
                        <span className={styles.parcelaNumero}>{i + 1}</span>
                        <span>{dataBrCompleta(p.vencimento)}</span>
                        <span className={styles.parcelaEtapa}>
                          {p.canal ? COMPRA_GASTO_CANAL_CURTO[p.canal] : ""}
                          {p.canal && p.etapa ? " · " : ""}
                          {p.etapa ?? ""}
                        </span>
                        <strong>{brlGasto(p.valor)}</strong>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.helperText}>
                    Os valores acima são o plano reancorado na data desta compra. O que vale para o
                    financeiro é o lote em Gastos de Compra — ajustes e baixas de parcela são feitos
                    por lá.
                  </p>
                </section>
              )}

              {renderTableRows(selectedCompra.items, true)}
            </>
          )}
        </>
      )}

      <ComprasTransitoPickerModal
        companyKey={companyKey}
        open={modalOpen}
        draftItems={draftItems}
        onClose={() => setModalOpen(false)}
        onApply={(items) => {
          setDraftItems(items);
          setModalOpen(false);
        }}
      />
    </div>
  );
}
