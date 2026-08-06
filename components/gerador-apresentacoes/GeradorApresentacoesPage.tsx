"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
import { PAINEL_COLECAO_CODES } from "@/lib/config/painel-colecoes";
import { getCurrentMonthRange, formatDateForQuery } from "@/lib/utils/date";
import {
  DECK_PALETTE_AUTO,
  DECK_PALETTE_OPTIONS,
  deckPaperColor,
  painelPaletteForColecao,
  resolveDeckPalette,
} from "@/lib/presentations/palettes";
import { presentationBrandName } from "@/lib/presentations/brand";
import {
  COLECAO_COMPLETA_ID,
  COMPARATIVO_COLECOES_ID,
  COMPARATIVO_RESUMIDO_ID,
  PRODUTO_GIRO_ID,
  TOP_PRODUTOS_ID,
  getPresentationMeta,
  getPresentationTypesForCompany,
} from "@/lib/presentations/registry";
import type { ColecaoPresentationPayload } from "@/lib/repositories/colecaoPresentation";
import type { ComparativoColecoesPayload } from "@/lib/repositories/comparativoColecoes";
import type { ComparativoResumidoPayload } from "@/lib/repositories/comparativoResumido";
import type { ProdutoGiroPresentationPayload } from "@/lib/repositories/produtoGiroPresentation";
import type { TopProdutosPayload } from "@/lib/repositories/topProdutosPresentation";

import ColecaoDeck from "./ColecaoDeck";
import ComparativoDeck from "./ComparativoDeck";
import ComparativoResumidoDeck from "./ComparativoResumidoDeck";
import ProdutoGiroDeck from "./ProdutoGiroDeck";
import TopProdutosDeck from "./TopProdutosDeck";
import styles from "./GeradorApresentacoesPage.module.css";

interface ProductPick {
  id: string;
  name: string;
}

interface GeradorApresentacoesPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

export default function GeradorApresentacoesPage({
  companyKey,
  companyName,
}: GeradorApresentacoesPageProps) {
  const initialRange = useMemo<DateRangeValue>(() => {
    const r = getCurrentMonthRange();
    return { startDate: r.start, endDate: r.end };
  }, []);

  // Marca da empresa aberta: em NERD o logo/wordmark é NERD, não SCARF·ME.
  const brandName = useMemo(() => presentationBrandName(companyName), [companyName]);

  const availableTypes = useMemo(() => getPresentationTypesForCompany(companyKey), [companyKey]);
  const [presentationTypeId, setPresentationTypeId] = useState<string>(
    () => availableTypes[0]?.id ?? PRODUTO_GIRO_ID
  );
  // Se a empresa não tem o tipo selecionado (ex.: NERD só tem Giro), cai no primeiro válido.
  useEffect(() => {
    if (!availableTypes.some((t) => t.id === presentationTypeId)) {
      setPresentationTypeId(availableTypes[0]?.id ?? PRODUTO_GIRO_ID);
    }
  }, [availableTypes, presentationTypeId]);
  const meta = useMemo(
    () => getPresentationMeta(presentationTypeId, companyKey),
    [presentationTypeId, companyKey]
  );
  const isGiro = presentationTypeId === PRODUTO_GIRO_ID;
  const isTopProdutos = presentationTypeId === TOP_PRODUTOS_ID;
  /**
   * Capa do Top Produtos sorteada entre as fotos de coleção só existe onde há
   * coleção com foto cadastrada (ScarfMe). No NERD a capa é sempre upload do
   * usuário, só desta geração.
   */
  const isTopProdutosCapaColecao = isTopProdutos && companyKey === "scarfme";
  // Dimensão das páginas do Top Produtos (o payload traz a oficial; aqui é só
  // para o texto de ajuda, que aparece antes de gerar).
  const topDimSingular = companyKey === "nerd" ? "grupo" : "subgrupo";
  const topDimPlural = `${topDimSingular}s`;
  const isColecaoType = presentationTypeId === COLECAO_COMPLETA_ID;
  const isComparativo = presentationTypeId === COMPARATIVO_COLECOES_ID;
  const isResumido = presentationTypeId === COMPARATIVO_RESUMIDO_ID;
  // Tipos multi-coleção usam uma foto (recorte) por coleção selecionada.
  const isMultiCover = isComparativo || isResumido;

  // Filtros
  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [filial, setFilial] = useState<string | null>(null);
  const [colecoes, setColecoes] = useState<string[]>([]);
  const [optColecoes, setOptColecoes] = useState<MultiSelectOption[]>([]);
  const [loadingColecoes, setLoadingColecoes] = useState(false);
  const [coverTitle, setCoverTitle] = useState("");
  // Paleta do deck de coleção: "auto" = a mesma que a coleção tem no Painel de
  // Coleções; qualquer outro id = escolha manual do usuário.
  const [paletteId, setPaletteId] = useState<string>(DECK_PALETTE_AUTO);

  // ---- Tabela de produtos do tipo #1 ----
  // Ambos vêm do backend (as linhas mudam), então trocá-los exige gerar de novo —
  // diferente da paleta, que re-tinge o deck na hora.
  const [todosProdutos, setTodosProdutos] = useState(false);
  const [produtoTotal, setProdutoTotal] = useState(false);

  // ---- Destaque opcional (Relatório Completo de Coleção) ----
  // Um termo (ex.: "Dracena") reconhece produtos DENTRO da coleção selecionada
  // com a mesma regra do Gerador de Relatórios; a lista reconhecida vira chips
  // que o usuário pode desmarcar antes de gerar.
  const [destaqueTermo, setDestaqueTermo] = useState("");
  const [destaqueNome, setDestaqueNome] = useState("");
  const [destaqueMatches, setDestaqueMatches] = useState<ProductPick[]>([]);
  const [destaqueOff, setDestaqueOff] = useState<string[]>([]);
  const [destaqueLoading, setDestaqueLoading] = useState(false);

  // Imagens (assets salvos no banco)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [logoUpdatedAt, setLogoUpdatedAt] = useState<string | null>(null);
  const [coverUpdatedAt, setCoverUpdatedAt] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Filtros do tipo Giro (mesmas regras da página Produto Giro) ----
  const [porCor, setPorCor] = useState(true);
  const [giroProdutos, setGiroProdutos] = useState<ProductPick[]>([]);
  const [giroSearch, setGiroSearch] = useState("");
  const [giroSearchResults, setGiroSearchResults] = useState<ProductPick[]>([]);
  const [giroSearchOpen, setGiroSearchOpen] = useState(false);
  const [giroGrupos, setGiroGrupos] = useState<string[]>([]);
  const [giroSubgrupos, setGiroSubgrupos] = useState<string[]>([]);
  const [giroColecoes, setGiroColecoes] = useState<string[]>([]);
  const [giroGrades, setGiroGrades] = useState<string[]>([]);
  const [optGrupos, setOptGrupos] = useState<string[]>([]);
  const [optSubgrupos, setOptSubgrupos] = useState<string[]>([]);
  const [optGiroGrades, setOptGiroGrades] = useState<string[]>([]);
  const [optGiroColecoes, setOptGiroColecoes] = useState<string[]>([]);
  // Capa do Giro fica só em memória (escolhida a cada geração; não persiste).
  const [giroCoverDataUrl, setGiroCoverDataUrl] = useState<string | null>(null);
  const giroCoverInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Capa do Top Produtos ----
  // O deck não é de uma coleção específica, então a capa PADRÃO é uma foto
  // sorteada entre as capas de coleção já enviadas. O usuário pode escolher outra
  // na lista, sortear de novo ou subir a própria imagem (essa fica só em memória).
  const [topCoverRefs, setTopCoverRefs] = useState<string[]>([]);
  const [topCoverRef, setTopCoverRef] = useState<string | null>(null);
  const [topCoverDataUrl, setTopCoverDataUrl] = useState<string | null>(null);
  const [topCoverUpload, setTopCoverUpload] = useState<string | null>(null);
  const topCoverInputRef = useRef<HTMLInputElement | null>(null);

  // Resultado
  const [report, setReport] = useState<ColecaoPresentationPayload | null>(null);
  const [comparativo, setComparativo] = useState<ComparativoColecoesPayload | null>(null);
  const [resumido, setResumido] = useState<ComparativoResumidoPayload | null>(null);
  const [giro, setGiro] = useState<ProdutoGiroPresentationPayload | null>(null);
  const [topProdutos, setTopProdutos] = useState<TopProdutosPayload | null>(null);
  const [coversByCode, setCoversByCode] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const deckRef = useRef<HTMLDivElement | null>(null);

  const startStr = formatDateForQuery(range.startDate);
  const endStr = formatDateForQuery(range.endDate);

  // ---- preset "Coleções do Painel" ----
  // Mesma lista do Painel de Coleções (lib/config/painel-colecoes.ts). Um clique
  // marca todas; o usuário segue livre para adicionar/remover no próprio filtro.
  const isPainelPresetOn = useMemo(() => {
    if (colecoes.length === 0) return false;
    const selecionadas = new Set(colecoes.map((c) => c.trim().toUpperCase()));
    return PAINEL_COLECAO_CODES.every((code) => selecionadas.has(code));
  }, [colecoes]);

  const togglePainelPreset = useCallback(() => {
    setColecoes((prev) => {
      const doPainel = new Set(PAINEL_COLECAO_CODES);
      if (isPainelPresetOn) {
        // Desliga: tira só os códigos do painel, preservando o que foi adicionado à mão.
        return prev.filter((c) => !doPainel.has(c.trim().toUpperCase()));
      }
      const jaSelecionadas = new Set(prev.map((c) => c.trim().toUpperCase()));
      return [...prev, ...PAINEL_COLECAO_CODES.filter((code) => !jaSelecionadas.has(code))];
    });
  }, [isPainelPresetOn]);

  // Descrição de TODA coleção cadastrada (tabela mestre COLECOES), independente de
  // venda. A lista de opções vem das VENDAS do período; sem este mapa, uma coleção
  // sem venda na janela (ex.: SUELEN ARRIGO) apareceria só como "Y7".
  const [descByCode, setDescByCode] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    fetch(`/api/products/colecoes/descricoes?company=${companyKey}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: Record<string, string> } | null) => {
        if (active && j?.data) setDescByCode(j.data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [companyKey]);

  /** Rótulo "DESCRIÇÃO (CÓDIGO)" a partir da tabela mestre; só o código se não houver. */
  const labelFromMaster = useCallback(
    (code: string) => {
      const cod = code.trim().toUpperCase();
      const desc = (descByCode[cod] ?? "").trim();
      return desc && desc.toUpperCase() !== cod ? `${desc} (${cod})` : code;
    },
    [descByCode]
  );

  // Toda coleção selecionada entra na lista de opções, mesmo sem venda no período —
  // senão o usuário não conseguiria enxergá-la nem desmarcá-la.
  const colecaoOptions = useMemo<MultiSelectOption[]>(() => {
    const conhecidas = new Set(optColecoes.map((o) => o.value.trim().toUpperCase()));
    const extras = colecoes
      .filter((code) => !conhecidas.has(code.trim().toUpperCase()))
      .map((code) => ({ value: code, label: labelFromMaster(code) }));
    return extras.length > 0 ? [...optColecoes, ...extras] : optColecoes;
  }, [optColecoes, colecoes, labelFromMaster]);

  // Coleção "âncora" = a única selecionada (capa/título ligam a ela).
  const singleColecao = colecoes.length === 1 ? colecoes[0] : null;
  const singleColecaoLabel = useMemo(() => {
    if (!singleColecao) return "";
    const opt = colecaoOptions.find((o) => o.value === singleColecao);
    const label = opt?.label ?? labelFromMaster(singleColecao);
    // label vem como "descrição (código)" — usa a descrição pura no título.
    return label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
  }, [singleColecao, colecaoOptions, labelFromMaster]);

  // ---- paleta do deck (Relatório Completo de Coleção) ----
  // "Automática" = a MESMA paleta que a coleção tem no card do Painel de Coleções
  // (mapeada pelo código, ver `painelPaletteForColecao`). Coleção fora do painel
  // (ou seleção múltipla, sem coleção-âncora) cai no coral histórico.
  const paletteColecaoCode = singleColecao ?? report?.collection.code ?? null;
  const painelPalette = useMemo(
    () => painelPaletteForColecao(paletteColecaoCode),
    [paletteColecaoCode]
  );
  const activePalette = useMemo(
    () => resolveDeckPalette(paletteId, paletteColecaoCode),
    [paletteId, paletteColecaoCode]
  );

  // ---- opções de coleção ----
  const loadColecoes = useCallback(async () => {
    setLoadingColecoes(true);
    try {
      const params = new URLSearchParams({ company: companyKey, includeDescriptions: "1" });
      if (filial) params.set("filial", filial);
      params.set("start", startStr);
      params.set("end", endStr);
      const res = await fetch(`/api/products/colecoes?${params}`, { cache: "no-store" });
      const json = (await res.json()) as { data?: MultiSelectOption[] };
      setOptColecoes(json.data ?? []);
    } catch {
      setOptColecoes([]);
    } finally {
      setLoadingColecoes(false);
    }
  }, [companyKey, filial, startStr, endStr]);

  useEffect(() => {
    void loadColecoes();
  }, [loadColecoes]);

  // ---- destaque: reconhecimento dos produtos DENTRO da coleção selecionada ----
  // Mesmo endpoint/função que o deck usa para montar o slide, então a prévia
  // abaixo é exatamente o conjunto que vai entrar na apresentação.
  const colecoesKey = colecoes.join("|");
  useEffect(() => {
    if (!isColecaoType) return;
    const termo = destaqueTermo.trim();
    if (termo.length < 2 || colecoes.length === 0) {
      setDestaqueMatches([]);
      setDestaqueLoading(false);
      return;
    }
    let cancelled = false;
    setDestaqueLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ company: companyKey, termo });
      colecoes.forEach((c) => params.append("colecao", c));
      fetch(`/api/gerador-apresentacoes/colecao-produtos?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((json: { data?: Array<{ productId: string; nome: string }> } | null) => {
          if (cancelled) return;
          setDestaqueMatches(
            (json?.data ?? []).map((d) => ({ id: d.productId, name: d.nome || d.productId }))
          );
        })
        .catch(() => {
          if (!cancelled) setDestaqueMatches([]);
        })
        .finally(() => {
          if (!cancelled) setDestaqueLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // colecoesKey entra como dependência estável (o array muda de identidade a cada render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isColecaoType, companyKey, destaqueTermo, colecoesKey, colecoes.length]);

  // Trocar o termo (ou a coleção) recomeça com todos os reconhecidos marcados.
  useEffect(() => {
    setDestaqueOff([]);
  }, [destaqueTermo, colecoesKey]);

  const destaqueSelecionados = useMemo(
    () => destaqueMatches.filter((m) => !destaqueOff.includes(m.id)),
    [destaqueMatches, destaqueOff]
  );
  const toggleDestaqueProduto = useCallback((id: string) => {
    setDestaqueOff((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  // ---- assets (logo global + capa da coleção âncora) ----
  const loadAssets = useCallback(async () => {
    try {
      const params = new URLSearchParams({ company: companyKey });
      if (singleColecao) params.set("colecao", singleColecao);
      const res = await fetch(`/api/gerador-apresentacoes/assets?${params}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { logo: string | null; cover: string | null };
      setLogoDataUrl(json.logo ?? null);
      setCoverDataUrl(json.cover ?? null);
    } catch {
      // silencioso
    }
  }, [companyKey, singleColecao]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  // ---- capa do Top Produtos: lista de capas disponíveis + sorteio inicial ----
  useEffect(() => {
    if (!isTopProdutosCapaColecao) return;
    let cancelled = false;
    fetch(`/api/gerador-apresentacoes/assets?company=${companyKey}&list=covers`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { covers?: string[] } | null) => {
        if (cancelled) return;
        const covers = json?.covers ?? [];
        setTopCoverRefs(covers);
        // Sorteia a capa padrão só na primeira carga; escolha do usuário manda.
        setTopCoverRef((prev) => {
          if (prev && covers.includes(prev)) return prev;
          if (covers.length === 0) return null;
          return covers[Math.floor(Math.random() * covers.length)];
        });
      })
      .catch(() => {
        if (!cancelled) setTopCoverRefs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isTopProdutosCapaColecao, companyKey]);

  // Baixa o base64 da capa escolhida/sorteada.
  useEffect(() => {
    if (!isTopProdutosCapaColecao || !topCoverRef) {
      if (!topCoverRef) setTopCoverDataUrl(null);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/gerador-apresentacoes/assets?company=${companyKey}&colecao=${encodeURIComponent(topCoverRef)}`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { cover?: string | null } | null) => {
        if (!cancelled) setTopCoverDataUrl(json?.cover ?? null);
      })
      .catch(() => {
        if (!cancelled) setTopCoverDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isTopProdutosCapaColecao, companyKey, topCoverRef]);

  const sortearTopCover = useCallback(() => {
    if (topCoverRefs.length === 0) return;
    setTopCoverUpload(null);
    setTopCoverRef((prev) => {
      if (topCoverRefs.length === 1) return topCoverRefs[0];
      const outras = topCoverRefs.filter((c) => c !== prev);
      return outras[Math.floor(Math.random() * outras.length)];
    });
  }, [topCoverRefs]);

  const onPickTopCover = async (file: File | undefined) => {
    if (!file) return;
    try {
      setTopCoverUpload(await readFileAsDataUrl(file));
    } catch {
      setError("Não foi possível ler a imagem.");
    } finally {
      if (topCoverInputRef.current) topCoverInputRef.current.value = "";
    }
  };

  /** Capa que vai pro deck: upload do usuário vence a capa sorteada/escolhida. */
  const topCoverEffective = topCoverUpload ?? topCoverDataUrl;

  // ---- opções dos filtros do Giro (mesmo escopo da página Produto Giro) ----
  useEffect(() => {
    if (!isGiro) return;
    let cancelled = false;
    const params = new URLSearchParams({ company: companyKey, start: startStr, end: endStr });
    if (filial) params.set("filial", filial);
    const qs = params.toString();
    const load = (path: string, setter: (v: string[]) => void) =>
      fetch(`/api/products/${path}?${qs}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { data?: string[] }) => {
          if (!cancelled) setter(Array.isArray(json.data) ? json.data : []);
        })
        .catch(() => {
          if (!cancelled) setter([]);
        });

    setOptGrupos([]);
    setOptSubgrupos([]);
    setOptGiroGrades([]);
    setOptGiroColecoes([]);
    void load("subgrupos", setOptSubgrupos);
    if (companyKey === "nerd") {
      void load("grupos", setOptGrupos);
    } else {
      void load("colecoes", setOptGiroColecoes);
      void load("grades", setOptGiroGrades);
    }
    return () => {
      cancelled = true;
    };
  }, [isGiro, companyKey, filial, startStr, endStr]);

  // ---- busca de produtos (picker) — debounce + /api/products/search ----
  useEffect(() => {
    if (!isGiro) return;
    const term = giroSearch.trim();
    if (term.length < 2) {
      setGiroSearchResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/products/search?q=${encodeURIComponent(term)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { data?: Array<{ productId: string; productName: string }> }) => {
          if (cancelled) return;
          setGiroSearchResults(
            (json.data ?? []).map((d) => ({ id: d.productId.trim(), name: d.productName || d.productId }))
          );
        })
        .catch(() => {
          if (!cancelled) setGiroSearchResults([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isGiro, giroSearch]);

  const addGiroProduto = useCallback((p: ProductPick) => {
    setGiroProdutos((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setGiroSearch("");
    setGiroSearchResults([]);
    setGiroSearchOpen(false);
  }, []);
  const removeGiroProduto = useCallback((id: string) => {
    setGiroProdutos((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const onPickGiroCover = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setGiroCoverDataUrl(dataUrl);
    } catch {
      setError("Não foi possível ler a imagem.");
    } finally {
      if (giroCoverInputRef.current) giroCoverInputRef.current.value = "";
    }
  };

  // Comparativo: carrega as capas (recortes) de TODAS as coleções selecionadas
  // — reusa as imagens já enviadas por coleção; serve tanto ao preview do
  // uploader quanto ao deck.
  const loadCoversForSelection = useCallback(async () => {
    if (colecoes.length === 0) {
      setCoversByCode({});
      return;
    }
    const entries = await Promise.all(
      colecoes.map(async (code) => {
        try {
          const r = await fetch(
            `/api/gerador-apresentacoes/assets?company=${companyKey}&colecao=${encodeURIComponent(code)}`,
            { cache: "no-store" }
          );
          if (!r.ok) return [code, null] as const;
          const j = (await r.json()) as { cover: string | null };
          return [code, j.cover ?? null] as const;
        } catch {
          return [code, null] as const;
        }
      })
    );
    setCoversByCode(Object.fromEntries(entries));
  }, [colecoes, companyKey]);

  useEffect(() => {
    if (
      presentationTypeId === COMPARATIVO_COLECOES_ID ||
      presentationTypeId === COMPARATIVO_RESUMIDO_ID
    ) {
      void loadCoversForSelection();
    }
  }, [presentationTypeId, loadCoversForSelection]);

  // Upload/troca da capa de UMA coleção específica (recorte de fundo transparente).
  const [uploadingCoverCode, setUploadingCoverCode] = useState<string | null>(null);
  const uploadCoverFor = useCallback(
    async (code: string, file: File | undefined) => {
      if (!file) return;
      setUploadingCoverCode(code);
      setError(null);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const res = await fetch("/api/gerador-apresentacoes/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company: companyKey, kind: "cover", ref: code, dataUrl }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Erro ao salvar imagem.");
        setCoversByCode((prev) => ({ ...prev, [code]: dataUrl }));
        if (code === singleColecao) setCoverDataUrl(dataUrl);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao salvar a capa.");
      } finally {
        setUploadingCoverCode(null);
      }
    },
    [companyKey, singleColecao]
  );

  const uploadAsset = useCallback(
    async (kind: "logo" | "cover", file: File) => {
      const dataUrl = await readFileAsDataUrl(file);
      const body: Record<string, unknown> = { company: companyKey, kind, dataUrl };
      if (kind === "cover") body.ref = singleColecao;
      const res = await fetch("/api/gerador-apresentacoes/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Erro ao salvar imagem.");
      if (kind === "logo") {
        setLogoDataUrl(dataUrl);
        setLogoUpdatedAt(json.updatedAt ?? null);
      } else {
        setCoverDataUrl(dataUrl);
        setCoverUpdatedAt(json.updatedAt ?? null);
      }
    },
    [companyKey, singleColecao]
  );

  const onPickLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploadingLogo(true);
    setError(null);
    try {
      await uploadAsset("logo", file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar o logo.");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const onPickCover = async (file: File | undefined) => {
    if (!file) return;
    if (!singleColecao) {
      setError("Selecione exatamente uma coleção antes de enviar a capa.");
      if (coverInputRef.current) coverInputRef.current.value = "";
      return;
    }
    setUploadingCover(true);
    setError(null);
    try {
      await uploadAsset("cover", file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar a capa.");
    } finally {
      setUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  // Descrição de uma coleção pelo código (títulos do comparativo e cards de imagem).
  // Cai na tabela mestre quando a coleção não vendeu no período (não está em optColecoes).
  const labelForCode = useCallback(
    (code: string) => {
      const opt = optColecoes.find((o) => o.value === code);
      const label = opt?.label ?? labelFromMaster(code);
      return label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
    },
    [optColecoes, labelFromMaster]
  );

  // ---- gerar ----
  const handleGenerate = useCallback(async () => {
    if (isTopProdutos) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/gerador-apresentacoes/top-produtos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company: companyKey,
            filial,
            range: { start: startStr, end: endStr },
          }),
        });
        const json = (await res.json()) as { data?: TopProdutosPayload; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Erro ao gerar a apresentação.");
        setTopProdutos(json.data ?? null);
        setReport(null);
        setComparativo(null);
        setResumido(null);
        setGiro(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao gerar a apresentação.");
        setTopProdutos(null);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (isGiro) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/gerador-apresentacoes/produto-giro", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company: companyKey,
            filial,
            porCor,
            produtoIds: giroProdutos.map((p) => p.id),
            grupos: giroGrupos,
            subgrupos: giroSubgrupos,
            colecoes: giroColecoes,
            grades: giroGrades,
            coverTitle: coverTitle || undefined,
            range: { start: startStr, end: endStr },
          }),
        });
        const json = (await res.json()) as { data?: ProdutoGiroPresentationPayload; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Erro ao gerar a apresentação.");
        setGiro(json.data ?? null);
        setReport(null);
        setComparativo(null);
        setResumido(null);
        setTopProdutos(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao gerar a apresentação.");
        setGiro(null);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (colecoes.length === 0) {
      setError("Selecione ao menos uma coleção.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (presentationTypeId === COMPARATIVO_COLECOES_ID) {
        const res = await fetch("/api/gerador-apresentacoes/comparativo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company: companyKey,
            filial,
            range: { start: startStr, end: endStr },
            colecoes: colecoes.map((code) => ({ code, label: labelForCode(code) })),
          }),
        });
        const json = (await res.json()) as { data?: ComparativoColecoesPayload; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Erro ao gerar o comparativo.");
        const data = json.data ?? null;
        setComparativo(data);
        setReport(null);
        setResumido(null);
        setGiro(null);
        setTopProdutos(null);
        // Carrega as capas de todas as coleções do deck.
        if (data) {
          const entries = await Promise.all(
            data.slides.map(async (s) => {
              try {
                const r = await fetch(
                  `/api/gerador-apresentacoes/assets?company=${companyKey}&colecao=${encodeURIComponent(s.code)}`,
                  { cache: "no-store" }
                );
                if (!r.ok) return [s.code, null] as const;
                const j = (await r.json()) as { cover: string | null };
                return [s.code, j.cover ?? null] as const;
              } catch {
                return [s.code, null] as const;
              }
            })
          );
          setCoversByCode(Object.fromEntries(entries));
        }
        return;
      }

      if (presentationTypeId === COMPARATIVO_RESUMIDO_ID) {
        const res = await fetch("/api/gerador-apresentacoes/comparativo-resumido", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company: companyKey,
            filial,
            range: { start: startStr, end: endStr },
            colecoes: colecoes.map((code) => ({ code, label: labelForCode(code) })),
          }),
        });
        const json = (await res.json()) as { data?: ComparativoResumidoPayload; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Erro ao gerar o comparativo resumido.");
        const data = json.data ?? null;
        setResumido(data);
        setReport(null);
        setComparativo(null);
        setGiro(null);
        setTopProdutos(null);
        // Carrega as fotos (recortes) de todas as coleções do resumo.
        if (data) {
          const entries = await Promise.all(
            data.cards.map(async (c) => {
              try {
                const r = await fetch(
                  `/api/gerador-apresentacoes/assets?company=${companyKey}&colecao=${encodeURIComponent(c.code)}`,
                  { cache: "no-store" }
                );
                if (!r.ok) return [c.code, null] as const;
                const j = (await r.json()) as { cover: string | null };
                return [c.code, j.cover ?? null] as const;
              } catch {
                return [c.code, null] as const;
              }
            })
          );
          setCoversByCode(Object.fromEntries(entries));
        }
        return;
      }

      // Destaque só viaja quando há termo E pelo menos um produto reconhecido
      // marcado — desmarcar tudo equivale a não pedir destaque.
      const termoDestaque = destaqueTermo.trim();
      const pedeDestaque = termoDestaque.length >= 2 && destaqueSelecionados.length > 0;

      const res = await fetch("/api/gerador-apresentacoes/colecao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: companyKey,
          filial,
          colecoes,
          collectionLabel: singleColecaoLabel || undefined,
          range: { start: startStr, end: endStr },
          todosProdutos,
          produtoTotal,
          destaque: pedeDestaque
            ? {
                termo: termoDestaque,
                nome: destaqueNome.trim() || undefined,
                produtoIds: destaqueSelecionados.map((p) => p.id),
              }
            : undefined,
        }),
      });
      const json = (await res.json()) as { data?: ColecaoPresentationPayload; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Erro ao gerar a apresentação.");
      setReport(json.data ?? null);
      setComparativo(null);
      setResumido(null);
      setGiro(null);
      setTopProdutos(null);
      // Produto reconhecido no cadastro mas sem venda no período não rende slide —
      // avisa em vez de sumir com o destaque silenciosamente.
      if (pedeDestaque && json.data && !json.data.destaque) {
        setError(
          `Nenhum dos produtos de “${termoDestaque}” teve venda na coleção nesse período — o slide de destaque não entrou no deck.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao gerar a apresentação.");
      setReport(null);
      setComparativo(null);
      setResumido(null);
    } finally {
      setLoading(false);
    }
  }, [
    isGiro,
    isTopProdutos,
    colecoes,
    companyKey,
    filial,
    porCor,
    giroProdutos,
    giroGrupos,
    giroSubgrupos,
    giroColecoes,
    giroGrades,
    coverTitle,
    todosProdutos,
    produtoTotal,
    destaqueTermo,
    destaqueNome,
    destaqueSelecionados,
    singleColecaoLabel,
    startStr,
    endStr,
    presentationTypeId,
    labelForCode,
  ]);

  // ---- export PDF (mesmo pipeline do Relatório Claude) ----
  const handleExportPdf = useCallback(async () => {
    const deckElement = deckRef.current;
    if ((!report && !comparativo && !resumido && !giro && !topProdutos) || !deckElement) return;
    const slideElements = Array.from(deckElement.querySelectorAll<HTMLElement>("[data-pdf-slide]"));
    if (slideElements.length === 0) return;

    setExportingPdf(true);
    try {
      await document.fonts.ready;
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      // Slides variam de altura conforme os dados (ex.: tabela de lojas/produtos
      // sem limite de linhas). Forçar height fixo (720px) cortava esse conteúdo
      // e cada página saía com uma proporção diferente. Aqui a altura fica livre
      // (min-height 720 preserva o layout padrão) e cada página do PDF nasce com
      // o tamanho exato do slide (full-bleed), então nada é cortado nem sai
      // desproporcional entre os slides.
      // Full-bleed: sem margem. A página do PDF nasce com o tamanho exato do
      // slide e a imagem cobre 100% dela — nada de moldura branca em volta.
      const marginMm = 0;
      const pageWidthMm = 297;
      const usableWidthMm = pageWidthMm - marginMm * 2;

      // Fundo do canvas = "papel" do deck. No deck de coleção ele depende da
      // paleta ativa (o coral tinha #fffdfc fixo, que sujava as outras paletas).
      const canvasBackground = report
        ? deckPaperColor(activePalette)
        : topProdutos
          ? "#ffffff"
          : "#fffdfc";

      const canvases: HTMLCanvasElement[] = [];
      for (const slideElement of slideElements) {
        const canvas = await html2canvas(slideElement, {
          backgroundColor: canvasBackground,
          scale: Math.min(window.devicePixelRatio || 1, 2),
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          windowWidth: Math.max(slideElement.scrollWidth, 1440),
          windowHeight: Math.max(slideElement.scrollHeight, 900),
          onclone: (cloneDoc) => {
            cloneDoc.querySelectorAll<HTMLElement>("[data-pdf-slide]").forEach((element) => {
              // Deck com tamanho FIXO (data-pdf-width/height, ex.: Top Produtos em
              // 1280×905) sai no tamanho exato do modelo. Os demais mantêm a altura
              // livre (min-height 720), porque o conteúdo varia por slide.
              const fixedW = element.dataset.pdfWidth;
              const fixedH = element.dataset.pdfHeight;
              element.style.width = `${fixedW || 1280}px`;
              if (fixedH) {
                element.style.height = `${fixedH}px`;
                element.style.minHeight = `${fixedH}px`;
                element.style.maxHeight = `${fixedH}px`;
              } else {
                element.style.minHeight = "720px";
                element.style.height = "auto";
              }
              element.style.margin = "0";
              element.style.boxShadow = "none";
              element.style.borderRadius = "0";
            });
            cloneDoc.querySelectorAll<HTMLElement>("*[style]").forEach((el) => {
              const wVal = el.style.width ? parseFloat(el.style.width) : null;
              const hVal = el.style.height ? parseFloat(el.style.height) : null;
              if ((wVal !== null && wVal <= 0) || (hVal !== null && hVal <= 0)) {
                el.style.backgroundImage = "none";
                el.style.background = "transparent";
              }
            });

            // html2canvas 1.x ignora `object-fit` em <img> e estica a imagem
            // para preencher a caixa — logo, capa e o círculo saíam deformados
            // no PDF. Converte cada imagem com object-fit num <div> equivalente
            // usando background-image + background-size (que o html2canvas
            // respeita), mantendo a MESMA caixa que aparece no HTML. Roda depois
            // do resize do slide para 1280px, então as medidas computadas já
            // refletem o layout final.
            const view = cloneDoc.defaultView;
            if (view) {
              cloneDoc.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
                const cs = view.getComputedStyle(img);
                const fit = cs.objectFit;
                if (fit !== "contain" && fit !== "cover") return;
                if (!img.src) return;
                const div = cloneDoc.createElement("div");
                div.style.width = cs.width;
                div.style.height = cs.height;
                div.style.backgroundImage = `url("${img.src}")`;
                div.style.backgroundSize = fit;
                div.style.backgroundPosition = cs.objectPosition || "center";
                div.style.backgroundRepeat = "no-repeat";
                div.style.borderRadius = cs.borderRadius;
                div.style.border = cs.border;
                div.style.display = cs.display === "inline" ? "block" : cs.display;
                div.style.flexShrink = cs.flexShrink;
                div.style.margin = cs.margin;
                // A <img> pode estar POSICIONADA (ex.: a capa do comparativo é
                // absoluta dentro do canvas do slide). Sem copiar position/left/top
                // o div substituto virava estático e ia parar no canto superior
                // esquerdo, por cima do título. left/top computados já são os
                // valores usados em px; right/bottom são zerados para não conflitar.
                div.style.position = cs.position;
                if (cs.position !== "static") {
                  div.style.left = cs.left;
                  div.style.top = cs.top;
                  div.style.right = "auto";
                  div.style.bottom = "auto";
                  div.style.zIndex = cs.zIndex;
                }
                img.parentNode?.replaceChild(div, img);
              });
            }
          },
        });
        canvases.push(canvas);
      }

      const firstDrawHeightMm = usableWidthMm * (canvases[0].height / canvases[0].width);
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: [pageWidthMm, firstDrawHeightMm + marginMm * 2],
      });

      for (const [index, canvas] of canvases.entries()) {
        const drawHeightMm = usableWidthMm * (canvas.height / canvas.width);
        if (index > 0) {
          doc.addPage([pageWidthMm, drawHeightMm + marginMm * 2]);
        }
        doc.addImage(canvas.toDataURL("image/png"), "PNG", marginMm, marginMm, usableWidthMm, drawHeightMm, undefined, "FAST");
        canvas.width = 0;
        canvas.height = 0;
      }

      const baseName = topProdutos
        ? `top-produtos-${topProdutos.period.start}-${topProdutos.period.end}`
        : giro
        ? `giro-${(giro.title || "produtos").toLowerCase()}-${giro.period.start}-${giro.period.end}`
        : comparativo
          ? `comparativo-colecoes-${comparativo.period.start}-${comparativo.period.end}`
          : resumido
            ? `comparativo-resumido-${resumido.period.start}-${resumido.period.end}`
            : `apresentacao-${report?.collection.code || "colecao"}-${report?.period.start}-${report?.period.end}`;
      const safeName = baseName.replace(/[^\w-]+/g, "_").slice(0, 100);
      doc.save(`${safeName}.pdf`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erro ao exportar PDF");
    } finally {
      setExportingPdf(false);
    }
  }, [report, comparativo, resumido, giro, topProdutos, activePalette]);

  const hasResult = Boolean(report || comparativo || resumido || giro || topProdutos);

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Gerador de Apresentações</h1>
        <p className={styles.subtitle}>
          Escolha o tipo de apresentação, aplique os filtros, envie as imagens e gere um deck de
          slides pronto para exportar em PDF. {companyName}.
        </p>
      </header>

      {/* Tipo de apresentação */}
      <section className={styles.panel}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Tipo de apresentação</label>
          <select
            className={styles.select}
            value={presentationTypeId}
            onChange={(e) => setPresentationTypeId(e.target.value)}
          >
            {availableTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {meta?.description && <p className={styles.hint}>{meta.description}</p>}
      </section>

      {/* Filtros */}
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Filtros</h2>
        <div className={styles.filtersGrid}>
          {!isGiro && meta?.supportedFilters.includes("colecao") && (
            <div className={styles.field}>
              <MultiSelectFilter
                label="Coleção"
                value={colecoes}
                options={colecaoOptions}
                onChange={setColecoes}
                onOpen={() => void loadColecoes()}
                loading={loadingColecoes}
              />
              {companyKey === "scarfme" && (
                <button
                  type="button"
                  className={`${styles.presetBtn} ${isPainelPresetOn ? styles.presetBtnOn : ""}`}
                  onClick={togglePainelPreset}
                  aria-pressed={isPainelPresetOn}
                  title={
                    isPainelPresetOn
                      ? "Remover as coleções do Painel da seleção"
                      : "Selecionar as mesmas coleções do Painel de Coleções"
                  }
                >
                  {isPainelPresetOn ? "✓" : "+"} Coleções do Painel ({PAINEL_COLECAO_CODES.length})
                </button>
              )}
            </div>
          )}
          {meta?.supportedFilters.includes("periodo") && (
            <DateRangeFilter value={range} onChange={setRange} label="Período" />
          )}
          {meta?.supportedFilters.includes("filial") && (
            <FilialFilter companyKey={companyKey} value={filial} onChange={setFilial} module="sales" />
          )}
          {isGiro && companyKey === "nerd" && optGrupos.length > 0 && (
            <MultiSelectFilter label="Grupo" value={giroGrupos} options={optGrupos} onChange={setGiroGrupos} />
          )}
          {isGiro && optSubgrupos.length > 0 && (
            <MultiSelectFilter label="Subgrupo" value={giroSubgrupos} options={optSubgrupos} onChange={setGiroSubgrupos} />
          )}
          {isGiro && companyKey !== "nerd" && optGiroColecoes.length > 0 && (
            <MultiSelectFilter label="Coleção" value={giroColecoes} options={optGiroColecoes} onChange={setGiroColecoes} />
          )}
          {isGiro && companyKey !== "nerd" && optGiroGrades.length > 0 && (
            <MultiSelectFilter label="Grade" value={giroGrades} options={optGiroGrades} onChange={setGiroGrades} />
          )}
          {isColecaoType && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Paleta de cores (opcional)</label>
              <select
                className={styles.select}
                value={paletteId}
                onChange={(e) => setPaletteId(e.target.value)}
              >
                <option value={DECK_PALETTE_AUTO}>
                  {painelPalette
                    ? `Automática — ${painelPalette.name} (Painel de Coleções)`
                    : "Automática — Coral SCARF·ME (fora do Painel)"}
                </option>
                {DECK_PALETTE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.palette.name}
                  </option>
                ))}
              </select>
              <div className={styles.paletteRow} aria-hidden="true">
                <span
                  className={styles.paletteSwatch}
                  style={{ background: `#${activePalette.primary}` }}
                />
                <span
                  className={styles.paletteSwatch}
                  style={{ background: `#${activePalette.accent}` }}
                />
                <span
                  className={styles.paletteSwatch}
                  style={{ background: `#${activePalette.tint}` }}
                />
                <span
                  className={styles.paletteSwatch}
                  style={{ background: `#${activePalette.ink}` }}
                />
                <span className={styles.paletteName}>{activePalette.name}</span>
              </div>
            </div>
          )}
          {(isColecaoType || isGiro || isTopProdutos) && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Título da capa (opcional)</label>
              <input
                className={styles.input}
                value={coverTitle}
                placeholder={
                  isTopProdutos
                    ? "Campeões de venda"
                    : isGiro
                      ? "Ex.: Pashminas Lisas"
                      : singleColecaoLabel || "Ex.: Copa Galisteu"
                }
                onChange={(e) => setCoverTitle(e.target.value)}
              />
            </div>
          )}
        </div>

        {isGiro && (
          <div className={styles.field} style={{ marginTop: 16 }}>
            <label className={styles.fieldLabel}>Produtos específicos (opcional)</label>
            <div style={{ position: "relative" }}>
              <input
                className={styles.input}
                value={giroSearch}
                placeholder="Busque por nome, código ou código de barras…"
                onChange={(e) => {
                  setGiroSearch(e.target.value);
                  setGiroSearchOpen(true);
                }}
                onFocus={() => setGiroSearchOpen(true)}
              />
              {giroSearchOpen && giroSearchResults.length > 0 && (
                <div className={styles.searchResults}>
                  {giroSearchResults.slice(0, 30).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={styles.searchResultItem}
                      onClick={() => addGiroProduto(p)}
                    >
                      <span className={styles.searchResultName}>{p.name}</span>
                      <span className={styles.searchResultId}>{p.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {giroProdutos.length > 0 && (
              <div className={styles.chips}>
                {giroProdutos.map((p) => (
                  <span key={p.id} className={styles.chip}>
                    {p.name}
                    <button type="button" className={styles.chipX} onClick={() => removeGiroProduto(p.id)} aria-label="Remover">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={porCor} onChange={(e) => setPorCor(e.target.checked)} />
              Detalhar por cor (cada item vira produto × cor)
            </label>
          </div>
        )}
        {/* Tabela de produtos: quantas linhas e em que granularidade */}
        {isColecaoType && (
          <div className={styles.optionsRow}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={todosProdutos}
                onChange={(e) => setTodosProdutos(e.target.checked)}
              />
              Todos os produtos (várias páginas em vez do top 12 + “Outros”)
            </label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={produtoTotal}
                onChange={(e) => setProdutoTotal(e.target.checked)}
              />
              Produto total (uma linha por produto, somando as cores)
            </label>
            <p className={styles.hint}>
              As linhas vêm do backend: mudar um destes exige gerar a apresentação de novo (a paleta,
              não — ela re-tinge na hora). Os dois combinam.
            </p>
          </div>
        )}

        {/* Destaque opcional: conjunto de produtos DA COLEÇÃO com slide próprio */}
        {isColecaoType && (
          <div className={styles.destaqueBox}>
            <div className={styles.destaqueHead}>
              <span className={styles.destaqueTitle}>Destacar um conjunto de produtos (opcional)</span>
              <span className={styles.destaqueSub}>
                Gera um slide extra logo depois da lista de produtos, só com esses itens.
              </span>
            </div>
            <div className={styles.filtersGrid}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Produtos com o nome</label>
                <input
                  className={styles.input}
                  value={destaqueTermo}
                  placeholder="Ex.: Dracena"
                  onChange={(e) => setDestaqueTermo(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Nome do conjunto (opcional)</label>
                <input
                  className={styles.input}
                  value={destaqueNome}
                  placeholder={destaqueTermo.trim() || "Ex.: Família Dracena"}
                  onChange={(e) => setDestaqueNome(e.target.value)}
                />
              </div>
            </div>
            {destaqueTermo.trim().length >= 2 && colecoes.length === 0 && (
              <p className={styles.hint}>Selecione a coleção para reconhecer os produtos.</p>
            )}
            {destaqueTermo.trim().length >= 2 && colecoes.length > 0 && (
              <>
                <p className={styles.hint}>
                  {destaqueLoading
                    ? "Reconhecendo produtos da coleção..."
                    : destaqueMatches.length === 0
                      ? `Nenhum produto da coleção selecionada tem “${destaqueTermo.trim()}” no nome.`
                      : `${destaqueSelecionados.length} de ${destaqueMatches.length} produto(s) reconhecido(s) na coleção — clique para tirar do destaque.`}
                </p>
                {destaqueMatches.length > 0 && (
                  <div className={styles.chips}>
                    {destaqueMatches.map((p) => {
                      const on = !destaqueOff.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`${styles.chipToggle} ${on ? styles.chipToggleOn : ""}`}
                          onClick={() => toggleDestaqueProduto(p.id)}
                          aria-pressed={on}
                        >
                          {on ? "✓" : "+"} {p.name}
                          {/* Produtos diferentes repetem o nome (muda a grade/material),
                              então o código é o que separa um chip do outro. */}
                          <span className={styles.chipCode}>{p.id}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            <p className={styles.hint}>
              O reconhecimento pelo nome é o mesmo do Gerador de Relatórios, mas sempre dentro da(s)
              coleção(ões) selecionada(s) — e o slide usa exatamente os números da lista geral (venda
              líquida com trocas). Sem nome do conjunto, o título sai do termo digitado.
            </p>
          </div>
        )}
        {isColecaoType && (
          <p className={styles.hint}>
            A paleta sai por padrão igual à cor que a coleção tem no card do Painel de Coleções
            (coral SCARF·ME para coleções fora do painel). Escolher uma paleta na lista re-tinge os
            5 slides na hora — antes ou depois de gerar — e vale também no PDF.
          </p>
        )}
        {isColecaoType && colecoes.length > 1 && (
          <p className={styles.hint}>
            Selecione apenas uma coleção para vincular a imagem de capa e o título. Com várias, os
            números são somados mas a capa não é aplicada.
          </p>
        )}
        {isComparativo && (
          <p className={styles.hint}>
            Escolha 2 ou mais coleções — cada uma vira um slide com paleta própria, ordenadas por
            venda líquida, mais um slide final de decisão de renovação. Cada slide usa o recorte
            (fundo transparente) da coleção — envie/troque abaixo, por coleção.
          </p>
        )}
        {isResumido && (
          <p className={styles.hint}>
            Escolha as coleções — cada uma vira uma carta compacta (uma abaixo da outra) com foto,
            venda líquida, quantidade vendida, peças (SKUs) e a evolução mensal, ordenadas por venda
            líquida. Use o recorte (fundo transparente) de cada coleção — envie/troque abaixo.
          </p>
        )}
        {isTopProdutos && (
          <p className={styles.hint}>
            Ranking por item = <b>produto × cor</b>, critério único de faturamento (mesma lógica
            validada do relatório “Vendas por faturamento”). O deck sai com capa, os 10 maiores
            produtos do período, o sumário de {topDimPlural} e uma página com o top 10 de cada{" "}
            {topDimSingular} — os {topDimPlural} menores entram no complemento final. Filtre por
            período e filial; sem filial a apresentação cobre a rede inteira.
          </p>
        )}
        {isGiro && (
          <p className={styles.hint}>
            Mesmas regras da página Produto Giro: selecione produtos específicos e/ou os filtros da
            empresa. Sem seleção, o deck cobre todo o escopo (empresa/filial/período). O ritmo semanal
            e o salto dos últimos 3 dias são relativos a hoje (como na Produto Giro).
          </p>
        )}
      </section>

      {/* Imagens */}
      {meta?.requiresCover && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Imagens</h2>
          <p className={styles.hint}>
            {isTopProdutosCapaColecao
              ? "A capa vem sorteada entre as fotos de coleção já enviadas — escolha outra na lista, sorteie de novo ou suba a sua (essa fica só nesta geração). O logo abaixo é salvo e vale para todas as apresentações."
              : isTopProdutos
                ? "Envie a imagem da capa desta apresentação — ela fica só nesta geração (não é salva). O logo abaixo é salvo e vale para todas as apresentações."
                  : isGiro
                    ? "Escolha a imagem principal (capa/hero) deste relatório — ela fica só nesta geração (não é salva). O logo abaixo é salvo e vale para todas as apresentações."
                    : "Use imagens com fundo transparente (PNG recortado) — elas aparecem “flutuando” sobre o círculo da coleção, como no modelo. Reenviar substitui a anterior; o que já foi enviado aparece no preview."}
          </p>
          <div className={styles.uploadGrid}>
            {/* Capa do Top Produtos — sorteada entre as capas de coleção (ScarfMe)
                ou enviada pelo usuário (NERD, que não tem foto de coleção). */}
            {isTopProdutos && (
              <div className={styles.uploadCard}>
                <div className={styles.uploadPreview}>
                  {topCoverEffective ? (
                    <img src={topCoverEffective} alt="Capa da apresentação" />
                  ) : (
                    <span className={styles.uploadEmpty}>Sem capa</span>
                  )}
                </div>
                <div className={styles.uploadBody}>
                  <span className={styles.uploadTitle}>Imagem da capa</span>
                  <span
                    className={
                      topCoverEffective
                        ? `${styles.uploadStatus} ${styles.uploadStatusOk}`
                        : styles.uploadStatus
                    }
                  >
                    {topCoverUpload
                      ? "Imagem enviada (só nesta geração)"
                      : topCoverRef
                        ? `Capa de ${labelFromMaster(topCoverRef)}`
                        : isTopProdutosCapaColecao
                          ? "Nenhuma capa de coleção disponível — envie uma imagem"
                          : "Nenhuma imagem selecionada"}
                  </span>
                  {isTopProdutosCapaColecao && (
                    <select
                      className={styles.select}
                      value={topCoverUpload ? "" : topCoverRef ?? ""}
                      onChange={(e) => {
                        setTopCoverUpload(null);
                        setTopCoverRef(e.target.value || null);
                      }}
                      disabled={topCoverRefs.length === 0}
                    >
                      {topCoverUpload && <option value="">Imagem enviada por você</option>}
                      {topCoverRefs.length === 0 && (
                        <option value="">Nenhuma capa cadastrada</option>
                      )}
                      {topCoverRefs.map((code) => (
                        <option key={code} value={code}>
                          {labelFromMaster(code)}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className={styles.uploadActions}>
                    {isTopProdutosCapaColecao && (
                      <button
                        type="button"
                        className={styles.fileBtn}
                        onClick={sortearTopCover}
                        disabled={topCoverRefs.length < 2}
                      >
                        Sortear outra
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.fileBtn}
                      onClick={() => topCoverInputRef.current?.click()}
                    >
                      {topCoverUpload ? "Trocar imagem" : "Enviar imagem"}
                    </button>
                    {topCoverUpload && (
                      <button
                        type="button"
                        className={styles.fileBtn}
                        onClick={() => setTopCoverUpload(null)}
                      >
                        Remover envio
                      </button>
                    )}
                    <input
                      ref={topCoverInputRef}
                      type="file"
                      accept="image/*"
                      className={styles.hiddenInput}
                      onChange={(e) => void onPickTopCover(e.target.files?.[0])}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Capa (hero) do Giro — só em memória, escolhida a cada geração */}
            {isGiro && (
              <div className={styles.uploadCard}>
                <div className={styles.uploadPreview}>
                  {giroCoverDataUrl ? (
                    <img src={giroCoverDataUrl} alt="Capa do relatório" />
                  ) : (
                    <span className={styles.uploadEmpty}>Sem capa</span>
                  )}
                </div>
                <div className={styles.uploadBody}>
                  <span className={styles.uploadTitle}>Imagem principal (capa)</span>
                  <span className={giroCoverDataUrl ? `${styles.uploadStatus} ${styles.uploadStatusOk}` : styles.uploadStatus}>
                    {giroCoverDataUrl ? "Imagem selecionada (só nesta geração)" : "Nenhuma imagem selecionada"}
                  </span>
                  <div className={styles.uploadActions}>
                    <button
                      type="button"
                      className={styles.fileBtn}
                      onClick={() => giroCoverInputRef.current?.click()}
                    >
                      {giroCoverDataUrl ? "Trocar imagem" : "Escolher imagem"}
                    </button>
                    {giroCoverDataUrl && (
                      <button type="button" className={styles.fileBtn} onClick={() => setGiroCoverDataUrl(null)}>
                        Remover
                      </button>
                    )}
                    <input
                      ref={giroCoverInputRef}
                      type="file"
                      accept="image/*"
                      className={styles.hiddenInput}
                      onChange={(e) => void onPickGiroCover(e.target.files?.[0])}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Capa da coleção (tipo #1: coleção âncora única) */}
            {isColecaoType && (
              <div className={styles.uploadCard}>
                <div className={styles.uploadPreview}>
                  {coverDataUrl ? (
                    <img src={coverDataUrl} alt="Capa da coleção" />
                  ) : (
                    <span className={styles.uploadEmpty}>Sem capa</span>
                  )}
                </div>
                <div className={styles.uploadBody}>
                  <span className={styles.uploadTitle}>Capa da coleção</span>
                  <span className={coverDataUrl ? `${styles.uploadStatus} ${styles.uploadStatusOk}` : styles.uploadStatus}>
                    {!singleColecao
                      ? "Selecione uma coleção"
                      : coverDataUrl
                        ? `Imagem salva${coverUpdatedAt ? " · atualizada agora" : ""}`
                        : "Nenhuma imagem enviada"}
                  </span>
                  <div className={styles.uploadActions}>
                    <button
                      type="button"
                      className={styles.fileBtn}
                      disabled={!singleColecao || uploadingCover}
                      onClick={() => coverInputRef.current?.click()}
                    >
                      {uploadingCover ? "Enviando..." : coverDataUrl ? "Substituir imagem" : "Enviar imagem"}
                    </button>
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      className={styles.hiddenInput}
                      onChange={(e) => void onPickCover(e.target.files?.[0])}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Multi-coleção: uma foto (recorte) por coleção selecionada */}
            {isMultiCover &&
              colecoes.map((code) => {
                const url = coversByCode[code] ?? null;
                return (
                  <div key={code} className={styles.uploadCard}>
                    <div className={styles.uploadPreview}>
                      {url ? <img src={url} alt={labelForCode(code)} /> : <span className={styles.uploadEmpty}>Sem imagem</span>}
                    </div>
                    <div className={styles.uploadBody}>
                      <span className={styles.uploadTitle}>{labelForCode(code)}</span>
                      <span className={url ? `${styles.uploadStatus} ${styles.uploadStatusOk}` : styles.uploadStatus}>
                        {url ? "Imagem salva" : "Nenhuma imagem enviada"}
                      </span>
                      <div className={styles.uploadActions}>
                        <label className={styles.fileBtn}>
                          {uploadingCoverCode === code ? "Enviando..." : url ? "Substituir" : "Enviar"}
                          <input
                            type="file"
                            accept="image/*"
                            className={styles.hiddenInput}
                            disabled={uploadingCoverCode === code}
                            onChange={(e) => void uploadCoverFor(code, e.target.files?.[0])}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })}

            {/* Logo da empresa (um por empresa: NERD tem o dela, ScarfMe a dela) */}
            <div className={styles.uploadCard}>
              <div className={styles.uploadPreview}>
                {logoDataUrl ? (
                  <img src={logoDataUrl} alt={`Logo ${brandName}`} />
                ) : (
                  <span className={styles.uploadEmpty}>Sem logo</span>
                )}
              </div>
              <div className={styles.uploadBody}>
                <span className={styles.uploadTitle}>Logo {brandName}</span>
                <span className={logoDataUrl ? `${styles.uploadStatus} ${styles.uploadStatusOk}` : styles.uploadStatus}>
                  {logoDataUrl
                    ? `Logo salvo${logoUpdatedAt ? " · atualizado agora" : ""} (vale para todas as apresentações de ${brandName})`
                    : `Nenhum logo enviado (usa o texto ${brandName})`}
                </span>
                <div className={styles.uploadActions}>
                  <button
                    type="button"
                    className={styles.fileBtn}
                    disabled={uploadingLogo}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {uploadingLogo ? "Enviando..." : logoDataUrl ? "Substituir logo" : "Enviar logo"}
                  </button>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className={styles.hiddenInput}
                    onChange={(e) => void onPickLogo(e.target.files?.[0])}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Ações */}
      <section className={styles.actionsBar}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => void handleGenerate()}
          disabled={loading}
        >
          {loading ? "Gerando..." : "Gerar apresentação"}
        </button>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={() => void handleExportPdf()}
          disabled={!hasResult || exportingPdf}
        >
          {exportingPdf ? "Exportando..." : "Exportar PDF"}
        </button>
        {report && !loading && (
          <span className={styles.resultMeta}>
            {report.kpis.nSkus} SKUs · {report.kpis.canaisAtivos} canais · {report.period.label}
            {` · tabela: ${report.products.length} de ${report.productsTotalCount} ${
              report.productsPorProduto ? "produtos" : "SKUs"
            }`}
            {report.products.length > report.productsPerSlide
              ? ` em ${Math.ceil(report.products.length / report.productsPerSlide)} páginas`
              : ""}
            {report.destaque
              ? ` · destaque “${report.destaque.titulo}”: ${report.destaque.totals.skus} itens (${report.destaque.totals.participacaoPct.toLocaleString(
                  "pt-BR",
                  { minimumFractionDigits: 1, maximumFractionDigits: 1 }
                )}%)`
              : ""}
          </span>
        )}
        {comparativo && !loading && (
          <span className={styles.resultMeta}>
            {comparativo.totals.colecoes} coleções · {comparativo.period.label}
          </span>
        )}
        {resumido && !loading && (
          <span className={styles.resultMeta}>
            {resumido.totals.colecoes} coleções · {resumido.period.label}
          </span>
        )}
        {giro && !loading && (
          <span className={styles.resultMeta}>
            {giro.kpis.coresComVenda} {giro.dimensao} · {giro.kpis.unidades.toLocaleString("pt-BR")} un · {giro.period.label}
          </span>
        )}
        {topProdutos && !loading && (
          <span className={styles.resultMeta}>
            {topProdutos.totalPages} páginas · {topProdutos.slides.length}{" "}
            {topProdutos.dimensao.plural} ·{" "}
            {topProdutos.totals.itensComVenda.toLocaleString("pt-BR")} itens · {topProdutos.period.label}
          </span>
        )}
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {/* Deck */}
      {topProdutos ? (
        <div className={styles.deckWrap}>
          <TopProdutosDeck
            report={topProdutos}
            logoDataUrl={logoDataUrl}
            coverDataUrl={topCoverEffective}
            coverTitle={coverTitle}
            companyName={companyName}
            deckRef={deckRef}
          />
        </div>
      ) : report ? (
        <div className={styles.deckWrap}>
          <ColecaoDeck
            report={report}
            logoDataUrl={logoDataUrl}
            coverDataUrl={coverDataUrl}
            coverTitle={coverTitle || singleColecaoLabel}
            palette={activePalette}
            deckRef={deckRef}
          />
        </div>
      ) : comparativo ? (
        <div className={styles.deckWrap}>
          <ComparativoDeck
            payload={comparativo}
            logoDataUrl={logoDataUrl}
            coversByCode={coversByCode}
            deckRef={deckRef}
          />
        </div>
      ) : resumido ? (
        <div className={styles.deckWrap}>
          <ComparativoResumidoDeck
            payload={resumido}
            logoDataUrl={logoDataUrl}
            coversByCode={coversByCode}
            deckRef={deckRef}
          />
        </div>
      ) : giro ? (
        <div className={styles.deckWrap}>
          <ProdutoGiroDeck
            report={giro}
            logoDataUrl={logoDataUrl}
            coverDataUrl={giroCoverDataUrl}
            coverTitle={coverTitle}
            companyName={companyName}
            deckRef={deckRef}
          />
        </div>
      ) : (
        !loading && (
          <div className={styles.empty}>
            {isGiro || isTopProdutos
              ? "Ajuste os filtros e clique em “Gerar apresentação” para montar os slides."
              : "Escolha as coleções e clique em “Gerar apresentação” para montar os slides."}
          </div>
        )
      )}
    </div>
  );
}
