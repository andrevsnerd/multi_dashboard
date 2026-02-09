"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
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
  const response = await fetch("/api/transferencia-produtos/log-saidas?limit=50", {
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const json = (await response.json()) as { data: TransferenciaLog[] };
  return json.data || [];
}

async function fetchLogEntradas(): Promise<TransferenciaLog[]> {
  const response = await fetch("/api/transferencia-produtos/log?limit=50", {
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
  const [modalAberto, setModalAberto] = useState(false);
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
  const [observacao, setObservacao] = useState("");
  const [permissoes, setPermissoes] = useState<TransferenciaPermissao | null>(null);
  const [permissoesCarregadas, setPermissoesCarregadas] = useState(false);

  const notificacaoTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hoverRef = useRef<NodeJS.Timeout | null>(null);
  const leaveRef = useRef<NodeJS.Timeout | null>(null);
  const [hoveredLogKey, setHoveredLogKey] = useState<string | null>(null);
  const [detalhesCache, setDetalhesCache] = useState<Record<string, LogDetalheItem[]>>({});
  const [loadingDetalhesKey, setLoadingDetalhesKey] = useState<string | null>(null);

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

  const adicionarProduto = useCallback((produto: Produto) => {
    if (!filialSelecionada) {
      mostrarNotificacao("Selecione uma filial primeiro", "error");
      return;
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
      return;
    }

    const produtoSelecionado: ProdutoSelecionado = {
      produto: produto.produto,
      descProduto: produto.descProduto,
      corProduto: produto.corProduto,
      descCor: produto.descCor,
      filial: filialSelecionada.codFilial,
      nomeFilial: filialSelecionada.filial,
      estoque: estoque.estoque,
      quantidade: 1,
    };

    setProdutosSelecionados(prev => [...prev, produtoSelecionado]);
    mostrarNotificacao(`${produto.descProduto} adicionado`);
    
    setSearchTerm("");
    setProdutos([]);
  }, [filialSelecionada, mostrarNotificacao]);

  const removerProduto = useCallback((index: number) => {
    setProdutosSelecionados(prev => prev.filter((_, i) => i !== index));
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
          observacao.trim() || undefined
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
  }, [filaOperacoes, processandoOperacao, filialSelecionada, mostrarNotificacao, tipoOperacao, tipoRomaneioSelecionado, responsavelFinal, user?.username, observacao]);

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
    if (tipo && romaneio && fo && fd) {
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
    if (leaveRef.current) { clearTimeout(leaveRef.current); leaveRef.current = null; }
    if (hoverRef.current) clearTimeout(hoverRef.current);
    hoverRef.current = setTimeout(() => setHoveredLogKey(key), 80);
  }, []);

  const onLogCardLeave = useCallback(() => {
    if (hoverRef.current) { clearTimeout(hoverRef.current); hoverRef.current = null; }
    leaveRef.current = setTimeout(() => setHoveredLogKey(null), 80);
  }, []);

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

  // Limpar produtos selecionados quando mudar tipo de operação ou filial
  useEffect(() => {
    setProdutosSelecionados([]);
  }, [tipoOperacao, filialSelecionada]);

  const totalItens = produtosSelecionados.reduce((sum, p) => sum + p.quantidade, 0);
  const totalProdutos = produtosSelecionados.length;

  const logsAtivos = tipoOperacao === "saida" ? logSaidas : logEntradas;
  const loadingLogsAtivos = tipoOperacao === "saida" ? loadingLogSaidas : loadingLogEntradas;

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

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <span className={styles.icon}>{tipoOperacao === "saida" ? "📤" : "📥"}</span>
            Saídas e Entradas de Produtos
          </h1>
          <p className={styles.subtitle}>
            {tipoOperacao === "saida" ? "Registre saídas de produtos" : "Registre entradas de produtos"}
          </p>
        </div>
      </div>

      {/* Seletor de Tipo de Operação */}
      <div className={styles.tipoOperacaoSelector}>
        <button
          className={`${styles.tipoOperacaoButton} ${tipoOperacao === "saida" ? styles.tipoOperacaoButtonActive : ""}`}
          onClick={() => setTipoOperacao("saida")}
        >
          📤 Saída
        </button>
        <button
          className={`${styles.tipoOperacaoButton} ${tipoOperacao === "entrada" ? styles.tipoOperacaoButtonActive : ""}`}
          onClick={() => setTipoOperacao("entrada")}
        >
          📥 Entrada
        </button>
      </div>

      {/* Layout principal */}
      <div className={styles.layout}>
        {/* Coluna esquerda - Filial e Logs */}
        <div className={styles.column}>
          <div className={styles.section}>
            <label className={styles.sectionLabel}>
              {tipoOperacao === "saida" ? "FILIAL ORIGEM" : "FILIAL DESTINO"}
            </label>
            {filiaisDisponiveis.length === 1 && filialSelecionada ? (
              <div className={styles.filialCard}>
                <div className={styles.filialIcon}>🏢</div>
                <div className={styles.filialInfo}>
                  <div className={styles.filialName}>{filialSelecionada.filial}</div>
                  <div className={styles.filialCode}>{filialSelecionada.codFilial}</div>
                </div>
                <div className={styles.checkmark}>✓</div>
              </div>
            ) : (
              <>
                <div className={styles.selectWrapper}>
                  <select
                    className={styles.select}
                    value={filialSelecionada?.codFilial || ""}
                    onChange={(e) => {
                      const filial = filiaisDisponiveis.find(f => f.codFilial === e.target.value);
                      setFilialSelecionada(filial || null);
                      setProdutosSelecionados([]);
                    }}
                  >
                    <option value="">Selecione uma filial</option>
                    {filiaisDisponiveis.map(f => (
                      <option key={f.codFilial} value={f.codFilial}>
                        {f.filial}
                      </option>
                    ))}
                  </select>
                </div>
                {filialSelecionada && (
                  <div className={styles.filialCard}>
                    <div className={styles.filialIcon}>🏢</div>
                    <div className={styles.filialInfo}>
                      <div className={styles.filialName}>{filialSelecionada.filial}</div>
                      <div className={styles.filialCode}>{filialSelecionada.codFilial}</div>
                    </div>
                    <div className={styles.checkmark}>✓</div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Log */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>
              LOG DE {tipoOperacao === "saida" ? "SAÍDAS" : "ENTRADAS"}
            </label>
            {loadingLogsAtivos ? (
              <div className={styles.emptyState}>Carregando...</div>
            ) : logsAtivos.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📄</div>
                <div>Nenhuma {tipoOperacao === "saida" ? "saída" : "entrada"} realizada</div>
              </div>
            ) : (
              <div className={styles.logList}>
                {logsAtivos.map((log, index) => {
                  const logKey = `${tipoOperacao}|${log.romaneio}|${log.filialOrigem}|${log.filialDestino}`;
                  const show = hoveredLogKey === logKey;
                  const detalhes = show ? detalhesCache[logKey] : undefined;
                  const loading = loadingDetalhesKey === logKey;
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
                          <span className={styles.logStatus}>{log.status}</span>
                        </div>
                        <div className={styles.logDetails}>
                          {tipoOperacao === "saida" 
                            ? `${log.filialOrigem} → ${log.filialDestino}`
                            : `${log.filialOrigem} → ${log.filialDestino}`
                          }
                        </div>
                        {log.responsavel && (
                          <div className={styles.logResponsavel}>Responsável: {log.responsavel}</div>
                        )}
                        <div className={styles.logFooter}>
                          <span>👁 {log.qtdProdutos} produtos • {log.qtdItens} itens</span>
                          <span className={styles.logDate}>
                            {new Date(log.dataEmissao).toLocaleString("pt-BR")}
                          </span>
                        </div>
                      </div>
                      {show && (
                        <div className={styles.logPopover}>
                          {loading ? (
                            <div className={styles.logPopoverLoad}>…</div>
                          ) : detalhes?.length ? (
                            <div className={styles.logPopoverList}>
                              {detalhes.map((it, i) => {
                                const lojaO = it.filialOrigem ?? log.filialOrigem;
                                const lojaD = it.filialDestino ?? log.filialDestino;
                                return (
                                <div key={i} className={styles.logPopoverRow}>
                                  <div className={styles.logPopoverNome}>{it.descProduto || it.produto}</div>
                                  <div className={styles.logPopoverMeta}>
                                    {it.produto}{it.descCor ? ` · ${it.descCor}` : ""}
                                    {it.codigoBarra ? ` · ${it.codigoBarra}` : ""}
                                  </div>
                                  <div className={styles.logPopoverEstoque}>
                                    <div>Qtd {tipoOperacao === "saida" ? "saída" : "entrada"}: {it.qtde}</div>
                                    <div><strong>{lojaO}</strong>: {it.estoqueOrigem} un</div>
                                    <div><strong>{lojaD}</strong>: {it.estoqueDestino} un</div>
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className={styles.logPopoverLoad}>—</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Coluna central - Produtos e Resumo */}
        <div className={styles.column}>
          {/* Produtos */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <label className={styles.sectionLabel}>
                PRODUTOS PARA {tipoOperacao === "saida" ? "SAÍDA" : "ENTRADA"}
              </label>
              <span className={styles.itemCount}>{totalItens} itens</span>
            </div>

            {produtosSelecionados.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📦</div>
                <div>Nenhum produto adicionado</div>
                <div className={styles.emptySubtext}>Adicione produtos para {tipoOperacao === "saida" ? "saída" : "entrada"}</div>
              </div>
            ) : (
              <div className={styles.produtosList}>
                {produtosSelecionados.map((produto, index) => (
                  <div key={index} className={styles.produtoItem}>
                    <div className={styles.produtoInfo}>
                      <div className={styles.produtoName}>{produto.descProduto}</div>
                      <div className={styles.produtoSku}>
                        SKU: {produto.produto}
                        {produto.corProduto && ` • Cor: ${produto.descCor || produto.corProduto}`}
                      </div>
                    </div>
                    <div className={styles.produtoControls}>
                      <div className={styles.quantityControls}>
                        <button
                          className={styles.quantityButton}
                          onClick={() => atualizarQuantidade(index, produto.quantidade - 1)}
                          disabled={produto.quantidade <= 1}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          className={styles.quantityInput}
                          value={produto.quantidade}
                          onChange={(e) => {
                            const qty = parseInt(e.target.value) || 1;
                            atualizarQuantidade(index, qty);
                          }}
                          min={1}
                          max={produto.estoque}
                        />
                        <button
                          className={styles.quantityButton}
                          onClick={() => atualizarQuantidade(index, produto.quantidade + 1)}
                          disabled={produto.quantidade >= produto.estoque}
                        >
                          +
                        </button>
                      </div>
                      <div className={styles.stockIndicator}>
                        {produto.quantidade}/{produto.estoque}
                      </div>
                      <button
                        className={styles.removeButton}
                        onClick={() => removerProduto(index)}
                        title="Remover produto"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              className={styles.addButton}
              onClick={() => setModalAberto(true)}
              disabled={!filialSelecionada}
            >
              <span className={styles.addIcon}>+</span>
              Adicionar Produto
            </button>
          </div>

          {/* Resumo */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>RESUMO</label>
            <div className={styles.resumo}>
              <div className={styles.resumoFilial}>
                <span>{tipoOperacao === "saida" ? "Filial Origem" : "Filial Destino"}</span>
                <strong>{filialSelecionada?.filial || "—"}</strong>
              </div>
            </div>
            <div className={styles.resumoCards}>
              <div className={styles.resumoCard}>
                <div className={styles.resumoCardValue}>{totalProdutos}</div>
                <div className={styles.resumoCardLabel}>Produtos</div>
              </div>
              <div className={styles.resumoCard}>
                <div className={styles.resumoCardValue}>{totalItens}</div>
                <div className={styles.resumoCardLabel}>Itens Total</div>
              </div>
            </div>

            {/* Tipo de Romaneio */}
            <div className={styles.configSection}>
              <label className={styles.configLabel}>Tipo de Romaneio</label>
              {tiposRomaneioDisponiveis.length === 1 ? (
                <div style={{ 
                  padding: "10px 14px", 
                  border: "1px solid #e2e8f0", 
                  borderRadius: "10px", 
                  fontSize: "15px",
                  background: "#f8fafc",
                  color: "#334155"
                }}>
                  {tipoRomaneioSelecionado}
                </div>
              ) : (
                <select
                  className={styles.configSelect}
                  value={tipoRomaneioSelecionado}
                  onChange={(e) => setTipoRomaneioSelecionado(e.target.value)}
                  disabled={permissoes?.tipoRomaneioFixo === true}
                >
                  {tiposRomaneioDisponiveis.map(tipo => (
                    <option key={tipo} value={tipo}>{tipo}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Responsável */}
            <div className={styles.configSection}>
              <label className={styles.configLabel}>Responsável</label>
              {permissoes?.responsavelFixo ? (
                <div style={{ 
                  padding: "10px 14px", 
                  border: "1px solid #e2e8f0", 
                  borderRadius: "10px", 
                  fontSize: "15px",
                  background: "#f8fafc",
                  color: "#334155"
                }}>
                  {permissoes.responsavelPadrao || "LOGISTICA"}
                </div>
              ) : responsaveis.length === 1 ? (
                <div style={{ 
                  padding: "10px 14px", 
                  border: "1px solid #e2e8f0", 
                  borderRadius: "10px", 
                  fontSize: "15px",
                  background: "#f8fafc",
                  color: "#334155"
                }}>
                  {responsaveis[0].responsavel}
                </div>
              ) : !mostrarInputResponsavel ? (
                <>
                  <input
                    type="text"
                    list="responsaveis-list"
                    className={styles.configSelect}
                    value={responsavelSelecionado}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase();
                      setResponsavelSelecionado(value);
                    }}
                    onBlur={(e) => {
                      const value = e.target.value.trim().toUpperCase();
                      if (value && !responsaveis.some(r => r.responsavel.toUpperCase() === value)) {
                        mostrarNotificacao("Responsável deve existir na lista de responsáveis disponíveis", "error");
                        if (responsaveis.length > 0) {
                          setResponsavelSelecionado(responsaveis[0].responsavel);
                        }
                      }
                    }}
                    placeholder="Selecione ou digite um responsável"
                  />
                  <datalist id="responsaveis-list">
                    {responsaveis.map((resp, idx) => (
                      <option key={idx} value={resp.responsavel}>
                        {resp.responsavel} ({resp.qtd} entradas)
                      </option>
                    ))}
                  </datalist>
                </>
              ) : (
                <div className={styles.customInputWrapper}>
                  <input
                    type="text"
                    list="responsaveis-list"
                    className={styles.customInput}
                    placeholder="Digite o login do responsável"
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
                      <option key={idx} value={resp.responsavel}>
                        {resp.responsavel} ({resp.qtd} entradas)
                      </option>
                    ))}
                  </datalist>
                  <button
                    className={styles.cancelCustomButton}
                    onClick={() => {
                      setMostrarInputResponsavel(false);
                      setInputResponsavelCustomizado("");
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>

            {/* Observação */}
            <div className={styles.configSection}>
              <label className={styles.configLabel}>Observação (Opcional)</label>
              <textarea
                className={styles.observacaoTextarea}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder={`Adicione um comentário sobre esta ${tipoOperacao === "saida" ? "saída" : "entrada"}...`}
                rows={3}
                maxLength={2000}
                disabled={processandoOperacao || filaOperacoes.length > 0}
              />
              <div className={styles.observacaoCounter}>
                {observacao.length}/2000 caracteres
              </div>
            </div>

            <button
              className={`${styles.transferButton} ${
                !filialSelecionada || produtosSelecionados.length === 0 || processandoOperacao || filaOperacoes.length > 0
                  ? styles.transferButtonDisabled
                  : ""
              }`}
              onClick={iniciarOperacao}
              disabled={!filialSelecionada || produtosSelecionados.length === 0 || processandoOperacao || filaOperacoes.length > 0}
            >
              <span className={styles.transferIcon}>{tipoOperacao === "saida" ? "📤" : "📥"}</span>
              {processandoOperacao || filaOperacoes.length > 0
                ? `Processando... (${filaOperacoes.length} restantes)`
                : tipoOperacao === "saida" ? "Registrar Saída" : "Registrar Entrada"}
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Adicionar Produto */}
      {modalAberto && (
        <div className={styles.modalOverlay} onClick={() => setModalAberto(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Adicionar Produto</h2>
              <button
                className={styles.modalClose}
                onClick={() => setModalAberto(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalContent}>
              <div className={styles.searchWrapper}>
                <span className={styles.searchIcon}>🔍</span>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Buscar por nome ou SKU..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoFocus
                />
              </div>
              {loadingProdutos ? (
                <div className={styles.loading}>Buscando produtos...</div>
              ) : produtos.length === 0 && searchTerm.length >= 2 ? (
                <div className={styles.emptyState}>Nenhum produto encontrado</div>
              ) : (
                <div className={styles.produtosModalList}>
                  {produtos.map((produto, index) => {
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
                            SKU: {produto.produto}
                            {produto.corProduto && ` • Cor: ${produto.descCor || produto.corProduto}`}
                            {estoque && ` • Estoque: ${estoque.estoque}`}
                          </div>
                        </div>
                        <button
                          className={styles.addProdutoButton}
                          onClick={() => adicionarProduto(produto)}
                          disabled={!estoque}
                          title={estoque ? `Adicionar produto (Estoque: ${estoque.estoque})` : `Produto não possui estoque na filial ${filialSelecionada?.filial}`}
                        >
                          +
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notificação */}
      {notificacao && (
        <div className={`${styles.notification} ${styles[`notification${notificacao.tipo}`]}`}>
          <span className={styles.notificationIcon}>
            {notificacao.tipo === "success" ? "✓" : "✗"}
          </span>
          <span className={styles.notificationMessage}>{notificacao.mensagem}</span>
        </div>
      )}
    </div>
  );
}
