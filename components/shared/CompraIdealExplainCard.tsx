"use client";

import type { CompraIdealResult } from "@/lib/utils/compra-ideal";

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function fmt2(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shortDate(iso?: string | null): string {
  if (!iso) return "—";
  const v = iso.trim().slice(0, 10);
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return `${String(d.getDate()).padStart(2, "0")}/${MESES_PT[d.getMonth()]}`;
}

/** Cabeçalho por tamanho da janela de ritmo (mesma régua do cálculo). */
function cenario(ideal: CompraIdealResult): { emoji: string; label: string } {
  // Ruptura antes da chegada tem prioridade: a posição (estoque+trânsito) parece "cheia",
  // mas o estoque zera antes de a remessa pousar → há janela sem estoque. Não é "estável".
  if (ideal.rupturaAntesDaChegada) {
    return {
      emoji: "⚠️",
      label: `Vai romper ~${fmt(ideal.diasRupturaAntesChegada ?? 0)}d antes da remessa chegar`,
    };
  }
  // Resgate: o maior trecho teve 0 venda, mas vendeu recente → usa o recente (vendedor lento).
  if (ideal.motivoTrechoRecente === "zerado") {
    return { emoji: "🔄", label: "Vendeu recente · base zerada resgatada" };
  }
  // Janela antiga: o maior trecho estava velho (gap > tolerância) → usou o recente.
  if (ideal.usouTrechoRecente) {
    return { emoji: "🔄", label: `Trecho recente (maior estava velho · gap ${fmt(ideal.ritmoGapDias)}d)` };
  }
  // Resgate por venda recente: vendeu (últimos 60d) mas nenhum trecho com estoque capturou (venda no negativo).
  if (ideal.resgateVendaRecente) {
    return { emoji: "🔄", label: "Vendeu recente sem saldo (fantasma) · ritmo resgatado" };
  }
  if (ideal.ritmoDiasBase < 30) return { emoji: "🆕", label: "Base curta (<30d) — ritmo amortecido" };
  if (ideal.ritmoDiasBase < 60) return { emoji: "📊", label: "Base parcial (30–59d)" };
  return { emoji: "✅", label: "Janela cheia (≥60d) — estável" };
}

interface QA {
  n: number;
  pergunta: string;
  formula: string;
  destaque?: "compra" | "ok";
}

/** Monta as 5 perguntas a partir do resultado já calculado. */
function buildPerguntas(ideal: CompraIdealResult): QA[] {
  // Regra única: divisor = MAX(trecho, 30). Sem trecho (0) ou <30 → 30; 30-59 → real; ≥60 → 60.
  const divisor = Math.max(ideal.ritmoDiasBase, 30);
  const precisaRepor = ideal.status === "REPOR";

  // 1. histórico (maior trecho contínuo com estoque)
  const baseHist =
    ideal.ritmoDiasBase === 0
      ? "sem trecho com estoque → tratado como novo → divide por 30"
      : ideal.ritmoDiasBase < 30
        ? `${fmt(ideal.ritmoDiasBase)} dias com estoque → <30 → amortece (divide por 30)`
        : ideal.ritmoDiasBase < 60
          ? `${fmt(ideal.ritmoDiasBase)} dias com estoque → 30–59 → usa dias reais`
          : `${fmt(ideal.ritmoDiasBase)} dias com estoque → ≥60 → janela cheia (teto 60)`;
  // Trecho recente entrou no lugar do maior: por gap (janela antiga) ou por resgate (maior zerou).
  const hist =
    ideal.motivoTrechoRecente === "zerado"
      ? `maior trecho não vendeu (0) → usa o RECENTE: ${baseHist}`
      : ideal.usouTrechoRecente
        ? `maior trecho ficou ${fmt(ideal.ritmoGapDias)}d parado (> ${fmt(ideal.gapAntigoDias ?? 0)}d) → usa o RECENTE: ${baseHist}`
        : ideal.resgateVendaRecente
          ? `vendeu ${fmt(ideal.ritmoVendasBase)} nos últimos 60d, mas sem saldo positivo no dia (fantasma) → resgata a venda recente: divide por 30`
          : baseHist;

  // 2. consumo/dia
  const consumo = `${fmt(ideal.ritmoVendasBase)} vendas ÷ ${divisor} = ${fmt2(ideal.consumoDiario)}/dia  (≈ ${fmt(ideal.ritmoMensal)}/mês)`;

  // 3. quando acaba (com trânsito, se houver)
  const diasAcaba = ideal.diasAteAcabarComTransito ?? ideal.diasAteAcabar;
  const dataAcaba = ideal.acabaComTransitoIso ?? ideal.acabaEm;
  const acaba =
    ideal.consumoDiario <= 0
      ? "sem consumo → não zera"
      : ideal.rupturaAntesDaChegada
        ? // Honestidade: o estoque ATUAL zera antes do trânsito chegar — mostra o gap, não a data final.
          `estoque ${fmt(ideal.estoqueAtual)} zera ${shortDate(ideal.acabaEm)} (${fmt(ideal.diasAteAcabar ?? 0)}d) · remessa só chega ${shortDate(ideal.chegaEm)} (${fmt(ideal.diasAteChegada ?? 0)}d) → ~${fmt(ideal.diasRupturaAntesChegada ?? 0)}d SEM ESTOQUE`
        : ideal.emTransito > 0
          ? `estoque ${fmt(ideal.estoqueAtual)} + trânsito ${fmt(ideal.emTransito)} → acaba ${shortDate(dataAcaba)} (${fmt(diasAcaba ?? 0)} dias)`
          : `${fmt(ideal.estoqueAtual)} ÷ ${fmt2(ideal.consumoDiario)} = ${fmt(diasAcaba ?? 0)} dias → acaba ${shortDate(dataAcaba)}`;

  const perguntas: QA[] = [
    { n: 1, pergunta: "qual o histórico?", formula: hist },
    { n: 2, pergunta: "consumo/dia?", formula: consumo },
    { n: 3, pergunta: "quando acaba?", formula: acaba },
  ];

  // 4. quanto comprar?
  if (!ideal.modoCiclo) {
    perguntas.push({
      n: 4,
      pergunta: "quanto comprar?",
      formula: precisaRepor
        ? `alvo ${fmt(ideal.alvoEstoque)} − posição ${fmt(ideal.estoqueAtual + ideal.emTransito)} = ${fmt(ideal.compraIdeal)} un`
        : `posição ${fmt(ideal.estoqueAtual + ideal.emTransito)} já cobre o alvo ${fmt(ideal.alvoEstoque)} → suficiente`,
      destaque: precisaRepor ? "compra" : "ok",
    });
    return perguntas;
  }

  const saldo = ideal.saldoNaChegadaCompra ?? 0;
  perguntas.push({
    n: 4,
    pergunta: "quanto comprar?",
    formula: precisaRepor
      ? `${fmt2(ideal.consumoDiario)} × ${ideal.coberturaAlvoDias} (cobertura) − ${fmt(saldo)} (saldo na chegada) = ${fmt(ideal.compraIdeal)} un`
      : `posição já cobre o ciclo → suficiente (0 un)`,
    destaque: precisaRepor ? "compra" : "ok",
  });

  // 5. quando comprar?
  if (precisaRepor && diasAcaba != null) {
    const raw = diasAcaba - ideal.producaoDias;
    const concl = ideal.comprarAgora
      ? "🔴 comprar agora"
      : `comprar em ${shortDate(ideal.dataCompra)} (${fmt(ideal.diasAteComprar ?? 0)} dias)`;
    // catraca segurou a data mais cedo? (recalculada daria mais tarde que a registrada)
    const travada =
      !ideal.comprarAgora && ideal.diasAteComprar != null && ideal.diasAteComprar < Math.round(raw) - 1;
    perguntas.push({
      n: 5,
      pergunta: "quando comprar?",
      formula: `acaba ${fmt(diasAcaba)}d − produção ${ideal.producaoDias}d = ${fmt(raw)}d → ${concl}${
        travada ? "  · 📌 data do ciclo mantida (não atrasa)" : ""
      }`,
      destaque: "compra",
    });
  } else {
    perguntas.push({ n: 5, pergunta: "quando comprar?", formula: "—  (não precisa repor agora)", destaque: "ok" });
  }

  return perguntas;
}

interface Props {
  ideal: CompraIdealResult;
  /** Cabeçalho opcional (descrição do produto + cor). */
  descricao?: string | null;
  cor?: string | null;
}

/**
 * Tooltip didático da Compra Ideal — sempre as MESMAS 5 perguntas, na mesma ordem,
 * respondidas com os números reais do item. Compartilhado por Curva ABC, Lista Loja e
 * demais telas que mostram a Compra Ideal.
 */
export default function CompraIdealExplainCard({ ideal, descricao, cor }: Props) {
  const c = cenario(ideal);
  const perguntas = buildPerguntas(ideal);
  const subtitle = [
    ideal.grupoCiclo ? `${ideal.grupoCiclo} (cob ${ideal.coberturaAlvoDias} / prod ${ideal.producaoDias})` : `cobertura ${ideal.coberturaAlvoDias} / produção ${ideal.producaoDias}`,
    `estoque ${fmt(ideal.estoqueAtual)}${ideal.emTransito > 0 ? ` + ${fmt(ideal.emTransito)} trânsito` : ""}`,
  ].join(" · ");

  return (
    <div
      style={{
        width: 340,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 10px 30px rgba(15,23,42,0.18)",
        overflow: "hidden",
        fontSize: 12,
        color: "#0f172a",
        lineHeight: 1.45,
      }}
    >
      <div style={{ padding: "10px 14px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>
          {c.emoji} {c.label}
        </div>
        {descricao ? (
          <div style={{ fontWeight: 700, marginTop: 2 }}>
            {descricao}
            {cor ? <span style={{ color: "#64748b", fontWeight: 600 }}> · {cor}</span> : null}
          </div>
        ) : null}
        <div style={{ color: "#64748b", marginTop: 2 }}>{subtitle}</div>
      </div>
      <div style={{ padding: "8px 14px 12px" }}>
        {perguntas.map((q) => (
          <div key={q.n} style={{ marginTop: q.n === 1 ? 2 : 9 }}>
            <div style={{ fontWeight: 700 }}>
              {q.n}. {q.pergunta}
            </div>
            <div
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11.5,
                color: q.destaque === "compra" ? "#b45309" : q.destaque === "ok" ? "#0f766e" : "#334155",
                marginTop: 1,
              }}
            >
              {q.formula}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
