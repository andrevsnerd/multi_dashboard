"use client";

import { Fragment, type RefObject } from "react";

import { presentationBrandName } from "@/lib/presentations/brand";
import type {
  TopProdutosCategoriaSlide,
  TopProdutosItem,
  TopProdutosMenorGrupo,
  TopProdutosPayload,
  TopProdutosSumarioRow,
} from "@/lib/repositories/topProdutosPresentation";

import styles from "./TopProdutosDeck.module.css";

/**
 * Deck "Top Produtos (Campeões de Venda)" — porte fiel do modelo
 * scarfme-campeoes-<mês>.html. Cada slide é uma <section> de 1280×905px marcada
 * com `data-pdf-slide` (+ data-pdf-width/height, que o export lê para clonar o
 * slide no tamanho exato) → uma página do PDF em A4 paisagem.
 *
 * O mesmo deck serve ScarfMe e NERD: o que muda é a marca (logo/wordmark) e a
 * dimensão das páginas — `report.dimensao` traz os rótulos prontos ("subgrupo"
 * na ScarfMe, "grupo" no NERD), então nenhuma string aqui é fixa.
 */

interface TopProdutosDeckProps {
  report: TopProdutosPayload;
  logoDataUrl: string | null;
  /** Foto da capa (recorte de coleção na ScarfMe, upload próprio no NERD). */
  coverDataUrl: string | null;
  /** Título da capa (ex.: "Campeões de venda"); a última palavra sai em itálico. */
  coverTitle?: string;
  /** Nome da empresa (marca do logo/rodapé). */
  companyName: string;
  deckRef?: RefObject<HTMLDivElement | null>;
}

const SLIDE_W = 1280;
const SLIDE_H = 905;

// ---------- formatação (pt-BR, igual ao modelo) ----------
function fmtCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("pt-BR");
}
function fmtPct1(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
/** "01", "02"… como no modelo (ranking e paginação). */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
function ordinal(value: number): string {
  return `${value}º`;
}

/** Coleção: descrição em negrito + código ao lado (cai só no código se faltar). */
function Colecao({ desc, code }: { desc: string; code: string }) {
  if (!desc) return <>{code}</>;
  return (
    <>
      <b>{desc}</b> {code}
    </>
  );
}

export default function TopProdutosDeck({
  report,
  logoDataUrl,
  coverDataUrl,
  coverTitle,
  companyName,
  deckRef,
}: TopProdutosDeckProps) {
  const { dimensao, period, scope, totals, network, sumarioPages, slides, menores, totalPages } =
    report;
  const brandName = presentationBrandName(companyName);

  // Título da capa: última palavra em itálico coral, como "Campeões de venda".
  const titleRaw = (coverTitle?.trim() || "Campeões de venda").replace(/\s+/g, " ");
  const words = titleRaw.split(" ");
  const titleLead = words.slice(0, -1).join(" ");
  const titleTail = words.length > 1 ? words[words.length - 1] : "";

  const footerLeft = `${brandName}  ·  ${titleRaw}  ·  ${period.label}  ·  ${scope.label}`;

  const slideProps = {
    "data-pdf-slide": "",
    "data-pdf-width": String(SLIDE_W),
    "data-pdf-height": String(SLIDE_H),
  } as const;

  const mini = logoDataUrl ? (
    <img className={styles.mini} src={logoDataUrl} alt={brandName} />
  ) : (
    <span className={styles.miniWord}>{brandName}</span>
  );

  const footer = (pageNumber: number, prefix?: string) => (
    <div className={styles.fo}>
      <span>{footerLeft}</span>
      <b>
        {prefix ? `${prefix}  ·  ` : ""}
        {pad2(pageNumber)} / {pad2(totalPages)}
      </b>
    </div>
  );

  /** Cabeçalho da tabela; no top da rede a coluna de cor é agregada ("Cores"). */
  const headerRow = (corLabel: string = "Cor") => (
    <div className={`${styles.rw} ${styles.hrow}`}>
      <div>#</div>
      <div>Produto</div>
      <div>{corLabel}</div>
      <div>Coleção</div>
      <div>Grade</div>
      <div>Comparativo · líder = 100%</div>
      <div className={styles.tr}>Faturamento</div>
      <div className={styles.tr}>Qtde</div>
      <div className={styles.tr}>Preço médio</div>
    </div>
  );

  const rankingRow = (item: TopProdutosItem) => {
    const rankClass =
      item.rank === 1 ? styles.top : item.rank === 2 ? styles.r2 : item.rank === 3 ? styles.r3 : "";
    return (
      <div key={`${item.rank}-${item.produto}-${item.cor}`} className={`${styles.rw} ${styles.row} ${rankClass}`}>
        <div className={styles.rk}>{pad2(item.rank)}</div>
        <div className={styles.nm}>
          <span className={styles.t}>{item.descricao}</span>
          <i>{item.produto}</i>
        </div>
        <div className={styles.cl}>{item.cor || "-"}</div>
        <div className={styles.co}>
          <Colecao desc={item.colecaoDesc} code={item.colecaoCode} />
        </div>
        <div className={styles.gr}>{item.grade}</div>
        <div className={styles.bar}>
          <span style={{ width: `${item.barPct}%` }} />
        </div>
        <div className={styles.ft}>{fmtCurrency(item.faturamento)}</div>
        <div className={styles.qt}>{fmtInt(item.qtde)}</div>
        <div className={styles.pm}>{fmtCurrency(item.precoMedio)}</div>
      </div>
    );
  };

  /** Página de categoria em cards grandes (categoria com poucos itens). */
  const cardsGrid = (slide: TopProdutosCategoriaSlide) => {
    const n = slide.items.length;
    const columns = n === 1 ? 1 : 2;
    return (
      <div
        className={styles.cards}
        style={{
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          ...(n <= 2 ? { gridTemplateRows: "1fr" } : null),
          ...(n === 1 ? { maxWidth: 700 } : null),
        }}
      >
        {slide.items.map((item) => {
          const colecao = [item.colecaoDesc, item.colecaoCode].filter(Boolean).join(" ");
          return (
            <div
              key={`${item.rank}-${item.produto}-${item.cor}`}
              className={`${styles.card} ${item.rank === 1 ? styles.one : ""}`}
            >
              {item.rank === 1 && <div className={styles.cut} />}
              <div className={styles.cr}>{pad2(item.rank)}</div>
              <div className={styles.cn}>{item.descricao}</div>
              <div className={styles.cm}>
                <b>{item.cor || "-"}</b>
                {colecao ? ` · ${colecao}` : ""}
                {item.grade ? ` · grade ${item.grade}` : ""}
                {` · cód. ${item.produto}`}
              </div>
              <div className={styles.cf}>{fmtCurrency(item.faturamento)}</div>
              <div className={styles.cg}>
                <div>
                  <u>Qtde vendida</u>
                  <b>{fmtInt(item.qtde)}</b>
                </div>
                <div>
                  <u>Preço médio</u>
                  <b>{fmtCurrency(item.precoMedio)}</b>
                </div>
                {item.linha ? (
                  <div>
                    <u>Linha</u>
                    <b>{item.linha}</b>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /** Uma coluna do sumário. */
  const sumarioColumn = (rows: TopProdutosSumarioRow[], key: string) => (
    <div key={key} className={styles.icol}>
      {rows.map((r) => (
        <div key={r.categoria} className={styles.ir}>
          <u>{pad2(r.ordem)}</u>
          <div className={styles.isub}>
            {r.categoria}
            <em>
              {fmtInt(r.qtde)} {r.qtde === 1 ? "peça vendida" : "peças vendidas"}
            </em>
          </div>
          <div className={styles.ibar}>
            <span style={{ width: `${r.barPct}%` }} />
          </div>
          <div className={styles.ifat}>{fmtCurrency(r.faturamento)}</div>
        </div>
      ))}
    </div>
  );

  /** Uma coluna da página "Demais categorias". */
  const menoresColumn = (grupos: TopProdutosMenorGrupo[], key: string) => (
    <div key={key} className={styles.mcol}>
      <div className={`${styles.mrow} ${styles.hd2}`}>
        <div>{dimensao.singularCap} · produto</div>
        <div className={styles.tr}>Faturamento</div>
        <div className={styles.tr}>Qtde</div>
      </div>
      {grupos.map((g) => (
        // Fragment (sem nó no DOM) para as linhas caírem direto no flex da coluna —
        // um wrapper com display:contents não sobrevive ao html2canvas do PDF.
        <Fragment key={g.categoria}>
          <div className={styles.mrow}>
            <div className={styles.ms}>
              <b>{g.categoria}</b>
            </div>
            <div className={styles.mf}>{fmtCurrency(g.faturamento)}</div>
            <div className={styles.mq}>{fmtInt(g.qtde)}</div>
          </div>
          {g.items.map((item, i) => (
            <div key={`${g.categoria}-${i}`} className={styles.mrow}>
              <div className={`${styles.ms} ${styles.msItem}`}>
                <i>
                  {item.descricao}
                  {item.cor ? ` · ${item.cor}` : ""}
                </i>
              </div>
              <div className={`${styles.mf} ${styles.mfItem}`}>{fmtCurrency(item.faturamento)}</div>
              <div className={styles.mq}>{fmtInt(item.qtde)}</div>
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );

  // Numeração das páginas: capa · top 10 · sumário(s) · categorias · demais.
  let pageNumber = 1;
  const coverPage = pageNumber++;
  const networkPage = pageNumber++;
  const sumarioPageNumbers = sumarioPages.map(() => pageNumber++);
  const slidePageNumbers = slides.map(() => pageNumber++);
  const menoresPageNumbers = menores.pages.map(() => pageNumber++);

  const topLabel = `Top ${network.items.length}`;

  return (
    <div ref={deckRef} className={styles.deck}>
      {/* ============ 01 — CAPA ============ */}
      <section
        className={`${styles.page} ${styles.cover}`}
        {...slideProps}
        data-titulo="Capa"
        data-n={coverPage}
      >
        <div className={styles.frame} />
        {coverDataUrl ? <img className={styles.model} src={coverDataUrl} alt="" /> : null}
        <div className={styles.cont}>
          {logoDataUrl ? (
            <img className={styles.logo} src={logoDataUrl} alt={brandName} />
          ) : (
            <span className={styles.wordmark}>{brandName}</span>
          )}
          <div className={styles.eyebrow}>Relatório de performance · {scope.eyebrow}</div>
          <h1>
            {titleLead}
            {titleLead && titleTail ? <br /> : null}
            {titleTail ? <em>{titleTail}</em> : null}
          </h1>
          <div className={styles.month}>
            <div className={styles.rule} />
            <b>{period.label}</b>
            <span>{period.range}</span>
          </div>
          <div className={styles.lead}>
            Os <b>{network.items.length} maiores produtos</b> do período e o{" "}
            <b>top {network.items.length} de cada {dimensao.singular}</b>. Critério único:{" "}
            <b>faturamento no período</b>.
          </div>
        </div>
        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <u>Faturamento</u>
            <strong>{fmtCurrency(totals.faturamento)}</strong>
            <i>{scope.label}</i>
          </div>
          {/* Contagem de itens únicos saiu do deck por pedido do dono: o que vale
              é o volume vendido (peças), não quantos códigos diferentes venderam. */}
          <div className={styles.kpi}>
            <u>Peças</u>
            <strong>{fmtInt(totals.pecas)}</strong>
            <i>unidades líquidas em {fmtInt(totals.categorias)} {dimensao.plural}</i>
          </div>
        </div>
        <div className={styles.foot}>
          Top {network.items.length} da rede por produto (todas as cores somadas) · demais rankings
          por produto + cor
        </div>
      </section>

      {/* ============ 02 — TOP 10 DA REDE ============ */}
      <section className={styles.page} {...slideProps} data-titulo="Top da rede" data-n={networkPage}>
        <div className={styles.hd}>
          <div className={styles.ttl}>
            <span className={styles.eyebrow}>
              {topLabel} · {scope.eyebrow}
            </span>
            <h2 style={{ fontSize: "27px" }}>
              Os {network.items.length} maiores produtos do {period.unit}
              <small>
                Ranking por faturamento {scope.inLabel} em {period.longLabel} — cada produto soma
                todas as suas cores
              </small>
            </h2>
          </div>
          <div className={styles.right}>
            <div className={styles.chip}>
              <u>Faturamento do {topLabel.toLowerCase()}</u>
              <strong className={styles.c}>{fmtCurrency(network.faturamento)}</strong>
            </div>
            <div className={styles.chip}>
              <u>Peças</u>
              <strong>{fmtInt(network.qtde)}</strong>
            </div>
            <div className={styles.chip}>
              <u>{scope.pctLabel}</u>
              <strong>{fmtPct1(network.percRede)}</strong>
            </div>
            {mini}
          </div>
        </div>
        {/* Mesmo layout das páginas de categoria: cabeçalho + a lista inteira
            (o pódio de 3 cards grandes do modelo saiu por pedido do dono). */}
        <div className={styles.body}>
          {headerRow("Cores")}
          <div className={styles.rows}>{network.items.map(rankingRow)}</div>
        </div>
        {footer(networkPage)}
      </section>

      {/* ============ SUMÁRIO ============ */}
      {sumarioPages.map((rows, pageIdx) => {
        const half = Math.ceil(rows.length / 2);
        const pageNo = sumarioPageNumbers[pageIdx];
        return (
          <section
            key={`sumario-${pageIdx}`}
            className={styles.page}
            {...slideProps}
            data-titulo="Sumario"
            data-n={pageNo}
          >
            <div className={styles.hd}>
              <div className={styles.ttl}>
                <span className={styles.eyebrow}>
                  Sumário{sumarioPages.length > 1 ? ` · ${pageIdx + 1}/${sumarioPages.length}` : ""}
                </span>
                <h2 style={{ fontSize: "27px" }}>
                  {dimensao.pluralCap} em ordem de faturamento
                  <small>
                    Cada {dimensao.singular} abaixo tem uma página com seu próprio top {network.items.length}.
                    {menores.categorias > 0
                      ? ` Os ${menores.categorias} ${dimensao.plural} menores estão consolidados na última página.`
                      : ""}
                  </small>
                </h2>
              </div>
              <div className={styles.right}>
                <div className={styles.chip}>
                  <u>{dimensao.pluralCap} com página</u>
                  <strong className={styles.c}>{slides.length}</strong>
                </div>
                <div className={styles.chip}>
                  <u>Demais {dimensao.plural}</u>
                  <strong>{menores.categorias}</strong>
                </div>
                <div className={styles.chip}>
                  <u>Faturamento do {period.unit}</u>
                  <strong>{fmtCurrency(totals.faturamento)}</strong>
                </div>
                {mini}
              </div>
            </div>
            <div className={styles.body}>
              <div className={styles.idx}>
                {sumarioColumn(rows.slice(0, half), `c1-${pageIdx}`)}
                {sumarioColumn(rows.slice(half), `c2-${pageIdx}`)}
              </div>
            </div>
            {footer(pageNo)}
          </section>
        );
      })}

      {/* ============ UMA PÁGINA POR CATEGORIA (subgrupo · grupo) ============ */}
      {slides.map((slide, idx) => {
        const pageNo = slidePageNumbers[idx];
        const topN = slide.items.length;
        return (
          <section
            key={slide.categoria}
            className={styles.page}
            {...slideProps}
            data-titulo={slide.categoria}
            data-n={pageNo}
          >
            <div className={styles.hd}>
              <div className={styles.ttl}>
                <span className={styles.eyebrow}>Top {topN} · {dimensao.singular}</span>
                <h2 style={{ fontSize: slide.titleFontSize }}>
                  {slide.categoria}
                  <small>
                    {ordinal(slide.rank)} {dimensao.singular} {scope.ofLabel} em faturamento
                    {slide.linhas.length > 0
                      ? `  ·  ${slide.linhas.length === 1 ? "linha" : "linhas"} ${slide.linhas.join(" / ")}`
                      : ""}
                    {`  ·  ${fmtInt(slide.qtde)} ${slide.qtde === 1 ? "peça vendida" : "peças vendidas"} no ${period.unit}`}
                  </small>
                </h2>
              </div>
              <div className={styles.right}>
                <div className={styles.chip}>
                  <u>Faturamento</u>
                  <strong className={styles.c}>{fmtCurrency(slide.faturamento)}</strong>
                </div>
                <div className={styles.chip}>
                  <u>Peças</u>
                  <strong>{fmtInt(slide.qtde)}</strong>
                </div>
                <div className={styles.chip}>
                  <u>{scope.pctLabel}</u>
                  <strong>{fmtPct1(slide.percRede)}</strong>
                </div>
                <div className={styles.chip}>
                  <u>Top {topN} do {dimensao.singular}</u>
                  <strong>{fmtPct1(slide.topPerc)}</strong>
                </div>
                {mini}
              </div>
            </div>
            <div className={styles.body}>
              {slide.layout === "cards" ? (
                cardsGrid(slide)
              ) : (
                <>
                  {headerRow()}
                  <div className={styles.rows}>{slide.items.map(rankingRow)}</div>
                  {slide.note ? <div className={styles.note}>{slide.note}</div> : null}
                </>
              )}
            </div>
            {footer(pageNo, slide.categoria)}
          </section>
        );
      })}

      {/* ============ DEMAIS CATEGORIAS ============ */}
      {menores.pages.map((columns, pageIdx) => {
        const pageNo = menoresPageNumbers[pageIdx];
        return (
          <section
            key={`menores-${pageIdx}`}
            className={styles.page}
            {...slideProps}
            data-titulo={`Demais ${dimensao.plural}`}
            data-n={pageNo}
          >
            <div className={styles.hd}>
              <div className={styles.ttl}>
                <span className={styles.eyebrow}>
                  Complemento{menores.pages.length > 1 ? ` · ${pageIdx + 1}/${menores.pages.length}` : ""}
                </span>
                <h2 style={{ fontSize: "36px" }}>
                  Demais {dimensao.plural}
                  <small>
                    {dimensao.pluralCap} menores do {period.unit} — todos os produtos listados
                  </small>
                </h2>
              </div>
              <div className={styles.right}>
                <div className={styles.chip}>
                  <u>{dimensao.pluralCap}</u>
                  <strong>{menores.categorias}</strong>
                </div>
                <div className={styles.chip}>
                  <u>Faturamento somado</u>
                  <strong className={styles.c}>{fmtCurrency(menores.faturamento)}</strong>
                </div>
                <div className={styles.chip}>
                  <u>{scope.pctLabel}</u>
                  <strong>{fmtPct1(menores.percRede)}</strong>
                </div>
                {mini}
              </div>
            </div>
            <div className={styles.body}>
              <div className={styles.mn}>
                {columns.map((grupos, colIdx) => menoresColumn(grupos, `mc-${pageIdx}-${colIdx}`))}
              </div>
            </div>
            {footer(pageNo)}
          </section>
        );
      })}
    </div>
  );
}
