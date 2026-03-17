"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { type CompanyKey } from "@/lib/config/company";
import { useAuth } from "@/components/auth/AuthContext";

import styles from "./SaidasEntradasProdutosPage.module.css";

interface Filial {
  codFilial: string;
  filial: string;
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

interface LogDetalheItem {
  produto: string;
  corProduto: string | null;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  qtde: number;
  estoqueOrigem: number;
  estoqueDestino: number;
  filialOrigem?: string;
  filialDestino?: string;
}

interface SaidasEntradasProdutosPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface TransferenciaPermissao {
  username: string;
  filiaisOrigem: string[];
  filiaisDestino: string[];
  tiposRomaneioPermitidos: string[];
  responsavelPadrao?: string;
  tipoRomaneioPadrao?: string;
  responsavelFixo: boolean;
  tipoRomaneioFixo: boolean;
}

type TipoOperacao = "saida" | "entrada";

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

function formatLogRoute(filialOrigem?: string, filialDestino?: string): string {
  const o = (filialOrigem || "").trim();
  const d = (filialDestino || "").trim();
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

async function fetchFiliais(): Promise<Filial[]> {
  const response = await fetch("/api/transferencia-produtos/filiais", {
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

async function searchProdutos(searchTerm: string, filial?: string, corProduto?: string | null, companyKey?: string): Promise<Produto[]> {
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

async function executarOperacao(
  tipoOperacao: TipoOperacao,
  produto: string,
  corProduto: string | null,
  filial: string,
  quantidade: number,
  tipoRomaneio: string,
  responsavel: string,
  username?: string,
  observacao?: string
): Promise<{ success: boolean; message: string; romaneio?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (username) headers["x-auth-username"] = username;
  const response = await fetch("/api/saidas-entradas-produtos/executar", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tipoOperacao,
      produto,
      corProduto,
      filial,
      quantidade,
      tipoRomaneio,
      responsavel,
      observacao: observacao || null,
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

async function fetchLogDetalhes(
  tipo: "saida" | "entrada",
  romaneio: string,
  filialOrigem: string,
  filialDestino: string
): Promise<LogDetalheItem[]> {
  const params = new URLSearchParams({
    tipo,
    romaneio,
    filialOrigem,
    filialDestino,
  });
  const response = await fetch(`/api/transferencia-produtos/log-detalhes?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: LogDetalheItem[] };
  return json.data || [];
}

export default function SaidasEntradasProdutosPage({
  companyKey,
  companyName,
}: SaidasEntradasProdutosPageProps) {
  const { user } = useAuth();
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
  const [filaOperacoes, setFilaOperacoes] = useState<ProdutoSelecionado[]>([]);
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
  const observacaoRegistroRef = useRef<string>("");
  const [hoveredLogKey, setHoveredLogKey] = useState<string | null>(null);
  const [detalhesCache, setDetalhesCache] = useState<Record<string, LogDetalheItem[]>>({});
  const [loadingDetalhesKey, setLoadingDetalhesKey] = useState<string | null>(null);
  const [modalEdicaoAberto, setModalEdicaoAberto] = useState(false);
  const [logEditando, setLogEditando] = useState<TransferenciaLog | null>(null);
  const [observacaoEditando, setObservacaoEditando] = useState("");
  const [processandoEdicao, setProcessandoEdicao] = useState(false);
  const [mostrarConfirmacaoRegistro, setMostrarConfirmacaoRegistro] = useState(false);

  // Carregar permissões do usuário PRIMEIRO (antes de tudo)
  useEffect(() => {
    async function loadPermissoes() {
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
  }, [user?.username]);

  // Carregar filiais e aplicar filtros de permissão (aguardar permissões carregarem)
  useEffect(() => {
    if (!permissoesCarregadas) return;
    
    async function loadFiliais() {
      try {
        const data = await fetchFiliais();
        setFiliais(data);

        // Aplicar filtros de permissão se existirem
        if (permissoes) {
          // Para saída: usar filiaisOrigem, para entrada: usar filiaisDestino
          const filiaisPermitidas = tipoOperacao === "saida" 
            ? (permissoes.filiaisOrigem.length > 0 
                ? data.filter(f => permissoes.filiaisOrigem.some(cod => f.codFilial.trim() === (cod || "").trim()))
                : data)
            : (permissoes.filiaisDestino.length > 0
                ? data.filter(f => permissoes.filiaisDestino.some(cod => f.codFilial.trim() === (cod || "").trim()))
                : data);
          
          setFiliaisDisponiveis(filiaisPermitidas);
          
          if (filiaisPermitidas.length > 0) {
            setFilialSelecionada(filiaisPermitidas[0]);
          }
        } else {
          setFiliaisDisponiveis(data);
          if (data.length > 0) {
            setFilialSelecionada(data[0]);
          }
        }
      } catch (error) {
        console.error("Erro ao carregar filiais", error);
      }
    }
    loadFiliais();
  }, [permissoes, permissoesCarregadas, tipoOperacao]);

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

  // Carregar responsáveis e aplicar padrão de permissão
  useEffect(() => {
    if (!permissoesCarregadas) return;
    
    async function loadResponsaveis() {
      try {
        const data = await fetchResponsaveis();
        setResponsaveis(data);
        
        if (permissoes?.responsavelPadrao) {
          const responsavelValido = data.find(r =>
            r.responsavel.toUpperCase() === permissoes.responsavelPadrao!.toUpperCase()
          );
          if (responsavelValido) {
            setResponsavelSelecionado(responsavelValido.responsavel);
            setResponsavelFinal(responsavelValido.responsavel);
          } else if (data.length > 0) {
            setResponsavelSelecionado(data[0].responsavel);
            setResponsavelFinal(data[0].responsavel);
          }
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
    setHoveredLogKey(null);
    setLoadingDetalhesKey(null);
    setProdutosSelecionados([]);
    setProdutosSelecionadosModal([]);
    setFilaOperacoes([]);
    setSearchTerm("");
    setProdutos([]);
    setModalAberto(false);
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
  }, [produtosSelecionados]);

  const continuarNoModal = useCallback(() => {
    setModalConfirmarFecharAberto(false);
  }, []);

  const confirmarProdutosDoModal = useCallback(() => {
    setProdutosSelecionados(produtosSelecionadosModal);
    setModalAberto(false);
    setSearchTerm("");
    setProdutos([]);
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
              companyKey
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
                companyKey
              );
            }
          }
        }
        
        if (results.length === 0) {
          results = await searchProdutos(searchTermTrimmed, filialSelecionada?.codFilial, null, companyKey);
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
  }, [searchTerm, filialSelecionada, companyKey, mostrarNotificacao]);

  const criarProdutoSelecionado = useCallback((produto: Produto): ProdutoSelecionado | null => {
    if (!filialSelecionada) {
      mostrarNotificacao("Selecione uma filial primeiro", "error");
      return null;
    }

    const estoque = produto.estoques.find(e => {
      const filialTrim = e.filial.trim();
      const codFilialTrim = filialSelecionada.codFilial.trim();
      return filialTrim === codFilialTrim || 
             e.filial === filialSelecionada.codFilial ||
             filialTrim.startsWith(codFilialTrim) ||
             codFilialTrim.startsWith(filialTrim);
    });
    
    if (!estoque) {
      mostrarNotificacao(`Produto não possui estoque na filial ${filialSelecionada.filial}`, "error");
      return null;
    }

    return {
      produto: produto.produto,
      descProduto: produto.descProduto,
      corProduto: produto.corProduto,
      descCor: produto.descCor,
      filial: filialSelecionada.codFilial,
      nomeFilial: filialSelecionada.filial,
      estoque: estoque.estoque,
      quantidade: 1,
    };
  }, [filialSelecionada, mostrarNotificacao]);

  const adicionarProdutoModal = useCallback((produto: Produto) => {
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
      const proxQtd = Math.min(atual.estoque, atual.quantidade + 1);
      const next = [...prev];
      next[idx] = { ...atual, quantidade: proxQtd };

      if (proxQtd === atual.estoque) {
        mostrarNotificacao(`Quantidade máxima atingida (estoque ${atual.estoque})`, "error");
      } else {
        mostrarNotificacao(`${novoItem.descProduto} adicionado`);
      }

      return next;
    });
  }, [criarProdutoSelecionado, mostrarNotificacao]);

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
      if (quantidade > produto.estoque) {
        mostrarNotificacao(`Quantidade não pode ser maior que o estoque disponível (${produto.estoque})`, "error");
        return prev;
      }
      novo[index] = { ...produto, quantidade };
      return novo;
    });
  }, [mostrarNotificacao]);

  const atualizarQuantidadeModal = useCallback((index: number, quantidade: number) => {
    if (quantidade < 1) return;
    
    setProdutosSelecionadosModal(prev => {
      const novo = [...prev];
      const produto = novo[index];
      if (!produto) return prev;
      if (quantidade > produto.estoque) {
        mostrarNotificacao(`Quantidade não pode ser maior que o estoque disponível (${produto.estoque})`, "error");
        return prev;
      }
      novo[index] = { ...produto, quantidade };
      return novo;
    });
  }, [mostrarNotificacao]);

  const removerProdutoModal = useCallback((index: number) => {
    setProdutosSelecionadosModal(prev => prev.filter((_, i) => i !== index));
  }, []);

  const processarFilaOperacoes = useCallback(async () => {
    if (filaOperacoes.length === 0 || processandoOperacao || !filialSelecionada) {
      return;
    }

    setProcessandoOperacao(true);
    const produto = filaOperacoes[0];

    let tentativas = 0;
    const maxTentativas = 5;
    let sucesso = false;

    while (!sucesso && tentativas < maxTentativas) {
      try {
        await executarOperacao(
          tipoOperacao,
          produto.produto,
          produto.corProduto,
          produto.filial,
          produto.quantidade,
          tipoRomaneioSelecionado,
          responsavelFinal || 'LOGISTICA',
          user?.username,
          observacaoRegistroRef.current.trim() || undefined
        );

        sucesso = true;

        setFilaOperacoes(prev => prev.slice(1));
        setProdutosSelecionados(prev => prev.filter(p => 
          p.produto !== produto.produto || 
          p.corProduto !== produto.corProduto ||
          p.filial !== produto.filial
        ));

        // Recarregar logs
        const [novoSaidas, novoEntradas] = await Promise.all([
          fetchLogSaidas(),
          fetchLogEntradas(),
        ]);
        setLogSaidas(novoSaidas);
        setLogEntradas(novoEntradas);

        mostrarNotificacao(`${tipoOperacao === "saida" ? "Saída" : "Entrada"} de ${produto.descProduto} concluída com sucesso!`);
      } catch (error: any) {
        const errorMessage = error.message || "Erro ao processar operação";
        
        if (
          errorMessage.includes('PRIMARY KEY') ||
          errorMessage.toLowerCase().includes('duplicate key') ||
          errorMessage.includes('ROMANEIO_DUPLICADO') ||
          (errorMessage.toLowerCase().includes('ja existe') && errorMessage.toLowerCase().includes('saida')) ||
          (errorMessage.toLowerCase().includes('já existe') && errorMessage.toLowerCase().includes('saida'))
        ) {
          tentativas++;
          if (tentativas < maxTentativas) {
            mostrarNotificacao(`Romaneio duplicado detectado. Tentando novamente... (${tentativas}/${maxTentativas})`, "success");
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          } else {
            mostrarNotificacao(`Não foi possível gerar um romaneio único após ${maxTentativas} tentativas.`, "error");
            setFilaOperacoes(prev => prev.slice(1));
            break;
          }
        } else {
          mostrarNotificacao(errorMessage, "error");
          setFilaOperacoes(prev => prev.slice(1));
          break;
        }
      }
    }

    setProcessandoOperacao(false);
  }, [filaOperacoes, processandoOperacao, filialSelecionada, mostrarNotificacao, tipoOperacao, tipoRomaneioSelecionado, responsavelFinal, user?.username]);

  // Quando terminar a fila, limpar snapshot da observação
  useEffect(() => {
    if (!processandoOperacao && filaOperacoes.length === 0) {
      observacaoRegistroRef.current = "";
    }
  }, [processandoOperacao, filaOperacoes.length]);

  useEffect(() => {
    if (!processandoOperacao && filaOperacoes.length > 0) {
      processarFilaOperacoes();
    }
  }, [processandoOperacao, filaOperacoes.length, processarFilaOperacoes]);

  useEffect(() => {
    if (!hoveredLogKey) return;
    if (detalhesCache[hoveredLogKey]) return;
    let cancelled = false;
    setLoadingDetalhesKey(hoveredLogKey);
    const parts = hoveredLogKey.split("|");
    const [tipo, romaneio, fo, fd] = parts;
    if (tipo && romaneio && (fo || fd)) {
      fetchLogDetalhes(tipo as "saida" | "entrada", romaneio, fo, fd).then((data) => {
        if (!cancelled) {
          setDetalhesCache((prev) => ({ ...prev, [hoveredLogKey]: data }));
          setLoadingDetalhesKey((prev) => (prev === hoveredLogKey ? null : prev));
        }
      }).catch(() => {
        if (!cancelled) setLoadingDetalhesKey((prev) => (prev === hoveredLogKey ? null : prev));
      });
    } else {
      setLoadingDetalhesKey(null);
    }
    return () => { cancelled = true; };
  }, [hoveredLogKey]);

  const onLogCardEnter = useCallback((key: string) => {
    setHoveredLogKey(key);
  }, []);

  const onLogCardLeave = useCallback(() => {
    setHoveredLogKey(null);
  }, []);

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

  const isAdmin = user?.role === "admin";

  const iniciarOperacao = useCallback(() => {
    if (!filialSelecionada) {
      mostrarNotificacao(`Selecione uma filial`, "error");
      return;
    }

    if (produtosSelecionados.length === 0) {
      mostrarNotificacao("Adicione pelo menos um produto", "error");
      return;
    }

    setFilaOperacoes([...produtosSelecionados]);
  }, [filialSelecionada, produtosSelecionados, mostrarNotificacao]);

  const abrirConfirmacaoRegistro = useCallback(() => {
    if (!filialSelecionada) {
      mostrarNotificacao("Selecione uma filial", "error");
      return;
    }
    if (produtosSelecionados.length === 0) {
      mostrarNotificacao("Adicione pelo menos um produto", "error");
      return;
    }
    setMostrarConfirmacaoRegistro(true);
  }, [filialSelecionada, produtosSelecionados.length, mostrarNotificacao]);

  const confirmarRegistro = useCallback(() => {
    setMostrarConfirmacaoRegistro(false);
    // captura observação atual para o registro e limpa o campo imediatamente
    observacaoRegistroRef.current = observacaoAtual;
    setObservacaoAtual("");
    iniciarOperacao();
  }, [iniciarOperacao, observacaoAtual, setObservacaoAtual]);

  // Limpar produtos selecionados quando mudar filial
  useEffect(() => {
    setProdutosSelecionados([]);
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

  const isBusy = processandoOperacao || filaOperacoes.length > 0;

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
            <span className={styles.configBarText}>{filialSelecionada.filial}</span>
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
                  <option key={f.codFilial} value={f.codFilial}>{f.filial}</option>
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
                    {tiposRomaneioDisponiveis.map(tipo => (
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

          {/* Responsável */}
          <div className={styles.configSegment}>
            <div className={styles.configIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" strokeWidth="2" />
                <path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className={styles.configBody}>
              <span className={styles.configBarLabel}>Responsável</span>
              {permissoes?.responsavelFixo ? (
                <span className={styles.configBarText}>{permissoes.responsavelPadrao || "LOGISTICA"}</span>
              ) : responsaveis.length === 1 ? (
                <span className={styles.configBarText}>{responsaveis[0].responsavel}</span>
              ) : !mostrarInputResponsavel ? (
                <>
                  <div className={styles.selectWrap}>
                    <input
                      type="text"
                      list="responsaveis-list"
                      className={styles.configBarInput}
                      value={responsavelSelecionado}
                      onChange={(e) => setResponsavelSelecionado(e.target.value.toUpperCase())}
                      onBlur={(e) => {
                        const value = e.target.value.trim().toUpperCase();
                        if (value && !responsaveis.some(r => r.responsavel.toUpperCase() === value)) {
                          mostrarNotificacao("Responsável deve existir na lista de responsáveis disponíveis", "error");
                          if (responsaveis.length > 0) setResponsavelSelecionado(responsaveis[0].responsavel);
                        }
                      }}
                      placeholder="Selecione ou digite"
                    />
                    <span className={styles.selectChevron} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </div>
                  <datalist id="responsaveis-list">
                    {responsaveis.map((resp, idx) => (
                      <option key={idx} value={resp.responsavel}>
                        {resp.responsavel}{resp.qtd > 0 ? ` (${resp.qtd})` : ""}
                      </option>
                    ))}
                  </datalist>
                </>
              ) : (
                <div className={styles.customInputRow}>
                  <input
                    type="text"
                    list="responsaveis-list"
                    className={styles.configBarInput}
                    placeholder="Digite o responsável"
                    value={inputResponsavelCustomizado}
                    onChange={(e) => setInputResponsavelCustomizado(e.target.value)}
                    onBlur={() => {
                      if (inputResponsavelCustomizado.trim()) {
                        const value = inputResponsavelCustomizado.trim().toUpperCase();
                        if (responsaveis.some(r => r.responsavel.toUpperCase() === value)) {
                          setResponsavelSelecionado(value);
                          setMostrarInputResponsavel(false);
                          setInputResponsavelCustomizado("");
                        } else {
                          mostrarNotificacao("Responsável deve existir na lista de responsáveis disponíveis", "error");
                          setInputResponsavelCustomizado("");
                        }
                      }
                    }}
                  />
                  <datalist id="responsaveis-list">
                    {responsaveis.map((resp, idx) => (
                      <option key={idx} value={resp.responsavel} />
                    ))}
                  </datalist>
                  <button
                    className={styles.cancelCustomBtn}
                    onClick={() => { setMostrarInputResponsavel(false); setInputResponsavelCustomizado(""); }}
                  >×</button>
                </div>
              )}
            </div>
          </div>
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
                <span className={styles.badgeMuted}>{logsFiltrados.length}</span>
              )}
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
                    const logKey = `${tipoOperacao}|${log.romaneio}|${log.filialOrigem}|${log.filialDestino}`;
                    const show = hoveredLogKey === logKey;
                    const detalhes = show ? detalhesCache[logKey] : undefined;
                    const loadingDet = loadingDetalhesKey === logKey;
                    return (
                      <div
                        key={index}
                        className={styles.logItemWrapper}
                        onMouseEnter={() => onLogCardEnter(logKey)}
                        onMouseLeave={onLogCardLeave}
                      >
                        <div className={styles.logItem}>
                          <div className={styles.logHeader}>
                            <span className={styles.logRomaneio}>#{log.romaneio}</span>
                            <div className={styles.logActions}>
                              {isAdmin && (
                                <button
                                  className={styles.logEditBtn}
                                  onClick={(e) => { e.stopPropagation(); abrirModalEdicao(log); }}
                                  title="Editar"
                                >✏️</button>
                              )}
                              <span className={styles.logStatusPill}>{log.status}</span>
                            </div>
                          </div>
                          <div className={styles.logRoute}>
                            {formatLogRoute(log.filialOrigem, log.filialDestino)}
                          </div>
                          {log.responsavel && (
                            <div className={styles.logResponsavel}>{log.responsavel}</div>
                          )}
                          <div className={styles.logFooter}>
                            <span className={styles.logMeta}>
                              {log.qtdProdutos} prod · {log.qtdItens} itens
                            </span>
                            <span className={styles.logDate}>
                              {formatLogDateTime(log.dataEmissao)}
                            </span>
                          </div>
                        </div>

                        {show && (
                          <div className={styles.logPopover}>
                            <div className={styles.logPopoverTitle}>Produtos deste romaneio</div>
                            {loadingDet ? (
                              <div className={styles.logPopoverLoad}>Carregando…</div>
                            ) : detalhes?.length ? (
                              <div className={styles.logPopoverList}>
                                {detalhes.map((it, i) => {
                                  const lojaO = it.filialOrigem ?? log.filialOrigem;
                                  const lojaD = it.filialDestino ?? log.filialDestino;
                                  const hasLojaO = Boolean(lojaO && lojaO !== "—");
                                  const hasLojaD = Boolean(lojaD && lojaD !== "—");
                                  return (
                                    <div key={i} className={styles.logPopoverRow}>
                                      <div className={styles.logPopoverNome}>{it.descProduto || it.produto}</div>
                                      <div className={styles.logPopoverMeta}>
                                        {it.produto}{it.descCor ? ` · ${it.descCor}` : ""}{it.codigoBarra ? ` · ${it.codigoBarra}` : ""}
                                      </div>
                                      <div className={styles.logPopoverEstoque}>
                                        <span className={styles.logPopoverEstoqueItem}>
                                          Qtd: <strong>{it.qtde}</strong>
                                        </span>
                                        {hasLojaO && (
                                          <span className={styles.logPopoverEstoqueItem}>
                                            <strong>{lojaO}</strong>: {it.estoqueOrigem}
                                          </span>
                                        )}
                                        {hasLojaD && (
                                          <span className={styles.logPopoverEstoqueItem}>
                                            <strong>{lojaD}</strong>: {it.estoqueDestino}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className={styles.logPopoverLoad}>Sem detalhes</div>
                            )}
                          </div>
                        )}
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
                  {produtosSelecionados.map((produto, index) => (
                    <div key={index} className={styles.produtoItem}>
                      <div className={styles.produtoInfo}>
                        <div className={styles.produtoName}>{produto.descProduto}</div>
                        <div className={styles.produtoSku}>
                          {produto.produto}
                          {produto.corProduto && ` · ${produto.descCor || produto.corProduto}`}
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
                            max={produto.estoque}
                          />
                          <button
                            className={styles.qtyBtn}
                            onClick={() => atualizarQuantidade(index, produto.quantidade + 1)}
                            disabled={produto.quantidade >= produto.estoque}
                          >+</button>
                        </div>
                        <div className={styles.stockPill}>{produto.quantidade}/{produto.estoque}</div>
                        <button className={styles.removeBtn} onClick={() => removerProduto(index)} title="Remover">🗑</button>
                      </div>
                    </div>
                  ))}
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
                  className={`${styles.submitBtn} ${isBusy || !filialSelecionada || produtosSelecionados.length === 0 ? "" : tipoOperacao === "saida" ? styles.submitBtnSaida : styles.submitBtnEntrada}`}
                  onClick={abrirConfirmacaoRegistro}
                  disabled={!filialSelecionada || produtosSelecionados.length === 0 || isBusy}
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
                    ? `⏳ Processando… (${filaOperacoes.length} restantes)`
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
                      e.filial.trim() === filialSelecionada?.codFilial?.trim() ||
                      e.filial === filialSelecionada?.codFilial
                    );
                    return (
                      <div key={index} className={styles.produtoModalItem}>
                        <div className={styles.produtoModalIcon}>📦</div>
                        <div className={styles.produtoModalInfo}>
                          <div className={styles.produtoModalName}>{produto.descProduto}</div>
                          <div className={styles.produtoModalDetails}>
                            {produto.produto}
                            {produto.corProduto && ` · ${produto.descCor || produto.corProduto}`}
                            {estoque && ` · Estoque: ${estoque.estoque}`}
                          </div>
                        </div>
                        <button
                          className={`${styles.addModalBtn} ${tipoOperacao === "saida" ? styles.addModalBtnSaida : styles.addModalBtnEntrada}`}
                          onClick={() => adicionarProdutoModal(produto)}
                          disabled={!estoque}
                          title={estoque
                            ? `Estoque: ${estoque.estoque}`
                            : `Sem estoque em ${filialSelecionada?.filial}`}
                        >+</button>
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
                    {produtosSelecionadosModal.map((p, idx) => (
                      <div key={`${p.produto}-${p.corProduto ?? ""}-${p.filial}-${idx}`} className={styles.produtoItem}>
                        <div className={styles.produtoInfo}>
                          <div className={styles.produtoName}>{p.descProduto}</div>
                          <div className={styles.produtoSku}>
                            {p.produto}
                            {p.corProduto && ` · ${p.descCor || p.corProduto}`}
                          </div>
                        </div>
                        <div className={styles.produtoControls}>
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
                              max={p.estoque}
                            />
                            <button
                              className={styles.qtyBtn}
                              onClick={() => atualizarQuantidadeModal(idx, p.quantidade + 1)}
                              disabled={p.quantidade >= p.estoque}
                            >+</button>
                          </div>
                          <div className={styles.stockPill}>{p.quantidade}/{p.estoque}</div>
                          <button className={styles.removeBtn} onClick={() => removerProdutoModal(idx)} title="Remover">🗑</button>
                        </div>
                      </div>
                    ))}
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
                <div><strong>Filial:</strong> {tipoOperacao === "saida" ? logEditando.filialOrigem : logEditando.filialDestino}</div>
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
