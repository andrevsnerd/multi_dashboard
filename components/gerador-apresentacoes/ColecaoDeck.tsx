"use client";

import { type CSSProperties, type RefObject } from "react";

import { deckThemeVars, type CollectionPalette } from "@/lib/presentations/palettes";
import type {
  ColecaoPresentationPayload,
  PresentationProductRow,
} from "@/lib/repositories/colecaoPresentation";

import styles from "./ColecaoDeck.module.css";

interface ColecaoDeckProps {
  report: ColecaoPresentationPayload;
  logoDataUrl: string | null;
  coverDataUrl: string | null;
  /** Título curto/estilizado da capa (ex.: "Copa Galisteu" ou "Copa\nGalisteu"). */
  coverTitle?: string;
  /**
   * Paleta do deck. Ausente = coral SCARF·ME (as variáveis do CSS valem).
   * Quem chama resolve a paleta (`resolveDeckPalette`): escolha manual do usuário
   * ou a mesma paleta que a coleção tem no Painel de Coleções.
   */
  palette?: CollectionPalette | null;
  deckRef?: RefObject<HTMLDivElement | null>;
}

// ---------- formatação (pt-BR, espelha o template) ----------
function fmtCurrency0(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtCurrency2(value: number): string {
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
function fmtPct(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Meta da visão geral: cor · grade · N un · ticket R$ X. */
function overviewMeta(p: PresentationProductRow): string {
  return [
    p.colorDescription || "-",
    p.grade,
    `${fmtInt(p.qtd)} un`,
    `ticket ${fmtCurrency0(p.precoMedio)}`,
  ]
    .filter((s) => s && String(s).trim())
    .join(" · ");
}

/** Meta da tabela de produtos: cor · grade · tipo. */
function productMeta(p: PresentationProductRow): string {
  return [p.colorDescription || "-", p.grade, p.tipo].filter((s) => s && String(s).trim()).join(" · ");
}

/** Divide o título da capa em até 2 linhas equilibradas. */
function titleLines(title: string): string[] {
  const explicit = title.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit.slice(0, 3);
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [title.trim()];
  if (words.length === 2) return words;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

function Logo({ dataUrl, small }: { dataUrl: string | null; small?: boolean }) {
  if (dataUrl) {
    return <img className={small ? styles.logoSm : styles.logo} src={dataUrl} alt="SCARF·ME" />;
  }
  return (
    <div className={`${styles.wordmark} ${small ? styles.wordmarkSm : ""}`}>
      SCARF<span className={styles.dot}>·</span>ME
    </div>
  );
}

export default function ColecaoDeck({
  report,
  logoDataUrl,
  coverDataUrl,
  coverTitle,
  palette,
  deckRef,
}: ColecaoDeckProps) {
  // Tema: aplicado no deck e repetido em cada slide, porque o export PDF
  // rasteriza slide por slide.
  const theme: CSSProperties | undefined = palette ? deckThemeVars(palette) : undefined;
  const displayTitleRaw = (coverTitle?.trim() || report.collection.fullName || report.collection.code || "Coleção");
  const lines = titleLines(displayTitleRaw);
  const displayName = displayTitleRaw.replace(/\r?\n/g, " ").trim();
  const eyebrowName = displayName.toUpperCase();
  const footerText = `${displayName} · ${report.period.short}`;

  // Páginas da tabela de produtos. `productsPerSlide` vem do payload (o repo é
  // server/mssql, o deck não pode importar a constante). Sempre ≥ 1 página, para
  // a coleção sem venda continuar rendendo o slide (com a tabela vazia).
  const perSlide = Math.max(1, report.productsPerSlide || report.products.length || 1);
  const productPages: PresentationProductRow[][] = [];
  for (let i = 0; i < report.products.length; i += perSlide) {
    productPages.push(report.products.slice(i, i + perSlide));
  }
  if (productPages.length === 0) productPages.push([]);

  // Modo "Produto Total" conta PRODUTOS; o padrão conta SKUs (produto × cor).
  const itemWord = report.productsPorProduto ? "produtos" : "SKUs";
  const productsCountLabel = `${report.productsTotalCount} ${itemWord}`;

  // Elemento reutilizado no rodapé de cada slide (não é um componente criado no
  // render — é uma descrição de elemento reaproveitada).
  const footer = (
    <div className={styles.footer}>
      <Logo dataUrl={logoDataUrl} small />
      <span>{footerText}</span>
    </div>
  );

  return (
    <div ref={deckRef} className={styles.deck} style={theme}>
      {/* ============ SLIDE 1 — CAPA ============ */}
      <section className={`${styles.slide} ${styles.hero}`} data-pdf-slide="" style={theme}>
        <div className={styles.blob} style={{ width: 520, height: 520, background: "var(--accent-soft)", right: -120, top: -120 }} />
        <div className={styles.blob} style={{ width: 260, height: 260, background: "var(--accent-soft2)", right: 340, bottom: -110 }} />
        <div className={styles.left}>
          <Logo dataUrl={logoDataUrl} />
          <div>
            <div className={styles.kicker}>Relatório de Performance · Coleção</div>
            <h1>
              {lines.map((line, i) => (
                <span key={i} style={{ display: "block" }}>
                  {line}
                </span>
              ))}
              <span className={styles.sub}>Performance da coleção · {report.period.label}</span>
            </h1>
          </div>
          <div className={styles.meta}>
            <b>Coleção:</b> {report.collection.fullName}
            <br />
            <b>Rede:</b> SCARF·ME · {report.kpis.canaisAtivos} canais ativos
            <br />
            <b>Faturamento:</b> {fmtCurrency2(report.kpis.faturamento)}
          </div>
        </div>
        {coverDataUrl ? (
          <div className={styles.imgwrap}>
            <img src={coverDataUrl} alt={report.collection.fullName} />
          </div>
        ) : (
          <div className={styles.imgPlaceholder}>
            Envie a imagem de capa da coleção
            <br />
            no gerador para exibi-la aqui.
          </div>
        )}
      </section>

      {/* ============ SLIDE 2 — NÚMEROS / VISÃO GERAL ============ */}
      <section className={styles.slide} data-pdf-slide="" style={theme}>
        <div className={styles.head}>
          <div>
            <div className={styles.eyebrow}>{eyebrowName} · Visão Geral</div>
            <h2>Os números da coleção</h2>
          </div>
          {coverDataUrl ? <img className={styles.pageimg} src={coverDataUrl} alt="" /> : null}
        </div>
        <div className={styles.body}>
          <div className={styles.numgrid}>
            <div className={styles.kcol}>
              <div className={`${styles.kpi} ${styles.accent}`}>
                <div className={styles.lbl}>Faturamento</div>
                <div className={styles.val}>{fmtCurrency0(report.kpis.faturamento)}</div>
                <div className={styles.foot}>venda líquida no período</div>
              </div>
              <div className={styles.krow}>
                <div className={styles.kpi}>
                  <div className={styles.lbl}>Peças vendidas</div>
                  <div className={styles.val}>{fmtInt(report.kpis.pecasVendidas)}</div>
                  <div className={styles.foot}>em {report.kpis.nSkus} SKUs</div>
                </div>
                <div className={styles.kpi}>
                  <div className={styles.lbl}>Preço médio</div>
                  <div className={styles.val}>
                    <small>R$ </small>
                    {fmtInt(report.kpis.precoMedio)}
                  </div>
                  <div className={styles.foot}>ticket por peça</div>
                </div>
              </div>
              <div className={styles.krow}>
                <div className={styles.kpi}>
                  <div className={styles.lbl}>Estoque restante</div>
                  <div className={styles.val}>{fmtInt(report.kpis.estoqueRestante)}</div>
                  <div className={styles.foot}>peças na rede</div>
                </div>
                <div className={styles.kpi}>
                  <div className={styles.lbl}>Canais ativos</div>
                  <div className={styles.val}>{report.kpis.canaisAtivos}</div>
                  <div className={styles.foot}>e-com + lojas</div>
                </div>
              </div>
            </div>
            <div className={styles.podium}>
              <h3>Destaques da coleção</h3>
              <div className={styles.psub}>Top {report.topProducts.length} produtos que puxaram o resultado</div>
              {report.topProducts.map((p) => (
                <div key={p.rank} className={styles.prow}>
                  <div className={styles.prank}>{p.rank}</div>
                  <div className={styles.pinfo}>
                    <div className={styles.pn}>{p.nome}</div>
                    <div className={styles.pm}>{overviewMeta(p)}</div>
                    <div className={styles.bar}>
                      <i style={{ width: `${p.barWidthPct}%` }} />
                    </div>
                  </div>
                  <div className={styles.pval}>
                    <div className={styles.v}>{fmtCurrency0(p.venda)}</div>
                    <div className={styles.s}>{fmtPct(p.participacaoPct)}% do total</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {footer}
      </section>

      {/* ============ SLIDE 3 — PRODUTOS (1..N páginas) ============
          Com "Todos os produtos" ligado o backend manda a lista inteira; aqui ela
          é quebrada em páginas de `productsPerSlide`, uma por slide. A linha
          "Outros" e a leitura da curva ficam só na ÚLTIMA página. */}
      {productPages.map((pageRows, pageIndex) => {
        const isLastPage = pageIndex === productPages.length - 1;
        return (
          <section
            key={`produtos-${pageIndex}`}
            className={styles.slide}
            data-pdf-slide=""
            style={theme}
          >
            <div className={styles.head}>
              <div>
                <div className={styles.eyebrow}>{eyebrowName} · Produtos</div>
                <h2>Performance por produto</h2>
              </div>
              <span className={styles.tag}>
                {productsCountLabel}
                {productPages.length > 1
                  ? ` · página ${pageIndex + 1}/${productPages.length}`
                  : ""}
              </span>
            </div>
            <div className={styles.body}>
              <table className={styles.ptable}>
                <thead>
                  <tr>
                    <th />
                    <th>Produto</th>
                    <th className={styles.num}>Qtd</th>
                    <th className={styles.num}>Preço méd.</th>
                    <th className={styles.num}>Venda líq.</th>
                    <th className={styles.num}>Estoque</th>
                    <th>Participação</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={`${p.rank}-${p.nome}-${p.colorDescription}`}>
                      <td className={styles.rank}>{p.rank}</td>
                      <td>
                        <div className={styles.pname}>
                          <span className={styles.pdesc}>{p.nome}</span>
                          <span className={styles.pmeta}>{productMeta(p)}</span>
                        </div>
                      </td>
                      <td className={styles.num}>{fmtInt(p.qtd)}</td>
                      <td className={styles.num}>{fmtCurrency2(p.precoMedio)}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{fmtCurrency2(p.venda)}</td>
                      <td className={styles.num}>{fmtInt(p.estoque)}</td>
                      <td className={styles.share}>
                        <div className={styles.sb}>
                          <div className={styles.sf} style={{ width: `${p.barWidthPct}%` }} />
                        </div>
                        <span>{fmtPct(p.participacaoPct)}%</span>
                      </td>
                    </tr>
                  ))}
                  {report.outros && isLastPage ? (
                    <tr>
                      <td className={styles.rank}>·</td>
                      <td>
                        <div className={styles.pname}>
                          <span className={styles.pdesc}>
                            Outros {report.outros.count} {itemWord}
                          </span>
                          <span className={styles.pmeta}>cauda longa</span>
                        </div>
                      </td>
                      <td className={styles.num}>{fmtInt(report.outros.qtd)}</td>
                      <td className={styles.num}>—</td>
                      <td className={`${styles.num} ${styles.strong}`}>
                        {fmtCurrency2(report.outros.venda)}
                      </td>
                      <td className={styles.num}>{fmtInt(report.outros.estoque)}</td>
                      <td className={styles.share} />
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {isLastPage ? (
                <div className={styles.ins}>
                  <h4>{report.insightProdutos.titulo}</h4>
                  <p>{report.insightProdutos.texto}</p>
                </div>
              ) : null}
            </div>
            {footer}
          </section>
        );
      })}

      {/* ============ SLIDE 4 (OPCIONAL) — CONJUNTO EM DESTAQUE ============
          Só existe quando o usuário pediu um destaque no Gerador e algum produto
          da coleção foi reconhecido. Vem logo depois da lista geral de produtos,
          repetindo os itens que já apareceram lá — de propósito: aqui eles são
          lidos como conjunto (total, ticket e peso no faturamento da coleção). */}
      {report.destaque ? (
        <section className={styles.slide} data-pdf-slide="" style={theme}>
          <div className={styles.head}>
            <div>
              <div className={styles.eyebrow}>{eyebrowName} · Destaque</div>
              <h2>{report.destaque.titulo}</h2>
            </div>
            <span className={styles.tag}>{report.destaque.subtitulo}</span>
          </div>
          <div className={styles.body}>
            <div className={styles.dstKpis}>
              <div className={`${styles.kpi} ${styles.accent}`}>
                <div className={styles.lbl}>Faturamento do conjunto</div>
                <div className={styles.val}>{fmtCurrency0(report.destaque.totals.venda)}</div>
                <div className={styles.foot}>venda líquida no período</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.lbl}>% do faturamento</div>
                <div className={styles.val}>
                  {fmtPct(report.destaque.totals.participacaoPct)}
                  <small>%</small>
                </div>
                <div className={styles.foot}>da coleção {report.collection.fullName}</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.lbl}>Peças vendidas</div>
                <div className={styles.val}>{fmtInt(report.destaque.totals.qtd)}</div>
                <div className={styles.foot}>
                  em {report.destaque.totals.skus}{" "}
                  {report.destaque.totals.skus === 1 ? "item" : "itens"}
                </div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.lbl}>Ticket médio</div>
                <div className={styles.val}>
                  <small>R$ </small>
                  {fmtInt(report.destaque.totals.precoMedio)}
                </div>
                <div className={styles.foot}>
                  {report.destaque.totals.estoque > 0
                    ? `${fmtInt(report.destaque.totals.estoque)} peças em estoque`
                    : "sem estoque na rede"}
                </div>
              </div>
            </div>

            <div className={styles.dstBody}>
              <div className={styles.dstCard}>
                <h3>Itens do conjunto</h3>
                <div className={styles.psub}>
                  Posição (#) e participação são as da coleção inteira
                </div>
                <div className={styles.dstRows}>
                  {report.destaque.items.map((p) => (
                    <div key={`${p.rank}-${p.nome}-${p.colorDescription}`} className={styles.prow}>
                      <div className={styles.prank}>{p.rank}</div>
                      <div className={styles.pinfo}>
                        <div className={styles.pn}>{p.nome}</div>
                        <div className={styles.pm}>{overviewMeta(p)}</div>
                        <div className={styles.bar}>
                          <i style={{ width: `${p.barWidthPct}%` }} />
                        </div>
                      </div>
                      <div className={styles.pval}>
                        <div className={styles.v}>{fmtCurrency0(p.venda)}</div>
                        <div className={styles.s}>{fmtPct(p.participacaoPct)}% da coleção</div>
                      </div>
                    </div>
                  ))}
                  {report.destaque.outros ? (
                    <div className={styles.dstOutros}>
                      <span>
                        + outros {report.destaque.outros.count} itens do conjunto ·{" "}
                        {fmtInt(report.destaque.outros.qtd)} un
                      </span>
                      <b>{fmtCurrency0(report.destaque.outros.venda)}</b>
                    </div>
                  ) : null}
                </div>
                <div className={styles.dstTotal}>
                  <span className={styles.dstTotalLbl}>Total do conjunto</span>
                  <span className={styles.dstTotalVal}>
                    {fmtCurrency2(report.destaque.totals.venda)}
                  </span>
                </div>
              </div>

              <div className={styles.dstSide}>
                <div className={styles.dstCard}>
                  <div className={styles.ct}>Peso no faturamento da coleção</div>
                  {/* O número em evidência é SEMPRE o do conjunto (a barra ativa).
                      Conjunto estreito não caberia o rótulo dentro da barra, então
                      ele vai logo ao lado — antes o slide acabava destacando o %
                      do RESTO da coleção, que é justamente o que o conjunto não é.
                      O % do resto continua visível, na legenda. */}
                  <div className={styles.dstStackWrap}>
                    <div className={styles.dstStack}>
                      <div
                        className={styles.dstStackA}
                        style={{ width: `${report.destaque.shareBar.destaquePct}%` }}
                      >
                        {report.destaque.shareBar.destaquePct >= 12 ? (
                          <span>{fmtPct(report.destaque.shareBar.destaquePct)}%</span>
                        ) : null}
                      </div>
                      <div className={styles.dstStackB} />
                    </div>
                    {report.destaque.shareBar.destaquePct < 12 ? (
                      <span className={styles.dstStackOut}>
                        {fmtPct(report.destaque.shareBar.destaquePct)}%
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.dstLegend}>
                    <span className={styles.dstLegendItem}>
                      <i className={styles.dstDot} style={{ background: "var(--accent)" }} />
                      {report.destaque.titulo} · <b>{fmtCurrency0(report.destaque.totals.venda)}</b>
                    </span>
                    <span className={styles.dstLegendItem}>
                      <i className={styles.dstDot} style={{ background: "var(--accent-soft2)" }} />
                      Resto da coleção · <b>{fmtCurrency0(report.destaque.shareBar.restoVenda)}</b> (
                      {fmtPct(report.destaque.shareBar.restoPct)}%)
                    </span>
                    {report.destaque.topCanal ? (
                      <span className={styles.dstLegendItem}>
                        Canal líder do conjunto: {report.destaque.topCanal.nome} ·{" "}
                        <b>{fmtPct(report.destaque.topCanal.participacaoPct)}%</b>
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className={styles.ins}>
                  <h4>{report.destaque.insight.titulo}</h4>
                  <p>{report.destaque.insight.texto}</p>
                </div>
              </div>
            </div>
          </div>
          {footer}
        </section>
      ) : null}

      {/* ============ SLIDE 5 — VENDAS POR LOJA ============ */}
      <section className={styles.slide} data-pdf-slide="" style={theme}>
        <div className={styles.head}>
          <div>
            <div className={styles.eyebrow}>{eyebrowName} · Canais</div>
            <h2>Vendas por loja</h2>
          </div>
          <span className={styles.tag}>{report.kpis.canaisAtivos} canais ativos</span>
        </div>
        <div className={styles.body}>
          <div className={styles.storewrap}>
            <div className={styles.tablecard}>
              <div className={styles.ct}>Ranking de canais</div>
              <table>
                <thead>
                  <tr>
                    <th>Canal</th>
                    <th className={styles.num}>Venda líq.</th>
                    <th className={styles.num}>Qtd</th>
                    <th className={styles.num}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stores.map((s) => (
                    <tr key={s.nome}>
                      <td className={styles.sname}>{s.nome}</td>
                      <td className={styles.num}>{fmtCurrency2(s.venda)}</td>
                      <td className={styles.num}>{fmtInt(s.qtd)}</td>
                      <td className={`${styles.num} ${styles.strong}`} style={{ color: "var(--accent)" }}>
                        {fmtPct(s.participacaoPct)}%
                      </td>
                    </tr>
                  ))}
                  <tr className={styles.totrow}>
                    <td>TOTAL</td>
                    <td className={styles.num}>{fmtCurrency2(report.storesTotal.venda)}</td>
                    <td className={styles.num}>{fmtInt(report.storesTotal.qtd)}</td>
                    <td className={styles.num}>100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={styles.chartcard}>
              <div className={styles.ct}>Faturamento por canal</div>
              <div className={styles.cs}>{report.storeChartSubtitle}</div>
              <div className={styles.hbarChart}>
                {report.storeBars.map((b) => (
                  <div key={b.nome} className={styles.hbarRow}>
                    <div className={styles.hbarLabel}>{b.nome}</div>
                    <div className={styles.hbarTrack}>
                      <div className={styles.hbarFill} style={{ width: `${b.widthPct}%`, background: b.color }}>
                        {b.showPctInside ? <span>{b.pctLabel}</span> : null}
                      </div>
                      <div className={styles.hbarValue}>{fmtCurrency0(b.venda)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {footer}
      </section>

      {/* ============ SLIDE 6 — CONCLUSÃO ============ */}
      <section className={styles.slide} data-pdf-slide="" style={theme}>
        <div className={styles.head}>
          <div>
            <div className={styles.eyebrow}>{eyebrowName} · Conclusão</div>
            <h2>O que os dados contam</h2>
          </div>
          <Logo dataUrl={logoDataUrl} small />
        </div>
        <div className={styles.body}>
          <div className={styles.closeGrid}>
            <div className={`${styles.ins} ${styles.closeCard}`} style={{ borderLeftColor: "var(--accent)" }}>
              <h4>{report.closing.insightA.titulo}</h4>
              <p>{report.closing.insightA.texto}</p>
            </div>
            <div className={`${styles.ins} ${styles.closeCard}`} style={{ borderLeftColor: "var(--accent-2)" }}>
              <h4>{report.closing.insightB.titulo}</h4>
              <p>{report.closing.insightB.texto}</p>
            </div>
          </div>
          <div
            className={styles.footKpis}
            style={{ gridTemplateColumns: `repeat(${report.closing.footKpis.length}, 1fr)` }}
          >
            {report.closing.footKpis.map((k) => (
              <div key={k.label} className={styles.kpi}>
                <div className={styles.lbl}>{k.label}</div>
                <div className={styles.val} style={{ fontSize: k.fontSize }}>
                  {k.value}
                </div>
              </div>
            ))}
          </div>
        </div>
        {footer}
      </section>
    </div>
  );
}
