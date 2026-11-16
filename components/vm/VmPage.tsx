"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import type { CompanyKey } from "@/lib/config/company";
import type { RoleKey } from "@/types/auth";
import { buildVmKey, type VmItem, type VmMovimento } from "@/lib/utils/vm";

import styles from "./VmPage.module.css";

interface FilialVm {
  cod: string;
  nome: string;
  display: string;
  apelido: string | null;
}

interface EscopoVm {
  username: string;
  role: RoleKey;
  todasFiliais: boolean;
  podeMutar: boolean;
}

interface EstadoVm {
  escopo: EscopoVm;
  /** Só filiais em uso da empresa — resolvido no servidor pelo escopo do usuário. */
  filiais: FilialVm[];
  items: VmItem[];
  movimentos: VmMovimento[];
}

interface ProductSearchResult {
  productId: string;
  productName: string;
}

interface CorDisponivel {
  cor: string;
  descCor: string;
  estoque: number;
}

/** Peças no rascunho, esperando o Salvar. */
interface PendenteEntrada {
  produto: string;
  cor: string;
  descricao: string;
  descCor: string;
  /** Saldo da filial quando a peça entrou no rascunho — teto da quantidade. */
  estoque: number;
  qtde: number;
}

/** SKU pronto para entrar no rascunho (vindo da busca ou do bipe). */
type SkuParaRascunho = Omit<PendenteEntrada, "qtde">;

interface PreviewLinha {
  direcao: "saida" | "entrada";
  produto: string;
  cor: string;
  descricao: string;
  descCor: string;
  qtde: number;
  estoqueAtual: number;
  estoqueDepois: number;
  bloqueio: string | null;
}

interface Preview {
  filial: string;
  filialNome: string;
  linhas: PreviewLinha[];
  executaveis: number;
  bloqueadas: number;
}

interface ResultadoDirecao {
  direcao: "saida" | "entrada";
  /** TIPO_ROMANEIO do Linx — sempre 'VM'. */
  tipo: string;
  /** "saída" ou "entrada" — a operação, não um tipo. */
  operacao: string;
  romaneio: string | null;
  itens: number;
  erro: string | null;
}

interface Resultado {
  filialNome: string;
  direcoes: ResultadoDirecao[];
  bloqueadas: PreviewLinha[];
}

// ─── Bipagem (mesma rota da tela Saídas e Entradas) ───────────────────────────
interface BipeItem {
  produto: string;
  descProduto: string;
  corProduto: string | null;
  descCor: string;
  estoque: number;
  exigeTamanho?: boolean;
}

interface BipeResposta {
  status: "ok" | "sem_estoque" | "ambiguo" | "nao_encontrado";
  item: BipeItem | null;
  opcoes: BipeItem[];
}

/** Bipe que NÃO entrou no rascunho — fica no painel até o operador resolver ou dispensar. */
interface BipeOcorrencia {
  id: string;
  codigo: string;
  titulo: string;
  detalhe: string;
  opcoes?: BipeItem[];
}

interface VmPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

function corLabel(cor: string, descCor: string): string {
  const desc = (descCor || "").trim();
  return desc ? `${desc} (${cor})` : cor;
}

function dataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function chaveSku(produto: string, cor: string): string {
  return `${produto.trim().toUpperCase()}|${cor.trim().toUpperCase()}`;
}

let seqBipe = 0;
function novoIdBipe(): string {
  seqBipe += 1;
  return `${Date.now()}-${seqBipe}`;
}

/**
 * Resolve o código de barras direto no SKU + saldo da filial, numa ida só — a mesma
 * rota que a tela Saídas e Entradas usa na bipagem. Leitura pura: repetir é seguro.
 */
async function biparCodigo(codigo: string, filialNome: string, companyKey: string): Promise<BipeResposta> {
  const params = new URLSearchParams({ codigoBarras: codigo, filial: filialNome, company: companyKey });
  let response: Response | null = null;
  let ultimoErro: unknown = null;
  for (const espera of [0, 400, 1200]) {
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

export default function VmPage({ companyKey, companyName }: VmPageProps) {
  const { user } = useAuth();
  const username = user?.username ?? "";

  const [estado, setEstado] = useState<EstadoVm | null>(null);
  const [loading, setLoading] = useState(true);
  const [filialCod, setFilialCod] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProductSearchResult | null>(null);
  const [cores, setCores] = useState<CorDisponivel[]>([]);
  const [corSelecionada, setCorSelecionada] = useState("");
  const [qtdeSelecionada, setQtdeSelecionada] = useState(1);
  const [carregandoCores, setCarregandoCores] = useState(false);

  const [entrando, setEntrando] = useState<PendenteEntrada[]>([]);
  /** Espelho síncrono do rascunho: bipes em sequência decidem pelo valor mais novo, não pelo do render. */
  const entrandoRef = useRef<PendenteEntrada[]>([]);
  /** Itens em VM marcados para voltar ao estoque: chave buildVmKey → quantas peças. */
  const [saindo, setSaindo] = useState<Record<string, number>>({});

  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Bipagem ──
  const [codigoBipado, setCodigoBipado] = useState("");
  const [bipesEmVoo, setBipesEmVoo] = useState(0);
  const [bipesLidos, setBipesLidos] = useState(0);
  const [bipesAceitos, setBipesAceitos] = useState(0);
  const [ultimoBipe, setUltimoBipe] = useState<{ ok: boolean; titulo: string; detalhe: string } | null>(null);
  const [ocorrencias, setOcorrencias] = useState<BipeOcorrencia[]>([]);
  const [somBipeLigado, setSomBipeLigado] = useState(true);
  const bipeInputRef = useRef<HTMLInputElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  /** Bipes são processados em fila: cada um vê o rascunho já com o anterior somado. */
  const filaBipeRef = useRef<Promise<void>>(Promise.resolve());
  /** Filial no render atual — bipe que volta depois de trocar a filial é descartado. */
  const filialRef = useRef("");

  const authHeaders = useMemo(
    () => (username ? { "x-auth-username": username } : undefined),
    [username]
  );

  const carregarEstado = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/vm?company=${encodeURIComponent(companyKey)}`, {
        cache: "no-store",
        headers: { "x-auth-username": username },
      });
      const json = (await response.json()) as (EstadoVm & { error?: string }) | { error: string };
      if (!response.ok) {
        throw new Error(("error" in json && json.error) || "Não foi possível carregar a lista de VM.");
      }
      setEstado(json as EstadoVm);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a lista de VM.");
      setEstado(null);
    } finally {
      setLoading(false);
    }
  }, [companyKey, username]);

  useEffect(() => {
    void carregarEstado();
  }, [carregarEstado]);

  const filiaisDisponiveis = useMemo(() => estado?.filiais ?? [], [estado]);

  // Gerente tem uma filial só: já entra selecionada.
  useEffect(() => {
    if (filialCod || filiaisDisponiveis.length === 0) return;
    if (filiaisDisponiveis.length === 1) setFilialCod(filiaisDisponiveis[0].cod);
  }, [filiaisDisponiveis, filialCod]);

  useEffect(() => {
    filialRef.current = filialCod;
  }, [filialCod]);

  const filialAtual = filiaisDisponiveis.find((f) => f.cod === filialCod) ?? null;

  const itensDaFilial = useMemo(() => {
    if (!estado || !filialCod) return [] as VmItem[];
    return estado.items.filter((item) => item.filial.toUpperCase() === filialCod.toUpperCase());
  }, [estado, filialCod]);

  const pecasEmVm = useMemo(() => itensDaFilial.reduce((t, i) => t + i.qtde, 0), [itensDaFilial]);
  const pecasEntrando = useMemo(() => entrando.reduce((t, p) => t + p.qtde, 0), [entrando]);
  const pecasSaindo = useMemo(() => Object.values(saindo).reduce((t, n) => t + n, 0), [saindo]);
  const totalPendencias = entrando.length + Object.keys(saindo).length;

  function definirEntrando(proximo: PendenteEntrada[]) {
    entrandoRef.current = proximo;
    setEntrando(proximo);
  }

  /**
   * Soma `qtde` peças do SKU no rascunho (mesmo SKU = mesma linha). O teto é o saldo
   * da filial: o que já está em VM saiu do estoque, então o saldo atual é o que sobra.
   */
  const somarNoRascunho = useCallback(
    (sku: SkuParaRascunho, qtde: number): { ok: true; total: number } | { ok: false; motivo: string } => {
      const atual = entrandoRef.current;
      const chave = chaveSku(sku.produto, sku.cor);
      const existente = atual.find((p) => chaveSku(p.produto, p.cor) === chave);
      const jaNoRascunho = existente?.qtde ?? 0;
      // Saldo mais recente que chegou (o bipe consulta de novo a cada leitura).
      const teto = sku.estoque;
      if (jaNoRascunho + qtde > teto) {
        return {
          ok: false,
          motivo: `A filial tem ${teto} peça(s) em estoque e ${jaNoRascunho} já estão no rascunho.`,
        };
      }
      const proximo = existente
        ? atual.map((p) => (p === existente ? { ...p, qtde: p.qtde + qtde, estoque: teto } : p))
        : [...atual, { ...sku, qtde }];
      entrandoRef.current = proximo;
      setEntrando(proximo);
      return { ok: true, total: jaNoRascunho + qtde };
    },
    []
  );

  // ─── Busca de produtos ───────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTerm.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/products/search?q=${encodeURIComponent(searchTerm.trim())}`, {
          cache: "no-store",
        });
        const json = (await response.json()) as { data?: ProductSearchResult[] };
        if (!cancelled) setSearchResults(json.data ?? []);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchTerm]);

  // ─── Cores com estoque do produto escolhido ──────────────────────────────────
  const selecionarProduto = useCallback(
    async (result: ProductSearchResult) => {
      setProdutoSelecionado(result);
      setCores([]);
      setCorSelecionada("");
      setQtdeSelecionada(1);
      setFeedback(null);
      setError(null);
      if (!filialCod) {
        setError("Escolha a filial antes de selecionar o produto.");
        return;
      }
      setCarregandoCores(true);
      try {
        const params = new URLSearchParams({
          company: companyKey,
          filial: filialCod,
          produto: result.productId,
        });
        const response = await fetch(`/api/vm/cores?${params}`, {
          cache: "no-store",
          headers: authHeaders,
        });
        const json = (await response.json()) as { data?: CorDisponivel[]; error?: string };
        if (!response.ok) throw new Error(json.error || "Não foi possível carregar as cores.");
        const data = json.data ?? [];
        setCores(data);
        if (data.length === 1) setCorSelecionada(data[0].cor);
        if (data.length === 0) {
          setError(
            `${result.productName} não tem estoque em ${filialAtual?.nome ?? "nesta filial"} — não há peça para expor.`
          );
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar as cores.");
      } finally {
        setCarregandoCores(false);
      }
    },
    [authHeaders, companyKey, filialAtual?.nome, filialCod]
  );

  const corEscolhida = cores.find((c) => c.cor === corSelecionada) ?? null;

  function adicionarAoRascunho() {
    if (!produtoSelecionado || !corEscolhida) return;
    const resultadoSoma = somarNoRascunho(
      {
        produto: produtoSelecionado.productId,
        cor: corEscolhida.cor,
        descricao: produtoSelecionado.productName,
        descCor: corEscolhida.descCor,
        estoque: corEscolhida.estoque,
      },
      Math.max(1, qtdeSelecionada)
    );
    if (!resultadoSoma.ok) {
      setError(resultadoSoma.motivo);
      return;
    }
    setProdutoSelecionado(null);
    setCores([]);
    setCorSelecionada("");
    setQtdeSelecionada(1);
    setSearchTerm("");
    setSearchResults([]);
    setError(null);
    setFeedback("Adicionado ao rascunho. Clique em Salvar para confirmar o movimento de estoque.");
  }

  function alterarQtdeRascunho(p: PendenteEntrada, qtde: number) {
    const nova = Math.min(Math.max(1, Math.floor(qtde) || 1), Math.max(1, p.estoque));
    definirEntrando(
      entrandoRef.current.map((x) =>
        chaveSku(x.produto, x.cor) === chaveSku(p.produto, p.cor) ? { ...x, qtde: nova } : x
      )
    );
  }

  function tirarDoRascunho(p: PendenteEntrada) {
    definirEntrando(entrandoRef.current.filter((x) => chaveSku(x.produto, x.cor) !== chaveSku(p.produto, p.cor)));
  }

  function marcarParaRemover(item: VmItem) {
    const chave = buildVmKey(item.filial, item.produto, item.cor);
    // Por padrão devolve tudo; com mais de uma peça, o stepper ajusta quantas voltam.
    setSaindo((prev) => (chave in prev ? prev : { ...prev, [chave]: item.qtde }));
    setFeedback(null);
  }

  function ajustarRemocao(item: VmItem, qtde: number) {
    const chave = buildVmKey(item.filial, item.produto, item.cor);
    const nova = Math.min(Math.max(1, Math.floor(qtde) || 1), item.qtde);
    setSaindo((prev) => ({ ...prev, [chave]: nova }));
  }

  function desmarcarRemocao(chave: string) {
    setSaindo((prev) => {
      const proximo = { ...prev };
      delete proximo[chave];
      return proximo;
    });
  }

  const limparBipagem = useCallback(() => {
    setBipesLidos(0);
    setBipesAceitos(0);
    setUltimoBipe(null);
    setOcorrencias([]);
    setCodigoBipado("");
  }, []);

  function limparRascunho() {
    definirEntrando([]);
    setSaindo({});
    setFeedback(null);
    limparBipagem();
  }

  // ─── Bipagem ─────────────────────────────────────────────────────────────────
  const tocarBipe = useCallback(
    (ok: boolean) => {
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
    },
    [somBipeLigado]
  );

  const registrarFalhaBipe = useCallback(
    (codigo: string, titulo: string, detalhe: string, opcoes?: BipeItem[]) => {
      setUltimoBipe({ ok: false, titulo, detalhe });
      setOcorrencias((prev) => [...prev, { id: novoIdBipe(), codigo, titulo, detalhe, opcoes }]);
      tocarBipe(false);
    },
    [tocarBipe]
  );

  /** Coloca no rascunho o SKU que o bipe resolveu. Devolve false se não entrou. */
  const aceitarItemBipado = useCallback(
    (codigo: string, item: BipeItem): boolean => {
      const cor = (item.corProduto ?? "").trim();
      const nome = item.descProduto || item.produto;
      if (item.exigeTamanho) {
        registrarFalhaBipe(codigo, `${nome} tem tamanho (P/M/G)`, "O VM não escolhe tamanho. Use a tela Saídas/Entradas.");
        return false;
      }
      if (!cor) {
        registrarFalhaBipe(codigo, `${nome} sem cor`, "Código de barras sem cor cadastrada — a cor é obrigatória no VM.");
        return false;
      }
      if (item.estoque < 1) {
        registrarFalhaBipe(
          codigo,
          `${nome} sem estoque`,
          `${corLabel(cor, item.descCor)}: saldo ${item.estoque} nesta filial — não há peça para expor.`
        );
        return false;
      }
      const soma = somarNoRascunho(
        { produto: item.produto, cor, descricao: nome, descCor: item.descCor, estoque: item.estoque },
        1
      );
      if (!soma.ok) {
        registrarFalhaBipe(codigo, `${nome} — estoque insuficiente`, soma.motivo);
        return false;
      }
      setBipesAceitos((n) => n + 1);
      setUltimoBipe({
        ok: true,
        titulo: nome,
        detalhe: `${item.produto} · ${corLabel(cor, item.descCor)} · ${soma.total} no rascunho`,
      });
      tocarBipe(true);
      return true;
    },
    [registrarFalhaBipe, somarNoRascunho, tocarBipe]
  );

  function submeterBipe(valor?: string) {
    const codigo = (valor ?? codigoBipado).trim();
    setCodigoBipado("");
    bipeInputRef.current?.focus();
    if (!codigo) return;
    if (!filialAtual) {
      setUltimoBipe({ ok: false, titulo: "Selecione a filial", detalhe: "Escolha a loja antes de bipar." });
      tocarBipe(false);
      return;
    }

    const filialNaHora = filialAtual.cod;
    const filialNome = filialAtual.nome;
    setBipesLidos((n) => n + 1);
    setBipesEmVoo((n) => n + 1);

    filaBipeRef.current = filaBipeRef.current.then(async () => {
      try {
        const resposta = await biparCodigo(codigo, filialNome, companyKey);
        // Trocou de filial enquanto a consulta ia: a peça era da outra loja.
        if (filialRef.current !== filialNaHora) return;

        if (resposta.status === "nao_encontrado") {
          registrarFalhaBipe(codigo, "Código não encontrado", `Nenhum produto com o código ${codigo}.`);
        } else if (resposta.status === "ambiguo") {
          registrarFalhaBipe(
            codigo,
            "Código em mais de um produto/cor",
            "Escolha abaixo qual peça é esta.",
            resposta.opcoes
          );
        } else if (resposta.item) {
          aceitarItemBipado(codigo, resposta.item);
        } else {
          registrarFalhaBipe(codigo, "Resposta inválida", `Não foi possível resolver o código ${codigo}.`);
        }
      } catch (cause) {
        if (filialRef.current !== filialNaHora) return;
        registrarFalhaBipe(
          codigo,
          "Falha na consulta",
          cause instanceof Error ? `${cause.message}. Bipe de novo.` : "Bipe de novo."
        );
      } finally {
        setBipesEmVoo((n) => Math.max(0, n - 1));
      }
    });
  }

  function resolverOcorrencia(oc: BipeOcorrencia, opcao: BipeItem) {
    setOcorrencias((prev) => prev.filter((o) => o.id !== oc.id));
    aceitarItemBipado(oc.codigo, opcao);
  }

  function dispensarOcorrencia(id: string) {
    setOcorrencias((prev) => prev.filter((o) => o.id !== id));
  }

  // ─── Salvar → prévia → confirmação ───────────────────────────────────────────
  const skusSaindo = useMemo(
    () =>
      itensDaFilial
        .filter((item) => buildVmKey(item.filial, item.produto, item.cor) in saindo)
        .map((item) => ({
          produto: item.produto,
          cor: item.cor,
          qtde: saindo[buildVmKey(item.filial, item.produto, item.cor)] ?? 1,
        })),
    [itensDaFilial, saindo]
  );

  const skusEntrando = useMemo(
    () => entrando.map((p) => ({ produto: p.produto, cor: p.cor, qtde: p.qtde })),
    [entrando]
  );

  async function abrirPrevia() {
    setError(null);
    setFeedback(null);
    setResultado(null);
    try {
      const response = await fetch("/api/vm/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({
          company: companyKey,
          filial: filialCod,
          entrando: skusEntrando,
          saindo: skusSaindo,
        }),
      });
      const json = (await response.json()) as { data?: Preview; error?: string };
      if (!response.ok || !json.data) {
        throw new Error(json.error || "Não foi possível montar a prévia.");
      }
      setPreview(json.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível montar a prévia.");
    }
  }

  async function confirmar() {
    if (!preview) return;
    setConfirmando(true);
    setError(null);
    try {
      const response = await fetch("/api/vm/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({
          company: companyKey,
          filial: filialCod,
          entrando: skusEntrando,
          saindo: skusSaindo,
        }),
      });
      const json = (await response.json()) as { data?: Resultado; error?: string };
      if (!response.ok || !json.data) {
        throw new Error(json.error || "Não foi possível confirmar o movimento.");
      }
      setPreview(null);
      setResultado(json.data);
      limparRascunho();
      await carregarEstado();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o movimento.");
    } finally {
      setConfirmando(false);
    }
  }

  const podeMutar = estado?.escopo.podeMutar ?? false;
  const movimentosDaFilial = useMemo(() => {
    if (!estado) return [] as VmMovimento[];
    if (!filialCod) return estado.movimentos;
    return estado.movimentos.filter((m) => m.filial.toUpperCase() === filialCod.toUpperCase());
  }, [estado, filialCod]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.title}>VM — Visual Merchandising</h1>
          <p className={styles.subtitle}>
            Peças em exposição, por filial. Ao entrar na lista, a peça <strong>sai do estoque</strong> da
            loja por um romaneio de saída do tipo <strong>VM</strong>; ao sair da lista, volta por um
            romaneio de entrada do mesmo tipo. Por isso a Compra Ideal, o giro e o estoque disponível
            já enxergam a realidade — o VM não conta como peça à venda.
          </p>
        </div>
        <div className={styles.note}>
          <strong>Como funciona</strong>
          <span>
            Escolha a filial e <strong>bipe as peças</strong> (ou busque o produto e escolha a cor). Pode
            ter mais de uma peça igual em VM: cada bipe soma 1, até o saldo da loja. Clique em Salvar — o
            movimento de estoque só acontece depois da sua confirmação, e aparece no Extrato de Produto.
          </span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span className={styles.label}>Filial</span>
          <select
            className={styles.select}
            value={filialCod}
            onChange={(event) => {
              setFilialCod(event.target.value);
              limparRascunho();
              setProdutoSelecionado(null);
              setCores([]);
              setCorSelecionada("");
              setError(null);
            }}
            disabled={loading || filiaisDisponiveis.length <= 1}
          >
            <option value="">Selecione a filial…</option>
            {filiaisDisponiveis.map((f) => (
              <option key={f.cod} value={f.cod}>
                {f.nome}
                {f.apelido ? ` — ${f.apelido}` : ""}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            {estado?.escopo.todasFiliais
              ? "Você enxerga todas as filiais."
              : "Você opera apenas a sua filial atribuída."}
          </span>
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Empresa</span>
          <div className={styles.hint} style={{ paddingTop: 12 }}>
            {companyName}
            {!podeMutar && " · acesso somente leitura"}
          </div>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {feedback && <div className={styles.feedback}>{feedback}</div>}

      {totalPendencias > 0 && (
        <div className={styles.saveBar}>
          <div className={styles.saveBarText}>
            <span className={styles.saveBarTitle}>
              {totalPendencias} alteração(ões) no rascunho — nada saiu ou entrou no estoque ainda.
            </span>
            <span>
              {pecasEntrando} peça(s) entrando em VM (saída de estoque) · {pecasSaindo} peça(s) saindo de VM
              (entrada de estoque)
            </span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className={styles.undoButton} onClick={limparRascunho}>
              Descartar
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={abrirPrevia}
              disabled={!podeMutar || !filialCod || bipesEmVoo > 0 || ocorrencias.length > 0}
              title={
                bipesEmVoo > 0
                  ? "Aguarde os bipes em consulta."
                  : ocorrencias.length > 0
                    ? "Resolva ou dispense os bipes que não entraram."
                    : undefined
              }
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        <section className={styles.editorCard}>
          <div className={styles.cardHeader}>
            <h2>Adicionar peça ao VM</h2>
          </div>

          {!filialCod ? (
            <div className={styles.emptyState}>Escolha a filial para começar.</div>
          ) : (
            <>
              <div className={styles.field}>
                <span className={styles.label}>Bipar código de barras</span>
                <div className={styles.bipeRow}>
                  <input
                    ref={bipeInputRef}
                    className={`${styles.input} ${styles.bipeInput}`}
                    value={codigoBipado}
                    onChange={(event) => setCodigoBipado(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter, ou Tab no leitor configurado com sufixo Tab.
                      if (event.key === "Enter" || (event.key === "Tab" && event.currentTarget.value.trim())) {
                        event.preventDefault();
                        submeterBipe(event.currentTarget.value);
                      }
                    }}
                    placeholder="Bipe a peça (ou digite o código e tecle Enter)"
                    disabled={!podeMutar}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    aria-label="Código de barras"
                  />
                  {bipesEmVoo > 0 && <span className={styles.bipeLoading}>consultando {bipesEmVoo}…</span>}
                  <button
                    type="button"
                    className={styles.undoButton}
                    onClick={() => submeterBipe()}
                    disabled={!codigoBipado.trim() || !podeMutar}
                  >
                    Adicionar
                  </button>
                  <button
                    type="button"
                    className={styles.undoButton}
                    onClick={() => setSomBipeLigado((v) => !v)}
                    title={somBipeLigado ? "Desligar o som do bipe" : "Ligar o som do bipe"}
                    aria-pressed={somBipeLigado}
                  >
                    {somBipeLigado ? "🔊" : "🔇"}
                  </button>
                </div>
              </div>

              {/* Confirmação do último bipe: o operador está olhando a peça, não a lista. */}
              {ultimoBipe && (
                <div className={ultimoBipe.ok ? styles.bipeOk : styles.bipeErro}>
                  <span aria-hidden="true">{ultimoBipe.ok ? "✓" : "!"}</span>
                  <span className={styles.bipeTexto}>
                    <strong>{ultimoBipe.titulo}</strong>
                    <span>{ultimoBipe.detalhe}</span>
                  </span>
                </div>
              )}

              {bipesLidos > 0 && (
                <div className={styles.bipeContador}>
                  <span>
                    Lidos <strong>{bipesLidos}</strong>
                  </span>
                  <span>
                    Entraram <strong>{bipesAceitos}</strong>
                  </span>
                  {ocorrencias.length > 0 && (
                    <span className={styles.bipeContadorAlerta}>
                      Não entraram <strong>{ocorrencias.length}</strong>
                    </span>
                  )}
                </div>
              )}

              {/* Bipes que NÃO entraram: ficam aqui até resolver ou dispensar — o Salvar espera. */}
              {ocorrencias.length > 0 && (
                <div className={styles.bipeOcorrencias} role="alert">
                  <strong>⚠ {ocorrencias.length} bipe(s) não entraram no rascunho</strong>
                  {ocorrencias.map((oc) => (
                    <div key={oc.id} className={styles.bipeOcorrencia}>
                      <div className={styles.bipeTexto}>
                        <strong>
                          {oc.titulo} <span className={styles.itemCode}>· código {oc.codigo}</span>
                        </strong>
                        <span>{oc.detalhe}</span>
                        {oc.opcoes && oc.opcoes.length > 0 && (
                          <div className={styles.bipeOpcoes}>
                            {oc.opcoes.map((op) => (
                              <button
                                key={`${op.produto}|${op.corProduto ?? ""}`}
                                type="button"
                                className={styles.undoButton}
                                onClick={() => resolverOcorrencia(oc, op)}
                              >
                                {op.descProduto || op.produto} · {corLabel(op.corProduto ?? "", op.descCor)} ·
                                estoque {op.estoque}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className={styles.undoButton}
                        onClick={() => dispensarOcorrencia(oc.id)}
                      >
                        Dispensar
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label className={styles.field}>
                <span className={styles.label}>Ou buscar produto</span>
                <input
                  className={styles.input}
                  type="search"
                  placeholder="Busque por nome ou código"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  disabled={!podeMutar}
                />
              </label>

              {!produtoSelecionado &&
                (searching || searchResults.length > 0 || searchTerm.trim().length >= 2) && (
                  <div className={styles.searchPanel}>
                    {searching ? (
                      <div className={styles.searchEmpty}>Buscando produtos…</div>
                    ) : searchResults.length === 0 ? (
                      <div className={styles.searchEmpty}>Nenhum produto encontrado.</div>
                    ) : (
                      searchResults.map((result) => (
                        <button
                          key={result.productId}
                          type="button"
                          className={styles.searchItem}
                          onClick={() => void selecionarProduto(result)}
                          disabled={!podeMutar}
                        >
                          <span className={styles.searchName}>{result.productName}</span>
                          <span className={styles.searchCode}>{result.productId}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}

              {produtoSelecionado && (
                <div className={`${styles.itemRow} ${styles.itemRowPendenteSaida}`}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                    <div>
                      <div className={styles.itemName}>{produtoSelecionado.productName}</div>
                      <div className={styles.itemCode}>{produtoSelecionado.productId}</div>
                    </div>
                    <label className={styles.field}>
                      <span className={styles.label}>Cor (obrigatória)</span>
                      <select
                        className={styles.select}
                        value={corSelecionada}
                        onChange={(event) => {
                          setCorSelecionada(event.target.value);
                          setQtdeSelecionada(1);
                        }}
                        disabled={carregandoCores || cores.length === 0}
                      >
                        <option value="">
                          {carregandoCores
                            ? "Carregando cores com estoque…"
                            : cores.length === 0
                              ? "Nenhuma cor com estoque nesta filial"
                              : "Selecione a cor…"}
                        </option>
                        {cores.map((c) => (
                          <option key={c.cor} value={c.cor}>
                            {corLabel(c.cor, c.descCor)} · estoque {c.estoque}
                          </option>
                        ))}
                      </select>
                    </label>
                    {corEscolhida && (
                      <label className={styles.field}>
                        <span className={styles.label}>Quantidade (até {corEscolhida.estoque})</span>
                        <input
                          className={`${styles.input} ${styles.qtdeInput}`}
                          type="number"
                          min={1}
                          max={corEscolhida.estoque}
                          value={qtdeSelecionada}
                          onChange={(event) =>
                            setQtdeSelecionada(
                              Math.min(Math.max(1, Math.floor(Number(event.target.value)) || 1), corEscolhida.estoque)
                            )
                          }
                        />
                      </label>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={adicionarAoRascunho}
                      disabled={!corSelecionada}
                    >
                      Adicionar
                    </button>
                    <button
                      type="button"
                      className={styles.undoButton}
                      onClick={() => {
                        setProdutoSelecionado(null);
                        setCores([]);
                        setCorSelecionada("");
                        setQtdeSelecionada(1);
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {entrando.length > 0 && (
                <>
                  <div className={styles.cardHeader}>
                    <h2>No rascunho ({pecasEntrando} peça(s))</h2>
                  </div>
                  <div className={styles.itemList}>
                    {entrando.map((p) => (
                      <div
                        key={`${p.produto}|${p.cor}`}
                        className={`${styles.itemRow} ${styles.itemRowPendenteSaida}`}
                      >
                        <div>
                          <div className={styles.itemName}>
                            {p.descricao}
                            <span className={styles.pendenteBadge}>vai sair do estoque</span>
                          </div>
                          <div className={styles.itemCode}>
                            {p.produto} · {corLabel(p.cor, p.descCor)} · estoque atual {p.estoque}
                          </div>
                        </div>
                        <div className={styles.rowActions}>
                          <div className={styles.stepper} aria-label="Quantidade">
                            <button
                              type="button"
                              onClick={() => alterarQtdeRascunho(p, p.qtde - 1)}
                              disabled={p.qtde <= 1}
                              aria-label="Menos uma"
                            >
                              −
                            </button>
                            <span>{p.qtde}</span>
                            <button
                              type="button"
                              onClick={() => alterarQtdeRascunho(p, p.qtde + 1)}
                              disabled={p.qtde >= p.estoque}
                              aria-label="Mais uma"
                            >
                              +
                            </button>
                          </div>
                          <button type="button" className={styles.undoButton} onClick={() => tirarDoRascunho(p)}>
                            Tirar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        <section className={styles.listCard}>
          <div className={styles.cardHeader}>
            <h2>Em VM {filialAtual ? `· ${filialAtual.nome}` : ""}</h2>
            <span>{pecasEmVm} peça(s)</span>
          </div>

          {loading ? (
            <div className={styles.emptyState}>Carregando…</div>
          ) : !filialCod ? (
            <div className={styles.emptyState}>Escolha a filial para ver as peças em VM.</div>
          ) : itensDaFilial.length === 0 ? (
            <div className={styles.emptyState}>Nenhuma peça em VM nesta filial.</div>
          ) : (
            <div className={styles.itemList}>
              {itensDaFilial.map((item) => {
                const chave = buildVmKey(item.filial, item.produto, item.cor);
                const qtdeSaindo = saindo[chave];
                const marcado = qtdeSaindo !== undefined;
                return (
                  <div
                    key={chave}
                    className={`${styles.itemRow} ${marcado ? styles.itemRowPendenteEntrada : ""}`}
                  >
                    <div>
                      <div className={styles.itemName}>
                        {item.descricao}
                        <span className={styles.vmBadge}>VM {item.qtde}</span>
                        {marcado && (
                          <span className={styles.pendenteBadge}>
                            {qtdeSaindo === item.qtde ? "vai voltar ao estoque" : `${qtdeSaindo} vai(ão) voltar ao estoque`}
                          </span>
                        )}
                      </div>
                      <div className={styles.itemCode}>
                        {item.produto} · {corLabel(item.cor, item.descCor)}
                        {item.romaneio ? ` · romaneio ${item.romaneio}` : ""}
                      </div>
                    </div>
                    {marcado ? (
                      <div className={styles.rowActions}>
                        {item.qtde > 1 && (
                          <div className={styles.stepper} aria-label="Quantas voltam ao estoque">
                            <button
                              type="button"
                              onClick={() => ajustarRemocao(item, qtdeSaindo - 1)}
                              disabled={qtdeSaindo <= 1}
                              aria-label="Menos uma"
                            >
                              −
                            </button>
                            <span>{qtdeSaindo}</span>
                            <button
                              type="button"
                              onClick={() => ajustarRemocao(item, qtdeSaindo + 1)}
                              disabled={qtdeSaindo >= item.qtde}
                              aria-label="Mais uma"
                            >
                              +
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          className={styles.undoButton}
                          onClick={() => desmarcarRemocao(chave)}
                        >
                          Manter
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => marcarParaRemover(item)}
                        disabled={!podeMutar}
                      >
                        Tirar do VM
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className={styles.listCard}>
        <div className={styles.cardHeader}>
          <h2>Movimentos recentes</h2>
          <span>{movimentosDaFilial.length} registro(s)</span>
        </div>
        {movimentosDaFilial.length === 0 ? (
          <div className={styles.emptyState}>Nenhum movimento de VM registrado ainda.</div>
        ) : (
          <div className={styles.movList}>
            {movimentosDaFilial.map((m) => (
              <div key={m.id} className={styles.movRow}>
                <div>
                  <span className={m.direcao === "saida" ? styles.tagSaida : styles.tagEntrada}>
                    VM
                  </span>{" "}
                  <span className={styles.movMeta}>
                    {m.direcao === "saida" ? "saída · foi para exposição" : "entrada · voltou ao estoque"}
                  </span>{" "}
                  <strong>
                    {m.qtde > 1 ? `${m.qtde}× ` : ""}
                    {m.descricao}
                  </strong>
                  <div className={styles.movMeta}>
                    {m.produto} · {corLabel(m.cor, m.descCor)} · {m.filial}
                    {m.romaneio ? ` · romaneio ${m.romaneio}` : ""}
                  </div>
                </div>
                <div className={styles.movMeta}>
                  {dataHora(m.criadoEm)}
                  {m.usuario ? ` · ${m.usuario}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {preview && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>Confirmar movimento de estoque</h2>
            <p className={styles.modalIntro}>
              Em <strong>{preview.filialNome}</strong>, estas peças vão se mover no estoque por
              romaneio do tipo <strong>VM</strong>. A operação fica registrada no Extrato de Produto.
            </p>

            <div className={styles.tableScroll}>
              <table className={styles.movTable}>
                <thead>
                  <tr>
                    <th>Movimento</th>
                    <th>Produto</th>
                    <th>Cor</th>
                    <th className={styles.num}>Qtde</th>
                    <th className={styles.num}>Estoque</th>
                    <th className={styles.num}>Depois</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.linhas.map((linha) => (
                    <tr
                      key={`${linha.direcao}|${linha.produto}|${linha.cor}`}
                      className={linha.bloqueio ? styles.rowBloqueada : undefined}
                    >
                      <td>
                        <span
                          className={linha.direcao === "saida" ? styles.tagSaida : styles.tagEntrada}
                        >
                          VM
                        </span>{" "}
                        <span className={styles.movMeta}>
                          {linha.direcao === "saida" ? "saída" : "entrada"}
                        </span>
                      </td>
                      <td>
                        {linha.descricao}
                        <span className={styles.movMeta}> · {linha.produto}</span>
                        {linha.bloqueio && (
                          <span className={styles.bloqueioMotivo}>{linha.bloqueio}</span>
                        )}
                      </td>
                      <td>{corLabel(linha.cor, linha.descCor)}</td>
                      <td className={styles.num}>{linha.qtde}</td>
                      <td className={styles.num}>{linha.estoqueAtual}</td>
                      <td className={styles.num}>{linha.bloqueio ? "—" : linha.estoqueDepois}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.bloqueadas > 0 && (
              <div className={styles.error}>
                {preview.bloqueadas} linha(s) não serão executadas — veja o motivo na tabela.
              </div>
            )}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.undoButton}
                onClick={() => setPreview(null)}
                disabled={confirmando}
              >
                Voltar
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => void confirmar()}
                disabled={confirmando || preview.executaveis === 0}
              >
                {confirmando
                  ? "Movimentando estoque…"
                  : `Confirmar ${preview.executaveis} movimento(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {resultado && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>Movimento concluído</h2>
            <p className={styles.modalIntro}>
              Em <strong>{resultado.filialNome}</strong>:
            </p>
            <div className={styles.movList}>
              {resultado.direcoes.map((d) => (
                <div key={d.direcao} className={styles.movRow}>
                  <div>
                    <span className={d.direcao === "saida" ? styles.tagSaida : styles.tagEntrada}>
                      {d.tipo}
                    </span>{" "}
                    <span className={styles.movMeta}>{d.operacao}</span>{" "}
                    {d.erro ? (
                      <strong style={{ color: "#b91c1c" }}>{d.erro}</strong>
                    ) : (
                      <>
                        <strong>{d.itens} peça(s)</strong>
                        <div className={styles.movMeta}>Romaneio no extrato: {d.romaneio}</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {resultado.bloqueadas.length > 0 && (
              <div className={styles.error}>
                {resultado.bloqueadas.length} linha(s) não foram executadas:{" "}
                {resultado.bloqueadas
                  .map((l) => `${l.produto}/${l.cor} — ${l.bloqueio ?? "motivo não informado"}`)
                  .join(" · ")}
              </div>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => setResultado(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
