"use client";

/**
 * Imprimir Etiquetas — busca produto, mostra todas as cores, o usuário digita a
 * quantidade de etiquetas por cor e manda para a Zebra.
 *
 * Três caminhos de saída, todos a partir do MESMO desenho:
 *  1. Zebra Browser Print — manda o ZPL cru (barras desenhadas pela impressora);
 *  2. Baixar .zpl — para copiar direto na fila da impressora;
 *  3. Imprimir pelo navegador — folha em mm no driver ZDesigner, sem instalar nada.
 *
 * O código de barra usado é sempre o PREFERENCIAL (o menor/interno), conforme a
 * regra canônica do cadastro; a configuração permite trocar para o EAN.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import { canMutate, canSeeCusto } from "@/lib/auth/permissions";
import {
  ajustarTamanhoParaCaber,
  analisarBarras,
  analisarTextos,
  gerarZpl,
  montarFileiras,
} from "@/lib/etiquetas/zpl";
import {
  CONFIG_PADRAO,
  alturaConteudoMm,
  clonarConfig,
  larguraFileiraMm,
  type EtiquetaCompany,
  type EtiquetaConfig,
  type ItemEtiqueta,
} from "@/lib/etiquetas/tipos";

import ConfiguracaoEtiqueta from "./ConfiguracaoEtiqueta";
import CalibracaoEtiqueta from "./CalibracaoEtiqueta";
import EditorVisualEtiqueta from "./EditorVisualEtiqueta";
import EtiquetaSvg from "./EtiquetaSvg";
import ModalCustoProduto from "./ModalCustoProduto";
import styles from "./ImprimirEtiquetasPage.module.css";
import {
  calibrarMidia,
  enviarZpl,
  listarImpressoras,
  type StatusBrowserPrint,
  type ZebraDevice,
} from "./zebra-browser-print";

interface CorEtiqueta {
  cor: string;
  descCor: string;
  codigoBarra: string;
  ean: string;
  codigos: string[];
  estoque: number;
}

interface ProdutoEtiqueta {
  produto: string;
  descProduto: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  colecao: string;
  grade: string;
  tipo: string;
  inativo: boolean;
  cores: CorEtiqueta[];
}

interface SugestaoProduto {
  produto: string;
  descProduto: string;
  subgrupo: string;
  inativo: boolean;
  totalCores: number;
  corEncontrada: string | null;
  descCorEncontrada: string | null;
  codigoEncontrado: string | null;
  /** Só apareceu no repescão sem filtro de empresa (cadastrado em outra EMPRESA). */
  foraDoCatalogo?: boolean;
}

interface ItemFila {
  item: ItemEtiqueta;
  quantidade: number;
}

interface Props {
  companyKey: EtiquetaCompany;
}

/** Teto do caminho "imprimir pelo navegador" — acima disso o DOM fica pesado. */
const MAX_ETIQUETAS_NAVEGADOR = 900;

function chaveItem(produto: string, cor: string): string {
  return `${produto}|${cor}`;
}

/** '06' e '6' são a mesma cor no ERP — comparar como string pura falha. */
function mesmaCor(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && a.trim() !== "" && b.trim() !== "") {
    return na === nb;
  }
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function montarItem(produto: ProdutoEtiqueta, cor: CorEtiqueta): ItemEtiqueta {
  return {
    produto: produto.produto,
    descProduto: produto.descProduto,
    cor: cor.cor,
    descCor: cor.descCor,
    codigoBarra: cor.codigoBarra,
    grupo: produto.grupo,
    subgrupo: produto.subgrupo,
    linha: produto.linha,
    colecao: produto.colecao,
    grade: produto.grade,
    tipo: produto.tipo,
  };
}

export default function ImprimirEtiquetasPage({ companyKey }: Props) {
  const { user } = useAuth();
  const username = user?.username ?? "";
  /**
   * Custo é restrito (gerente e supervisor nunca veem) — mesma regra da tela
   * Alterar Custo / Preço, que as rotas `/api/precos/*` também aplicam no
   * servidor. Diretor abre a ficha, mas só de leitura.
   */
  const podeVerCusto = canSeeCusto(user);
  const podeAlterarCusto = podeVerCusto && canMutate(user);

  /** Produto com a ficha de custo/preço aberta (null = modal fechado). */
  const [produtoCusto, setProdutoCusto] = useState<{ produto: string; descProduto: string } | null>(
    null
  );

  const [termo, setTermo] = useState("");
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [buscando, setBuscando] = useState(false);
  /** Produtos abertos, o mais recente no topo. A fila sobrevive a todos eles. */
  const [produtos, setProdutos] = useState<ProdutoEtiqueta[]>([]);

  const [sugestoes, setSugestoes] = useState<SugestaoProduto[]>([]);
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false);
  const [indiceSugestao, setIndiceSugestao] = useState(-1);
  const [corDestacada, setCorDestacada] = useState<string | null>(null);
  const buscaRef = useRef<HTMLDivElement | null>(null);

  const [fila, setFila] = useState<Record<string, ItemFila>>({});
  const [qtdPadrao, setQtdPadrao] = useState(1);

  const [config, setConfig] = useState<EtiquetaConfig>(() => clonarConfig(CONFIG_PADRAO));
  const [configSalva, setConfigSalva] = useState<EtiquetaConfig>(() => clonarConfig(CONFIG_PADRAO));
  const [podeConfigurar, setPodeConfigurar] = useState(false);
  const [mostrarConfig, setMostrarConfig] = useState(true);
  const [mostrarAvancado, setMostrarAvancado] = useState(false);
  const [salvandoConfig, setSalvandoConfig] = useState(false);

  const [zebra, setZebra] = useState<StatusBrowserPrint | null>(null);
  const [impressoraUid, setImpressoraUid] = useState("");
  const [verificandoZebra, setVerificandoZebra] = useState(false);

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mostrarZpl, setMostrarZpl] = useState(false);
  const [mostrarDetalheAvisos, setMostrarDetalheAvisos] = useState(false);

  const folhaRef = useRef<HTMLDivElement | null>(null);
  const [preparandoFolha, setPreparandoFolha] = useState(false);

  /* ── configuração salva da empresa ───────────────────────────────────── */

  useEffect(() => {
    if (!username) return;
    let cancelado = false;
    (async () => {
      try {
        const resp = await fetch(`/api/etiquetas/config?company=${companyKey}`, {
          headers: { "x-auth-username": username },
        });
        const dados = await resp.json();
        if (!resp.ok) throw new Error(dados?.error ?? "Erro ao carregar a configuração.");
        if (cancelado) return;
        setConfig(dados.config);
        setConfigSalva(dados.config);
        setPodeConfigurar(Boolean(dados.podeConfigurar));
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Erro ao carregar a configuração.");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [companyKey, username]);

  /* ── Zebra Browser Print ─────────────────────────────────────────────── */

  const verificarZebra = useCallback(async () => {
    setVerificandoZebra(true);
    try {
      const status = await listarImpressoras();
      setZebra(status);
      const preferida =
        status.impressoras.find((i) => i.name === config.impressora.nomeImpressora) ??
        status.padrao ??
        status.impressoras[0];
      if (preferida) setImpressoraUid(preferida.uid);
    } finally {
      setVerificandoZebra(false);
    }
  }, [config.impressora.nomeImpressora]);

  useEffect(() => {
    void verificarZebra();
    // Só na montagem: reconsultar a cada mudança de config faria pedido à toa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const impressoraEscolhida: ZebraDevice | null = useMemo(() => {
    if (!zebra) return null;
    return zebra.impressoras.find((i) => i.uid === impressoraUid) ?? zebra.padrao ?? null;
  }, [zebra, impressoraUid]);

  /** Serviço rodando E com pelo menos uma impressora de verdade. */
  const zebraPronta = Boolean(zebra?.disponivel && zebra.impressoras.length > 0 && impressoraEscolhida);

  /* ── busca ───────────────────────────────────────────────────────────── */

  // Sugestões enquanto digita (300ms de folga, igual ao Produto Detalhado).
  useEffect(() => {
    const t = termo.trim();
    if (!username || t.length < 2) {
      setSugestoes([]);
      setMostrarSugestoes(false);
      return;
    }

    let ativo = true;
    const timer = window.setTimeout(async () => {
      try {
        const resp = await fetch(
          `/api/etiquetas/sugestoes?company=${companyKey}&q=${encodeURIComponent(t)}${
            incluirInativos ? "&inativos=1" : ""
          }`,
          { headers: { "x-auth-username": username }, cache: "no-store" }
        );
        if (!resp.ok || !ativo) return;
        const dados = await resp.json();
        if (!ativo) return;
        setSugestoes(dados.sugestoes ?? []);
        setMostrarSugestoes((dados.sugestoes ?? []).length > 0);
        setIndiceSugestao(-1);
      } catch {
        // digitar rápido cancela requisições — silêncio é o certo aqui
      }
    }, 300);

    return () => {
      ativo = false;
      window.clearTimeout(timer);
    };
  }, [termo, username, companyKey, incluirInativos]);

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    function aoClicarFora(evento: MouseEvent) {
      if (buscaRef.current && !buscaRef.current.contains(evento.target as Node)) {
        setMostrarSugestoes(false);
      }
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, []);

  /**
   * Abre um produto (com todas as cores) no topo da lista. Não fecha os
   * anteriores: dá para ir de produto em produto empilhando na fila.
   */
  const abrirProduto = useCallback(
    async (codigo: string, corParaDestacar: string | null = null) => {
      setBuscando(true);
      setErro(null);
      setMostrarSugestoes(false);
      try {
        const resp = await fetch("/api/etiquetas/produtos", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ company: companyKey, termo: codigo, incluirInativos, limite: 5 }),
        });
        const dados = await resp.json();
        if (!resp.ok) throw new Error(dados?.error ?? "Erro ao buscar o produto.");

        const encontrados: ProdutoEtiqueta[] = dados.produtos ?? [];
        const alvo = encontrados.find((p) => p.produto === codigo) ?? encontrados[0];
        if (!alvo) {
          setAviso("Produto não encontrado.");
          return;
        }
        setProdutos((atuais) => [alvo, ...atuais.filter((p) => p.produto !== alvo.produto)].slice(0, 8));
        setCorDestacada(corParaDestacar);
        setAviso(null);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao buscar o produto.");
      } finally {
        setBuscando(false);
      }
    },
    [username, companyKey, incluirInativos]
  );

  const escolherSugestao = useCallback(
    (sugestao: SugestaoProduto) => {
      setTermo("");
      setSugestoes([]);
      void abrirProduto(sugestao.produto, sugestao.corEncontrada);
    },
    [abrirProduto]
  );

  /** ↑ ↓ para navegar, Enter para abrir, Esc para fechar. */
  const aoTeclar = useCallback(
    (evento: React.KeyboardEvent<HTMLInputElement>) => {
      if (evento.key === "Escape") {
        setMostrarSugestoes(false);
        return;
      }
      if (!mostrarSugestoes || sugestoes.length === 0) {
        if (evento.key === "Enter" && termo.trim().length >= 2 && sugestoes.length === 1) {
          escolherSugestao(sugestoes[0]);
        }
        return;
      }
      if (evento.key === "ArrowDown") {
        evento.preventDefault();
        setIndiceSugestao((i) => (i + 1) % sugestoes.length);
      } else if (evento.key === "ArrowUp") {
        evento.preventDefault();
        setIndiceSugestao((i) => (i <= 0 ? sugestoes.length - 1 : i - 1));
      } else if (evento.key === "Enter") {
        evento.preventDefault();
        escolherSugestao(sugestoes[indiceSugestao >= 0 ? indiceSugestao : 0]);
      }
    },
    [mostrarSugestoes, sugestoes, indiceSugestao, termo, escolherSugestao]
  );

  /* ── fila de impressão ───────────────────────────────────────────────── */

  const definirQuantidade = useCallback(
    (produto: ProdutoEtiqueta, cor: CorEtiqueta, quantidade: number) => {
      const chave = chaveItem(produto.produto, cor.cor);
      setFila((atual) => {
        const proximo = { ...atual };
        const qtd = Math.max(0, Math.floor(quantidade));
        if (qtd <= 0) delete proximo[chave];
        else proximo[chave] = { item: montarItem(produto, cor), quantidade: qtd };
        return proximo;
      });
    },
    []
  );

  const quantidadeDe = useCallback(
    (produto: string, cor: string) => fila[chaveItem(produto, cor)]?.quantidade ?? 0,
    [fila]
  );

  const adicionarTodasAsCores = useCallback(
    (produto: ProdutoEtiqueta) => {
      setFila((atual) => {
        const proximo = { ...atual };
        for (const cor of produto.cores) {
          const chave = chaveItem(produto.produto, cor.cor);
          if (proximo[chave]) continue;
          proximo[chave] = { item: montarItem(produto, cor), quantidade: Math.max(1, qtdPadrao) };
        }
        return proximo;
      });
    },
    [qtdPadrao]
  );

  const preencherComEstoque = useCallback((produto: ProdutoEtiqueta) => {
    setFila((atual) => {
      const proximo = { ...atual };
      for (const cor of produto.cores) {
        const chave = chaveItem(produto.produto, cor.cor);
        const qtd = Math.floor(cor.estoque);
        if (qtd <= 0) delete proximo[chave];
        else proximo[chave] = { item: montarItem(produto, cor), quantidade: qtd };
      }
      return proximo;
    });
  }, []);

  const itensFila = useMemo(() => Object.entries(fila).map(([chave, v]) => ({ chave, ...v })), [fila]);
  const totalEtiquetas = useMemo(
    () => itensFila.reduce((soma, i) => soma + i.quantidade, 0),
    [itensFila]
  );

  /** Quantas etiquetas já estão na fila por produto — some no autocomplete. */
  const etiquetasPorProduto = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const { item, quantidade } of itensFila) {
      mapa[item.produto] = (mapa[item.produto] ?? 0) + quantidade;
    }
    return mapa;
  }, [itensFila]);

  /* ── ZPL ─────────────────────────────────────────────────────────────── */

  const resultadoZpl = useMemo(() => {
    if (itensFila.length === 0) return null;
    return gerarZpl(
      itensFila.map(({ item, quantidade }) => ({ item, quantidade })),
      config
    );
  }, [itensFila, config]);

  const itemExemplo: ItemEtiqueta | null = itensFila[0]?.item ?? null;
  const exemploPreview: ItemEtiqueta = itemExemplo ?? {
    produto: "N4.7H.0080",
    descProduto: "CP SILICONE IP 17 PRO MAX",
    cor: "06",
    descCor: "PRETO",
    codigoBarra: "050496",
    grupo: "ACESSORIOS",
    subgrupo: "CAPA P/ CELULAR",
    linha: "ELETRONICOS",
    colecao: "",
    grade: "",
    tipo: "",
  };

  const fileiras = useMemo(
    () =>
      montarFileiras(
        itensFila.map(({ item, quantidade }) => ({ item, quantidade })),
        config.colunas
      ),
    [itensFila, config.colunas]
  );

  // O código de barras cabe na largura? Simbologia larga ou módulo grande fazem
  // a Zebra cortar as barras sem avisar.
  const barras = useMemo(
    () =>
      analisarBarras(
        itensFila.map(({ item, quantidade }) => ({ item, quantidade })),
        config
      ),
    [itensFila, config]
  );

  // Idem para as linhas de texto: fonte alta demais ou "máx. caracteres"
  // generoso demais faz o texto invadir a etiqueta vizinha na mídia contínua.
  const linhasEstouram = useMemo(
    () =>
      analisarTextos(
        itensFila.map(({ item, quantidade }) => ({ item, quantidade })),
        config
      ),
    [itensFila, config]
  );

  /** Encolhe as fontes até tudo caber — sem cortar texto. */
  const ajustarParaCaber = useCallback(() => {
    setConfig((atual) =>
      ajustarTamanhoParaCaber(
        itensFila.map(({ item, quantidade }) => ({ item, quantidade })),
        atual
      )
    );
  }, [itensFila]);

  const alturaConteudo = alturaConteudoMm(config);
  const conteudoNaoCabe = alturaConteudo > config.alturaEtiquetaMm + 0.01;
  const larguraFileira = larguraFileiraMm(config);
  const fileiraNaoCabe = larguraFileira > config.impressora.larguraMidiaMm + 0.01;

  /**
   * Tudo que não cabe, numa lista só — a prévia mostra o resumo em uma linha e
   * guarda o detalhe atrás do "detalhes". Mais de um aviso aberto ao mesmo
   * tempo ocupava mais espaço que a própria etiqueta.
   */
  const problemas = useMemo(() => {
    const lista: Array<{ chave: string; resumo: string; detalhe: string; ajustavel: boolean }> = [];

    if (conteudoNaoCabe) {
      lista.push({
        chave: "altura",
        resumo: `O conteúdo passa ${(alturaConteudo - config.alturaEtiquetaMm).toFixed(1)}mm da altura`,
        detalhe: `Altura: o conteúdo ocupa ${alturaConteudo.toFixed(1)}mm e a etiqueta tem ${config.alturaEtiquetaMm}mm — a Zebra corta o que passar.`,
        ajustavel: true,
      });
    }
    for (const l of linhasEstouram) {
      lista.push({
        chave: `linha-${l.linhaId}`,
        resumo: `"${l.campoLabel}" passa ${(l.larguraEstimadaMm - l.larguraUtilMm).toFixed(1)}mm da largura`,
        detalhe: `"${l.campoLabel}": precisa de ${l.larguraEstimadaMm.toFixed(1)}mm e só há ${l.larguraUtilMm.toFixed(1)}mm — o texto invade a etiqueta vizinha.`,
        ajustavel: true,
      });
    }
    if (barras.estoura) {
      lista.push({
        chave: "barras",
        resumo: "O código de barras não cabe",
        detalhe: `Código de barras: precisa de ${barras.larguraMaxMm.toFixed(1)}mm e só há ${barras.larguraUtilMm.toFixed(1)}mm — as barras saem cortadas e nenhum leitor lê. Diminua a largura do módulo ou aumente a etiqueta.`,
        ajustavel: false,
      });
    } else if (barras.quietZoneCurta) {
      lista.push({
        chave: "silencio",
        resumo: "Pouco silêncio ao redor das barras",
        detalhe: `Código de barras: sobram ${barras.quietZoneMm.toFixed(1)}mm de silêncio de cada lado (as normas pedem 10 módulos). O leitor pode engasgar — diminua a largura do módulo.`,
        ajustavel: false,
      });
    }
    if (fileiraNaoCabe) {
      lista.push({
        chave: "fileira",
        resumo: "A fileira não cabe na mídia",
        detalhe: `Fileira: mede ${larguraFileira.toFixed(1)}mm e a mídia tem ${config.impressora.larguraMidiaMm}mm — reduza as colunas, a largura ou o espaço entre elas.`,
        ajustavel: false,
      });
    }
    return lista;
  }, [
    conteudoNaoCabe,
    alturaConteudo,
    config.alturaEtiquetaMm,
    config.impressora.larguraMidiaMm,
    linhasEstouram,
    barras,
    fileiraNaoCabe,
    larguraFileira,
  ]);

  const podeAjustar = podeConfigurar && problemas.some((p) => p.ajustavel);

  /* ── ações de impressão ──────────────────────────────────────────────── */

  const imprimirNaZebra = useCallback(async () => {
    if (!resultadoZpl || !impressoraEscolhida) return;
    setErro(null);
    setAviso(null);
    try {
      await enviarZpl(impressoraEscolhida, resultadoZpl.zpl);
      // Fila esvaziada só depois do envio dar certo: apertar de novo sem querer
      // reimprimia o lote inteiro. As quantidades voltam a vazio junto (elas
      // são a própria fila). Se der erro, a fila FICA — senão o trabalho de
      // montar o lote se perde justamente quando deu problema.
      setFila({});
      setAviso(
        `Enviado: ${resultadoZpl.totalEtiquetas} etiqueta(s) em ${resultadoZpl.totalFileiras} fileira(s) para ${impressoraEscolhida.name}. Fila limpa.`
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar para a impressora.");
    }
  }, [resultadoZpl, impressoraEscolhida]);

  /**
   * Ensina o passo do rolo para a impressora. Sem sensor calibrado o ^MNY não
   * tem referência e a impressão volta a andar de lugar a cada tiragem.
   */
  const calibrar = useCallback(async () => {
    if (!impressoraEscolhida) return;
    setErro(null);
    setAviso(null);
    try {
      await calibrarMidia(impressoraEscolhida);
      setAviso(
        'Calibração enviada — a impressora vai avançar algumas etiquetas medindo o vão entre elas. Espere parar e imprima de novo.'
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao calibrar a impressora.');
    }
  }, [impressoraEscolhida]);

  const baixarZpl = useCallback(() => {
    if (!resultadoZpl) return;
    const blob = new Blob([resultadoZpl.zpl], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `etiquetas-${companyKey}-${resultadoZpl.totalEtiquetas}.zpl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [resultadoZpl, companyKey]);

  const imprimirPeloNavegador = useCallback(() => {
    if (totalEtiquetas === 0) return;
    if (totalEtiquetas > MAX_ETIQUETAS_NAVEGADOR) {
      setErro(
        `A impressão pelo navegador aguenta até ${MAX_ETIQUETAS_NAVEGADOR} etiquetas por vez. Use o caminho ZPL ou divida o lote.`
      );
      return;
    }
    setErro(null);
    // Monta a folha escondida e só então abre a caixa de impressão.
    setPreparandoFolha(true);
  }, [totalEtiquetas]);

  useEffect(() => {
    if (!preparandoFolha) return;
    const timer = window.setTimeout(() => {
      const folha = folhaRef.current;
      if (!folha) {
        setPreparandoFolha(false);
        return;
      }
      const alturaFileira = config.alturaEtiquetaMm + config.espacoLinhasMm;
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument;
      if (!doc) {
        document.body.removeChild(iframe);
        setPreparandoFolha(false);
        return;
      }

      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title>
<style>
  @page { size: ${config.impressora.larguraMidiaMm}mm ${alturaFileira}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .fileira {
    width: ${config.impressora.larguraMidiaMm}mm;
    height: ${alturaFileira}mm;
    display: flex;
    gap: ${config.espacoColunasMm}mm;
    padding-left: ${config.margemEsquerdaMm}mm;
    box-sizing: border-box;
    break-after: page;
    page-break-after: always;
    overflow: hidden;
  }
  .fileira:last-child { break-after: auto; page-break-after: auto; }
  .fileira svg { display: block; }
</style></head><body>${folha.innerHTML}</body></html>`);
      doc.close();

      const disparar = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } finally {
          window.setTimeout(() => {
            if (iframe.parentNode) document.body.removeChild(iframe);
            setPreparandoFolha(false);
            // Pode ser esvaziada aqui sem medo: o HTML da folha já foi copiado
            // para dentro do iframe (doc.write acima), então limpar a fila não
            // apaga o que está sendo impresso.
            setFila({});
            setAviso("Enviado para a impressão do navegador. Fila limpa.");
          }, 1000);
        }
      };
      // Dá um respiro para o layout do iframe assentar antes do print().
      window.setTimeout(disparar, 250);
    }, 60);

    return () => window.clearTimeout(timer);
  }, [preparandoFolha, config]);

  /* ── salvar configuração ─────────────────────────────────────────────── */

  const configMudou = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(configSalva),
    [config, configSalva]
  );

  /** Só a calibração mudou — o card de imprimir oferece salvar sem abrir o editor. */
  const calibracaoMudou = useMemo(
    () => JSON.stringify(config.calibracao) !== JSON.stringify(configSalva.calibracao),
    [config.calibracao, configSalva.calibracao]
  );

  const salvarConfig = useCallback(
    async (resetar = false) => {
      setSalvandoConfig(true);
      setErro(null);
      try {
        const resp = await fetch("/api/etiquetas/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-auth-username": username },
          body: JSON.stringify({ company: companyKey, config, resetar }),
        });
        const dados = await resp.json();
        if (!resp.ok) throw new Error(dados?.error ?? "Erro ao salvar a configuração.");
        setConfig(dados.config);
        setConfigSalva(dados.config);
        setAviso(resetar ? "Modelo voltou ao padrão." : "Modelo salvo para toda a empresa.");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao salvar a configuração.");
      } finally {
        setSalvandoConfig(false);
      }
    },
    [companyKey, config, username]
  );

  /* ── render ──────────────────────────────────────────────────────────── */

  const semCodigo = resultadoZpl?.semBarcode ?? [];

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Imprimir Etiquetas</h1>
        <p className={styles.subtitle}>
          Busque o produto, escolha as cores e a quantidade. O código impresso é sempre o
          preferencial do cadastro (o menor/interno), como no relatório do Linx.
        </p>
      </div>

      {erro ? <div className={styles.erro}>{erro}</div> : null}
      {aviso ? <div className={styles.ok}>{aviso}</div> : null}

      <div className={styles.colunas}>
        {/* ─────────────── coluna esquerda: busca ─────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>1. Produtos</h2>
            <div className={styles.buscaContainer} ref={buscaRef}>
              <div className={styles.buscaWrapper}>
                <span className={styles.buscaIcone} aria-hidden>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </span>
                <input
                  className={styles.buscaInput}
                  placeholder="Nome, código ou código de barras"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  onKeyDown={aoTeclar}
                  onFocus={() => {
                    if (sugestoes.length > 0) setMostrarSugestoes(true);
                  }}
                  autoComplete="off"
                />
                {termo ? (
                  <button
                    type="button"
                    className={styles.buscaLimpar}
                    onClick={() => {
                      setTermo("");
                      setSugestoes([]);
                      setMostrarSugestoes(false);
                    }}
                    aria-label="Limpar busca"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M12 4L4 12M4 4L12 12"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                ) : null}
              </div>

              {mostrarSugestoes && sugestoes.length > 0 ? (
                <div className={styles.sugestoes}>
                  {sugestoes.map((s, i) => {
                    const naFila = etiquetasPorProduto[s.produto] ?? 0;
                    return (
                      <button
                        key={`${s.produto}-${s.corEncontrada ?? "todas"}`}
                        type="button"
                        className={`${styles.sugestaoItem} ${i === indiceSugestao ? styles.sugestaoAtiva : ""}`}
                        onMouseEnter={() => setIndiceSugestao(i)}
                        onClick={() => escolherSugestao(s)}
                      >
                        <div className={styles.sugestaoNome}>
                          {s.descProduto || s.produto}
                          {s.inativo ? <span className={styles.tagInativo}>inativo</span> : null}
                          {s.foraDoCatalogo ? (
                            <span className={styles.tagOutraEmpresa} title="Cadastrado em outra empresa do Linx">
                              outra empresa
                            </span>
                          ) : null}
                          {naFila > 0 ? (
                            <span className={styles.tagFila}>{naFila} na fila</span>
                          ) : null}
                        </div>
                        <div className={styles.sugestaoMeta}>
                          {s.produto}
                          {s.subgrupo ? ` · ${s.subgrupo}` : ""}
                          {` · ${s.totalCores} cor${s.totalCores === 1 ? "" : "es"}`}
                          {s.codigoEncontrado
                            ? ` · barra ${s.codigoEncontrado}${
                                s.descCorEncontrada ? ` (${s.descCorEncontrada})` : ""
                              }`
                            : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className={styles.checkLinha}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={incluirInativos}
                  onChange={(e) => setIncluirInativos(e.target.checked)}
                />
                incluir produtos inativos
              </label>
              <label className={styles.check}>
                quantidade padrão
                <input
                  className={styles.numero}
                  type="number"
                  min={1}
                  value={qtdPadrao}
                  onChange={(e) => setQtdPadrao(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>

            {produtos.length > 0 ? (
              <div className={styles.resultados}>
                {produtos.map((produto) => (
                  <div key={produto.produto} className={styles.produtoBloco}>
                    <div className={styles.produtoHead}>
                      <div>
                        <div className={styles.produtoNome}>
                          {produto.descProduto || produto.produto}{" "}
                          {produto.inativo ? <span className={styles.tagInativo}>inativo</span> : null}
                          {etiquetasPorProduto[produto.produto] ? (
                            <span className={styles.tagFila}>
                              {etiquetasPorProduto[produto.produto]} na fila
                            </span>
                          ) : null}
                          {/* Colado no nome de propósito: o fluxo é conferir o
                              custo do que acabou de chegar e imprimir na hora.
                              Só quem pode ver custo enxerga o botão. */}
                          {podeVerCusto ? (
                            <button
                              type="button"
                              className={styles.botaoCusto}
                              onClick={() =>
                                setProdutoCusto({
                                  produto: produto.produto,
                                  descProduto: produto.descProduto || produto.produto,
                                })
                              }
                              title="Ver e alterar custo/preço deste produto (mesma regra e histórico da tela Alterar Custo / Preço)"
                            >
                              Alterar Custo
                            </button>
                          ) : null}
                        </div>
                        {/* A contagem de cores fica à vista de propósito: é
                            como conferir num relance se vieram TODAS as cores
                            do cadastro (a tela não depende de estoque). */}
                        <div className={styles.produtoMeta}>
                          {produto.produto}
                          {produto.subgrupo ? ` · ${produto.subgrupo}` : ""}
                          {produto.grade ? ` · ${produto.grade}` : ""}
                          {` · ${produto.cores.length} cor${produto.cores.length === 1 ? "" : "es"} no cadastro`}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button
                          type="button"
                          className={styles.botaoMini}
                          onClick={() => adicionarTodasAsCores(produto)}
                        >
                          todas as cores × {qtdPadrao}
                        </button>
                        <button
                          type="button"
                          className={styles.botaoMini}
                          onClick={() => preencherComEstoque(produto)}
                          title="Uma etiqueta por peça em estoque"
                        >
                          usar estoque
                        </button>
                        <button
                          type="button"
                          className={styles.botaoFechar}
                          onClick={() =>
                            setProdutos((atuais) =>
                              atuais.filter((p) => p.produto !== produto.produto)
                            )
                          }
                          title="Fechar este produto (não mexe na fila)"
                          aria-label="Fechar produto"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Larguras fixas: com vários produtos abertos ao mesmo tempo,
                        as colunas de todos os blocos ficam na mesma posição em vez
                        de cada tabela se dimensionar sozinha. */}
                    <table className={`${styles.tabela} ${styles.tabelaCores}`}>
                      <colgroup>
                        <col style={{ width: 64 }} />
                        <col />
                        <col style={{ width: 132 }} />
                        <col style={{ width: 96 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Cor</th>
                          <th>Descrição</th>
                          <th>Código de barra</th>
                          <th className={styles.tdNum}>Etiquetas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {produto.cores.map((cor) => {
                          const qtd = quantidadeDe(produto.produto, cor.cor);
                          // Quando o usuário buscou por um código de barra, a cor
                          // daquele código fica marcada para não precisar caçar.
                          const encontrada =
                            corDestacada !== null &&
                            produtos[0]?.produto === produto.produto &&
                            mesmaCor(cor.cor, corDestacada);
                          return (
                            <tr
                              key={`${produto.produto}-${cor.cor}`}
                              className={[
                                qtd > 0 ? styles.linhaAtiva : "",
                                encontrada ? styles.linhaEncontrada : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              <td className={styles.mono}>{cor.cor || "—"}</td>
                              <td>{cor.descCor || <span className={styles.semCodigo}>sem descrição</span>}</td>
                              <td className={styles.mono}>
                                {cor.codigoBarra || (
                                  <span className={styles.semCodigo}>sem código</span>
                                )}
                              </td>
                              <td className={styles.tdNum}>
                                <input
                                  className={styles.numero}
                                  type="number"
                                  min={0}
                                  // Zero aparece VAZIO: quem clica quer digitar a
                                  // quantidade direto, e um "0" no campo obriga a
                                  // apagar antes (ou vira "05").
                                  value={qtd || ""}
                                  placeholder="0"
                                  onChange={(e) =>
                                    definirQuantidade(produto, cor, Number(e.target.value) || 0)
                                  }
                                />
                              </td>
                            </tr>
                          );
                        })}
                        {produto.cores.length === 0 ? (
                          <tr>
                            <td colSpan={4} className={styles.semCodigo}>
                              Produto sem cores cadastradas.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.filaVazia}>
                {buscando
                  ? "Abrindo produto…"
                  : "Digite o nome, o código ou passe o leitor no código de barras. As sugestões aparecem enquanto você digita."}
              </div>
            )}
          </div>

          {/* ─────────────── fila ─────────────── */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>2. Fila de impressão</h2>
              {itensFila.length > 0 ? (
                <button type="button" className={styles.botaoMini} onClick={() => setFila({})}>
                  limpar tudo
                </button>
              ) : null}
            </div>

            {itensFila.length === 0 ? (
              <div className={styles.filaVazia}>
                Nenhuma etiqueta na fila. Coloque uma quantidade em alguma cor acima.
              </div>
            ) : (
              <>
                <table className={styles.tabela}>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Cor</th>
                      <th>Código</th>
                      <th className={styles.tdNum}>Qtd</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {itensFila.map(({ chave, item, quantidade }) => (
                      <tr key={chave}>
                        <td>
                          <div>{item.descProduto || item.produto}</div>
                          <div className={styles.produtoMeta}>{item.produto}</div>
                        </td>
                        <td>{item.descCor || item.cor || "—"}</td>
                        <td className={styles.mono}>
                          {item.codigoBarra || <span className={styles.semCodigo}>sem código</span>}
                        </td>
                        <td className={styles.tdNum}>
                          <input
                            className={styles.numero}
                            type="number"
                            min={0}
                            value={quantidade}
                            onChange={(e) => {
                              const qtd = Math.max(0, Number(e.target.value) || 0);
                              setFila((atual) => {
                                const proximo = { ...atual };
                                if (qtd <= 0) delete proximo[chave];
                                else proximo[chave] = { item, quantidade: qtd };
                                return proximo;
                              });
                            }}
                          />
                        </td>
                        <td className={styles.tdNum}>
                          <button
                            type="button"
                            className={styles.botaoLink}
                            onClick={() =>
                              setFila((atual) => {
                                const proximo = { ...atual };
                                delete proximo[chave];
                                return proximo;
                              })
                            }
                          >
                            remover
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className={styles.totalLinha}>
                  <span className={styles.totalNumero}>{totalEtiquetas}</span>
                  <span>
                    etiqueta(s) · {fileiras.length} fileira(s) de {config.colunas} coluna(s) ·{" "}
                    {(fileiras.length * (config.alturaEtiquetaMm + config.espacoLinhasMm)).toFixed(0)}
                    mm de papel
                  </span>
                </div>

                {semCodigo.length > 0 ? (
                  <div className={styles.aviso}>
                    {semCodigo.length} item(ns) sem código válido para{" "}
                    {config.barcode.simbologia}: saem sem as barras.{" "}
                    {semCodigo
                      .slice(0, 4)
                      .map((s) => `${s.produto}/${s.cor || "—"}`)
                      .join(", ")}
                    {semCodigo.length > 4 ? "…" : ""}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* ─────────────── coluna direita: preview + impressão ─────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Prévia</h2>
              <span className={styles.produtoMeta}>
                {config.larguraEtiquetaMm} × {config.alturaEtiquetaMm} mm
              </span>
            </div>

            <div className={styles.previewArea}>
              <div className={styles.previewEtiqueta}>
                <EtiquetaSvg
                  item={exemploPreview}
                  config={config}
                  comBorda
                  larguraCss={`${Math.min(360, config.larguraEtiquetaMm * 9)}px`}
                />
              </div>
              <div className={styles.previewLegenda}>
                {itemExemplo ? "Primeiro item da fila" : "Exemplo (a fila está vazia)"} — ampliado
              </div>

              {fileiras.length > 0 ? (
                <>
                  <div className={styles.previewFileira}>
                    {fileiras[0].map((item, i) => (
                      <EtiquetaSvg
                        key={`${item.produto}-${item.cor}-${i}`}
                        item={item}
                        config={config}
                        comBorda
                        larguraCss={`${Math.min(150, config.larguraEtiquetaMm * 4)}px`}
                      />
                    ))}
                  </div>
                  <div className={styles.previewLegenda}>
                    Primeira fileira ({fileiras[0].length} de {config.colunas} colunas)
                  </div>
                </>
              ) : null}
            </div>

            {/* Um aviso só, numa linha. O detalhe (quantos mm faltam em cada
                coisa) fica escondido: na hora de calibrar interessa saber que
                não cabe e ter o botão de resolver, não ler três parágrafos. */}
            {problemas.length > 0 ? (
              <div className={barras.estoura ? styles.erro : styles.aviso}>
                <div className={styles.avisoLinha}>
                  <span>
                    {problemas.length === 1 ? problemas[0].resumo : `${problemas.length} coisas não cabem na etiqueta`}
                  </span>
                  {podeAjustar ? (
                    <button type="button" className={styles.botaoLink} onClick={ajustarParaCaber}>
                      ajustar pra caber
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.botaoLink}
                    onClick={() => setMostrarDetalheAvisos((v) => !v)}
                  >
                    {mostrarDetalheAvisos ? "menos" : "detalhes"}
                  </button>
                </div>
                {mostrarDetalheAvisos ? (
                  <ul className={styles.avisoDetalhe}>
                    {problemas.map((p) => (
                      <li key={p.chave}>{p.detalhe}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>3. Imprimir</h2>

            <div className={styles.statusLinha}>
              <span
                className={`${styles.bolinha} ${zebraPronta ? styles.bolinhaOn : styles.bolinhaOff}`}
              />
              {zebraPronta ? (
                <>
                  <span>Zebra Browser Print conectado</span>
                  <select
                    className={styles.select}
                    value={impressoraUid}
                    onChange={(e) => setImpressoraUid(e.target.value)}
                  >
                    {zebra!.impressoras.map((i) => (
                      <option key={i.uid} value={i.uid}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <span>
                  {zebra?.disponivel ? "Serviço rodando, sem impressora" : zebra ? "Serviço não encontrado" : "Procurando o Zebra Browser Print…"}
                </span>
              )}
              <button
                type="button"
                className={styles.botaoMini}
                onClick={() => void verificarZebra()}
                disabled={verificandoZebra}
              >
                {verificandoZebra ? "verificando…" : "verificar"}
              </button>
            </div>

            {!zebraPronta && zebra?.motivo ? (
              <div className={styles.aviso}>{zebra.motivo}</div>
            ) : null}

            <div className={styles.acoes}>
              <button
                type="button"
                className={`${styles.botao} ${styles.botaoPrimario}`}
                onClick={() => void imprimirNaZebra()}
                disabled={!resultadoZpl || !zebraPronta}
                title={
                  zebraPronta
                    ? "Manda o ZPL direto para a impressora"
                    : "Precisa do Zebra Browser Print com uma impressora reconhecida"
                }
              >
                Imprimir na Zebra
              </button>
              <button
                type="button"
                className={styles.botao}
                onClick={imprimirPeloNavegador}
                disabled={totalEtiquetas === 0 || preparandoFolha}
              >
                {preparandoFolha ? "Preparando…" : "Imprimir pelo navegador"}
              </button>
              <button
                type="button"
                className={styles.botao}
                onClick={() => void calibrar()}
                disabled={!zebraPronta}
                title="Ensina o passo do rolo para a impressora — resolve a impressão que anda de lugar a cada tiragem"
              >
                Calibrar mídia
              </button>
              <button
                type="button"
                className={styles.botao}
                onClick={baixarZpl}
                disabled={!resultadoZpl}
              >
                Baixar .zpl
              </button>
              <button
                type="button"
                className={styles.botao}
                onClick={() => setMostrarZpl((v) => !v)}
                disabled={!resultadoZpl}
              >
                {mostrarZpl ? "Esconder ZPL" : "Ver ZPL"}
              </button>
            </div>

            <div className={styles.produtoMeta}>
              &quot;Imprimir pelo navegador&quot; abre a caixa do Windows: escolha a{" "}
              <strong>ZDesigner ZD230-203dpi ZPL</strong>, margens zero e sem ajuste de escala.
            </div>

            {/* Fica junto dos botões de imprimir de propósito: calibrar é
                imprimir → olhar → ajustar → imprimir de novo. */}
            <CalibracaoEtiqueta
              config={config}
              onChange={setConfig}
              podeConfigurar={podeConfigurar}
            />

            {calibracaoMudou ? (
              <div className={styles.acoes}>
                <button
                  type="button"
                  className={`${styles.botao} ${styles.botaoPrimario}`}
                  onClick={() => void salvarConfig(false)}
                  disabled={!podeConfigurar || salvandoConfig}
                >
                  {salvandoConfig ? "Salvando…" : "Salvar modelo"}
                </button>
                <button
                  type="button"
                  className={styles.botao}
                  onClick={() => setConfig(clonarConfig(configSalva))}
                >
                  Descartar alterações
                </button>
              </div>
            ) : null}

            {mostrarZpl && resultadoZpl ? (
              <pre className={styles.zplBox}>{resultadoZpl.zpl}</pre>
            ) : null}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Editor da etiqueta</h2>
              <button
                type="button"
                className={styles.botaoMini}
                onClick={() => setMostrarConfig((v) => !v)}
              >
                {mostrarConfig ? "fechar" : "abrir"}
              </button>
            </div>

            <div className={styles.produtoMeta}>
              {config.nomeModelo} · {config.colunas} coluna(s) · {config.impressora.dpi}dpi ·{" "}
              {config.barcode.simbologia}
            </div>

            {mostrarConfig ? (
              <>
                <EditorVisualEtiqueta
                  config={config}
                  onChange={setConfig}
                  item={exemploPreview}
                  podeConfigurar={podeConfigurar}
                />

                <button
                  type="button"
                  className={styles.botaoLink}
                  onClick={() => setMostrarAvancado((v) => !v)}
                >
                  {mostrarAvancado
                    ? "esconder configuração avançada"
                    : "usar configuração avançada (todas as opções: impressora, colunas, margens…)"}
                </button>

                {mostrarAvancado ? (
                  <ConfiguracaoEtiqueta
                    config={config}
                    onChange={setConfig}
                    podeConfigurar={podeConfigurar}
                  />
                ) : null}

                <div className={styles.acoes}>
                  <button
                    type="button"
                    className={`${styles.botao} ${styles.botaoPrimario}`}
                    onClick={() => void salvarConfig(false)}
                    disabled={!podeConfigurar || salvandoConfig || !configMudou}
                  >
                    {salvandoConfig ? "Salvando…" : "Salvar modelo"}
                  </button>
                  <button
                    type="button"
                    className={styles.botao}
                    onClick={() => setConfig(clonarConfig(configSalva))}
                    disabled={!configMudou}
                  >
                    Descartar alterações
                  </button>
                  <button
                    type="button"
                    className={styles.botao}
                    onClick={() => void salvarConfig(true)}
                    disabled={!podeConfigurar || salvandoConfig}
                  >
                    Voltar ao padrão
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Ficha de custo/preço do produto — mesmas rotas e mesmo histórico da
          tela Alterar Custo / Preço, sem sair da tela de etiquetas. */}
      {produtoCusto ? (
        <ModalCustoProduto
          companyKey={companyKey}
          username={username}
          produto={produtoCusto.produto}
          descProduto={produtoCusto.descProduto}
          podeGravar={podeAlterarCusto}
          onFechar={() => setProdutoCusto(null)}
        />
      ) : null}

      {/* Folha oculta: só existe enquanto o usuário manda imprimir pelo navegador. */}
      {preparandoFolha ? (
        <div className={styles.folhaOculta} ref={folhaRef} aria-hidden>
          {fileiras.map((fileira, i) => (
            <div key={`f-${i}`} className="fileira">
              {fileira.map((item, j) => (
                <EtiquetaSvg key={`f-${i}-${j}`} item={item} config={config} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
