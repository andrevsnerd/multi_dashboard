"use client";

import { type RefObject } from "react";

import type { ProdutoGiroPresentationPayload } from "@/lib/repositories/produtoGiroPresentation";
import { isScarfmeBrand, presentationBrandName } from "@/lib/presentations/brand";

import styles from "./ProdutoGiroDeck.module.css";

interface ProdutoGiroDeckProps {
  report: ProdutoGiroPresentationPayload;
  logoDataUrl: string | null;
  coverDataUrl: string | null;
  coverTitle?: string;
  companyName: string;
  deckRef?: RefObject<HTMLDivElement | null>;
}

// Paleta dos segmentos (donut/heatmap/legendas) — deriva do coral do template.
const PALETTE = ["#f0776b", "#f4988e", "#c99a4e", "#7a9e9f", "#b98a5e", "#9d8fb0", "#d9cfc7", "#e8a598"];
const HEAT_BUCKETS = ["#fbeae7", "#f6c9c1", "#f0a89b", "#ea8474", "#e3624f", "#d0402c"];

// ─── formatação ──────────────────────────────────────────────────────────────
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}
function fmtCurrency0(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtPct(n: number, dec = 0): string {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
}
function fmtSigned(n: number): string {
  return `${n >= 0 ? "+" : ""}${fmtPct(n)}`;
}

function Logo({ dataUrl, companyName }: { dataUrl: string | null; companyName: string }) {
  if (dataUrl) return <img className={styles.logo} src={dataUrl} alt={companyName} />;
  if (isScarfmeBrand(companyName)) {
    return (
      <div className={styles.wordmark}>
        SCARF<span className={styles.dot}>·</span>ME
      </div>
    );
  }
  return <div className={styles.wordmark}>{presentationBrandName(companyName)}</div>;
}

/** Barras verticais (ritmo diário / semanal) como SVG. */
function VBarChart({
  bars,
  height = 240,
  showLine = false,
}: {
  bars: Array<{ label: string; value: number; highlight?: boolean; line?: number | null }>;
  height?: number;
  showLine?: boolean;
}) {
  const W = 1144;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padB = 34;
  const padT = 16;
  const plotW = W - padL - padR;
  const plotH = H - padB - padT;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const n = bars.length || 1;
  const slot = plotW / n;
  const bw = Math.min(slot * 0.62, 46);
  const x = (i: number) => padL + slot * i + (slot - bw) / 2;
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const cx = (i: number) => padL + slot * i + slot / 2;

  const linePts = showLine
    ? bars
        .map((b, i) => (b.line == null ? null : `${cx(i)},${y(b.line)}`))
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} fontFamily="Manrope, Arial">
      {bars.map((b, i) => (
        <g key={i}>
          <rect
            x={x(i)}
            y={y(b.value)}
            width={bw}
            height={Math.max(0, padT + plotH - y(b.value))}
            rx={5}
            fill={b.highlight ? "#f0776b" : "#e8d9c9"}
          />
          <text x={cx(i)} y={y(b.value) - 6} fontSize="13" fill="#1a1417" textAnchor="middle" fontWeight="700">
            {b.value > 0 ? fmtInt(b.value) : ""}
          </text>
          <text x={cx(i)} y={H - 12} fontSize="11" fill="#8a7d80" textAnchor="middle">
            {b.label}
          </text>
        </g>
      ))}
      {showLine && linePts && (
        <polyline points={linePts} fill="none" stroke="#c99a4e" strokeWidth="2.5" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/** Barras verticais em R$ (ritmo semanal). */
function VBarCurrency({ bars, height = 240 }: { bars: Array<{ label: string; value: number; highlight?: boolean }>; height?: number }) {
  const W = 1144;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padB = 34;
  const padT = 22;
  const plotW = W - padL - padR;
  const plotH = H - padB - padT;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const n = bars.length || 1;
  const slot = plotW / n;
  const bw = Math.min(slot * 0.56, 70);
  const x = (i: number) => padL + slot * i + (slot - bw) / 2;
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const cx = (i: number) => padL + slot * i + slot / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} fontFamily="Manrope, Arial">
      {bars.map((b, i) => (
        <g key={i}>
          <rect
            x={x(i)}
            y={y(b.value)}
            width={bw}
            height={Math.max(0, padT + plotH - y(b.value))}
            rx={6}
            fill={b.highlight ? "#f0776b" : "#e8d9c9"}
          />
          <text x={cx(i)} y={y(b.value) - 7} fontSize="12" fill="#1a1417" textAnchor="middle" fontWeight="800">
            {fmtCurrency0(b.value)}
          </text>
          <text x={cx(i)} y={H - 12} fontSize="11" fill="#8a7d80" textAnchor="middle">
            {b.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Donut SVG (top N + demais). */
function Donut({
  segments,
  centerTop,
  centerBottom,
}: {
  segments: Array<{ value: number; color: string }>;
  centerTop: string;
  centerBottom: string;
}) {
  const cx = 220;
  const cy = 220;
  const rOuter = 150;
  const rInner = 88;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  // Somas de prefixo (sem reatribuir variável fora do map — regra de imutabilidade).
  const cumFractions: number[] = [];
  segments.reduce((acc, seg) => {
    cumFractions.push(acc);
    return acc + seg.value / total;
  }, 0);
  const arc = (startA: number, endA: number, r: number) => {
    const large = endA - startA > Math.PI ? 1 : 0;
    return {
      x1: cx + r * Math.cos(startA),
      y1: cy + r * Math.sin(startA),
      x2: cx + r * Math.cos(endA),
      y2: cy + r * Math.sin(endA),
      large,
    };
  };
  const paths = segments.map((seg, i) => {
    const frac = seg.value / total;
    const startA = -Math.PI / 2 + cumFractions[i] * Math.PI * 2;
    const endA = startA + frac * Math.PI * 2;
    const o = arc(startA, endA, rOuter);
    const inr = arc(startA, endA, rInner);
    const d = `M ${o.x1.toFixed(1)} ${o.y1.toFixed(1)} A ${rOuter} ${rOuter} 0 ${o.large} 1 ${o.x2.toFixed(1)} ${o.y2.toFixed(1)} L ${inr.x2.toFixed(1)} ${inr.y2.toFixed(1)} A ${rInner} ${rInner} 0 ${o.large} 0 ${inr.x1.toFixed(1)} ${inr.y1.toFixed(1)} Z`;
    return <path key={i} d={d} fill={seg.color} />;
  });
  return (
    <svg viewBox="0 0 440 440" width="100%" style={{ maxWidth: 360, display: "block", margin: "0 auto" }} fontFamily="Manrope, Arial">
      {paths}
      <text x={cx} y={cy - 6} fontSize="34" fill="#1a1417" textAnchor="middle" fontWeight="800">
        {centerTop}
      </text>
      <text x={cx} y={cy + 20} fontSize="14" fill="#8a7d80" textAnchor="middle">
        {centerBottom}
      </text>
    </svg>
  );
}

/** Salto 3 dias: 2 barras comparativas. */
function GrowthBars({ prev, cur, prevLabel, curLabel }: { prev: number; cur: number; prevLabel: string; curLabel: string }) {
  const max = Math.max(1, prev, cur);
  const baseY = 248;
  const barH = (v: number) => (v / max) * 210;
  const prevH = barH(prev);
  const curH = barH(cur);
  return (
    <svg viewBox="0 0 520 300" width="100%" fontFamily="Manrope, Arial">
      <rect x="65" y={baseY - prevH} width="150" height={prevH} rx="8" fill="#e8d9c9" />
      <text x="140" y={baseY - prevH - 12} fontSize="20" fill="#8a7d80" textAnchor="middle" fontWeight="800">
        {fmtCurrency0(prev)}
      </text>
      <text x="140" y="270" fontSize="13" fill="#8a7d80" textAnchor="middle" fontWeight="700">
        {prevLabel}
      </text>
      <text x="140" y="288" fontSize="11" fill="#8a7d80" textAnchor="middle">
        semana passada
      </text>
      <rect x="305" y={baseY - curH} width="150" height={curH} rx="8" fill="#f0776b" />
      <text x="380" y={baseY - curH - 12} fontSize="22" fill="#1a1417" textAnchor="middle" fontWeight="800">
        {fmtCurrency0(cur)}
      </text>
      <text x="380" y="270" fontSize="13" fill="#1a1417" textAnchor="middle" fontWeight="700">
        {curLabel}
      </text>
      <text x="380" y="288" fontSize="11" fill="#f0776b" textAnchor="middle" fontWeight="700">
        semana atual
      </text>
    </svg>
  );
}

function heatColor(q: number, max: number): { bg: string; fg: string } {
  if (q <= 0) return { bg: "#faf7f5", fg: "#c9bec0" };
  const ratio = q / max;
  const idx = Math.min(HEAT_BUCKETS.length - 1, Math.floor(ratio * HEAT_BUCKETS.length));
  return { bg: HEAT_BUCKETS[idx], fg: idx >= 3 ? "#fff" : "#1a1417" };
}

export default function ProdutoGiroDeck({
  report,
  logoDataUrl,
  coverDataUrl,
  coverTitle,
  companyName,
  deckRef,
}: ProdutoGiroDeckProps) {
  const dimSing = report.dimensao === "cores" ? "cor" : "produto";
  const dimPlur = report.dimensao === "cores" ? "cores" : "produtos";
  const title = (coverTitle?.trim() || report.title || "Produtos").trim();
  const footerText = `${title} · ${report.period.short}`;

  const footer = (dark = false) => (
    <div className={styles.foot}>
      {logoDataUrl ? (
        <img src={logoDataUrl} alt={companyName} />
      ) : (
        <span className={styles.footWordmark} style={dark ? { color: "#fff" } : undefined}>
          {presentationBrandName(companyName)}
        </span>
      )}
      <span>{footerText}</span>
    </div>
  );

  const k = report.kpis;
  const ch = report.channel;

  // capa: callout de crescimento (usa o salto 3 dias quando existe).
  const three = report.weekly.three;
  const coverPct = three?.pctVendas ?? null;

  const dailyBars = report.daily.points.map((p) => ({
    label: p.label,
    value: p.qtde,
    highlight: p.isRecent,
    line: p.movingAvg,
  }));
  const weeklyBars = report.weekly.points.map((p) => ({ label: p.label, value: p.vendas, highlight: p.partial }));
  // Cards do slide "Ritmo Semanal": as 3 últimas semanas (2 fechadas + a parcial).
  const weeklyCards = report.weekly.points.slice(-3);

  const maxTopColor = Math.max(1, ...report.topColors.map((c) => c.qtd));
  const donutSegs = [
    ...report.colorMix.segments.map((s, i) => ({ value: s.qtd, color: PALETTE[i % PALETTE.length] })),
    ...(report.colorMix.othersUn > 0 ? [{ value: report.colorMix.othersUn, color: "#d9cfc7" }] : []),
  ];
  const legendItems = [
    ...report.colorMix.segments.map((s, i) => ({
      nome: s.nome,
      color: PALETTE[i % PALETTE.length],
      qtd: s.qtd,
      pct: s.pct,
    })),
    ...(report.colorMix.othersUn > 0
      ? [{ nome: `Demais ${dimPlur}`, color: "#d9cfc7", qtd: report.colorMix.othersUn, pct: report.colorMix.othersPct }]
      : []),
  ];

  const top3 = report.topColors.slice(0, 3);
  const top3Un = top3.reduce((s, c) => s + c.qtd, 0);
  const top3Pct = top3.reduce((s, c) => s + c.pct, 0);
  const heatDays = report.heat.days;

  return (
    <div ref={deckRef} className={styles.deck}>
      {/* ============ 1 · CAPA ============ */}
      <section className={`${styles.slide} ${styles.cover}`} data-pdf-slide="">
        {coverDataUrl ? (
          <div className={styles.coverImg} style={{ backgroundImage: `url("${coverDataUrl}")` }} />
        ) : (
          <div className={styles.coverImgPlaceholder}>
            Selecione a imagem de capa
            <br />
            no gerador para exibi-la aqui.
          </div>
        )}
        <div className={styles.coverScrim} />
        <div className={styles.coverLeft}>
          <Logo dataUrl={logoDataUrl} companyName={companyName} />
          <div className={styles.kicker} style={{ color: "#f4988e", marginTop: 60 }}>
            Relatório de Performance
          </div>
          <h1 className={styles.coverTitle}>{title}</h1>
          <div className={styles.coverRule} />
          <p className={styles.coverP}>
            Ritmo de vendas, aceleração recente e desempenho por {dimSing}.
            <br />
            Período analisado: <b>{report.period.label}</b>.
          </p>
          {coverPct != null && (
            <div className={styles.coverCallout}>
              <div className={styles.coverCalloutN}>{fmtSigned(coverPct)}</div>
              <div className={styles.coverCalloutT}>
                faturamento nos últimos {three?.dias ?? 3} dias
                <br />
                vs. mesmos dias da semana passada
              </div>
            </div>
          )}
          <div className={styles.coverMeta}>
            {report.meta.filialLabel} &nbsp;|&nbsp; {fmtInt(k.coresComVenda)} {dimPlur} com venda
          </div>
        </div>
      </section>

      {/* ============ 2 · VISÃO GERAL / KPIs ============ */}
      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.pad}>
          <div className={styles.kicker}>Visão Geral · {report.period.short}</div>
          <h1 className={styles.title}>O período em números</h1>
          <p className={styles.sub}>
            Volume real de saída e faturamento no período de {report.period.dias} dia(s) (lojas físicas +
            e-commerce, líquido de trocas).
          </p>
          <div className={styles.kpiGrid} style={{ marginTop: 34 }}>
            <div className={`${styles.card} ${styles.kpi}`}>
              <div className={styles.big}>{fmtInt(k.unidades)}</div>
              <div className={styles.lab}>Unidades vendidas</div>
              <div className={styles.chg}>{k.mediaDiariaUn.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} un/dia</div>
            </div>
            <div className={`${styles.card} ${styles.kpi}`}>
              <div className={styles.big}>{fmtCurrency0(k.faturamento)}</div>
              <div className={styles.lab}>Faturamento do período</div>
              <div className={styles.chg}>ticket {fmtCurrency0(k.ticket)}</div>
            </div>
            <div className={`${styles.card} ${styles.kpi}`}>
              <div className={styles.big}>{fmtInt(k.coresComVenda)}</div>
              <div className={styles.lab}>{dimPlur} com venda</div>
              <div className={styles.chg}>de {fmtInt(k.coresAtivas)} ativas</div>
            </div>
            <div className={`${styles.card} ${styles.kpi}`}>
              <div className={`${styles.big} ${k.secondHalfVsFirstPct != null && k.secondHalfVsFirstPct >= 0 ? styles.up : styles.down}`}>
                {k.secondHalfVsFirstPct == null ? "—" : fmtSigned(k.secondHalfVsFirstPct)}
              </div>
              <div className={styles.lab}>2ª metade vs 1ª</div>
              <div className={`${styles.chg} ${k.secondHalfVsFirstPct != null && k.secondHalfVsFirstPct >= 0 ? styles.up : styles.down}`}>
                {k.secondHalfVsFirstPct != null && k.secondHalfVsFirstPct >= 0 ? "▲ aceleração" : "▼ desaceleração"}
              </div>
            </div>
          </div>
          <div className={styles.two} style={{ marginTop: 34 }}>
            <div className={styles.hlBox}>
              <div className={styles.n}>{fmtInt(k.secondHalfUn)} un</div>
              <div className={styles.t}>
                vendidas na segunda metade ({k.splitLabelSecond}) — contra {fmtInt(k.firstHalfUn)} un na primeira
                ({k.splitLabelFirst}).
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Composição por canal</div>
              <div className={styles.channelBar}>
                {ch.hasEcommerce && (
                  <div className={styles.channelSeg} style={{ width: `${Math.max(6, ch.ecomShare)}%`, background: "#f0776b" }}>
                    E-commerce {fmtPct(ch.ecomShare)}
                  </div>
                )}
                <div
                  className={styles.channelSeg}
                  style={{ width: `${Math.max(6, ch.retailShare)}%`, background: "#c99a4e" }}
                >
                  Lojas {fmtPct(ch.retailShare)}
                </div>
              </div>
              <p className={styles.channelText}>
                {ch.hasEcommerce ? (
                  <>
                    <b>E-commerce:</b> {fmtInt(ch.ecomUn)} un ({fmtCurrency0(ch.ecomVendas)}) online vs{" "}
                    {fmtInt(ch.retailUn)} un ({fmtCurrency0(ch.retailVendas)}) nas lojas. O online responde por{" "}
                    {fmtPct(ch.ecomUnShare)} das unidades e {fmtPct(ch.ecomShare)} do faturamento.
                  </>
                ) : (
                  <>
                    <b>Lojas físicas:</b> {fmtInt(ch.retailUn)} un ({fmtCurrency0(ch.retailVendas)}) no período.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
        {footer()}
      </section>

      {/* ============ 3 · RITMO DIÁRIO ============ */}
      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.pad}>
          <div className={styles.kicker}>Ritmo Diário</div>
          <h1 className={styles.title}>Vendas dia a dia — a curva de aceleração</h1>
          <p className={styles.sub}>
            Unidades vendidas por dia ({report.period.short}). Barras em coral destacam os 3 últimos dias; a
            linha dourada é a média móvel de 3 dias.
          </p>
          <div className={styles.chartBox}>
            <VBarChart bars={dailyBars} showLine height={280} />
          </div>
          <div className={styles.callouts}>
            {report.daily.pico && (
              <div>
                <span className={styles.tag}>PICO</span>
                <div style={{ fontSize: 15, marginTop: 4 }}>
                  <b>
                    {report.daily.pico.label} — {fmtInt(report.daily.pico.qtde)} un
                  </b>{" "}
                  · maior dia do período
                </div>
              </div>
            )}
            {report.daily.virada && (
              <div>
                <span className={styles.tag}>VIRADA</span>
                <div style={{ fontSize: 15, marginTop: 4 }}>
                  <b>{report.daily.virada.label} em diante</b> · média sobe e se sustenta
                </div>
              </div>
            )}
            <div>
              <span className={styles.tag}>FECHAMENTO</span>
              <div style={{ fontSize: 15, marginTop: 4 }}>
                <b>{fmtInt(report.daily.fechamento3dUn)} un em 3 dias</b>
              </div>
            </div>
          </div>
        </div>
        {footer()}
      </section>

      {/* ============ 4 · RITMO SEMANAL ============ */}
      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.pad}>
          <div className={styles.kicker}>Ritmo Semanal</div>
          <h1 className={styles.title}>Evolução por semana</h1>
          <p className={styles.sub}>
            Faturamento por semana (8 semanas) para dar contexto. A última coluna é parcial (dias já decorridos
            desta semana).
          </p>
          <div className={styles.fill}>
            <div className={styles.chartBox}>
              <VBarCurrency bars={weeklyBars} height={210} />
            </div>
            <div className={`${styles.kpiGrid} ${styles.kpiGrid3}`} style={{ marginTop: 18 }}>
              {weeklyCards.map((c) =>
                c.partial && three ? (
                  <div key={c.label} className={`${styles.card} ${styles.kpi} ${styles.kpiDark}`}>
                    <div className={styles.lab}>
                      Parcial {three.curLabel} ({three.dias} dias)
                    </div>
                    <div className={styles.big} style={{ fontSize: 26 }}>
                      {three.pctVendas == null ? fmtCurrency0(c.vendas) : fmtSigned(three.pctVendas)}
                    </div>
                    <div className={styles.chg}>vs mesmos dias da semana passada</div>
                  </div>
                ) : (
                  <div key={c.label} className={`${styles.card} ${styles.kpi}`}>
                    <div className={styles.lab}>Semana {c.label}</div>
                    <div className={styles.big} style={{ fontSize: 26 }}>
                      {fmtCurrency0(c.vendas)}
                    </div>
                    <div className={`${styles.chg} ${c.deltaPct != null && c.deltaPct >= 0 ? styles.up : styles.down}`}>
                      {c.deltaPct == null
                        ? `${fmtInt(c.qtde)} un`
                        : `${fmtSigned(c.deltaPct)} vs sem. anterior`}
                    </div>
                  </div>
                )
              )}
            </div>
            <p className={styles.note}>
              Fonte canônica: POS (líquido de trocas) + e-commerce, mesma base do Dashboard/Curva ABC. Última
              coluna é parcial.
            </p>
          </div>
        </div>
        {footer()}
      </section>

      {/* ============ 5 · SALTO 3 DIAS ============ */}
      {three && (
        <section className={`${styles.slide} ${styles.dark}`} data-pdf-slide="">
          <div className={styles.pad}>
            <div className={styles.kicker} style={{ color: "#f4988e" }}>
              🔥 Semana Atual · {three.curLabel}
            </div>
            <h1 className={styles.title} style={{ color: "#fff" }}>
              O salto dos últimos {three.dias} dias
            </h1>
            <p className={styles.sub}>
              Comparando os {three.dias} primeiros dias desta semana com exatamente os mesmos dias da semana
              passada — aceleração real de demanda, não sazonalidade de calendário.
            </p>
            <div className={styles.fill}>
              <div className={styles.growthGrid}>
                <div className={styles.growthChart}>
                  <GrowthBars prev={three.prevVendas} cur={three.curVendas} prevLabel={three.prevLabel} curLabel={three.curLabel} />
                </div>
                <div>
                  <div className={styles.growthBig}>{three.pctVendas == null ? "—" : fmtSigned(three.pctVendas)}</div>
                  <div className={styles.growthLabel}>em faturamento</div>
                  <div className={styles.growthRule} />
                  <div className={styles.growthMetrics}>
                    <div>
                      <div className={styles.m}>{three.pctUn == null ? "—" : fmtSigned(three.pctUn)}</div>
                      <div className={styles.ml}>em unidades</div>
                    </div>
                    <div>
                      <div className={styles.m}>{fmtInt(three.curUn)} un</div>
                      <div className={styles.ml}>vs {fmtInt(three.prevUn)} un antes</div>
                    </div>
                  </div>
                  <p className={styles.growthP}>
                    Os mesmos {three.dias} dias da semana passada renderam <b>{fmtCurrency0(three.prevVendas)}</b>. Esta
                    semana, já <b>{fmtCurrency0(three.curVendas)}</b> em {fmtInt(three.curUn)} unidades
                    {report.daily.pico ? (
                      <>
                        {" "}
                        — puxado pelo pico de {fmtInt(report.daily.pico.qtde)} un em {report.daily.pico.label}.
                      </>
                    ) : (
                      "."
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
          {footer(true)}
        </section>
      )}

      {/* ============ 6 · TOP CORES/ITENS ============ */}
      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.pad}>
          <div className={styles.kicker}>Campeãs de Venda</div>
          <h1 className={styles.title}>Os {dimPlur} que mais venderam</h1>
          <p className={styles.sub}>Top {report.topColors.length} {dimPlur} por unidades vendidas no período, com o faturamento correspondente.</p>
          <div className={styles.fill}>
            <div className={styles.hbars}>
              {report.topColors.map((c) => (
                <div key={c.nome} className={styles.hbarRow}>
                  <div className={styles.hbarLabel}>{c.nome}</div>
                  <div className={styles.hbarTrack} style={{ width: `${Math.max(4, (c.qtd / maxTopColor) * 100)}%` }} />
                  <div className={styles.hbarVal}>
                    <b>{fmtInt(c.qtd)} un</b> · {fmtCurrency0(c.venda)}
                  </div>
                </div>
              ))}
            </div>
            {top3.length > 0 && (
              <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
                <span className={styles.pill}>🏆 {top3[0].nome} lidera com {fmtInt(top3[0].qtd)} un</span>
                <span className={`${styles.pill} ${styles.pillGold}`}>
                  Top 3 = {fmtInt(top3Un)} un ({fmtPct(top3Pct)} do total)
                </span>
              </div>
            )}
          </div>
        </div>
        {footer()}
      </section>

      {/* ============ 7 · MIX (donut) ============ */}
      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.pad}>
          <div className={styles.kicker}>Concentração</div>
          <h1 className={styles.title}>Como o volume se distribui entre {report.dimensao === "cores" ? "as cores" : "os produtos"}</h1>
          <p className={styles.sub}>
            Participação de cada {dimSing} no total de unidades. Poucos concentram a maior parte da saída —
            leitura útil para priorizar reposição.
          </p>
          <div className={styles.fill}>
            <div className={styles.two}>
              <Donut segments={donutSegs} centerTop={fmtInt(report.colorMix.total)} centerBottom="unidades" />
              <div className={styles.legend}>
                {legendItems.map((l) => (
                  <div key={l.nome} className={styles.lgRow}>
                    <span className={styles.dot} style={{ background: l.color }} />
                    <span className={styles.lgLab}>{l.nome}</span>
                    <span className={styles.lgVal}>
                      {fmtInt(l.qtd)} un · {fmtPct(l.pct)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {footer()}
      </section>

      {/* ============ 8 · VENDAS POR FILIAL ============ */}
      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.pad}>
          <div className={styles.kicker}>Onde Vende</div>
          <h1 className={styles.title}>Desempenho por canal e filial</h1>
          <p className={styles.sub}>Faturamento do período por ponto de venda, com a participação de cada um na rede.</p>
          <div className={styles.fill}>
            <div className={styles.hbars}>
              {report.stores.buckets.map((b) => {
                const max = Math.max(1, ...report.stores.buckets.map((x) => x.vendas));
                return (
                  <div key={b.key} className={styles.hbarRow}>
                    <div className={styles.hbarLabel}>{b.label}</div>
                    <div
                      className={styles.hbarTrack}
                      style={{ width: `${Math.max(4, (b.vendas / max) * 100)}%`, background: b.ecommerce ? "#c99a4e" : "#f0776b" }}
                    />
                    <div className={styles.hbarVal}>
                      <b>{fmtCurrency0(b.vendas)}</b> · {fmtPct(b.pct)}
                    </div>
                  </div>
                );
              })}
            </div>
            {ch.hasEcommerce && (
              <div style={{ display: "flex", gap: 14, marginTop: 24 }}>
                <span className={styles.pill}>🛒 E-commerce: {fmtCurrency0(ch.ecomVendas)} ({fmtPct(ch.ecomShare)} da rede)</span>
                <span className={`${styles.pill} ${styles.pillGold}`}>
                  🏬 {report.stores.buckets.filter((b) => !b.ecommerce).length} lojas físicas: {fmtCurrency0(ch.retailVendas)}
                </span>
              </div>
            )}
          </div>
        </div>
        {footer()}
      </section>

      {/* ============ 9 · HEATMAP cor×dia ============ */}
      {report.heat.colors.length > 0 && heatDays.length > 0 && (
        <section className={styles.slide} data-pdf-slide="">
          <div className={styles.pad}>
            <div className={styles.kicker}>{report.dimensao === "cores" ? "Cor × Dia" : "Produto × Dia"}</div>
            <h1 className={styles.title}>Onde e quando cada {dimSing} girou</h1>
            <p className={styles.sub}>
              Mapa de calor {report.dimensao === "cores" ? "das cores" : "dos produtos"} mais vendidas ao longo do
              período. Quanto mais intenso o coral, mais unidades naquele dia.
            </p>
            <div className={styles.fill}>
              <div className={styles.heatWrap}>
                <table className={styles.heatTable}>
                  <thead>
                    <tr>
                      <th className={styles.rowHead}>{report.dimensao === "cores" ? "Cor" : "Produto"}</th>
                      {heatDays.map((d) => (
                        <th key={d}>{d.slice(8, 10)}</th>
                      ))}
                      <th>Tot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.heat.colors.map((c) => (
                      <tr key={c.nome}>
                        <td className={styles.rowHead}>{c.nome}</td>
                        {heatDays.map((d) => {
                          const q = c.porDia[d] ?? 0;
                          const { bg, fg } = heatColor(q, report.heat.max);
                          return (
                            <td key={d} className={styles.heatCell} style={{ background: bg, color: fg }}>
                              {q > 0 ? q : ""}
                            </td>
                          );
                        })}
                        <td className={styles.heatCell} style={{ fontWeight: 800 }}>
                          {fmtInt(c.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.note}>Colunas = dias do período; intensidade proporcional às unidades vendidas naquele dia.</p>
            </div>
          </div>
          {footer()}
        </section>
      )}

      {/* ============ 10 · SÍNTESE ============ */}
      <section className={`${styles.slide} ${styles.dark}`} data-pdf-slide="">
        <div className={styles.pad}>
          <div className={styles.kicker} style={{ color: "#f4988e", marginTop: 44 }}>
            Síntese
          </div>
          <h1 className={styles.title} style={{ color: "#fff", fontSize: 38 }}>
            O que os {report.period.dias} dias mostram
          </h1>
          <div className={styles.synthGrid}>
            {report.synthesis.map((s) => (
              <div key={s.titulo} className={styles.synthCard}>
                <div className={styles.h}>{s.titulo}</div>
                <p>{s.texto}</p>
              </div>
            ))}
          </div>
        </div>
        {footer(true)}
      </section>
    </div>
  );
}
