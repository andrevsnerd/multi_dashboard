"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

import { type CompraIdealResult } from "@/lib/utils/compra-ideal";
import CompraIdealExplainCard from "@/components/shared/CompraIdealExplainCard";

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function shortDate(iso?: string | null): string {
  if (!iso) return "—";
  const v = iso.trim().slice(0, 10);
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return `${String(d.getDate()).padStart(2, "0")}/${MESES_PT[d.getMonth()]}`;
}

interface CompraIdealCellProps {
  /** Resultado do cálculo. `null` quando as métricas do item ainda não chegaram. */
  ideal: CompraIdealResult | null;
  /** true enquanto as métricas ao vivo do item não chegaram → mostra "Carregando...". */
  loading?: boolean;
  /** true quando as métricas chegaram mas o item não tem base de vendas/estoque → "Sem dados". */
  semDados?: boolean;
  /** Estilo extra no container. */
  style?: React.CSSProperties;
  /** Cabeçalho opcional do card (descrição do produto + cor). */
  descricao?: string | null;
  cor?: string | null;
}

/** Texto neutro (carregando / sem dados) — mesma aparência em todas as telas. */
function CellTexto({ texto }: { texto: string }) {
  return <span style={{ color: "#94a3b8", fontWeight: 500, whiteSpace: "nowrap" }}>{texto}</span>;
}

/**
 * Célula compartilhada da Compra Ideal: quantidade + data de compra (modo ciclo), e um
 * tooltip-card didático (as 5 perguntas) ao passar o mouse. Mesma regra/global em todas as
 * telas. O card flutua via portal pra não ser cortado pela tabela.
 *
 * Estados GLOBAIS (idênticos em toda tela): (1) `loading`/`ideal=null` → "Carregando..." ·
 * (2) `semDados` → "Sem dados" · (3) caso contrário → número/data. Nunca mostra 0 falso:
 * enquanto o dado real do ritmo não chega, fica em "Carregando...".
 */
export default function CompraIdealCell({ ideal, loading, semDados, style, descricao, cor }: CompraIdealCellProps) {
  // Hook sempre no topo (rules-of-hooks) — antes de qualquer return condicional.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Estados de carregamento — IGUAIS em todas as telas (antes só a Curva ABC tinha).
  if (loading || ideal == null) return <CellTexto texto="Carregando..." />;
  if (semDados) return <CellTexto texto="Sem dados" />;

  const precisaRepor = ideal.status === "REPOR";
  const mostraData = ideal.modoCiclo && precisaRepor && ideal.dataCompra != null;

  const cardW = 340;
  const cardH = 280;
  const left = pos ? Math.min(pos.x + 14, window.innerWidth - cardW - 12) : 0;
  const top = pos ? Math.min(pos.y + 14, window.innerHeight - cardH - 12) : 0;

  return (
    <span
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 2,
        cursor: "help",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontWeight: precisaRepor ? 700 : 500, color: precisaRepor ? "#b45309" : "#64748b" }}>
          {precisaRepor ? `${fmt(ideal.compraIdeal)} pcs` : "Suficiente"}
        </span>
        {ideal.emTransito > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0 6px",
              height: 16,
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 800,
              background: "#dcfce7",
              color: "#166534",
              border: "1px solid #22c55e",
            }}
          >
            T {fmt(ideal.emTransito)}
          </span>
        )}
      </span>
      {mostraData && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: ideal.comprarAgora ? 800 : 600,
            color: ideal.comprarAgora ? "#b91c1c" : "#0f766e",
          }}
        >
          📅{" "}
          {ideal.comprarAgora
            ? "comprar agora"
            : `${shortDate(ideal.dataCompra)}${
                ideal.diasAteComprar != null ? ` · ${fmt(ideal.diasAteComprar)}d` : ""
              }`}
        </span>
      )}
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div style={{ position: "fixed", left, top, zIndex: 9999, pointerEvents: "none" }}>
            <CompraIdealExplainCard ideal={ideal} descricao={descricao} cor={cor} />
          </div>,
          document.body
        )}
    </span>
  );
}
