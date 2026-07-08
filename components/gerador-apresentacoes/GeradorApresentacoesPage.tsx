"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
import { getCurrentMonthRange, formatDateForQuery } from "@/lib/utils/date";
import {
  COLECAO_COMPLETA_ID,
  COMPARATIVO_COLECOES_ID,
  COMPARATIVO_RESUMIDO_ID,
  PRESENTATION_TYPES,
  getPresentationMeta,
} from "@/lib/presentations/registry";
import type { ColecaoPresentationPayload } from "@/lib/repositories/colecaoPresentation";
import type { ComparativoColecoesPayload } from "@/lib/repositories/comparativoColecoes";
import type { ComparativoResumidoPayload } from "@/lib/repositories/comparativoResumido";

import ColecaoDeck from "./ColecaoDeck";
import ComparativoDeck from "./ComparativoDeck";
import ComparativoResumidoDeck from "./ComparativoResumidoDeck";
import styles from "./GeradorApresentacoesPage.module.css";

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

  const [presentationTypeId, setPresentationTypeId] = useState<string>(COLECAO_COMPLETA_ID);
  const meta = useMemo(() => getPresentationMeta(presentationTypeId), [presentationTypeId]);

  // Filtros
  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [filial, setFilial] = useState<string | null>(null);
  const [colecoes, setColecoes] = useState<string[]>([]);
  const [optColecoes, setOptColecoes] = useState<MultiSelectOption[]>([]);
  const [loadingColecoes, setLoadingColecoes] = useState(false);
  const [coverTitle, setCoverTitle] = useState("");

  // Imagens (assets salvos no banco)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [logoUpdatedAt, setLogoUpdatedAt] = useState<string | null>(null);
  const [coverUpdatedAt, setCoverUpdatedAt] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // Resultado
  const [report, setReport] = useState<ColecaoPresentationPayload | null>(null);
  const [comparativo, setComparativo] = useState<ComparativoColecoesPayload | null>(null);
  const [resumido, setResumido] = useState<ComparativoResumidoPayload | null>(null);
  const [coversByCode, setCoversByCode] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const deckRef = useRef<HTMLDivElement | null>(null);

  const startStr = formatDateForQuery(range.startDate);
  const endStr = formatDateForQuery(range.endDate);

  // Coleção "âncora" = a única selecionada (capa/título ligam a ela).
  const singleColecao = colecoes.length === 1 ? colecoes[0] : null;
  const singleColecaoLabel = useMemo(() => {
    if (!singleColecao) return "";
    const opt = optColecoes.find((o) => o.value === singleColecao);
    if (!opt) return singleColecao;
    // label vem como "descrição (código)" — usa a descrição pura no título.
    return opt.label.replace(/\s*\([^)]*\)\s*$/, "").trim() || opt.label;
  }, [singleColecao, optColecoes]);

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

  // Descrição de uma coleção pelo código (para títulos do comparativo).
  const labelForCode = useCallback(
    (code: string) => {
      const opt = optColecoes.find((o) => o.value === code);
      if (!opt) return code;
      return opt.label.replace(/\s*\([^)]*\)\s*$/, "").trim() || opt.label;
    },
    [optColecoes]
  );

  // ---- gerar ----
  const handleGenerate = useCallback(async () => {
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

      const res = await fetch("/api/gerador-apresentacoes/colecao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: companyKey,
          filial,
          colecoes,
          collectionLabel: singleColecaoLabel || undefined,
          range: { start: startStr, end: endStr },
        }),
      });
      const json = (await res.json()) as { data?: ColecaoPresentationPayload; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Erro ao gerar a apresentação.");
      setReport(json.data ?? null);
      setComparativo(null);
      setResumido(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao gerar a apresentação.");
      setReport(null);
      setComparativo(null);
      setResumido(null);
    } finally {
      setLoading(false);
    }
  }, [colecoes, companyKey, filial, singleColecaoLabel, startStr, endStr, presentationTypeId, labelForCode]);

  // ---- export PDF (mesmo pipeline do Relatório Claude) ----
  const handleExportPdf = useCallback(async () => {
    const deckElement = deckRef.current;
    if ((!report && !comparativo && !resumido) || !deckElement) return;
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
      const marginMm = 8;
      const pageWidthMm = 297;
      const usableWidthMm = pageWidthMm - marginMm * 2;

      const canvases: HTMLCanvasElement[] = [];
      for (const slideElement of slideElements) {
        const canvas = await html2canvas(slideElement, {
          backgroundColor: "#fffdfc",
          scale: Math.min(window.devicePixelRatio || 1, 2),
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          windowWidth: Math.max(slideElement.scrollWidth, 1440),
          windowHeight: Math.max(slideElement.scrollHeight, 900),
          onclone: (cloneDoc) => {
            cloneDoc.querySelectorAll<HTMLElement>("[data-pdf-slide]").forEach((element) => {
              element.style.width = "1280px";
              element.style.minHeight = "720px";
              element.style.height = "auto";
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

      const baseName = comparativo
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
  }, [report, comparativo, resumido]);

  const isColecaoType = presentationTypeId === COLECAO_COMPLETA_ID;
  const isComparativo = presentationTypeId === COMPARATIVO_COLECOES_ID;
  const isResumido = presentationTypeId === COMPARATIVO_RESUMIDO_ID;
  // Tipos multi-coleção usam uma foto (recorte) por coleção selecionada.
  const isMultiCover = isComparativo || isResumido;
  const hasResult = Boolean(report || comparativo || resumido);

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
            {PRESENTATION_TYPES.map((t) => (
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
          {meta?.supportedFilters.includes("colecao") && (
            <MultiSelectFilter
              label="Coleção"
              value={colecoes}
              options={optColecoes}
              onChange={setColecoes}
              onOpen={() => void loadColecoes()}
              loading={loadingColecoes}
            />
          )}
          {meta?.supportedFilters.includes("periodo") && (
            <DateRangeFilter value={range} onChange={setRange} label="Período" />
          )}
          {meta?.supportedFilters.includes("filial") && (
            <FilialFilter companyKey={companyKey} value={filial} onChange={setFilial} module="sales" />
          )}
          {isColecaoType && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Título da capa (opcional)</label>
              <input
                className={styles.input}
                value={coverTitle}
                placeholder={singleColecaoLabel || "Ex.: Copa Galisteu"}
                onChange={(e) => setCoverTitle(e.target.value)}
              />
            </div>
          )}
        </div>
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
      </section>

      {/* Imagens */}
      {meta?.requiresCover && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Imagens</h2>
          <p className={styles.hint}>
            Use imagens com <strong>fundo transparente</strong> (PNG recortado) — elas aparecem
            &quot;flutuando&quot; sobre o círculo da coleção, como no modelo. Reenviar substitui a
            anterior; o que já foi enviado aparece no preview.
          </p>
          <div className={styles.uploadGrid}>
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

            {/* Logo SCARF·ME */}
            <div className={styles.uploadCard}>
              <div className={styles.uploadPreview}>
                {logoDataUrl ? (
                  <img src={logoDataUrl} alt="Logo SCARF·ME" />
                ) : (
                  <span className={styles.uploadEmpty}>Sem logo</span>
                )}
              </div>
              <div className={styles.uploadBody}>
                <span className={styles.uploadTitle}>Logo SCARF·ME</span>
                <span className={logoDataUrl ? `${styles.uploadStatus} ${styles.uploadStatusOk}` : styles.uploadStatus}>
                  {logoDataUrl
                    ? `Logo salvo${logoUpdatedAt ? " · atualizado agora" : ""} (vale para todas as apresentações)`
                    : "Nenhum logo enviado (usa o texto SCARF·ME)"}
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
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {/* Deck */}
      {report ? (
        <div className={styles.deckWrap}>
          <ColecaoDeck
            report={report}
            logoDataUrl={logoDataUrl}
            coverDataUrl={coverDataUrl}
            coverTitle={coverTitle || singleColecaoLabel}
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
      ) : (
        !loading && (
          <div className={styles.empty}>
            Escolha as coleções e clique em “Gerar apresentação” para montar os slides.
          </div>
        )
      )}
    </div>
  );
}
