"use client";

import { type RefObject } from "react";

import type {
  ComparativoResumidoPayload,
  ResumoColecaoCard,
} from "@/lib/repositories/comparativoResumido";

import styles from "./ComparativoResumidoDeck.module.css";

const CARDS_PER_SLIDE = 4;
const CORAL = "#F96167";

interface ComparativoResumidoDeckProps {
  payload: ComparativoResumidoPayload;
  logoDataUrl: string | null;
  coversByCode: Record<string, string | null>;
  deckRef?: RefObject<HTMLDivElement | null>;
}

const hex = (c: string) => (c.startsWith("#") ? c : `#${c}`);

function brl0(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function brlCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (abs >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString("pt-BR")} mil`;
  return brl0(v);
}
function intBR(v: number): string {
  return Math.round(v).toLocaleString("pt-BR");
}

function Wordmark({ color, size }: { color: string; size: number }) {
  return (
    <span style={{ fontFamily: "Arial, system-ui, sans-serif", fontWeight: 800, fontSize: size, color, letterSpacing: 1 }}>
      SCARF<span style={{ color: CORAL, margin: "0 2px" }}>·</span>ME
    </span>
  );
}

// Mini gráfico de área/linha da evolução mensal da venda líquida.
function MiniChart({ card }: { card: ResumoColecaoCard }) {
  const p = card.palette;
  const months = card.months;
  const n = months.length;

  const W = 250;
  const H = 92;
  const padT = 18;
  const padB = 20;
  const padX = 16;
  const plotW = W - padX * 2;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;

  if (n === 0) {
    return (
      <div className={styles.chartEmpty} style={{ width: W }}>
        sem série mensal
      </div>
    );
  }

  const pts = months.map((m, i) => ({
    x: padX + (n <= 1 ? plotW / 2 : plotW * (i / (n - 1))),
    y: padT + plotH - (m.val / card.maxV) * plotH,
    label: m.label,
    disp: m.disp,
  }));

  const areaPath =
    `M ${pts[0].x} ${baseY} ` + pts.map((q) => `L ${q.x} ${q.y}`).join(" ") + ` L ${pts[pts.length - 1].x} ${baseY} Z`;
  const linePath = pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`).join(" ");

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg}>
      <path d={areaPath} fill={hex(p.chartTint)} stroke="none" />
      {n > 1 && <path d={linePath} fill="none" stroke={hex(p.primary)} strokeWidth={2.4} strokeLinejoin="round" />}
      {pts.map((q, i) => {
        const anchor = i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle";
        const lx = i === 0 ? q.x - 2 : i === pts.length - 1 ? q.x + 2 : q.x;
        return (
          <g key={i}>
            <circle cx={q.x} cy={q.y} r={3.2} fill={hex(p.primary)} />
            <text
              x={lx}
              y={q.y - 8}
              textAnchor={anchor}
              fontFamily="Arial, sans-serif"
              fontWeight={700}
              fontSize={11}
              fill={hex(p.primary)}
            >
              {q.disp}
            </text>
            <text
              x={q.x}
              y={baseY + 15}
              textAnchor="middle"
              fontFamily="Arial, sans-serif"
              fontSize={10.5}
              fill={hex(p.grey)}
            >
              {q.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Card({ card, index, cover }: { card: ResumoColecaoCard; index: number; cover: string | null }) {
  const p = card.palette;
  return (
    <div className={styles.card} style={{ borderColor: hex(p.tint) }}>
      {/* Foto flutuante sobre o círculo tingido (recorte PNG transparente). */}
      <div className={styles.photoWrap} style={{ background: hex(p.tint) }}>
        <div className={styles.photoRing} style={{ borderColor: hex(p.circ) }} />
        {cover ? (
          <img src={cover} alt={card.title} className={styles.photo} />
        ) : (
          <span className={styles.photoRank} style={{ color: hex(p.primary) }}>
            {index + 1}
          </span>
        )}
      </div>

      <div className={styles.nameBlock}>
        <div className={styles.name} style={{ color: hex(p.ink) }}>
          {card.title}
        </div>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricValue} style={{ color: hex(p.ink) }}>
            {brl0(card.vl)}
          </span>
          <span className={styles.metricLabel} style={{ color: hex(p.primary) }}>
            VENDA LÍQUIDA
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue} style={{ color: hex(p.ink) }}>
            {intBR(card.qtde)}
          </span>
          <span className={styles.metricLabel}>QTD.</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricValue} style={{ color: hex(p.ink) }}>
            {intBR(card.skus)}
          </span>
          <span className={styles.metricLabel}>PEÇAS (SKUS)</span>
        </div>
      </div>

      <div className={styles.chart}>
        <MiniChart card={card} />
      </div>
    </div>
  );
}

function Cover({ payload, logoDataUrl }: { payload: ComparativoResumidoPayload; logoDataUrl: string | null }) {
  const stats = [
    { v: brlCompact(payload.totals.vendaLiquida), l: "VENDA LÍQUIDA TOTAL" },
    { v: String(payload.totals.colecoes), l: "COLEÇÕES" },
    { v: intBR(payload.totals.qtde), l: "PEÇAS VENDIDAS" },
    { v: payload.period.statLabel, l: "PERÍODO" },
  ];
  return (
    <section className={styles.slide} data-pdf-slide="" style={{ background: "#13131A" }}>
      <div className={`${styles.canvas} ${styles.coverCanvas}`}>
        <div className={styles.coverLogo}>
          {logoDataUrl ? (
            <img src={logoDataUrl} alt="SCARF·ME" className={styles.coverLogoImg} />
          ) : (
            <Wordmark color="#FFFFFF" size={30} />
          )}
        </div>
        <div className={styles.coverEyebrow}>COMPARATIVO RESUMIDO</div>
        <h1 className={styles.coverTitle}>Coleções em resumo · {payload.period.label}</h1>
        <p className={styles.coverLead}>
          {payload.totals.colecoes} coleções lado a lado — venda líquida, quantidade vendida, peças (SKUs)
          cadastradas e a evolução mensal de cada uma.
        </p>
        <div className={styles.coverStats}>
          {stats.map((st) => (
            <div key={st.l} className={styles.coverStat}>
              <span className={styles.coverStatValue}>{st.v}</span>
              <span className={styles.coverStatLabel}>{st.l}</span>
            </div>
          ))}
        </div>
        <div className={styles.coverFooter}>SCARF·ME</div>
      </div>
    </section>
  );
}

export default function ComparativoResumidoDeck({
  payload,
  logoDataUrl,
  coversByCode,
  deckRef,
}: ComparativoResumidoDeckProps) {
  const chunks: ResumoColecaoCard[][] = [];
  for (let i = 0; i < payload.cards.length; i += CARDS_PER_SLIDE) {
    chunks.push(payload.cards.slice(i, i + CARDS_PER_SLIDE));
  }

  const totalPages = chunks.length + 1; // + capa

  return (
    <div ref={deckRef} className={styles.deck}>
      <Cover payload={payload} logoDataUrl={logoDataUrl} />
      {chunks.map((chunk, slideIdx) => (
        <section key={slideIdx} className={styles.slide} data-pdf-slide="" style={{ background: "#FFFFFF" }}>
          <div className={styles.canvas}>
            <div className={styles.header}>
              <div>
                <div className={styles.eyebrow}>COMPARATIVO RESUMIDO</div>
                <div className={styles.title}>Coleções em resumo</div>
                <div className={styles.period}>{payload.period.label}</div>
              </div>
              <div className={styles.headerLogo}>
                {logoDataUrl ? (
                  <img src={logoDataUrl} alt="SCARF·ME" className={styles.headerLogoImg} />
                ) : (
                  <Wordmark color="#13131A" size={18} />
                )}
              </div>
            </div>

            <div className={styles.list}>
              {chunk.map((card, i) => (
                <Card
                  key={card.key}
                  card={card}
                  index={slideIdx * CARDS_PER_SLIDE + i}
                  cover={coversByCode[card.code] ?? null}
                />
              ))}
            </div>

            <div className={styles.footer}>
              <span>{`SCARF·ME  ·  COMPARATIVO RESUMIDO  ·  ${payload.period.statLabel}`}</span>
              <span>{String(slideIdx + 2).padStart(2, "0")} / {String(totalPages).padStart(2, "0")}</span>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
