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

/** Tint pastel da paleta (feito p/ fundo claro) diluído sobre fundo escuro. */
function withAlpha(c: string, alpha: number): string {
  const clean = hex(c).slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function MiniAreaChart({
  months,
  maxV,
  palette: p,
  width = 250,
  height = 92,
  dark = false,
}: MiniAreaChartProps) {
  const areaFill = dark ? withAlpha(p.primary, 0.18) : hex(p.chartTint);
  const monthLabelColor = dark ? "#94a3b8" : hex(p.grey);
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
