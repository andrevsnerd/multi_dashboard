"use client";

import type { CollectionPalette } from "@/lib/presentations/palettes";

/**
 * Mini gráfico de área/linha da evolução mensal — compartilhado entre o
 * Comparativo Resumido (deck de apresentação, sempre claro — fiel ao slide
 * exportado) e o tema "Com fotos" do Painel de Coleções (acompanha o tema do
 * dashboard via a prop `dark`). Cores vêm da paleta da coleção em ambos.
 */
export interface MiniAreaChartPoint {
  label: string;
  val: number;
  disp: string;
}

interface MiniAreaChartProps {
  months: MiniAreaChartPoint[];
  maxV: number;
  palette: CollectionPalette;
  width?: number;
  height?: number;
  /** true quando o card ao redor acompanha o modo escuro do dashboard. */
  dark?: boolean;
}

const hex = (c: string) => (c.startsWith("#") ? c : `#${c}`);

function toRgb(c: string): { r: number; g: number; b: number } {
  const clean = hex(c).slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/**
 * Clareia uma cor em direção ao branco por `amt` (0–1). As paletas das coleções
 * são tons jewel profundos, feitos p/ fundo claro; no dark ficam murchos, então
 * clareamos a linha/rótulos p/ um tom vivo que "pula" sobre o fundo escuro.
 */
function lightenRgb(c: string, amt: number): { r: number; g: number; b: number } {
  const { r, g, b } = toRgb(c);
  const mix = (ch: number) => Math.round(ch + (255 - ch) * amt);
  return { r: mix(r), g: mix(g), b: mix(b) };
}

export default function MiniAreaChart({
  months,
  maxV,
  palette: p,
  width = 250,
  height = 92,
  dark = false,
}: MiniAreaChartProps) {
  // No dark: cor viva (primary clareado) p/ linha, pontos e rótulos; fill sutil
  // dessa mesma cor. No claro: mantém primary/chartTint originais do slide.
  const lp = lightenRgb(p.primary, 0.5);
  const accent = dark ? `rgb(${lp.r}, ${lp.g}, ${lp.b})` : hex(p.primary);
  const areaFill = dark ? `rgba(${lp.r}, ${lp.g}, ${lp.b}, 0.14)` : hex(p.chartTint);
  const monthLabelColor = dark ? "#8b95a6" : hex(p.grey);
  const n = months.length;
  const padT = 18;
  const padB = 20;
  const padX = 16;
  const plotW = width - padX * 2;
  const plotH = height - padT - padB;
  const baseY = padT + plotH;

  if (n === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          color: "#b3b7c2",
          fontStyle: "italic",
        }}
      >
        sem série mensal
      </div>
    );
  }

  const pts = months.map((m, i) => ({
    x: padX + (n <= 1 ? plotW / 2 : plotW * (i / (n - 1))),
    y: padT + plotH - (m.val / maxV) * plotH,
    label: m.label,
    disp: m.disp,
  }));

  const areaPath =
    `M ${pts[0].x} ${baseY} ` + pts.map((q) => `L ${q.x} ${q.y}`).join(" ") + ` L ${pts[pts.length - 1].x} ${baseY} Z`;
  const linePath = pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`).join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <path d={areaPath} fill={areaFill} stroke="none" />
      {n > 1 && <path d={linePath} fill="none" stroke={accent} strokeWidth={2.4} strokeLinejoin="round" />}
      {pts.map((q, i) => {
        const anchor = i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle";
        const lx = i === 0 ? q.x - 2 : i === pts.length - 1 ? q.x + 2 : q.x;
        return (
          <g key={i}>
            <circle cx={q.x} cy={q.y} r={3.2} fill={accent} />
            <text
              x={lx}
              y={q.y - 8}
              textAnchor={anchor}
              fontFamily="Arial, sans-serif"
              fontWeight={700}
              fontSize={11}
              fill={accent}
            >
              {q.disp}
            </text>
            <text
              x={q.x}
              y={baseY + 15}
              textAnchor="middle"
              fontFamily="Arial, sans-serif"
              fontSize={10.5}
              fill={monthLabelColor}
            >
              {q.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
