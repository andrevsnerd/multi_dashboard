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
/**
 * Card por coleção. Carrega os MESMOS blocos do relatório de Coleção Completa —
 * "Os números", "Destaques" e "Vendas por loja" — num único slide:
 *
 *   ┌ cabeçalho ─────────────────────────────────┬──────────┐
 *   │ faixa de 5 KPIs                            │  capa    │
 *   ├──────────────────┬─────────────────────────┤  ────────│
 *   │ Destaques (top 5)│ Vendas por loja         │ destaque │
 *   │                  │                         │ evolução │
 *   └──────────────────┴─────────────────────────┴──────────┘
 */
function CollectionSlide({ c, logoDataUrl, cover }: { c: ComparativoColecaoSlide; logoDataUrl: string | null; cover: string | null }) {
  const p = c.palette;
  const titleSize = c.title.length > 22 ? 26 : c.title.length > 14 ? 31 : 36;

  const brl0 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const brl2 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int0 = (v: number) => Math.round(v).toLocaleString("pt-BR");
  const pct1 = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

  // Painel direito (capa + destaque + evolução)
  const PANEL_X = 10.35, PANEL_W = 2.3;

  // Faixa de KPIs — 5 × 1.80 + 4 × 0.12 = 9.48in, de 0.70 a 10.18 (painel em 10.35).
  const KPI_Y = 1.98, KPI_H = 0.94, KPI_W = 1.8, KPI_GAP = 0.12;

  // Colunas de conteúdo — os dois cards têm a MESMA altura e terminam antes do rodapé (7.12).
  const COL_Y = 3.24, CARD_H = 3.8;
  const TOP_X = 0.7, TOP_W = 4.55;
  const STO_X = 5.62, STO_W = 4.4;

  // Mini-gráfico de evolução (dentro do painel direito)
  const n = c.months.length;
  const gx = PANEL_X + 0.16, gy = 6.28, gw = PANEL_W - 0.32, gh = 0.5;
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

  // Os 5 números do relatório de Coleção Completa, na mesma ordem.
  const nums = c.numbers;
  const kpiCards = [
    { big: brl0(nums.faturamento), lbl: "FATURAMENTO", sub: `${int0(nums.pecasVendidas)} peças`, hero: true },
    { big: int0(nums.pecasVendidas), lbl: "PEÇAS VENDIDAS", sub: `em ${int0(nums.nSkus)} SKUs`, hero: false },
    { big: brl0(nums.precoMedio), lbl: "PREÇO MÉDIO", sub: "ticket por peça", hero: false },
    { big: int0(nums.estoqueRestante), lbl: "ESTOQUE RESTANTE", sub: "peças na rede", hero: false },
    { big: int0(nums.canaisAtivos), lbl: "CANAIS ATIVOS", sub: "e-com + lojas", hero: false },
  ];

  // Vendas por loja: o card comporta 8 linhas + TOTAL; o excedente vira uma linha resumo.
  const STORE_LIMIT = 7;
  const storesShown = c.stores.slice(0, STORE_LIMIT);
  const storesTail = c.stores.slice(STORE_LIMIT);
  const tailRow =
    storesTail.length > 0
      ? {
          nome: `+ ${storesTail.length} ${storesTail.length === 1 ? "canal" : "canais"}`,
          venda: storesTail.reduce((s, r) => s + r.venda, 0),
          qtd: storesTail.reduce((s, r) => s + r.qtd, 0),
          participacaoPct: storesTail.reduce((s, r) => s + r.participacaoPct, 0),
        }
      : null;
  const storeRows = tailRow ? [...storesShown, tailRow] : storesShown;
  const storeRowH = 0.3;
  const totalY = COL_Y + 0.74 + storeRows.length * storeRowH + 0.09;
  // Trunca em vez de quebrar linha: o slide tem altura fixa, texto longo empurraria o resto.
  const clip = { whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <section className={styles.slide} data-pdf-slide="" style={{ background: "#FFFFFF" }}>
      <div className={styles.canvas}>
        {/* ---------- cabeçalho ---------- */}
        <Txt x={0.7} y={0.5} w={7} size={10.5} color={p.primary} bold spacing={3}>{c.eyebrow}</Txt>
        <Txt x={0.68} y={0.83} w={9.3} size={titleSize} color={p.ink} bold serif lineH={1.0}>{c.title}</Txt>
        <div className={styles.abs} style={{ left: 10.95 * IN, top: 0.42 * IN }}>
          {logoDataUrl ? (
            <img src={logoDataUrl} alt="SCARF·ME" style={{ height: 0.66 * IN, width: 1.55 * IN, objectFit: "contain", objectPosition: "right center" }} />
          ) : (
            <Wordmark color={p.ink} dotColor="F96167" size={15} />
          )}
        </div>
        <Txt x={0.7} y={1.48} w={9.3} size={11} color={p.bodyColor} lineH={1.15}>
          {c.subtitle.map((s, i) => (
            <span key={i} style={{ fontWeight: s.bold ? 700 : 400 }}>{s.text}</span>
          ))}
        </Txt>

        {/* ---------- faixa de números (Os números da coleção) ---------- */}
        {kpiCards.map((k, i) => {
          const cx = 0.7 + i * (KPI_W + KPI_GAP);
          const bigFs = k.big.length > 10 ? 16 : k.big.length > 7 ? 18.5 : 21;
          return (
            <div key={k.lbl}>
              <Box x={cx} y={KPI_Y} w={KPI_W} h={KPI_H} bg={k.hero ? p.primary : p.cardbg} radius={0.08} />
              <Txt x={cx + 0.13} y={KPI_Y + 0.09} w={KPI_W - 0.2} size={7.5} color={k.hero ? "FFFFFF" : p.grey} bold spacing={1}>
                {k.lbl}
              </Txt>
              <Txt x={cx + 0.12} y={KPI_Y + 0.28} w={KPI_W - 0.18} size={bigFs} color={k.hero ? "FFFFFF" : p.ink} bold serif>
                {k.big}
              </Txt>
              <Txt x={cx + 0.13} y={KPI_Y + 0.68} w={KPI_W - 0.2} size={8} color={k.hero ? "FFFFFF" : p.grey}>
                {k.sub}
              </Txt>
            </div>
          );
        })}

        {/* ---------- Destaques da coleção ---------- */}
        <Box x={TOP_X - 0.14} y={COL_Y - 0.18} w={TOP_W + 0.28} h={CARD_H} bg={p.cardbg} radius={0.1} />
        <Txt x={TOP_X} y={COL_Y} w={TOP_W} size={13} color={p.ink} bold serif>Destaques da coleção</Txt>
        <Txt x={TOP_X} y={COL_Y + 0.24} w={TOP_W} size={8.5} color={p.grey}>
          {`Top ${c.top.length} ${c.top.length === 1 ? "produto que puxou" : "produtos que puxaram"} o resultado`}
        </Txt>
        {c.top.map((t, i) => {
          const ry = COL_Y + 0.52 + i * 0.6;
          return (
            <div key={`${t.rank}-${t.nome}`}>
              <Txt x={TOP_X} y={ry + 0.02} w={0.28} size={13} color={p.primary} bold serif>{String(t.rank)}</Txt>
              <Txt x={TOP_X + 0.3} y={ry} w={2.5} size={9.5} color={p.ink} bold style={clip}>{t.nome}</Txt>
              <Txt x={TOP_X + 0.3} y={ry + 0.17} w={2.5} size={7.5} color={p.grey} style={clip}>{t.meta}</Txt>
              <Box x={TOP_X + 0.3} y={ry + 0.36} w={TOP_W - 0.3} h={0.045} bg={p.chartTint} radius={0.022} />
              <Box x={TOP_X + 0.3} y={ry + 0.36} w={Math.max(0.04, ((TOP_W - 0.3) * t.barWidthPct) / 100)} h={0.045} bg={p.primary} radius={0.022} />
              <Txt x={TOP_X + 2.95} y={ry} w={1.6} size={10.5} color={p.ink} bold align="right">{brl0(t.venda)}</Txt>
              <Txt x={TOP_X + 2.95} y={ry + 0.18} w={1.6} size={7.5} color={p.accent} align="right">
                {`${pct1(t.participacaoPct)} do total`}
              </Txt>
            </div>
          );
        })}

        {/* ---------- Vendas por loja ---------- */}
        <Box x={STO_X - 0.14} y={COL_Y - 0.18} w={STO_W + 0.28} h={CARD_H} bg={p.cardbg} radius={0.1} />
        <Txt x={STO_X} y={COL_Y} w={STO_W} size={13} color={p.ink} bold serif>Vendas por loja</Txt>
        <Txt x={STO_X} y={COL_Y + 0.24} w={STO_W} size={8.5} color={p.grey}>Ranking de canais</Txt>
        <Txt x={STO_X} y={COL_Y + 0.52} w={1.6} size={7.5} color={p.grey} bold spacing={1}>CANAL</Txt>
        <Txt x={STO_X + 1.5} y={COL_Y + 0.52} w={1.35} size={7.5} color={p.grey} bold spacing={1} align="right">VENDA LÍQ.</Txt>
        <Txt x={STO_X + 2.9} y={COL_Y + 0.52} w={0.6} size={7.5} color={p.grey} bold spacing={1} align="right">QTD</Txt>
        <Txt x={STO_X + 3.55} y={COL_Y + 0.52} w={0.85} size={7.5} color={p.grey} bold spacing={1} align="right">%</Txt>
        {storeRows.map((s, i) => {
          const ry = COL_Y + 0.74 + i * storeRowH;
          return (
            <div key={s.nome}>
              {i % 2 === 0 && <Box x={STO_X - 0.08} y={ry - 0.03} w={STO_W + 0.16} h={storeRowH} bg={p.chartTint} radius={0.03} />}
              <Txt x={STO_X} y={ry} w={1.45} h={0.26} size={9} color={p.ink} bold valign="middle" style={clip}>{s.nome}</Txt>
              <Txt x={STO_X + 1.5} y={ry} w={1.35} h={0.26} size={9} color={p.bodyColor} align="right" valign="middle">{brl2(s.venda)}</Txt>
              <Txt x={STO_X + 2.9} y={ry} w={0.6} h={0.26} size={9} color={p.bodyColor} align="right" valign="middle">{int0(s.qtd)}</Txt>
              <Txt x={STO_X + 3.55} y={ry} w={0.85} h={0.26} size={9} color={p.accent} bold align="right" valign="middle">{pct1(s.participacaoPct)}</Txt>
            </div>
          );
        })}
        <Box x={STO_X} y={totalY - 0.06} w={STO_W} h={0.012} bg={p.grey} />
        <Txt x={STO_X} y={totalY} w={1.45} h={0.26} size={9} color={p.ink} bold valign="middle">TOTAL</Txt>
        <Txt x={STO_X + 1.5} y={totalY} w={1.35} h={0.26} size={9} color={p.ink} bold align="right" valign="middle">{brl2(c.storesTotal.venda)}</Txt>
        <Txt x={STO_X + 2.9} y={totalY} w={0.6} h={0.26} size={9} color={p.ink} bold align="right" valign="middle">{int0(c.storesTotal.qtd)}</Txt>
        <Txt x={STO_X + 3.55} y={totalY} w={0.85} h={0.26} size={9} color={p.ink} bold align="right" valign="middle">100%</Txt>

        {/* ---------- painel direito: capa, destaque e evolução ---------- */}
        <Box x={PANEL_X} y={1.98} w={PANEL_W} h={2.85} bg={p.tint} radius={0.16} />
        <Box x={PANEL_X + PANEL_W * 0.28} y={2.3} w={1.05} h={1.05} bg={p.circ} radius={0.525} />
        {cover ? (
          // Recorte de fundo transparente, ancorado na base do painel e centrado
          // sobre o círculo — imagem "flutuante", sem moldura.
          <img
            src={cover}
            alt={c.title}
            className={styles.abs}
            style={{
              left: PANEL_X * IN, top: 2.05 * IN, width: PANEL_W * IN, height: 2.72 * IN,
              objectFit: "contain", objectPosition: "center bottom",
            }}
          />
        ) : null}
        <Box x={PANEL_X} y={4.95} w={PANEL_W} h={0.78} bg={p.tint} radius={0.08} />
        <Txt x={PANEL_X + 0.16} y={5.06} w={PANEL_W - 0.3} size={8} color={p.primary} bold spacing={1}>{c.hiLabel}</Txt>
        <Txt x={PANEL_X + 0.16} y={5.28} w={PANEL_W - 0.3} size={12} color={p.ink} bold serif>{c.hiValue}</Txt>

        <Txt x={PANEL_X} y={5.92} w={PANEL_W} size={8} color={p.grey} bold spacing={1.2}>{c.chartTitle}</Txt>
        <svg className={styles.abs} width={1280} height={720} viewBox="0 0 1280 720" style={{ left: 0, top: 0, pointerEvents: "none" }}>
          {areaPath && <path d={areaPath} fill={hex(p.chartTint)} stroke="none" />}
          {pts.length > 1 && <path d={linePath} fill="none" stroke={hex(p.primary)} strokeWidth={pt(1.8)} strokeLinejoin="round" />}
          {pts.map((q, i) => (
            <g key={i}>
              <circle cx={q.x} cy={q.y} r={pt(2.2)} fill={hex(p.primary)} />
              {/* Muitos meses no painel estreito viram sopa de letrinhas: rotula só as pontas. */}
              {(n <= 4 || i === 0 || i === n - 1) && (
                <text x={q.x} y={(gy + gh + 0.17) * IN} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontFamily="Arial, sans-serif" fontSize={pt(7)} fill={hex(p.grey)}>
                  {q.label}
                </text>
              )}
            </g>
          ))}
        </svg>
        {c.growthBig ? (
          <Txt x={PANEL_X} y={6.92} w={PANEL_W} size={13} color={p.accent} bold serif>{`${c.growthBig} até o pico`}</Txt>
        ) : null}

        {/* ---------- rodapé ---------- */}
        <Txt x={0.7} y={7.12} w={9.5} size={8.5} color={p.grey} spacing={1}>{c.footer}</Txt>
        <Txt x={11.7} y={7.12} w={1.0} size={8.5} color={p.grey} bold align="right">{c.page}</Txt>
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
    </div>
  );
}
