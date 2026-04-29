"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getActiveFilial, resolveCompany, type CompanyKey } from "@/lib/config/company";
import { useAuth } from "@/components/auth/AuthContext";

import styles from "./TransferenciaProdutosPage.module.css";

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
  filialOrigem: string;
  nomeFilialOrigem: string;
  estoqueOrigem: number;
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

interface TransferenciaProdutosPageProps {
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

async function searchProdutos(searchTerm: string, filialOrigem?: string, corProduto?: string | null, companyKey?: string): Promise<Produto[]> {
  if (!searchTerm || searchTerm.trim().length < 2) {
    return [];
  }

  const params = new URLSearchParams({
    q: searchTerm.trim(),
  });

  if (filialOrigem) {
    params.set("filialOrigem", filialOrigem.trim());
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

async function executarTransferencia(
  produto: string,
  corProduto: string | null,
  filialOrigem: string,
  filialDestino: string,
  qtdeSaida: number,
  qtdeEntrada: number,
  tipoRomaneio: string,
  responsavel: string,
  username?: string,
  observacao?: string,
  companyKey?: string
): Promise<{ success: boolean; message: string; romaneioSaida?: string; romaneioEntrada?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (username) headers["x-auth-username"] = username;
  const response = await fetch("/api/transferencia-produtos/executar", {
    method: "POST",
    headers,
    body: JSON.stringify({
      produto,
      corProduto,
      filialOrigem,
      filialDestino,
      qtdeSaida,
      qtdeEntrada,
      tipoRomaneio,
      responsavel,
      observacao: observacao || null,
      companyKey,
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as { error: string };
    throw new Error(error.error || "Erro ao executar transferência");
  }

  const json = (await response.json()) as {
    success: boolean;
    message: string;
    romaneioSaida?: string;
    romaneioEntrada?: string;
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

export default function TransferenciaProdutosPage({
  companyKey,
  companyName,
}: TransferenciaProdutosPageProps) {
  const { user } = useAuth();
  const companyConfig = resolveCompany(companyKey);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [filiaisDisponiveis, setFiliaisDisponiveis] = useState<Filial[]>([]);
  const [filiaisDestinoDisponiveis, setFiliaisDestinoDisponiveis] = useState<Filial[]>([]);
  const [filialOrigem, setFilialOrigem] = useState<Filial | null>(null);
  const [filialDestino, setFilialDestino] = useState<Filial | null>(null);
  const [produtosSelecionados, setProdutosSelecionados] = useState<ProdutoSelecionado[]>([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [notificacao, setNotificacao] = useState<{ mensagem: string; tipo: "success" | "error" } | null>(null);
  const [processandoTransferencia, setProcessandoTransferencia] = useState(false);
  const [filaTransferencias, setFilaTransferencias] = useState<ProdutoSelecionado[]>([]);
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
    if (!permissoesCarregadas) return; // Aguardar permissões carregarem primeiro
    
    async function loadFiliais() {
      try {
        const data = await fetchFiliais();
        setFiliais(data);

        // Aplicar filtros de permissão se existirem
        if (permissoes) {
          const permissaoFilialMatches = (cod: string, filial: Filial) =>
            getActiveFilial(companyConfig, cod || "").trim() === filial.codFilial.trim();

          // Filtrar filiais de origem (correspondência exata por codFilial)
          if (permissoes.filiaisOrigem.length > 0) {
            const filiaisOrigemPermitidas = data.filter(f =>
              permissoes.filiaisOrigem.some(cod => permissaoFilialMatches(cod, f))
            );
            setFiliaisDisponiveis(filiaisOrigemPermitidas);
            
            // Selecionar primeira filial permitida
            if (filiaisOrigemPermitidas.length > 0) {
              setFilialOrigem(filiaisOrigemPermitidas[0]);
            }
          } else {
            setFiliaisDisponiveis(data);
            if (data.length > 0) {
              setFilialOrigem(data[0]);
            }
          }

          // Filtrar filiais de destino (correspondência exata por codFilial)
          if (permissoes.filiaisDestino.length > 0) {
            const filiaisDestinoPermitidas = data.filter(f =>
              permissoes.filiaisDestino.some(cod => permissaoFilialMatches(cod, f))
            );
            setFiliaisDestinoDisponiveis(filiaisDestinoPermitidas);
            
            // Se houver apenas uma filial de destino permitida e já tiver origem selecionada, selecionar automaticamente
            if (filiaisDestinoPermitidas.length === 1 && filialOrigem) {
              setFilialDestino(filiaisDestinoPermitidas[0]);
            }
          } else {
            setFiliaisDestinoDisponiveis(data);
          }
        } else {
          // Sem permissões, mostrar todas
          setFiliaisDisponiveis(data);
          setFiliaisDestinoDisponiveis(data);
          if (data.length > 0) {
            setFilialOrigem(data[0]);
          }
        }
      } catch (error) {
        console.error("Erro ao carregar filiais", error);
      }
    }
    loadFiliais();
  }, [permissoes, permissoesCarregadas, companyConfig]);

  // Atualizar filiais de destino quando origem mudar (considerando permissões)
  useEffect(() => {
    if (!filialOrigem) return;

    // Se houver apenas uma filial de destino permitida, selecionar automaticamente
    if (permissoes?.filiaisDestino.length === 1) {
      const filialDestinoUnica = filiaisDestinoDisponiveis.find(f =>
        permissoes.filiaisDestino.some(cod => getActiveFilial(companyConfig, cod || "").trim() === f.codFilial.trim())
      );
      if (filialDestinoUnica && filialDestinoUnica.codFilial !== filialOrigem.codFilial) {
        setFilialDestino(filialDestinoUnica);
      }
    }
  }, [filialOrigem, permissoes, filiaisDestinoDisponiveis, companyConfig]);

  // Carregar tipos de romaneio e aplicar filtros de permissão (aguardar permissões carregarem)
  useEffect(() => {
    if (!permissoesCarregadas) return; // Aguardar permissões carregarem primeiro
    
    async function loadTiposRomaneio() {
      try {
        const data = await fetchTiposRomaneio();
        setTiposRomaneio(data);
        
        // Aplicar filtros de permissão se existirem
        if (permissoes && permissoes.tiposRomaneioPermitidos.length > 0) {
          const tiposPermitidos = data.filter(tipo =>
            permissoes.tiposRomaneioPermitidos.some(permitido =>
              tipo.toUpperCase() === permitido.toUpperCase()
            )
          );
          setTiposRomaneioDisponiveis(tiposPermitidos);
          
          // Se tiver permissão com tipo padrão, usar ele (se estiver na lista permitida)
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
            // Usar o primeiro tipo permitido como padrão
            setTipoRomaneioSelecionado(tiposPermitidos[0]);
          }
        } else {
          // Sem permissões, mostrar todos
          setTiposRomaneioDisponiveis(data);
          if (data.length > 0) {
            // Se tiver permissão com tipo padrão, usar ele
            if (permissoes?.tipoRomaneioPadrao) {
              const tipoPermitido = data.find(tipo => 
                tipo.toUpperCase() === permissoes.tipoRomaneioPadrao!.toUpperCase()
              );
              if (tipoPermitido) {
                setTipoRomaneioSelecionado(tipoPermitido);
              } else {
                // Se não encontrar o tipo padrão, usar o padrão do sistema
                const tipoPadrao = data.find(tipo => tipo.toUpperCase() === 'TRANSFERENCIA ENTRE LOJAS') || data[0];
                setTipoRomaneioSelecionado(tipoPadrao);
              }
            } else {
              // Sempre usar "TRANSFERENCIA ENTRE LOJAS" como padrão se existir, senão usar o primeiro
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

  // Carregar responsáveis e aplicar padrão de permissão (aguardar permissões carregarem)
  useEffect(() => {
    if (!permissoesCarregadas) return; // Aguardar permissões carregarem primeiro
    
    async function loadResponsaveis() {
      try {
        const data = await fetchResponsaveis();
        setResponsaveis(data);
        
        // Se tiver permissão com responsável padrão, validar se existe na lista
        if (permissoes?.responsavelPadrao) {
          const responsavelValido = data.find(r =>
            r.responsavel.toUpperCase() === permissoes.responsavelPadrao!.toUpperCase()
          );
          if (responsavelValido) {
            setResponsavelSelecionado(responsavelValido.responsavel);
            setResponsavelFinal(responsavelValido.responsavel);
          } else if (data.length > 0) {
            // Se não encontrar, usar o primeiro disponível
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

  // Atualizar responsável final quando mudar (respeitando permissões)
  useEffect(() => {
    // Se responsável está fixo, sempre usar o padrão da permissão
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
        // Tentar buscar por código de barras primeiro (mesmo que não seja só números)
        const searchTermTrimmed = searchTerm.trim();
        let results: Produto[] = [];
        let corProdutoCodigoBarras: string | null = null;
        
        // Tentar buscar por código de barras se tiver pelo menos 3 caracteres
        if (searchTermTrimmed.length >= 3) {
          const produtoCodigoBarras = await buscarProdutoPorCodigoBarras(searchTermTrimmed, companyKey);
          
          if (produtoCodigoBarras) {
            // Se encontrou por código de barras, usar a cor específica se houver
            corProdutoCodigoBarras = produtoCodigoBarras.corProduto || null;
            
            // Buscar estoques desse produto, filtrando por cor se o código de barras tiver cor específica
            results = await searchProdutos(
              produtoCodigoBarras.produto,
              filialOrigem?.codFilial,
              corProdutoCodigoBarras,
              companyKey
            );
            
            // Se encontrou múltiplos produtos com mesmo código de barras, avisar
            if (produtoCodigoBarras.produtosEncontrados > 1 && active) {
              mostrarNotificacao(
                `Código de barras encontrado em ${produtoCodigoBarras.produtosEncontrados} produto(s). Usando o primeiro.`,
                "success"
              );
            }
            
            // Se não encontrou estoques com a cor específica, buscar todas as cores (igual ao script)
            if (results.length === 0 && corProdutoCodigoBarras) {
              results = await searchProdutos(
                produtoCodigoBarras.produto,
                filialOrigem?.codFilial,
                null,
                companyKey
              );
            }
          }
        }
        
        // Se não encontrou por código de barras ou não é só números, buscar normalmente
        if (results.length === 0) {
          results = await searchProdutos(searchTermTrimmed, filialOrigem?.codFilial, null, companyKey);
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
  }, [searchTerm, filialOrigem, companyKey, mostrarNotificacao]);

  const adicionarProduto = useCallback((produto: Produto) => {
    if (!filialOrigem) {
      mostrarNotificacao("Selecione uma filial de origem primeiro", "error");
      return;
    }

    // Debug: verificar o que está vindo
    console.log('[ADICIONAR PRODUTO]', {
      produto: produto.produto,
      filialOrigemCodFilial: filialOrigem.codFilial,
      filialOrigemCodFilialLen: filialOrigem.codFilial.length,
      estoques: produto.estoques.map(e => ({ 
        filial: e.filial, 
        filialLen: e.filial.length,
        filialTrim: e.filial.trim(),
        nomeFilial: e.nomeFilial, 
        estoque: e.estoque,
        match: e.filial.trim() === filialOrigem.codFilial.trim() || e.filial === filialOrigem.codFilial
      }))
    });

    // Encontrar estoque na filial origem - comparar com trim e também verificar se começa com o código
    const estoqueOrigem = produto.estoques.find(e => {
      const filialTrim = e.filial.trim();
      const codFilialTrim = filialOrigem.codFilial.trim();
      return filialTrim === codFilialTrim || 
             e.filial === filialOrigem.codFilial ||
             filialTrim.startsWith(codFilialTrim) ||
             codFilialTrim.startsWith(filialTrim);
    });
    
    if (!estoqueOrigem) {
      mostrarNotificacao(`Produto não possui estoque na filial ${filialOrigem.filial}`, "error");
      return;
    }

    const produtoSelecionado: ProdutoSelecionado = {
      produto: produto.produto,
      descProduto: produto.descProduto,
      corProduto: produto.corProduto,
      descCor: produto.descCor,
      filialOrigem: filialOrigem.codFilial,
      nomeFilialOrigem: filialOrigem.filial,
      estoqueOrigem: estoqueOrigem.estoque,
      quantidade: 1,
    };

    setProdutosSelecionados(prev => [...prev, produtoSelecionado]);
    mostrarNotificacao(`${produto.descProduto} adicionado à transferência`);
    
    // Limpar busca mas manter modal aberto
    setSearchTerm("");
    setProdutos([]);
  }, [filialOrigem, mostrarNotificacao]);

  const removerProduto = useCallback((index: number) => {
    setProdutosSelecionados(prev => prev.filter((_, i) => i !== index));
  }, []);

  const atualizarQuantidade = useCallback((index: number, quantidade: number) => {
    if (quantidade < 1) return;
    
    setProdutosSelecionados(prev => {
      const novo = [...prev];
      const produto = novo[index];
      if (quantidade > produto.estoqueOrigem) {
        mostrarNotificacao(`Quantidade não pode ser maior que o estoque disponível (${produto.estoqueOrigem})`, "error");
        return prev;
      }
      novo[index] = { ...produto, quantidade };
      return novo;
    });
  }, [mostrarNotificacao]);

  const processarFilaTransferencias = useCallback(async () => {
    if (filaTransferencias.length === 0 || processandoTransferencia || !filialDestino) {
      return;
    }

    setProcessandoTransferencia(true);
    const produto = filaTransferencias[0];

    // Retry automático se romaneio duplicado (igual ao script)
    let tentativas = 0;
    const maxTentativas = 5;
    let sucesso = false;

    while (!sucesso && tentativas < maxTentativas) {
      try {
        await executarTransferencia(
          produto.produto,
          produto.corProduto,
          produto.filialOrigem,
          filialDestino.codFilial,
          produto.quantidade,
          produto.quantidade,
          tipoRomaneioSelecionado,
          responsavelFinal || 'LOGISTICA',
          user?.username,
          observacao.trim() || undefined,
          companyKey
        );

        sucesso = true;

        // Remover da fila e da lista de selecionados
        setFilaTransferencias(prev => prev.slice(1));
        setProdutosSelecionados(prev => prev.filter(p => 
          p.produto !== produto.produto || 
          p.corProduto !== produto.corProduto ||
          p.filialOrigem !== produto.filialOrigem
        ));

        // Recarregar logs de saídas e entradas
        const [novoSaidas, novoEntradas] = await Promise.all([
          fetchLogSaidas(),
          fetchLogEntradas(),
        ]);
        setLogSaidas(novoSaidas);
        setLogEntradas(novoEntradas);

        mostrarNotificacao(`Transferência de ${produto.descProduto} concluída com sucesso!`);
      } catch (error: any) {
        const errorMessage = error.message || "Erro ao processar transferência";
        
        // Se falhou por PRIMARY KEY ou romaneio duplicado, tentar novamente
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
            // Aguardar um pouco antes de tentar novamente
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          } else {
            mostrarNotificacao(`Não foi possível gerar um romaneio único após ${maxTentativas} tentativas.`, "error");
            // Remover da fila mesmo em caso de erro para não travar
            setFilaTransferencias(prev => prev.slice(1));
            break;
          }
        } else {
          // Outro tipo de erro - não tentar novamente
          mostrarNotificacao(errorMessage, "error");
          // Remover da fila mesmo em caso de erro para não travar
          setFilaTransferencias(prev => prev.slice(1));
          break;
        }
      }
    }

    setProcessandoTransferencia(false);
  }, [filaTransferencias, processandoTransferencia, filialDestino, mostrarNotificacao, tipoRomaneioSelecionado, responsavelFinal, user?.username]);

  // Processar próximo item da fila quando terminar o anterior
  useEffect(() => {
    if (!processandoTransferencia && filaTransferencias.length > 0) {
      processarFilaTransferencias();
    }
  }, [processandoTransferencia, filaTransferencias.length, processarFilaTransferencias]);

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

  const iniciarTransferencia = useCallback(() => {
    if (!filialDestino) {
      mostrarNotificacao("Selecione uma filial de destino", "error");
      return;
    }

    if (produtosSelecionados.length === 0) {
      mostrarNotificacao("Adicione pelo menos um produto", "error");
      return;
    }

    // Adicionar todos os produtos à fila
    setFilaTransferencias([...produtosSelecionados]);
  }, [filialDestino, produtosSelecionados, mostrarNotificacao]);

  const totalItens = produtosSelecionados.reduce((sum, p) => sum + p.quantidade, 0);
  const totalProdutos = produtosSelecionados.length;

  // Mostrar loading enquanto permissões não carregaram
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
            <span className={styles.icon}>⇄</span>
            Transferência de Produtos
          </h1>
          <p className={styles.subtitle}>Movimente produtos entre filiais</p>
        </div>
      </div>

      {/* Layout principal */}
      <div className={styles.layout}>
        {/* Coluna esquerda - Filial Origem */}
        <div className={styles.column}>
          <div className={styles.section}>
            <label className={styles.sectionLabel}>FILIAL ORIGEM</label>
            {filiaisDisponiveis.length === 1 && filialOrigem ? (
              <div className={styles.filialCard}>
                <div className={styles.filialIcon}>🏢</div>
                <div className={styles.filialInfo}>
                  <div className={styles.filialName}>{filialOrigem.filial}</div>
                  <div className={styles.filialCode}>{filialOrigem.codFilial}</div>
                </div>
                <div className={styles.checkmark}>✓</div>
              </div>
            ) : (
              <>
                <div className={styles.selectWrapper}>
                  <select
                    className={styles.select}
                    value={filialOrigem?.codFilial || ""}
                    onChange={(e) => {
                      const filial = filiaisDisponiveis.find(f => f.codFilial === e.target.value);
                      setFilialOrigem(filial || null);
                      // Limpar produtos selecionados ao mudar origem
                      setProdutosSelecionados([]);
                      // Limpar destino quando mudar origem
                      setFilialDestino(null);
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
                {filialOrigem && (
                  <div className={styles.filialCard}>
                    <div className={styles.filialIcon}>🏢</div>
                    <div className={styles.filialInfo}>
                      <div className={styles.filialName}>{filialOrigem.filial}</div>
                      <div className={styles.filialCode}>{filialOrigem.codFilial}</div>
                    </div>
                    <div className={styles.checkmark}>✓</div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Log de Saídas */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>LOG DE SAÍDAS</label>
            {loadingLogSaidas ? (
              <div className={styles.emptyState}>Carregando...</div>
            ) : logSaidas.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📄</div>
                <div>Nenhuma saída realizada</div>
              </div>
            ) : (
              <div className={styles.logList}>
                {logSaidas.map((log, index) => {
                  const logKey = `saida|${log.romaneio}|${log.filialOrigem}|${log.filialDestino}`;
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
                          {log.filialOrigem} → {log.filialDestino}
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
                                    <div>Qtd transferida: {it.qtde}</div>
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
          {/* Produtos para Transferir */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <label className={styles.sectionLabel}>PRODUTOS PARA TRANSFERIR</label>
              <span className={styles.itemCount}>{totalItens} itens</span>
            </div>

            {produtosSelecionados.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📦</div>
                <div>Nenhum produto adicionado</div>
                <div className={styles.emptySubtext}>Adicione produtos para transferir</div>
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
                          max={produto.estoqueOrigem}
                        />
                        <button
                          className={styles.quantityButton}
                          onClick={() => atualizarQuantidade(index, produto.quantidade + 1)}
                          disabled={produto.quantidade >= produto.estoqueOrigem}
                        >
                          +
                        </button>
                      </div>
                      <div className={styles.stockIndicator}>
                        {produto.quantidade}/{produto.estoqueOrigem}
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
              disabled={!filialOrigem}
            >
              <span className={styles.addIcon}>+</span>
              Adicionar Produto
            </button>
          </div>

          {/* Resumo da Transferência */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>RESUMO DA TRANSFERÊNCIA</label>
            <div className={styles.resumo}>
              <div className={styles.resumoOrigem}>
                <span>Origem</span>
                <strong>{filialOrigem?.filial || "—"}</strong>
              </div>
              <div className={styles.resumoArrow}>→</div>
              <div className={styles.resumoDestino}>
                <span>Destino</span>
                <strong>{filialDestino?.filial || "—"}</strong>
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
                      // Validar se o valor existe na lista
                      if (value && !responsaveis.some(r => r.responsavel.toUpperCase() === value)) {
                        mostrarNotificacao("Responsável deve existir na lista de responsáveis disponíveis", "error");
                        // Reverter para o último valor válido
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
                        {resp.responsavel}{resp.qtd > 0 ? ` (${resp.qtd} entradas)` : ''}
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
                        // Validar se o valor existe na lista
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
                        {resp.responsavel}{resp.qtd > 0 ? ` (${resp.qtd} entradas)` : ''}
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
                placeholder="Adicione um comentário sobre esta transferência..."
                rows={3}
                maxLength={2000}
                disabled={processandoTransferencia || filaTransferencias.length > 0}
              />
              <div className={styles.observacaoCounter}>
                {observacao.length}/2000 caracteres
              </div>
            </div>

            <button
              className={`${styles.transferButton} ${
                !filialDestino || produtosSelecionados.length === 0 || processandoTransferencia || filaTransferencias.length > 0
                  ? styles.transferButtonDisabled
                  : ""
              }`}
              onClick={iniciarTransferencia}
              disabled={!filialDestino || produtosSelecionados.length === 0 || processandoTransferencia || filaTransferencias.length > 0}
            >
              <span className={styles.transferIcon}>✈️</span>
              {processandoTransferencia || filaTransferencias.length > 0
                ? `Processando... (${filaTransferencias.length} restantes)`
                : "Transferir Produtos"}
            </button>
          </div>
        </div>

        {/* Coluna direita - Filial Destino */}
        <div className={styles.column}>
          <div className={styles.section}>
            <label className={styles.sectionLabel}>FILIAL DESTINO</label>
            {filiaisDestinoDisponiveis.filter(f => f.codFilial !== filialOrigem?.codFilial).length === 1 && filialDestino ? (
              <div className={styles.filialCard}>
                <div className={styles.filialIcon}>🏢</div>
                <div className={styles.filialInfo}>
                  <div className={styles.filialName}>{filialDestino.filial}</div>
                  <div className={styles.filialCode}>{filialDestino.codFilial}</div>
                </div>
                <div className={styles.checkmark}>✓</div>
              </div>
            ) : (
              <>
                <div className={styles.selectWrapper}>
                  <select
                    className={styles.select}
                    value={filialDestino?.codFilial || ""}
                    onChange={(e) => {
                      const filial = filiaisDestinoDisponiveis.find(f => f.codFilial === e.target.value);
                      setFilialDestino(filial || null);
                    }}
                    disabled={!filialOrigem}
                  >
                    <option value="">Selecione uma filial</option>
                    {filiaisDestinoDisponiveis
                      .filter(f => f.codFilial !== filialOrigem?.codFilial)
                      .map(f => (
                        <option key={f.codFilial} value={f.codFilial}>
                          {f.filial}
                        </option>
                      ))}
                  </select>
                </div>
                {filialDestino && (
                  <div className={styles.filialCard}>
                    <div className={styles.filialIcon}>🏢</div>
                    <div className={styles.filialInfo}>
                      <div className={styles.filialName}>{filialDestino.filial}</div>
                      <div className={styles.filialCode}>{filialDestino.codFilial}</div>
                    </div>
                    <div className={styles.checkmark}>✓</div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Log de Entradas */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>LOG DE ENTRADAS</label>
            {loadingLogEntradas ? (
              <div className={styles.emptyState}>Carregando...</div>
            ) : logEntradas.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📄</div>
                <div>Nenhuma entrada realizada</div>
              </div>
            ) : (
              <div className={styles.logList}>
                {logEntradas.map((log, index) => {
                  const logKey = `entrada|${log.romaneio}|${log.filialOrigem}|${log.filialDestino}`;
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
                          {log.filialOrigem} → {log.filialDestino}
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
                                    <div>Qtd transferida: {it.qtde}</div>
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
                    // Debug: verificar comparação
                    console.log('[MODAL PRODUTO]', {
                      produto: produto.produto,
                      filialOrigemCodFilial: filialOrigem?.codFilial,
                      estoques: produto.estoques.map(e => ({
                        filial: e.filial,
                        filialTrim: e.filial.trim(),
                        codFilial: filialOrigem?.codFilial,
                        match: e.filial.trim() === filialOrigem?.codFilial?.trim(),
                        estoque: e.estoque
                      }))
                    });
                    const estoqueOrigem = produto.estoques.find(e => 
                      e.filial.trim() === filialOrigem?.codFilial?.trim() || 
                      e.filial === filialOrigem?.codFilial
                    );
                    return (
                      <div key={index} className={styles.produtoModalItem}>
                        <div className={styles.produtoModalIcon}>📦</div>
                        <div className={styles.produtoModalInfo}>
                          <div className={styles.produtoModalName}>{produto.descProduto}</div>
                          <div className={styles.produtoModalDetails}>
                            SKU: {produto.produto}
                            {produto.corProduto && ` • Cor: ${produto.descCor || produto.corProduto}`}
                            {estoqueOrigem && ` • Estoque: ${estoqueOrigem.estoque}`}
                          </div>
                        </div>
                        <button
                          className={styles.addProdutoButton}
                          onClick={() => adicionarProduto(produto)}
                          disabled={!estoqueOrigem}
                          title={estoqueOrigem ? `Adicionar produto (Estoque: ${estoqueOrigem.estoque})` : `Produto não possui estoque na filial ${filialOrigem?.filial}`}
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
