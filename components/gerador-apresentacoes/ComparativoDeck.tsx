"use client";

import { type CSSProperties, type ReactNode, type RefObject } from "react";

import type {
  ComparativoColecoesPayload,
  ComparativoColecaoSlide,
} from "@/lib/repositories/comparativoColecoes";

import styles from "./ComparativoDeck.module.css";

const IN = 96; // 1 polegada = 96px (canvas 1280×720)
const pt = (n: number) => n * (96 / 72); // pontos → px
const hex = (c: string) => (c.startsWith("#") ? c : `#${c}`);

interface ComparativoDeckProps {
  payload: ComparativoColecoesPayload;
  logoDataUrl: string | null;
  coversByCode: Record<string, string | null>;
  deckRef?: RefObject<HTMLDivElement | null>;
}

// ---- primitivos de layout (coordenadas em polegadas) ----
function Txt({
  x, y, w, h, size, color, bold, serif, align = "left", spacing = 0, lineH, valign, children, style,
}: {
  x: number; y: number; w: number; h?: number; size: number; color: string;
  bold?: boolean; serif?: boolean; align?: "left" | "center" | "right";
  spacing?: number; lineH?: number; valign?: "top" | "middle"; children: ReactNode; style?: CSSProperties;
}) {
  return (
    <div
      className={styles.abs}
      style={{
        left: x * IN, top: y * IN, width: w * IN, height: h != null ? h * IN : undefined,
        fontFamily: serif ? '"Cambria", Georgia, "Times New Roman", serif' : 'Arial, "Helvetica Neue", system-ui, sans-serif',
        fontSize: pt(size), fontWeight: bold ? 700 : 400, color: hex(color),
        textAlign: align, letterSpacing: spacing ? pt(spacing) : undefined,
        lineHeight: lineH ?? 1.1, whiteSpace: "pre-line",
        display: valign === "middle" ? "flex" : undefined,
        alignItems: valign === "middle" ? "center" : undefined,
        justifyContent: valign === "middle" ? (align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start") : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Box({
  x, y, w, h, bg, radius, border, style,
}: {
  x: number; y: number; w: number; h: number; bg?: string; radius?: number;
  border?: { color: string; width: number }; style?: CSSProperties;
}) {
  return (
    <div
      className={styles.abs}
      style={{
        left: x * IN, top: y * IN, width: w * IN, height: h * IN,
        background: bg ? hex(bg) : undefined, borderRadius: radius ? radius * IN : undefined,
        border: border ? `${border.width}px solid ${hex(border.color)}` : undefined,
        ...style,
      }}
    />
  );
}

function Wordmark({ color, dotColor, size }: { color: string; dotColor: string; size: number }) {
  return (
    <span style={{ fontFamily: 'Arial, system-ui, sans-serif', fontWeight: 800, fontSize: pt(size), color: hex(color), letterSpacing: pt(1) }}>
      SCARF<span style={{ color: hex(dotColor), margin: "0 2px" }}>·</span>ME
    </span>
  );
}

// ---------- CAPA ----------
function Cover({ payload, logoDataUrl }: { payload: ComparativoColecoesPayload; logoDataUrl: string | null }) {
  const brlCompact = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
    if (abs >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString("pt-BR")} mil`;
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  };
  const stats = [
    { v: brlCompact(payload.totals.vendaLiquida), l: "VENDA LÍQUIDA TOTAL" },
    { v: String(payload.totals.colecoes), l: "COLEÇÕES ANALISADAS" },
    { v: brlCompact(payload.totals.margemBruta), l: "MARGEM BRUTA" },
    { v: payload.period.statLabel, l: "PERÍODO" },
  ];
  return (
    <section className={styles.slide} data-pdf-slide="" style={{ background: "#13131A" }}>
      <div className={styles.canvas}>
        <Box x={9.3} y={-1.8} w={6.5} h={6.5} bg="1E1E28" radius={3.25} />
        <Box x={11.2} y={3.7} w={4.5} h={4.5} bg="1A1A23" radius={2.25} />
        <div className={styles.abs} style={{ left: 0.75 * IN, top: 0.7 * IN }}>
          {logoDataUrl ? (
            <img src={logoDataUrl} alt="SCARF·ME" style={{ height: 1.05 * IN, width: 2.1 * IN, objectFit: "contain", objectPosition: "left center" }} />
          ) : (
            <Wordmark color="FFFFFF" dotColor="F96167" size={26} />
          )}
        </div>
        <Txt x={0.78} y={2.55} w={9} size={13} color="F96167" bold spacing={4}>RELATÓRIO DE COLEÇÕES</Txt>
        <Txt x={0.72} y={2.95} w={9.6} size={46} color="FFFFFF" bold serif lineH={1.05}>{`Performance por\nColeção · ${payload.period.label}`}</Txt>
        <Txt x={0.78} y={5.0} w={7.4} size={13} color="B8BCC8" lineH={1.25}>
          {payload.totals.colecoes} coleções em análise · venda líquida, ticket, margem e ritmo de geração de receita para decisão de renovação.
        </Txt>
        {stats.map((st, i) => (
          <div key={st.l}>
            <Txt x={0.78 + i * 3.05} y={5.95} w={3.0} size={22} color="FFFFFF" bold serif>{st.v}</Txt>
            <Txt x={0.8 + i * 3.05} y={6.45} w={3.0} size={8.5} color="8A8E9C" bold spacing={1}>{st.l}</Txt>
          </div>
        ))}
        <Txt x={0.78} y={7.05} w={5} size={9} color="6A6E7C" bold spacing={2}>SCARF·ME</Txt>
      </div>
    </section>
  );
}

// ---------- SLIDE DE COLEÇÃO ----------
function CollectionSlide({ c, logoDataUrl, cover }: { c: ComparativoColecaoSlide; logoDataUrl: string | null; cover: string | null }) {
  const p = c.palette;
  const titleSize = c.title.length > 16 ? 44 : c.title.length > 10 ? 52 : 60;

  // Painel direito
  const PANEL_X = 9.5, PANEL_W = 3.35, bdY = 1.15, bdH = 4.6;

  // Gráfico
  const n = c.months.length;
  const gx = 0.95, gy = 5.62, gw = n > 4 ? 5.0 : 4.85, gh = 1.0;
  const baseY = (gy + gh) * IN;
  const pts = c.months.map((m, i) => ({
    x: (n <= 1 ? gx + gw / 2 : gx + gw * (i / (n - 1))) * IN,
    y: (gy + gh - (m.val / c.maxV) * gh) * IN,
    label: m.label, disp: m.disp,
  }));
  const areaPath =
    pts.length > 0
      ? `M ${pts[0].x} ${baseY} ` + pts.map((q) => `L ${q.x} ${q.y}`).join(" ") + ` L ${pts[pts.length - 1].x} ${baseY} Z`
      : "";
  const linePath = pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`).join(" ");

  return (
    <section className={styles.slide} data-pdf-slide="" style={{ background: "#FFFFFF" }}>
      <div className={styles.canvas}>
        {/* painel direito */}
        <Box x={PANEL_X} y={bdY} w={PANEL_W} h={bdH} bg={p.tint} radius={0.28} />
        <Box x={PANEL_X + PANEL_W * 0.36} y={bdY + 0.6} w={1.45} h={1.45} bg={p.circ} radius={0.725} />
        <Box x={PANEL_X + 0.15} y={bdY + 2.7} w={0.85} h={0.85} radius={0.425} border={{ color: p.circ, width: 2 }} />
        {cover ? (
          // Recorte de fundo transparente, ancorado na base do painel e centrado
          // sobre o círculo — mesmo tratamento do fonte (imagem "flutuante", sem
          // moldura). PNG transparente deixa o tint/círculo aparecerem atrás.
          <img
            src={cover}
            alt={c.title}
            className={styles.abs}
            style={{
              left: PANEL_X * IN, top: (5.75 - 4.55) * IN, width: PANEL_W * IN, height: 4.55 * IN,
              objectFit: "contain", objectPosition: "center bottom",
            }}
          />
        ) : null}
        {/* highlight card */}
        <Box x={PANEL_X} y={5.95} w={PANEL_W} h={0.95} bg={p.tint} radius={0.08} />
        <Txt x={PANEL_X + 0.22} y={6.08} w={PANEL_W - 0.4} size={9} color={p.primary} bold spacing={1}>{c.hiLabel}</Txt>
        <Txt x={PANEL_X + 0.22} y={6.35} w={PANEL_W - 0.4} size={15} color={p.ink} bold serif>{c.hiValue}</Txt>

        {/* conteúdo esquerdo */}
        <Txt x={0.7} y={0.55} w={6} size={11} color={p.primary} bold spacing={3}>{c.eyebrow}</Txt>
        <Txt x={0.68} y={0.92} w={8.4} size={titleSize} color={p.ink} bold serif lineH={0.98}>{c.title}</Txt>
        <div className={styles.abs} style={{ left: 10.95 * IN, top: 0.42 * IN }}>
          {logoDataUrl ? (
            <img src={logoDataUrl} alt="SCARF·ME" style={{ height: 0.78 * IN, width: 1.55 * IN, objectFit: "contain", objectPosition: "right center" }} />
          ) : (
            <Wordmark color={p.ink} dotColor="F96167" size={17} />
          )}
        </div>

        <Txt x={0.7} y={2.18} w={8.4} size={12.5} color={p.bodyColor} lineH={1.2}>
          {c.subtitle.map((s, i) => (
            <span key={i} style={{ fontWeight: s.bold ? 700 : 400 }}>{s.text}</span>
          ))}
        </Txt>

        {/* KPI cards */}
        {c.kpis.map((k, i) => {
          const cardW = 1.92, gap = 0.18, cardY = 3.6, cardH = 1.18;
          const cx = 0.7 + i * (cardW + gap);
          const subColor = i === 0 ? p.primary : i === 3 ? p.accent : p.grey;
          const bigFs = k.big.length > 9 ? 19 : 21;
          return (
            <div key={k.lbl}>
              <Box x={cx} y={cardY} w={cardW} h={cardH} bg={p.cardbg} radius={0.08} />
              <Txt x={cx + 0.13} y={cardY + 0.1} w={cardW - 0.18} size={bigFs} color={p.ink} bold serif>{k.big}</Txt>
              <Txt x={cx + 0.14} y={cardY + 0.6} w={cardW - 0.22} size={8} color={p.grey} bold spacing={1}>{k.lbl}</Txt>
              <Txt x={cx + 0.14} y={cardY + 0.82} w={cardW - 0.22} size={8.5} color={subColor}>{k.sub}</Txt>
            </div>
          );
        })}

        {/* chart */}
        <Txt x={0.7} y={5.08} w={5} size={10} color={p.grey} bold spacing={1.5}>{c.chartTitle}</Txt>
        <svg className={styles.abs} width={1280} height={720} viewBox="0 0 1280 720" style={{ left: 0, top: 0, pointerEvents: "none" }}>
          {areaPath && <path d={areaPath} fill={hex(p.chartTint)} stroke="none" />}
          {pts.length > 1 && <path d={linePath} fill="none" stroke={hex(p.primary)} strokeWidth={pt(2.5)} strokeLinejoin="round" />}
          {pts.map((q, i) => (
            <g key={i}>
              <circle cx={q.x} cy={q.y} r={pt(3.2)} fill={hex(p.primary)} />
              <text x={q.x} y={q.y - 0.24 * IN} textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={700} fontSize={pt(n > 4 ? 8 : 8.5)} fill={hex(p.primary)}>{q.disp}</text>
              <text x={q.x} y={(gy + gh + 0.2) * IN} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize={pt(8.5)} fill={hex(p.grey)}>{q.label}</text>
            </g>
          ))}
        </svg>

        {/* growth */}
        <Txt x={6.4} y={5.4} w={2.95} size={30} color={p.accent} bold serif>{c.growthBig}</Txt>
        <Txt x={6.43} y={6.0} w={2.9} size={10.5} color={p.bodyColor} lineH={1.15}>{c.growthText}</Txt>

        {/* footer */}
        <Txt x={0.7} y={7.08} w={9.5} size={9} color={p.grey} spacing={1}>{c.footer}</Txt>
        <Txt x={11.7} y={7.08} w={1.0} size={9} color={p.grey} bold align="right">{c.page}</Txt>
      </div>
    </section>
  );
}

// ---------- SLIDE DE DECISÃO ----------
function DecisionSlide({ payload }: { payload: ComparativoColecoesPayload }) {
  const INKC = "13131A", GREY = "6B7280", GREEN = "1E7A46", AMBER = "B7791F", RED = "B4452F", CORAL = "F96167";
  const brl0 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const brlCompact = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
    if (abs >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString("pt-BR")} mil`;
    return brl0(v);
  };
  const rows = [...payload.slides].sort((a, b) => b.vlPorMes - a.vlPorMes);
  const vcColor = (v: string) => (v === "RENOVAR" ? GREEN : v === "REAVALIAR" ? AMBER : RED);
  const pageNum = String(payload.slides.length + 1).padStart(2, "0");

  const tabX = 0.7, tabY = 2.45, tabW = 8.15, rh = 0.52;

  const renovar = rows.filter((r) => r.veredito === "RENOVAR");
  const reavaliar = rows.filter((r) => r.veredito === "REAVALIAR");
  const encerrar = rows.filter((r) => r.veredito === "ENCERRAR");
  const renovarMargem = renovar.reduce((s, r) => s + r.margemAbs, 0);
  const renovarMinRitmo = renovar.length > 0 ? Math.min(...renovar.map((r) => r.vlPorMes)) : 0;
  const listNames = (arr: ComparativoColecaoSlide[]) => arr.map((r) => r.title).join(", ");

  const rcX = 9.15, rcW = 3.45;

  return (
    <section className={styles.slide} data-pdf-slide="" style={{ background: "#FFFFFF" }}>
      <div className={styles.canvas}>
        <Txt x={0.7} y={0.5} w={8} size={11} color={CORAL} bold spacing={3}>{`${pageNum} · DECISÃO DE PARCERIA`}</Txt>
        <Txt x={0.68} y={0.85} w={9.5} size={38} color={INKC} bold serif>Vale a pena renovar?</Txt>
        <Txt x={0.7} y={1.62} w={11.9} size={12} color="44464F" lineH={1.15}>
          Parcerias têm custo fixo. O critério decisivo é o ritmo de geração de receita (venda líquida por mês ativo) somado à margem bruta absoluta. Coleções que sustentam volume alto por mês pagam a parceria; as de ritmo fraco, não.
        </Txt>

        {/* cabeçalho */}
        <Txt x={tabX} y={tabY} w={2.2} size={8.5} color={GREY} bold spacing={1}>COLEÇÃO</Txt>
        <Txt x={tabX + 2.05} y={tabY} w={1.1} size={8.5} color={GREY} bold spacing={1} align="right">VL TOTAL</Txt>
        <Txt x={tabX + 3.35} y={tabY} w={1.1} size={8.5} color={GREY} bold spacing={1} align="right">MARGEM</Txt>
        <Txt x={tabX + 4.55} y={tabY} w={0.7} size={8.5} color={GREY} bold spacing={1} align="right">MESES</Txt>
        <Txt x={tabX + 5.45} y={tabY} w={1.1} size={8.5} color={GREY} bold spacing={1} align="right">VL / MÊS</Txt>
        <Txt x={tabX + 6.85} y={tabY} w={1.3} size={8.5} color={GREY} bold spacing={1}>VEREDITO</Txt>

        {rows.map((r, idx) => {
          const ry = tabY + 0.35 + idx * rh;
          return (
            <div key={r.key}>
              {idx % 2 === 0 && <Box x={tabX - 0.12} y={ry - 0.06} w={tabW + 0.1} h={rh} bg="F7F7F9" />}
              <Txt x={tabX} y={ry} w={2.05} h={0.4} size={13} color={INKC} bold serif valign="middle">{r.title}</Txt>
              <Txt x={tabX + 2.05} y={ry} w={1.1} h={0.4} size={11} color="44464F" align="right" valign="middle">{brl0(r.vlTotal)}</Txt>
              <Txt x={tabX + 3.35} y={ry} w={1.1} h={0.4} size={11} color="44464F" align="right" valign="middle">{brl0(r.margemAbs)}</Txt>
              <Txt x={tabX + 4.55} y={ry} w={0.7} h={0.4} size={11} color="44464F" align="right" valign="middle">{String(r.mesesAtivos)}</Txt>
              <Txt x={tabX + 5.45} y={ry} w={1.1} h={0.4} size={12} color={INKC} bold serif align="right" valign="middle">{brl0(r.vlPorMes)}</Txt>
              <Box x={tabX + 6.85} y={ry + 0.04} w={1.25} h={0.32} bg={vcColor(r.veredito)} radius={0.16} />
              <Txt x={tabX + 6.85} y={ry + 0.04} w={1.25} h={0.32} size={8.5} color="FFFFFF" bold spacing={1} align="center" valign="middle">{r.veredito}</Txt>
            </div>
          );
        })}
        <Txt x={tabX} y={tabY + 0.35 + rows.length * rh + 0.05} w={8.0} size={8.5} color={GREY} style={{ fontStyle: "italic" }}>
          VL/mês medido sobre os meses ativos de cada coleção no período selecionado.
        </Txt>

        {/* card lateral */}
        <Box x={rcX} y={2.45} w={rcW} h={4.25} bg="13131A" radius={0.12} />
        <Txt x={rcX + 0.3} y={2.65} w={rcW - 0.6} size={9} color={CORAL} bold spacing={2}>VEREDITO</Txt>
        <Txt x={rcX + 0.3} y={2.94} w={rcW - 0.6} size={15} color="FFFFFF" bold serif>{`Renovar — ${renovar.length} ${renovar.length === 1 ? "coleção" : "coleções"}`}</Txt>
        <Txt x={rcX + 0.3} y={3.26} w={rcW - 0.6} size={10} color="C8CAD2" lineH={1.15}>
          {renovar.length > 0
            ? `${listNames(renovar)}. Juntas, ${brlCompact(renovarMargem)} em margem bruta e ritmo de ${brl0(renovarMinRitmo)}/mês ou mais. São o núcleo rentável.`
            : "Nenhuma coleção atingiu o ritmo de renovação no período."}
        </Txt>
        <Txt x={rcX + 0.3} y={4.42} w={rcW - 0.6} size={15} color="FFFFFF" bold serif>{`Reavaliar — ${reavaliar.length > 0 ? listNames(reavaliar) : "nenhuma"}`}</Txt>
        <Txt x={rcX + 0.3} y={4.74} w={rcW - 0.6} size={10} color="C8CAD2" lineH={1.15}>
          {reavaliar.length > 0
            ? "Volume razoável, mas ritmo na metade do núcleo. Renovar só se o custo da parceria couber nessa margem."
            : "Sem coleções em zona de reavaliação."}
        </Txt>
        <Txt x={rcX + 0.3} y={5.62} w={rcW - 0.6} size={15} color={CORAL} bold serif>{`Encerrar — ${encerrar.length > 0 ? listNames(encerrar) : "nenhuma"}`}</Txt>
        <Txt x={rcX + 0.3} y={5.94} w={rcW - 0.6} size={10} color="C8CAD2" lineH={1.15}>
          {encerrar.length > 0
            ? "Menor volume e menor ritmo. Improvável que cubram o custo fixo de uma parceria."
            : "Nenhuma coleção em zona de encerramento."}
        </Txt>

        <Txt x={0.7} y={7.08} w={9} size={9} color={GREY} spacing={1}>{`SCARF·ME  ·  DECISÃO DE PARCERIA  ·  ${payload.period.statLabel}`}</Txt>
        <Txt x={11.7} y={7.08} w={1.0} size={9} color={GREY} bold align="right">{pageNum}</Txt>
      </div>
    </section>
  );
}

export default function ComparativoDeck({ payload, logoDataUrl, coversByCode, deckRef }: ComparativoDeckProps) {
  return (
    <div ref={deckRef} className={styles.deck}>
      <Cover payload={payload} logoDataUrl={logoDataUrl} />
      {payload.slides.map((c) => (
        <CollectionSlide key={c.key} c={c} logoDataUrl={logoDataUrl} cover={coversByCode[c.code] ?? null} />
      ))}
      <DecisionSlide payload={payload} />
    </div>
  );
}
