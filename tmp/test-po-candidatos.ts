/**
 * Busca candidatos a PO: produtos com estoque baixo que tiveram vendas relevantes.
 * Usa o metricas-itens (mesma fonte da CurvaAbcPage) para ter diasComEstoquePositivo real.
 *
 * Uso: npx tsx --env-file=.env.local tmp/test-po-candidatos.ts
 */
import { fetchTopProdutosUltimos3Meses } from "@/lib/repositories/controleEstoque";
import { getControleEstoqueMetricasItens } from "@/lib/server/controle-estoque-metricas";
import { calcQtdSugestaoPOInfo } from "@/lib/utils/suggestion-rules";

function fmt(n: number | null | undefined, dec = 1) {
  if (n == null) return "—";
  return n.toFixed(dec);
}

async function main() {
  const COMPANY = "nerd";
  const FILIAL = null;

  console.log("Passo 1: buscando produtos NERD (limit=300)...");
  const allItems = await fetchTopProdutosUltimos3Meses({
    company: COMPANY,
    filial: FILIAL,
    categoria: null,
    grupos: null,
    linhas: null,
    colecoes: null,
    subgrupos: null,
    grades: null,
    produtos: null,
    qtdCompra: 0,
    porCor: false,
    limit: 300,
  });

  // Filtrar só os que têm estoque baixo (PO requer estoqueAtual <= 1)
  const candidatos = allItems.filter((p) => (p.estoqueAtual ?? 0) <= 1 && (p.vendas3meses ?? 0) >= 3);
  console.log(`→ Total: ${allItems.length} produtos | Com estoque ≤ 1 e vendas ≥ 3: ${candidatos.length}\n`);

  if (candidatos.length === 0) {
    console.log("Nenhum candidato com estoque ≤ 1 nos top 300 por receita.");
    console.log("PO foi projetada para produtos que saíram de estoque. Nos top 300 por receita eles têm estoque alto.");
    process.exit(0);
  }

  console.log("Passo 2: buscando métricas reais (diasComEstoquePositivo) para cada candidato...");
  const metricasResult = await getControleEstoqueMetricasItens({
    company: COMPANY,
    filial: FILIAL,
    includeHistorico: true,
    itens: candidatos.map((p) => ({ produto: p.produto, corProduto: p.cor ?? null })),
  });

  console.log(`→ Métricas retornadas para ${Object.keys(metricasResult).length} itens\n`);
  console.log("=".repeat(100));

  let poCount = 0;
  for (const item of candidatos) {
    const key = `${item.produto}||${item.cor ?? ""}`;
    const m = metricasResult[key]?.resumo;
    if (!m) continue;

    const poResult = calcQtdSugestaoPOInfo({
      qtde12m: m.qtde12m,
      vendasMesAtual: m.vendasMesAtual,
      estoqueAtual: m.estoqueTotal,
      linha: item.linha,
      subgrupo: item.subgrupo,
      diasDesdeUltimaVenda: m.diasDesdeUltimaVenda ?? null,
      mesesHistoricoFilial: m.mesesHistoricoFilial,
      diasComEstoquePositivo: m.diasComEstoquePositivo,
      diasSemEstoque: m.diasSemEstoque,
      mesesDisponiveis: m.mesesDisponiveis,
      velocidadeAjustada: m.velocidadeAjustada,
    });

    const status = poResult ? "✅ PO ATIVA" : "❌ não qualifica";
    if (poResult) poCount++;

    console.log(`\n${status} — ${item.produto} ${item.descricao}`);
    console.log(`   estoque atual:          ${m.estoqueTotal}`);
    console.log(`   qtde12m:                ${m.qtde12m}`);
    console.log(`   diasComEstoquePositivo: ${fmt(m.diasComEstoquePositivo, 0)}`);
    console.log(`   diasSemEstoque:         ${fmt(m.diasSemEstoque, 0)}`);
    console.log(`   mesesDisponiveis:       ${fmt(m.mesesDisponiveis)}`);
    console.log(`   velocidadeAjustada:     ${fmt(m.velocidadeAjustada)} un/mês`);

    if (poResult) {
      console.log(`   → QTD PO sugerida:     ${poResult.qtd}`);
      console.log(`   → potencialMensalBruto: ${fmt(poResult.potencialMensalBruto)} un/mês`);
      console.log(`   → limiteSeguro:         ${poResult.limiteSeguro}`);
    } else {
      const e = m.estoqueTotal;
      const dc = m.diasComEstoquePositivo ?? 0;
      const ds = m.diasSemEstoque ?? 0;
      const vAj = m.velocidadeAjustada ?? 0;
      const pot = m.qtde12m / Math.max(dc, 1);
      const motivos: string[] = [];
      if (e > 1) motivos.push(`estoque=${e} > 1`);
      if ((m.qtde12m ?? 0) < 3) motivos.push(`qtde12m=${m.qtde12m} < 3`);
      if (dc <= 0 || dc > 30) motivos.push(`diasComEstoquePositivo=${dc} fora de (0..30]`);
      if (ds < Math.max(15, dc * 2)) motivos.push(`diasSemEstoque=${ds} < ${Math.max(15, dc * 2)}`);
      if (pot < 4) motivos.push(`potencialDia=${fmt(pot)} → mensal=${fmt(pot * 30)} < 4`);
      if (vAj < 4) motivos.push(`velocidadeAjustada=${fmt(vAj)} < 4`);
      console.log(`   → Motivos: ${motivos.join("; ")}`);
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log(`\nRESUMO: ${poCount} de ${candidatos.length} candidatos qualificam para badge PO.`);
  if (poCount === 0) {
    console.log("\nNenhum produto qualificou. Possíveis razões:");
    console.log("  • diasComEstoquePositivo fora de (0..30]: produto com histórico longo ou sem dias positivos");
    console.log("  • diasSemEstoque insuficiente: ficou pouco tempo sem estoque");
    console.log("  • velocidadeAjustada < 4 un/mês: vendeu pouco quando tinha estoque");
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
