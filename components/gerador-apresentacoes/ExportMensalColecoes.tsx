"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import type { CompanyKey } from "@/lib/config/company";
import {
  EXPORT_MENSAL_COLECOES,
  exportMensalFileName,
  type ExportMensalColecao,
} from "@/lib/presentations/export-mensal-colecoes";
import type { PresentationItemFilters } from "@/lib/presentations/item-filters";
import {
  DECK_PALETTE_AUTO,
  deckPaperColor,
  resolveDeckPalette,
  type CollectionPalette,
} from "@/lib/presentations/palettes";
import type { ColecaoPresentationPayload } from "@/lib/repositories/colecaoPresentation";

import ColecaoDeck from "./ColecaoDeck";
import pageStyles from "./GeradorApresentacoesPage.module.css";
import styles from "./ExportMensalColecoes.module.css";

interface ExportMensalColecoesProps {
  companyKey: CompanyKey;
  filial: string | null;
  start: string;
  end: string;
  filtros: PresentationItemFilters;
  todosProdutos: boolean;
  produtoTotal: boolean;
  logoDataUrl: string | null;
}

type Status = "fila" | "gerando" | "exportando" | "ok" | "sem-venda" | "erro";

interface LinhaStatus {
  slug: string;
  code: string;
  label: string;
  arquivo: string;
  status: Status;
  detalhe?: string;
}

interface DeckAtual {
  report: ColecaoPresentationPayload;
  cover: string | null;
  label: string;
  palette: CollectionPalette;
}

interface Preparado {
  report: ColecaoPresentationPayload;
  cover: string | null;
}

/** Quantas coleções são buscadas no servidor ao mesmo tempo (o PDF sai uma por vez). */
const CONCORRENCIA = 3;

const STATUS_LABEL: Record<Status, string> = {
  fila: "na fila",
  gerando: "gerando…",
  exportando: "exportando PDF…",
  ok: "baixado",
  "sem-venda": "sem venda no período",
  erro: "erro",
};

function fmtBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Export mensal de coleções (só admin): um clique gera e baixa o "Relatório Completo
 * de Coleção" de cada coleção do pacote mensal, cada uma no seu PDF
 * (`<slug>-<mês>.pdf`). Usa o período, a filial, o recorte e os checkboxes da
 * tabela da página; paleta sempre a automática da coleção e capa salva dela.
 *
 * O deck de cada coleção é montado aqui embaixo, visível, e capturado pelo MESMO
 * pipeline do botão "Exportar PDF" (html2canvas + jsPDF), então o arquivo sai igual
 * ao export manual.
 */
export default function ExportMensalColecoes({
  companyKey,
  filial,
  start,
  end,
  filtros,
  todosProdutos,
  produtoTotal,
  logoDataUrl,
}: ExportMensalColecoesProps) {
  const { user } = useAuth();
  const [linhas, setLinhas] = useState<LinhaStatus[]>([]);
  const [rodando, setRodando] = useState(false);
  const [deck, setDeck] = useState<DeckAtual | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const cancelarRef = useRef(false);
  // Resolve quando o deck pedido já está na tela (pintado), para a captura não pegar o anterior.
  const deckPintadoRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!deck || !deckPintadoRef.current) return;
    const resolve = deckPintadoRef.current;
    deckPintadoRef.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }, [deck]);

  const mostrarDeck = useCallback((next: DeckAtual) => {
    return new Promise<void>((resolve) => {
      deckPintadoRef.current = resolve;
      setDeck(next);
    });
  }, []);

  const atualizar = useCallback((slug: string, patch: Partial<LinhaStatus>) => {
    setLinhas((prev) => prev.map((l) => (l.slug === slug ? { ...l, ...patch } : l)));
  }, []);

  const preparar = useCallback(
    async (colecao: ExportMensalColecao, label: string): Promise<Preparado> => {
      const [resReport, resAssets] = await Promise.all([
        fetch("/api/gerador-apresentacoes/colecao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company: companyKey,
            filial,
            colecoes: [colecao.code],
            filtros,
            collectionLabel: label,
            range: { start, end },
            todosProdutos,
            produtoTotal,
            destaque: colecao.destaque ? { termo: colecao.destaque } : undefined,
          }),
        }),
        fetch(
          `/api/gerador-apresentacoes/assets?${new URLSearchParams({
            company: companyKey,
            colecao: colecao.code,
          })}`,
          { cache: "no-store" }
        ),
      ]);
      const json = (await resReport.json()) as { data?: ColecaoPresentationPayload; error?: string };
      if (!resReport.ok || !json.data) throw new Error(json.error ?? "Erro ao gerar a apresentação.");
      const assets = resAssets.ok
        ? ((await resAssets.json()) as { cover: string | null })
        : { cover: null };
      return { report: json.data, cover: assets.cover ?? null };
    },
    [companyKey, filial, filtros, start, end, todosProdutos, produtoTotal]
  );

  const exportarPdf = useCallback(async (palette: CollectionPalette, fileName: string) => {
    const deckElement = deckRef.current;
    if (!deckElement) throw new Error("Deck não encontrado na tela.");
    const slideElements = Array.from(deckElement.querySelectorAll<HTMLElement>("[data-pdf-slide]"));
    if (slideElements.length === 0) throw new Error("Deck sem slides.");

    await document.fonts.ready;
    // Capa/logo precisam ter carregado antes da captura.
    await Promise.all(
      Array.from(deckElement.querySelectorAll("img")).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            })
      )
    );

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);

    // Mesmo pipeline do "Exportar PDF" da página (página do PDF = tamanho do slide,
    // full-bleed, 297 mm de largura).
    const pageWidthMm = 297;
    const canvasBackground = deckPaperColor(palette);

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

          // html2canvas 1.x ignora `object-fit` em <img>: troca por <div> com
          // background-image/size equivalente (mesma caixa do HTML).
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

    const firstDrawHeightMm = pageWidthMm * (canvases[0].height / canvases[0].width);
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: [pageWidthMm, firstDrawHeightMm],
    });
    for (const [index, canvas] of canvases.entries()) {
      const drawHeightMm = pageWidthMm * (canvas.height / canvas.width);
      if (index > 0) doc.addPage([pageWidthMm, drawHeightMm]);
      doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidthMm, drawHeightMm, undefined, "FAST");
      canvas.width = 0;
      canvas.height = 0;
    }
    doc.save(fileName);
  }, []);

  const executar = useCallback(async () => {
    cancelarRef.current = false;
    setRodando(true);

    // Rótulo da coleção = descrição da tabela mestre (o mesmo título da capa no export manual).
    let descricoes: Record<string, string> = {};
    try {
      const res = await fetch(`/api/products/colecoes/descricoes?company=${companyKey}`, { cache: "no-store" });
      if (res.ok) descricoes = ((await res.json()) as { data?: Record<string, string> }).data ?? {};
    } catch {
      // sem descrição o rótulo cai no código
    }
    const labelOf = (code: string) => (descricoes[code] ?? "").trim() || code;

    const fila = EXPORT_MENSAL_COLECOES.map((c) => ({
      colecao: c,
      label: labelOf(c.code),
      arquivo: exportMensalFileName(c.slug, start, end),
    }));
    setLinhas(
      fila.map((f) => ({
        slug: f.colecao.slug,
        code: f.colecao.code,
        label: f.label,
        arquivo: f.arquivo,
        status: "fila",
      }))
    );

    // Busca no servidor em paralelo (limitado); o PDF sai um de cada vez, na ordem.
    const pendentes: Array<Promise<Preparado> | null> = fila.map(() => null);
    let proximo = 0;
    const iniciar = () => {
      if (proximo >= fila.length || cancelarRef.current) return;
      const i = proximo++;
      atualizar(fila[i].colecao.slug, { status: "gerando" });
      const p = preparar(fila[i].colecao, fila[i].label);
      pendentes[i] = p;
      void p.catch(() => undefined).finally(iniciar);
    };
    for (let k = 0; k < CONCORRENCIA; k++) iniciar();

    for (let i = 0; i < fila.length; i++) {
      if (cancelarRef.current) break;
      const { colecao, label, arquivo } = fila[i];
      try {
        while (!pendentes[i] && !cancelarRef.current) await new Promise((r) => setTimeout(r, 100));
        if (!pendentes[i]) break;
        const { report, cover } = await pendentes[i]!;
        if (report.products.length === 0) {
          atualizar(colecao.slug, { status: "sem-venda" });
          continue;
        }
        if (cancelarRef.current) break;
        atualizar(colecao.slug, { status: "exportando" });
        const palette = resolveDeckPalette(DECK_PALETTE_AUTO, colecao.code);
        await mostrarDeck({ report, cover, label, palette });
        await exportarPdf(palette, arquivo);
        atualizar(colecao.slug, {
          status: "ok",
          detalhe: `${fmtBRL(report.kpis.faturamento)} · ${report.kpis.pecasVendidas.toLocaleString("pt-BR")} pç${
            report.destaque ? ` · destaque ${report.destaque.titulo}` : ""
          }`,
        });
      } catch (e) {
        atualizar(colecao.slug, {
          status: "erro",
          detalhe: e instanceof Error ? e.message : "Erro ao exportar.",
        });
      }
    }

    setDeck(null);
    setRodando(false);
  }, [companyKey, start, end, preparar, exportarPdf, mostrarDeck, atualizar]);

  if (user?.role !== "admin") return null;

  const feitos = linhas.filter((l) => l.status === "ok").length;

  return (
    <section className={pageStyles.panel}>
      <h2 className={pageStyles.panelTitle}>Export mensal de coleções</h2>
      <p className={pageStyles.hint}>
        Gera e baixa o Relatório Completo de Coleção de cada coleção do pacote mensal, um PDF por
        coleção ({EXPORT_MENSAL_COLECOES.length}), com o período, a filial e as opções da tabela
        escolhidos acima. Paleta automática e capa salva de cada coleção; a Isabela Capeto sai com o
        destaque dos Dracena. Coleção sem venda no período é pulada. O navegador pode pedir para
        permitir vários downloads — é só aceitar.
      </p>
      <div className={styles.acoes}>
        <button
          type="button"
          className={pageStyles.btnPrimary}
          onClick={() => void executar()}
          disabled={rodando}
        >
          {rodando ? `Exportando… ${feitos}/${linhas.length}` : "Exportar as coleções do mês"}
        </button>
        {rodando && (
          <button
            type="button"
            className={pageStyles.btnSecondary}
            onClick={() => {
              cancelarRef.current = true;
            }}
          >
            Cancelar
          </button>
        )}
        <span className={styles.arquivos}>
          ex.: {exportMensalFileName(EXPORT_MENSAL_COLECOES[0].slug, start, end)}
        </span>
      </div>

      {linhas.length > 0 && (
        <ul className={styles.lista}>
          {linhas.map((l) => (
            <li key={l.slug} className={`${styles.linha} ${styles[`st_${l.status.replace("-", "_")}`] ?? ""}`}>
              <span className={styles.nome}>
                {l.label} <span className={styles.code}>{l.code}</span>
              </span>
              <span className={styles.arquivo}>{l.arquivo}</span>
              <span className={styles.status}>{STATUS_LABEL[l.status]}</span>
              <span className={styles.detalhe}>{l.detalhe ?? ""}</span>
            </li>
          ))}
        </ul>
      )}

      {deck && (
        <div className={pageStyles.deckWrap}>
          <ColecaoDeck
            report={deck.report}
            logoDataUrl={logoDataUrl}
            coverDataUrl={deck.cover}
            coverTitle={deck.label}
            palette={deck.palette}
            deckRef={deckRef}
          />
        </div>
      )}
    </section>
  );
}
