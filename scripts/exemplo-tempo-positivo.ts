/**
 * Testes explicativos — tempo parado vs tempo positivo.
 * Executar: npx tsx scripts/exemplo-tempo-positivo.ts
 */
import {
  buildDisponibilidadeResumo,
  calcQtdSugestaoEInfo,
  calcQtdSugestaoPOInfo,
  calcQtdSugestaoS,
  getReposicaoCompraView,
  getVelocidadeAjustada,
} from "../lib/utils/suggestion-rules";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
}

function fmt(n: number) {
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

console.log("=== Testes: tempo positivo vs tempo parado ===\n");

const stockTimeline = Array.from({ length: 365 }, (_, d) => ({
  dateIso: `2025-day-${d}`,
  stockTotal: d < 90 ? 10 : 0,
}));
const disp = buildDisponibilidadeResumo(stockTimeline);
assert(disp.diasComEstoquePositivo === 90, "timeline 90 dias positivos");
assert(disp.diasSemEstoque === 275, "timeline 275 dias parados");

const itemParado = {
  qtde12m: 120,
  estoqueAtual: 0,
  linha: "ACESSORIOS",
  subgrupo: "OUTROS",
  diasComEstoquePositivo: 90,
  diasSemEstoque: 275,
  mesesDisponiveis: 3,
  velocidadeAjustada: 40,
};

const velComMetricas = getVelocidadeAjustada(itemParado);
const velSemMetricas = getVelocidadeAjustada({
  ...itemParado,
  diasComEstoquePositivo: undefined,
  diasSemEstoque: undefined,
  mesesDisponiveis: undefined,
  velocidadeAjustada: undefined,
  mesesHistoricoFilial: 12,
});

assert(velComMetricas === 40, `velocidade com 90d positivos = 40 (obteve ${velComMetricas})`);
assert(
  Math.abs(velSemMetricas - 10) < 0.01,
  `fallback 12 meses = 10/mês (obteve ${velSemMetricas})`
);

console.log("Exemplo 1 — Produto vendeu 120 un. e ficou parado");
console.log(`  Dias com estoque: ${disp.diasComEstoquePositivo} | Dias parados: ${disp.diasSemEstoque}`);
console.log(`  Velocidade IGNORANDO parado (12m corridos): ${fmt(velSemMetricas)} un./mês`);
console.log(`  Velocidade SÓ tempo positivo (90 dias):     ${fmt(velComMetricas)} un./mês`);
console.log("  → Com métricas, o tempo parado não entra no denominador.\n");

const eInfo = calcQtdSugestaoEInfo(itemParado);
assert(eInfo != null && eInfo.qtd >= 1, "E deve sugerir");
console.log("Exemplo 2 — Sugestão E (estoque 0)");
console.log(`  meses disponíveis: ${fmt(eInfo!.mesesDisponiveis)} | meses parados: ${fmt(eInfo!.mesesSemEstoque)}`);
console.log(`  qtd E (cobertura 60d): ${eInfo!.qtd} un.\n`);

const compraMes = getReposicaoCompraView(
  {
    qtde12m: 120,
    vendasMesAtual: 15,
    estoqueAtual: 5,
    diasComEstoquePositivo: 90,
    mesesDisponiveis: 3,
    velocidadeAjustada: 40,
  },
  22
);
console.log("Exemplo 3 — COMPRA (mês corrente, não usa dias positivos 12m)");
console.log(`  vendasMes=15, diasCorridos=22, estoque=5 → qtdFinal: ${compraMes.qtdFinal}\n`);

const poOk = calcQtdSugestaoPOInfo({
  qtde12m: 48,
  estoqueAtual: 0,
  diasComEstoquePositivo: 20,
  diasSemEstoque: 300,
  mesesDisponiveis: 20 / 30,
  velocidadeAjustada: 72,
});
const poFail = calcQtdSugestaoPOInfo({
  qtde12m: 48,
  estoqueAtual: 0,
  diasComEstoquePositivo: 90,
  diasSemEstoque: 275,
});
assert(poOk != null, "PO com janela curta");
assert(poFail == null, "PO bloqueado com 90d positivos");
console.log("Exemplo 4 — PO (potencial oculto)");
console.log(`  20d positivos + 300 parados → ${poOk?.qtd ?? "—"} un.`);
console.log(`  90d positivos + 275 parados → bloqueado\n`);

const sCap = calcQtdSugestaoS({
  qtde12m: 60,
  estoqueAtual: 0,
  diasComEstoquePositivo: 60,
  mesesDisponiveis: 2,
  velocidadeAjustada: 30,
});
assert(sCap <= 3, `cap S com <90d (obteve ${sCap})`);
console.log("Exemplo 5 — Trava: < 90 dias positivos → S máx. 3 un.");
console.log(`  velocidade 30/mês, 60 dias positivos → qtd S: ${sCap}\n`);

console.log("=== Todos os testes passaram ===");
