/**
 * Reproduz o cálculo exato do produto que foi de 6→51.
 * A CurvaAbcPage primeiro renderiza COM mesesHistoricoFilial (antes das métricas carregarem),
 * depois atualiza para mesesDisponiveis das métricas. Testamos os dois cenários.
 *
 * Uso: npx tsx --env-file=.env.local tmp/test-calculo-6-51.ts
 */
import {
  getReposicaoCompraView,
  getReposicaoBaseType,
  getSuggestedQtyValue,
  getLimiteDiasReposicao,
  getMesesDisponiveis,
  getVelocidadeAjustada,
  getSuggestedDelta,
} from "@/lib/utils/suggestion-rules";

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null) return "—";
  return n.toFixed(dec);
}

function simular(
  label: string,
  input: Parameters<typeof getReposicaoCompraView>[0],
  diasCorridosMes: number
) {
  const sugestao = getReposicaoCompraView(input, diasCorridosMes);
  const tipo = getReposicaoBaseType(sugestao);
  const qtd = getSuggestedQtyValue(sugestao);
  const meses = getMesesDisponiveis(input);
  const vel = getVelocidadeAjustada(input);
  const delta = getSuggestedDelta(input, diasCorridosMes);
  const limiteDias = getLimiteDiasReposicao(input);

  console.log(`\n${label}`);
  console.log(`  diasCorridosMes:    ${diasCorridosMes}`);
  console.log(`  mesesDisponiveis:   ${fmt(meses)}`);
  console.log(`  velocidadeAjustada: ${fmt(vel)} un/mês`);
  console.log(`  limiteDias:         ${limiteDias}`);
  console.log(`  getSuggestedDelta:  ${fmt(delta, 1)}`);
  console.log(`  qtdFinal (COMPRA):  ${sugestao.qtdFinal}`);
  console.log(`  qtdS:               ${sugestao.qtdS}`);
  console.log(`  qtdPO:              ${sugestao.qtdPO}`);
  console.log(`  QTD SUGERIDA:       ${qtd} [tipo: ${tipo}]`);
}

// Produto N2.P1.0012 / POWERBANK 5000MAH / TITANIO CHUMBO
// Dados do API (fetchTopProdutosUltimos3Meses — não tem diasComEstoquePositivo)
const baseApiData = {
  linha: "ELETRONICOS",
  subgrupo: "POWER BANK 5000",
  estoqueAtual: 14,       // de uma filial específica (a que o usuário estava vendo)
  vendasMesAtual: 16,     // 16 vendas no mês atual nessa filial
  mesesHistoricoFilial: 1.0,
  // diasComEstoquePositivo, diasSemEstoque, mesesDisponiveis, velocidadeAjustada
  // NÃO vêm da lista-compra-sugerida → undefined
};

// DIA DO MÊS de quando o usuário viu (assumindo ~25/mai)
const DIAS_CORRIDOS = 25;

console.log("=".repeat(70));
console.log("PRODUTO: N2.P1.0012 POWERBANK 5000MAH WUP-1004C");
console.log("=".repeat(70));

// ── CENÁRIO 1: ANTES das métricas carregarem na CurvaAbcPage ────────────────
// A página usa somente os dados do /api/curva-abc: não tem diasComEstoquePositivo
// → getDiasComEstoquePositivo() faz fallback para mesesHistoricoFilial * 30

console.log("\n### Cenário 1: Antes das métricas (só mesesHistoricoFilial=1.0)");

// COM piso de 1 mês (antes da nossa mudança)
simular("ANTES da mudança (piso 1 mês)", {
  ...baseApiData,
  qtde12m: 64, // vendas3meses * 4 como aproximação de qtde12m (16/mês * 4)
}, DIAS_CORRIDOS);

// SEM piso (após nossa mudança) — mesesHistoricoFilial=1.0 → meses=1.0 (não muda!)
simular("DEPOIS da mudança (sem piso) — mesesHistoricoFilial=1.0", {
  ...baseApiData,
  qtde12m: 64,
}, DIAS_CORRIDOS);

// ── CENÁRIO 2: Com produto chegando há poucos dias (diasComEstoquePositivo baixo) ────
console.log("\n### Cenário 2: Produto com diasComEstoquePositivo=4 dias (chegou há 4 dias)");

simular("ANTES (piso 1 mês): diasComEstoquePositivo=4 → meses=max(0.13,1)=1", {
  ...baseApiData,
  qtde12m: 64,
  diasComEstoquePositivo: 4,
  diasSemEstoque: 361,
  mesesDisponiveis: 1.0,       // old: max(4/30, 1) = 1
  velocidadeAjustada: 64,      // old: 64/1
}, DIAS_CORRIDOS);

simular("DEPOIS (sem piso): diasComEstoquePositivo=4 → meses=4/30=0.13", {
  ...baseApiData,
  qtde12m: 64,
  diasComEstoquePositivo: 4,
  diasSemEstoque: 361,
  mesesDisponiveis: 4/30,            // new: 0.133
  velocidadeAjustada: 64 / (4/30),   // new: 480 un/mês
}, DIAS_CORRIDOS);

// ── CENÁRIO 3: Produto com mesesHistoricoFilial=0.12 (produto de 3-4 dias) ──────────
console.log("\n### Cenário 3: Produto com mesesHistoricoFilial=0.12 (chegou há ~3 dias)");

simular("ANTES (piso 1 mês): meses=max(0.12,1)=1 → vel=6", {
  ...baseApiData,
  qtde12m: 6,   // 6 un em 3 dias
  mesesHistoricoFilial: 0.12,
  // sem diasComEstoquePositivo → usa mesesHistoricoFilial
}, DIAS_CORRIDOS);

simular("DEPOIS (sem piso): meses=0.12 → vel=50", {
  ...baseApiData,
  qtde12m: 6,   // 6 un em 3 dias
  mesesHistoricoFilial: 0.12,
  // sem diasComEstoquePositivo → usa mesesHistoricoFilial=0.12
}, DIAS_CORRIDOS);

console.log("\n" + "=".repeat(70));
console.log("CONCLUSÃO:");
console.log("Se o produto tinha mesesHistoricoFilial=0.12 (~3 dias na filial):");
console.log("  • ANTES: meses=max(0.12, 1)=1  → velocidade = qtde12m/1 → sugestão baixa");
console.log("  • DEPOIS: meses=0.12            → velocidade = qtde12m/0.12 → sugestão ~8x maior");
console.log("\nIsso explica a variação de 6→51 sem nenhuma relação com PO.");
console.log("=".repeat(70));
