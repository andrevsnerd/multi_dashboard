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

interface ProdutoSelecionado {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  filial: string;
  nomeFilial: string;
  estoque: number;
  quantidade: number;
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

function defeitoFilialOption(companyKey: string): Filial | undefined {
  const nome = getDefeitoFilial(companyKey);
  return nome ? { codFilial: nome, filial: nome } : undefined;
}

// Tipos de romaneio que não possuem filial destino (igual a SAÍDA MKT)
const TIPOS_SEM_FILIAL_DESTINO = [
  'MKT', 'BRINDE', 'DOACAO', 'AJUSTE DE ESTOQUE', 'AMOSTRA', 'SOCIO', 'COMPRA FUNCIONARIO',
  'RETIRADA FUNCIONARIO', 'RETIRADA SOCIO',
];
function isTipoSemDestino(tipo: string): boolean {
  const norm = tipo.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return TIPOS_SEM_FILIAL_DESTINO.some(t => norm.includes(t));
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
  itens: Array<{ produto: string; corProduto: string | null; quantidade: number }>,
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
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as { error: string };
    throw new Error(error.error || "Erro ao executar operação");
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

  const isAdmin = user?.role === "admin";

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
    tipoOperacao === "saida" &&
    (isTipoDefeito(tipoRomaneioSelecionado) ||
      (!!filialDestinoSaida && !!defeitoFilialOption(companyKey) &&
        filialDestinoSaida.codFilial.trim().toUpperCase() ===
          defeitoFilialOption(companyKey)!.codFilial.trim().toUpperCase()));

  // Depende do codFilial, não do objeto: o refresh em foco recria o Filial
  // (mesma loja, nova referência) e não deve refazer a consulta.
  const codFilialSelecionada = filialSelecionada?.codFilial ?? null;

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
    // evitar "cadeia" de updates pós-clique
    setProdutosSelecionados([]);
    setProdutosSelecionadosModal([]);
    setSearchTerm("");
    setProdutos([]);
    setModalAberto(false);
    setFilialDestinoSaida(null);
  }, []);

  const observacaoAtual = tipoOperacao === "saida" ? observacaoSaida : observacaoEntrada;
  const setObservacaoAtual = useCallback((value: string) => {
    if (tipoOperacao === "saida") setObservacaoSaida(value);
    else setObservacaoEntrada(value);
  }, [tipoOperacao]);

  const abrirModalAdicionarProduto = useCallback(() => {
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
    setProdutosSelecionados(produtosSelecionadosModal);
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
  }, [filialSelecionada, mostrarNotificacao, tipoOperacao, filialOptionLabel]);

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
      const idx = prev.findIndex(
        (p) =>
          p.produto === novoItem.produto &&
          p.corProduto === novoItem.corProduto &&
          p.filial === novoItem.filial
      );
      if (idx === -1) {
        mostrarNotificacao(`${novoItem.descProduto} adicionado`);
        return [...prev, novoItem];
      }

      const atual = prev[idx];
      const proxQtd = tipoOperacao === "entrada" ? atual.quantidade + 1 : Math.min(atual.estoque, atual.quantidade + 1);
      const next = [...prev];
      next[idx] = { ...atual, quantidade: proxQtd };

      if (tipoOperacao === "saida" && proxQtd === atual.estoque) {
        mostrarNotificacao(`Quantidade máxima atingida (estoque ${atual.estoque})`, "error");
      } else {
        mostrarNotificacao(`${novoItem.descProduto} adicionado`);
      }

      return next;
    });
  }, [criarProdutoSelecionado, mostrarNotificacao, tipoOperacao]);

  const adicionarComCorSelecionada = useCallback((produtoComCor: Produto) => {
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
    const novoItem = criarProdutoSelecionado(produtoComCor);
    if (!novoItem) return;

    setProdutosSelecionadosModal((prev) => {
      const idx = prev.findIndex(
        (p) =>
          p.produto === novoItem.produto &&
          p.corProduto === novoItem.corProduto &&
          p.filial === novoItem.filial
      );
      if (idx === -1) {
        mostrarNotificacao(`${novoItem.descProduto} adicionado`);
        return [...prev, novoItem];
      }

      const atual = prev[idx];
      const proxQtd = tipoOperacao === "entrada" ? atual.quantidade + 1 : Math.min(atual.estoque, atual.quantidade + 1);
      const next = [...prev];
      next[idx] = { ...atual, quantidade: proxQtd };

      if (tipoOperacao === "saida" && proxQtd === atual.estoque) {
        mostrarNotificacao(`Quantidade máxima atingida (estoque ${atual.estoque})`, "error");
      } else {
        mostrarNotificacao(`${novoItem.descProduto} adicionado`);
      }

      return next;
    });
  }, [criarProdutoSelecionado, mostrarNotificacao, tipoOperacao]);

  const removerProduto = useCallback((index: number) => {
    setProdutosSelecionados(prev => prev.filter((_, i) => i !== index));
  }, []);

  const limparProdutosSelecionados = useCallback(() => {
    setProdutosSelecionados([]);
  }, []);

  const atualizarQuantidade = useCallback((index: number, quantidade: number) => {
    if (quantidade < 1) return;
    
    setProdutosSelecionados(prev => {
      const novo = [...prev];
      const produto = novo[index];
      if (tipoOperacao === "saida" && quantidade > produto.estoque) {
        mostrarNotificacao(`Quantidade não pode ser maior que o estoque disponível (${produto.estoque})`, "error");
        return prev;
      }
      novo[index] = { ...produto, quantidade };
      return novo;
    });
  }, [mostrarNotificacao, tipoOperacao]);

  const atualizarQuantidadeModal = useCallback((index: number, quantidade: number) => {
    if (quantidade < 1) return;
    
    setProdutosSelecionadosModal(prev => {
      const novo = [...prev];
      const produto = novo[index];
      if (!produto) return prev;
      if (tipoOperacao === "saida" && quantidade > produto.estoque) {
        mostrarNotificacao(`Quantidade não pode ser maior que o estoque disponível (${produto.estoque})`, "error");
        return prev;
      }
      novo[index] = { ...produto, quantidade };
      return novo;
    });
  }, [mostrarNotificacao, tipoOperacao]);

  const removerProdutoModal = useCallback((index: number) => {
    setProdutosSelecionadosModal(prev => prev.filter((_, i) => i !== index));
  }, []);

  const executarLote = useCallback(async (produtos: ProdutoSelecionado[], observacao: string) => {
    if (produtos.length === 0 || processandoOperacao || !filialSelecionada) return;

    setProcessandoOperacao(true);
    try {
      const itens = produtos.map(p => ({
        produto: p.produto,
        corProduto: p.corProduto,
        quantidade: p.quantidade,
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

      setProdutosSelecionados([]);
      // Reconsulta a trava de defeito: o romaneio que acabou de sair fecha o dia.
      setDefeitoRefreshKey((k) => k + 1);

      const [novoSaidas, novoEntradas] = await Promise.all([fetchLogSaidas(), fetchLogEntradas()]);
      setLogSaidas(novoSaidas);
      setLogEntradas(novoEntradas);

      const label = tipoOperacao === "saida" ? "Saída" : "Entrada";
      mostrarNotificacao(`${label} registrada com sucesso! Romaneio: ${resultado.romaneio}`);
    } catch (error: any) {
      mostrarNotificacao(error.message || "Erro ao processar operação", "error");
    } finally {
      setProcessandoOperacao(false);
    }
  }, [processandoOperacao, filialSelecionada, tipoOperacao, tipoRomaneioSelecionado, responsavelFinal, user?.username, filialDestinoSaida, companyKey, mostrarNotificacao]);

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

  const abrirConfirmacaoRegistro = useCallback(() => {
    if (!filialSelecionada) {
      mostrarNotificacao("Selecione uma filial", "error");
      return;
    }
    if (produtosSelecionados.length === 0) {
      mostrarNotificacao("Adicione pelo menos um produto", "error");
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
  }, [filialSelecionada, produtosSelecionados.length, tipoOperacao, filiaisDestinoVisiveis.length, filialDestinoSaida, tipoRomaneioSelecionado, travaDefeitoAtiva, defeitoDoDia, mostrarNotificacao]);

  const confirmarRegistro = useCallback(() => {
    setMostrarConfirmacaoRegistro(false);
    const obs = observacaoAtual;
    setObservacaoAtual("");
    executarLote(produtosSelecionados, obs);
  }, [executarLote, produtosSelecionados, observacaoAtual, setObservacaoAtual]);

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

  const isBusy = processandoOperacao;
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
          {filiaisDisponiveis.length === 1 && filialSelecionada ? (
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
          {/* Filial Destino (apenas saída) */}
          {tipoOperacao === "saida" && (
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
              {tiposRomaneioDisponiveis.length === 1 || permissoes?.tipoRomaneioFixo ? (
                <span className={styles.configBarText}>{tipoRomaneioSelecionado}</span>
              ) : (
                <div className={styles.selectWrap}>
                  <select
                    className={styles.configBarSelect}
                    value={tipoRomaneioSelecionado}
                    onChange={(e) => setTipoRomaneioSelecionado(e.target.value)}
                  >
                    {[...tiposRomaneioDisponiveis].sort((a, b) => {
                      const ordem = (s: string) => {
                        const u = s.toUpperCase();
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
            <div className={styles.cardHeader}>
              <span className={styles.cardLabelWithIcon}>
                <span className={styles.cardHeaderIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Z" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </span>
                Histórico de {tipoOperacao === "saida" ? "Saídas" : "Entradas"}
              </span>
              {logsFiltrados.length > 0 && (
                <span className={styles.badgeMuted}>
                  {logsFiltrados.length} {tipoOperacao === "saida"
                    ? (logsFiltrados.length === 1 ? "saída" : "saídas")
                    : (logsFiltrados.length === 1 ? "entrada" : "entradas")}
                </span>
              )}
            </div>
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
                  Produtos para {tipoOperacao === "saida" ? "Saída" : "Entrada"}
                </span>
                {totalProdutos > 0 && (
                  <span className={`${styles.badge} ${tipoOperacao === "saida" ? styles.badgeSaida : styles.badgeEntrada}`}>
                    {totalProdutos} prod · {totalItens} itens
                  </span>
                )}
              </div>

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
                    Busque e adicione produtos à {tipoOperacao === "saida" ? "saída" : "entrada"}
                  </div>
                </div>
              ) : (
                <div className={styles.produtosList}>
                  {produtosSelecionados.map((produto, index) => {
                    const corTxt = textoCorProduto(produto.descCor, produto.corProduto);
                    return (
                    <div key={index} className={styles.produtoItem}>
                      <div className={styles.produtoInfo}>
                        <div className={styles.produtoName}>{produto.descProduto}</div>
                        <div className={styles.produtoSku}>
                          {produto.produto}
                          {corTxt ? ` · ${corTxt}` : ""}
                          {produto.codigoBarra && ` · ${produto.codigoBarra}`}
                        </div>
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
                            value={produto.quantidade}
                            onChange={(e) => atualizarQuantidade(index, parseInt(e.target.value) || 1)}
                            min={1}
                            max={tipoOperacao === "saida" ? produto.estoque : undefined}
                          />
                          <button
                            className={styles.qtyBtn}
                            onClick={() => atualizarQuantidade(index, produto.quantidade + 1)}
                            disabled={tipoOperacao === "saida" && produto.quantidade >= produto.estoque}
                          >+</button>
                        </div>
                        <div className={styles.stockPill}>{produto.quantidade}/{produto.estoque}</div>
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
              <div className={styles.obsLabel}>Observação (opcional)</div>
              <textarea
                className={styles.obsTextarea}
                value={observacaoAtual}
                onChange={(e) => setObservacaoAtual(e.target.value)}
                placeholder="Adicione uma observação sobre esta movimentação..."
                rows={3}
                maxLength={2000}
                disabled={isBusy}
              />
              <div className={styles.obsCounter}>{observacaoAtual.length}/2000</div>
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
                  onClick={abrirConfirmacaoRegistro}
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
                  {isBusy
                    ? "⏳ Processando…"
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
                {tipoOperacao === "saida" ? "Confirma a SAÍDA?" : "Confirma a ENTRADA?"}
              </h2>
              <button className={styles.modalCloseBtn} onClick={() => setMostrarConfirmacaoRegistro(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.confirmacaoTexto}>
                {tipoOperacao === "saida"
                  ? "Deseja registrar a saída dos produtos selecionados?"
                  : "Deseja registrar a entrada dos produtos selecionados?"}
              </p>
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
              >
                {tipoOperacao === "saida" ? "Confirmar Saída" : "Confirmar Entrada"}
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
                              max={tipoOperacao === "saida" ? p.estoque : undefined}
                            />
                            <button
                              className={styles.qtyBtn}
                              onClick={() => atualizarQuantidadeModal(idx, p.quantidade + 1)}
                              disabled={tipoOperacao === "saida" && p.quantidade >= p.estoque}
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
