"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

import { precisaComprarEssaSemana, type CompraIdealResult } from "@/lib/utils/compra-ideal";
import CompraIdealExplainCard from "@/components/shared/CompraIdealExplainCard";
import { useTheme } from "@/components/theme/ThemeContext";

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
  /** Empresa — habilita o rótulo "comprar essa semana" (hoje só NERD compra em dia fixo). */
  company?: string | null;
  /** Produto descontinuado → nunca sugere compra; mostra "Descontinuado" no lugar da qtd. */
  descontinuado?: boolean;
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
export default function CompraIdealCell({ ideal, loading, semDados, style, descricao, cor, company, descontinuado }: CompraIdealCellProps) {
  // Hook sempre no topo (rules-of-hooks) — antes de qualquer return condicional.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const { theme } = useTheme();
  const dark = theme === "dark";

  // Descontinuado nunca sugere compra — decidido pelo cadastro, independe de métrica.
  // Vem antes de loading/semDados: já sabemos sem esperar as métricas chegarem.
  if (descontinuado) {
    return <span style={{ color: dark ? "#94a3b8" : "#64748b", fontWeight: 600, fontStyle: "italic", whiteSpace: "nowrap" }}>Descontinuado</span>;
  }

  // Paleta da célula. No tema claro é idêntica à original; no escuro usa tons
  // vivos com contraste sobre o navy (laranja/verde/vermelho escuros somem no dark).
  const C = {
    pcs: dark ? "#fbbf24" : "#b45309",
    suficiente: dark ? "#94a3b8" : "#64748b",
    transitoBg: dark ? "rgba(34, 197, 94, 0.12)" : "#dcfce7",
    transitoText: dark ? "#4ade80" : "#166534",
    transitoBorder: dark ? "rgba(34, 197, 94, 0.3)" : "#22c55e",
    comprarAgora: dark ? "#fb7185" : "#b91c1c",
    essaSemana: dark ? "#fbbf24" : "#b45309",
    data: dark ? "#5eead4" : "#0f766e",
  };

  // Estados de carregamento — IGUAIS em todas as telas (antes só a Curva ABC tinha).
  if (loading || ideal == null) return <CellTexto texto="Carregando..." />;
  if (semDados) return <CellTexto texto="Sem dados" />;

  const precisaRepor = ideal.status === "REPOR";
  const mostraData = ideal.modoCiclo && precisaRepor && ideal.dataCompra != null;
  // Comprar essa semana: data sugerida cai até a próxima compra (NERD às segundas). O tooltip
  // continua mostrando a data verdadeira; aqui o rótulo vira "comprar essa semana".
  const essaSemana = precisaComprarEssaSemana(ideal, company);

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
        <span style={{ fontWeight: precisaRepor ? 700 : 500, color: precisaRepor ? C.pcs : C.suficiente }}>
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
              background: C.transitoBg,
              color: C.transitoText,
              border: `1px solid ${C.transitoBorder}`,
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
            fontWeight: ideal.comprarAgora || essaSemana ? 800 : 600,
            color: ideal.comprarAgora ? C.comprarAgora : essaSemana ? C.essaSemana : C.data,
          }}
        >
          📅{" "}
          {ideal.comprarAgora
            ? "comprar agora"
            : essaSemana
              ? "comprar essa semana"
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
