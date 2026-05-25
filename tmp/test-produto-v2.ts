/**
 * Analisa N2.P1.0012 sem filtro de cor — tentando vários formatos de cor.
 * Uso: npx tsx --env-file=.env.local tmp/test-produto-v2.ts
 */
import { fetchTopProdutosUltimos3Meses } from "@/lib/repositories/controleEstoque";
import { getControleEstoqueMetricasItens } from "@/lib/server/controle-estoque-metricas";
import {
  calcQtdSugestaoPOInfo,
  getReposicaoCompraView,
  getReposicaoBaseType,
  getSuggestedQtyValue,
  getMesesDisponiveis,
} from "@/lib/utils/suggestion-rules";

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null) return "—";
  return n.toFixed(dec);
}

async function main() {
  const COMPANY = "nerd";
  const PRODUTO = "N2.P1.0012";
  const hoje = new Date();
  const diasCorridosMes = hoje.getDate();

  console.log(`Analisando produto: ${PRODUTO}\n`);

  // Buscar dados base por produto (sem cor)
  const items = await fetchTopProdutosUltimos3Meses({
    company: COMPANY, filial: null, categoria: null,
    grupos: null, linhas: null, colecoes: null, subgrupos: null, grades: null,
    produtos: [PRODUTO],
    qtdCompra: 0, porCor: false, limit: 10,
  });
  console.log(`Dados base: ${items.length} registro(s)\n`);

  for (const item of items) {
    console.log(`\n  Produto: ${item.produto} | Cor: ${item.cor ?? "(todas)"}`);
    console.log(`  estoqueAtual: ${item.estoqueAtual} | vendas3meses: ${item.vendas3meses} | vendasMesAtual: ${item.vendasMesAtual}`);
    console.log(`  mesesHistoricoFilial: ${fmt(item.mesesHistoricoFilial)} | historicoParcial: ${item.historicoParcial}`);
  }

  // Buscar métricas sem cor (produto agregado)
  console.log("\n=== MÉTRICAS SEM COR (agregado) ===");
  const m1 = await getControleEstoqueMetricasItens({
    company: COMPANY, filial: null, includeHistorico: true,
    itens: [{ produto: PRODUTO, corProduto: null }],
  });

  for (const [key, data] of Object.entries(m1)) {
    const r = data.resumo;
    console.log(`  Key: "${key}"`);
    console.log(`  qtde12m: ${r.qtde12m} | estoqueTotal: ${r.estoqueTotal} | vendasMesAtual: ${r.vendasMesAtual}`);
    console.log(`  mesesHistoricoFilial: ${fmt(r.mesesHistoricoFilial)}`);
    console.log(`  diasComEstoquePositivo: ${fmt(r.diasComEstoquePositivo, 0)}`);
    console.log(`  diasSemEstoque:         ${fmt(r.diasSemEstoque, 0)}`);
    console.log(`  mesesDisponiveis:       ${fmt(r.mesesDisponiveis)}`);
    console.log(`  velocidadeAjustada:     ${fmt(r.velocidadeAjustada)} un/mês`);

    // Simular sugestão
    const input = {
      qtde12m: r.qtde12m,
      vendasMesAtual: r.vendasMesAtual,
      estoqueAtual: r.estoqueTotal,
      linha: items[0]?.linha,
      subgrupo: items[0]?.subgrupo,
      diasDesdeUltimaVenda: r.diasDesdeUltimaVenda ?? null,
      mesesHistoricoFilial: r.mesesHistoricoFilial,
      diasComEstoquePositivo: r.diasComEstoquePositivo,
      diasSemEstoque: r.diasSemEstoque,
      mesesDisponiveis: r.mesesDisponiveis,
      velocidadeAjustada: r.velocidadeAjustada,
    };

    const sugestaoNovo = getReposicaoCompraView(input, diasCorridosMes);
    const tipoNovo = getReposicaoBaseType(sugestaoNovo);
    const qtdNovo = getSuggestedQtyValue(sugestaoNovo);

    // Simular COM piso (antes da mudança)
    const dcOld = r.diasComEstoquePositivo ?? 0;
    const mesesOld = Math.max(dcOld > 0 ? dcOld / 30 : 0, 1);
    const velOld = mesesOld > 0 ? Math.round((r.qtde12m / mesesOld) * 100) / 100 : 0;
    const inputOld = { ...input, mesesDisponiveis: mesesOld, velocidadeAjustada: velOld };
    const sugestaoOld = getReposicaoCompraView(inputOld, diasCorridosMes);
    const qtdOld = getSuggestedQtyValue(sugestaoOld);

    console.log(`\n  ANTES (piso 1 mês):  meses=${fmt(mesesOld)} | vel=${fmt(velOld)} | QTD=${qtdOld}`);
    console.log(`  DEPOIS (sem piso):   meses=${fmt(r.mesesDisponiveis)} | vel=${fmt(r.velocidadeAjustada)} | tipo=${tipoNovo} | QTD=${qtdNovo}`);
    console.log(`  VARIAÇÃO: ${qtdOld} → ${qtdNovo}`);

    const poInfo = calcQtdSugestaoPOInfo(input);
    console.log(`  PO qualifica: ${poInfo ? `SIM (qtd=${poInfo.qtd})` : "NÃO"}`);

    if (poInfo) {
      console.log(`    diasComEstoquePositivo: ${poInfo.diasComEstoquePositivo}`);
      console.log(`    velocidadeAjustada: ${fmt(poInfo.velocidadeAjustada)}`);
      console.log(`    potencialMensalBruto: ${fmt(poInfo.potencialMensalBruto)}`);
      console.log(`    limiteSeguro: ${poInfo.limiteSeguro}`);
    } else {
      const dc = r.diasComEstoquePositivo ?? 0;
      const ds = r.diasSemEstoque ?? 0;
      const vAj = r.velocidadeAjustada ?? 0;
      const pot = r.qtde12m / Math.max(dc, 1);
      const e = r.estoqueTotal;
      const motivos: string[] = [];
      if (e > 1) motivos.push(`estoque=${e}`);
      if ((r.qtde12m ?? 0) < 3) motivos.push(`qtde12m=${r.qtde12m}`);
      if (dc <= 0 || dc > 30) motivos.push(`diasComEstoquePositivo=${dc} fora de (0..30]`);
      if (ds < Math.max(15, dc * 2)) motivos.push(`diasSemEstoque=${ds} < ${Math.max(15, dc * 2)}`);
      if (pot < 4) motivos.push(`potencial mensal=${fmt(pot*30)} < 4`);
      if (vAj < 4) motivos.push(`velocidade=${fmt(vAj)} < 4`);
      console.log(`    Motivos: ${motivos.join("; ")}`);
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
