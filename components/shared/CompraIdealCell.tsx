"use client";

import {
  COMPRA_IDEAL_CONFIABILIDADE_LABEL,
  type CompraIdealResult,
} from "@/lib/utils/compra-ideal";

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

function haTempo(dias: number | null): string {
  if (dias == null) return "";
  if (dias <= 1) return "atual";
  if (dias < 45) return `há ${dias} dias`;
  const meses = Math.round(dias / 30);
  return `há ~${meses} ${meses === 1 ? "mês" : "meses"}`;
}

/** Texto detalhado (multilinha) usado no atributo title — explica toda a conta. */
export function buildCompraIdealTitle(ideal: CompraIdealResult): string {
  const linhas: string[] = [];
  linhas.push(`Compra ideal: ${fmt(ideal.compraIdeal)} pcs`);
  linhas.push(
    `Ritmo: ${fmt(ideal.ritmoMensal)}/mês (${ideal.consumoDiario.toFixed(2)}/dia)`
  );
  if (ideal.ritmoDiasBase > 0) {
    const span = haTempo(ideal.ritmoDiasAtras);
    linhas.push(
      `Base do ritmo: ${shortDate(ideal.ritmoInicioIso)} → ${shortDate(ideal.ritmoFimIso)} · ${fmt(
        ideal.ritmoDiasBase
      )}d · ${fmt(ideal.ritmoVendasBase)} vendas${span ? ` · ${span}` : ""}`
    );
    if (ideal.confiabilidade !== "alta") {
      linhas.push(`⚠ ${COMPRA_IDEAL_CONFIABILIDADE_LABEL[ideal.confiabilidade]} (base curta)`);
    }
    if (ideal.ritmoSpanVendaDias != null) {
      linhas.push(
        `Concentração: ${shortDate(ideal.ritmoPrimeiraVendaIso)} → ${shortDate(
          ideal.ritmoUltimaVendaIso
        )} (${fmt(ideal.ritmoSpanVendaDias)}d · ${fmt(ideal.ritmoDiasComVenda)} dias com venda)`
      );
    }
  }
  linhas.push(
    `Cobertura atual: ${ideal.coberturaAtualDias != null ? `${fmt(ideal.coberturaAtualDias)}d` : "—"}`
  );
  linhas.push(`Produção (lead time): ${ideal.producaoDias}d · cobertura: ${ideal.coberturaAlvoDias}d`);
  if (ideal.modoCiclo) {
    // Modo ciclo: a quantidade é 1 ciclo de cobertura; a data é o que importa.
    linhas.push(`Alvo: 1 ciclo de cobertura (${ideal.coberturaAlvoDias}d)`);
    if (ideal.acabaComTransitoIso) {
      linhas.push(
        `Estoque+trânsito acaba em: ${shortDate(ideal.acabaComTransitoIso)}${
          ideal.diasAteAcabarComTransito != null ? ` (${fmt(ideal.diasAteAcabarComTransito)}d)` : ""
        }`
      );
    }
    if (ideal.dataCompra) {
      const quando = ideal.comprarAgora
        ? "AGORA (atrasado/no ponto)"
        : `${shortDate(ideal.dataCompra)}${ideal.diasAteComprar != null ? ` (em ${fmt(ideal.diasAteComprar)}d)` : ""}`;
      linhas.push(`📅 Comprar: ${quando}`);
    }
  } else {
    linhas.push(`Alvo total: ${ideal.alvoTotalDias}d → ${fmt(ideal.alvoEstoque)} un`);
  }
  linhas.push(
    `Estoque + trânsito: ${fmt(ideal.estoqueAtual)} + ${fmt(ideal.emTransito)} = ${fmt(
      ideal.estoqueAtual + ideal.emTransito
    )} un`
  );
  if (ideal.emTransito > 0) {
    linhas.push(
      `Chega em: ${shortDate(ideal.chegaEm)}${
        ideal.folgaAteChegadaDias != null
          ? ` · dias até ruptura antes da chegada: ${fmt(ideal.folgaAteChegadaDias)}d`
          : ""
      }`
    );
  }
  return linhas.join("\n");
}

interface CompraIdealCellProps {
  ideal: CompraIdealResult;
  /** Estilo extra no container. */
  style?: React.CSSProperties;
}

/**
 * Célula compartilhada da Compra Ideal (telas que não são a lista-loja): mostra só o
 * número quando precisa repor; quando está OK/Excesso mostra "Suficiente". Sem badge nem
 * ⚠ — toda a explicação fica no tooltip (title). Mesma regra global em todas as telas.
 */
export default function CompraIdealCell({ ideal, style }: CompraIdealCellProps) {
  const precisaRepor = ideal.status === "REPOR";
  // No modo ciclo, mostra a DATA de compra junto da quantidade (data fixa do ciclo).
  const mostraData = ideal.modoCiclo && precisaRepor && ideal.dataCompra != null;
  return (
    <span
      title={buildCompraIdealTitle(ideal)}
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
    </span>
  );
}
