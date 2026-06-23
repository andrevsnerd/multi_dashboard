/**
 * Valida o modo CICLO da Compra Ideal contra o exemplo do dono (ChatGPT/papel):
 *   vende 8/mês, cobertura 90, produção (lead time) 70.
 *   - Compra HOJE 24 un (1 ciclo).
 *   - Após pedir (24 em trânsito chegando em 70 dias), a PRÓXIMA compra cai ~22/09 (90 dias).
 *
 * Uso: npx tsx tmp/test-compra-ciclo.ts
 */
import { applyDataCompraFixa, calcCompraIdeal } from "@/lib/utils/compra-ideal";
import { resolveCicloCompra } from "@/lib/config/compra-ciclo";

const hoje = new Date(2026, 5, 23); // 23/06/2026 (mês 0-based)
const consumoMensal = 8;
// ritmo: 8 vendas em 30 dias com estoque → consumo/dia = 8/30
const ritmoBase = { ritmoDiasComEstoque: 30, ritmoVendasPeriodo: 8 };

function fmt(n: number) {
  return Math.round(n * 100) / 100;
}

console.log("=== Resolver de ciclo (scarfme) ===");
for (const [linha, subgrupo] of [
  ["LENÇOS", "CETIM DE SEDA"],
  ["INDIA", "100% CASHMERE"],
  ["FASHION", "VISCOSE"],
  ["PASHMINA", "VISCOSE (PASHMINA)"],
  ["LENÇOS", "VISCOSE"],
  ["ACESSÓRIOS", "COLAR"],
] as const) {
  const c = resolveCicloCompra("scarfme", { linha, subgrupo });
  console.log(`  ${linha} / ${subgrupo}  →  ${c.grupo}  (cob ${c.coberturaDias} / prod ${c.producaoDias})`);
}

console.log("\n=== Cenário 1: item zerado, sem trânsito (compra inicial) ===");
const r1 = calcCompraIdeal({
  estoqueAtual: 0,
  ...ritmoBase,
  coberturaDias: 90,
  producaoDias: 70,
  transitEntries: [],
  hoje,
});
console.log(`  consumo/dia=${fmt(r1.consumoDiario)} ritmoMensal=${r1.ritmoMensal}`);
console.log(`  QUANTIDADE = ${r1.compraIdeal}  (esperado ~24)`);
console.log(`  acaba c/ trânsito = ${r1.acabaComTransitoIso} (em ${r1.diasAteAcabarComTransito}d)`);
console.log(`  DATA compra = ${r1.dataCompra}  comprarAgora=${r1.comprarAgora}  (esperado: hoje/atrasado)`);
console.log(`  status=${r1.status} modoCiclo=${r1.modoCiclo}`);

console.log("\n=== Cenário 2: após comprar (24 em trânsito chegando em 70 dias = 01/09) ===");
const chegada = new Date(2026, 8, 1); // 01/09/2026
const r2 = calcCompraIdeal({
  estoqueAtual: 0,
  ...ritmoBase,
  coberturaDias: 90,
  producaoDias: 70,
  transitEntries: [{ quantidade: 24, dataRecebimento: "2026-09-01" } as any],
  hoje,
});
console.log(`  em trânsito=${r2.emTransito} chega=${r2.chegaEm}`);
console.log(`  acaba c/ trânsito = ${r2.acabaComTransitoIso} (em ${r2.diasAteAcabarComTransito}d)  (esperado ~30/11)`);
console.log(`  DATA próxima compra = ${r2.dataCompra} (em ${r2.diasAteComprar}d)  (esperado ~22/09)`);
console.log(`  QUANTIDADE próxima = ${r2.compraIdeal}  (esperado ~24)  comprarAgora=${r2.comprarAgora}`);
console.log(`  status=${r2.status}`);

console.log("\n=== Cenário 3: comparação LEGADO vs CICLO (números altos) ===");
const legado = calcCompraIdeal({ estoqueAtual: 0, ...ritmoBase, subgrupo: "CETIM DE SEDA", transitEntries: [], hoje });
console.log(`  LEGADO (2× cobertura 90 = 180d): compra = ${legado.compraIdeal}`);
console.log(`  CICLO  (1 ciclo cobertura 90):   compra = ${r1.compraIdeal}`);
// Sem persistência: a data é calculada ao vivo. Ritmo estável → data estável;
// aceleração → data mais cedo (naturalmente); desaceleração → data mais tarde.
function calcCom(vendas: number) {
  return calcCompraIdeal({
    estoqueAtual: 0,
    ritmoDiasComEstoque: 30,
    ritmoVendasPeriodo: vendas,
    coberturaDias: 90,
    producaoDias: 70,
    transitEntries: [{ quantidade: 24, dataRecebimento: "2026-09-01" } as any],
    hoje,
  });
}

console.log("\n=== Cenário 4: ACELEROU (16/mês) → data ao vivo antecipa sozinha ===");
const rAcel = calcCom(16);
console.log(`  acaba ${rAcel.acabaComTransitoIso} → data compra = ${rAcel.dataCompra} (em ${rAcel.diasAteComprar}d)`);
console.log(`  qtd=${rAcel.compraIdeal}  (vs base 8/mês → 21/09; acelerou → antecipou)`);

console.log("\n=== Cenário 5: DESACELEROU (4/mês) → data ao vivo posterga sozinha ===");
const rDesa = calcCom(4);
console.log(`  acaba ${rDesa.acabaComTransitoIso} → data compra = ${rDesa.dataCompra} (em ${rDesa.diasAteComprar}d)`);
console.log(`  qtd=${rDesa.compraIdeal}  (postergou e baixou a qtd)`);

console.log("\n=== Cenário 6: ritmo ESTÁVEL (8/mês) → data se mantém naturalmente ===");
const rEstavel = calcCom(8);
console.log(`  data compra = ${rEstavel.dataCompra} (em ${rEstavel.diasAteComprar}d)  qtd=${rEstavel.compraIdeal}  (≈ base, estável)`);

// CATRACA (regra da página): a data só anda pra mais cedo. Simula a reconciliação
// stored vs recalculada que o memo da ListaCompraSugeridaPage faz.
function aplicaCatraca(storedIso: string | null, calc: ReturnType<typeof calcCom>) {
  // mantém a mais cedo entre a registrada e a recalculada
  if (storedIso && calc.dataCompra && storedIso <= calc.dataCompra) {
    return applyDataCompraFixa(calc, storedIso, hoje); // segura a registrada
  }
  return calc; // sem registro, ou recalculada mais cedo → avança a catraca
}

console.log("\n=== Cenário 7: CATRACA — registrada 2026-08-07, agora DESACELEROU ===");
// Já tinha antecipado pra 07/08 (pico anterior). Agora caiu pra 4/mês (calc → 20/12).
const cat1 = aplicaCatraca("2026-08-07", calcCom(4));
console.log(`  recalculada hoje = ${calcCom(4).dataCompra} → catraca MANTÉM = ${cat1.dataCompra} (esperado 2026-08-07)`);
console.log(`  qtd segue viva = ${cat1.compraIdeal} (atualiza)`);

console.log("\n=== Cenário 8: CATRACA — registrada 2026-09-21, agora ACELEROU ===");
// Tinha 21/09 (base). Acelerou pra 16/mês (calc → 07/08, mais cedo) → catraca AVANÇA.
const cat2 = aplicaCatraca("2026-09-21", calcCom(16));
console.log(`  recalculada hoje = ${calcCom(16).dataCompra} → catraca AVANÇA p/ = ${cat2.dataCompra} (esperado 2026-08-07)`);

void chegada;
void consumoMensal;
