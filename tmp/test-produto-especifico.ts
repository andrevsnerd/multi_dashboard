/**
 * Analisa produto específico N2.P1.0012 para entender a sugestão.
 * Uso: npx tsx --env-file=.env.local tmp/test-produto-especifico.ts
 */
import { fetchTopProdutosUltimos3Meses } from "@/lib/repositories/controleEstoque";
import { getControleEstoqueMetricasItens } from "@/lib/server/controle-estoque-metricas";
import {
  calcQtdSugestaoPOInfo,
  getReposicaoCompraView,
  getReposicaoBaseType,
  getSuggestedQtyValue,
} from "@/lib/utils/suggestion-rules";

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null) return "—";
  return n.toFixed(dec);
}

async function main() {
  const COMPANY = "nerd";
  const FILIAL = null;
  const PRODUTO = "N2.P1.0012";
  const COR = "TITANIO CHUMBO";

  console.log(`Analisando produto: ${PRODUTO} | Cor: ${COR}\n`);

  // Passo 1: buscar dados base
  const items = await fetchTopProdutosUltimos3Meses({
    company: COMPANY,
    filial: FILIAL,
    categoria: null,
    grupos: null,
    linhas: null,
    colecoes: null,
    subgrupos: null,
    grades: null,
    produtos: [PRODUTO],
    qtdCompra: 0,
    porCor: true,
    limit: 10,
  });

  const item = items.find(i => i.produto === PRODUTO);
  if (!item) {
    console.log("Produto não encontrado nos dados base.");
    process.exit(1);
  }

  console.log("=== DADOS BASE (fetchTopProdutosUltimos3Meses) ===");
  console.log(`  estoqueAtual:           ${item.estoqueAtual}`);
  console.log(`  vendas3meses:           ${item.vendas3meses}`);
  console.log(`  vendasMesAtual:         ${item.vendasMesAtual}`);
  console.log(`  mesesHistoricoFilial:   ${fmt(item.mesesHistoricoFilial)}`);
  console.log(`  historicoParcial:       ${item.historicoParcial}`);
  const raw = item as Record<string, unknown>;
  console.log(`  diasComEstoquePositivo: ${raw.diasComEstoquePositivo ?? "NÃO RETORNADO"}`);
  console.log(`  diasSemEstoque:         ${raw.diasSemEstoque ?? "NÃO RETORNADO"}`);
  console.log(`  mesesDisponiveis:       ${raw.mesesDisponiveis ?? "NÃO RETORNADO"}`);
  console.log(`  velocidadeAjustada:     ${raw.velocidadeAjustada ?? "NÃO RETORNADO"}`);

  // Passo 2: buscar métricas completas (mesma fonte da CurvaAbcPage)
  console.log("\n=== MÉTRICAS COMPLETAS (mesma fonte da CurvaAbcPage) ===");
  const metricas = await getControleEstoqueMetricasItens({
    company: COMPANY,
    filial: FILIAL,
    includeHistorico: true,
    itens: [{ produto: PRODUTO, corProduto: COR }],
  });

  const key = Object.keys(metricas)[0];
  const m = metricas[key]?.resumo;
  if (!m) {
    console.log("  Métricas não encontradas.");
    process.exit(1);
  }

  console.log(`  qtde12m:                ${m.qtde12m}`);
  console.log(`  vendasMesAtual:         ${m.vendasMesAtual}`);
  console.log(`  estoqueTotal:           ${m.estoqueTotal}`);
  console.log(`  mesesHistoricoFilial:   ${fmt(m.mesesHistoricoFilial)}`);
  console.log(`  diasComEstoquePositivo: ${fmt(m.diasComEstoquePositivo, 0)}`);
  console.log(`  diasSemEstoque:         ${fmt(m.diasSemEstoque, 0)}`);
  console.log(`  mesesDisponiveis:       ${fmt(m.mesesDisponiveis)}`);
  console.log(`  velocidadeAjustada:     ${fmt(m.velocidadeAjustada)} un/mês`);

  // Passo 3: simular a sugestão com e sem PO, com e sem piso de 1 mês
  console.log("\n=== SIMULAÇÃO DA SUGESTÃO ===");

  const hoje = new Date();
  const diasCorridosMes = hoje.getDate(); // dia atual do mês

  const input = {
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
  };

  // Com dados reais (após nossa mudança — sem piso de 1 mês)
  const sugestaoAtual = getReposicaoCompraView(input, diasCorridosMes);
  const tipoAtual = getReposicaoBaseType(sugestaoAtual);
  const qtdAtual = getSuggestedQtyValue(sugestaoAtual);

  // Simulando COM piso de 1 mês (antes da mudança)
  const mesesDisponiveisAntes = Math.max(
    (m.diasComEstoquePositivo ?? 0) > 0 ? (m.diasComEstoquePositivo ?? 0) / 30 : 0,
    1  // o piso que removemos
  );
  const velocidadeAjustadaAntes =
    mesesDisponiveisAntes > 0
      ? Math.round((m.qtde12m / mesesDisponiveisAntes + Number.EPSILON) * 100) / 100
      : 0;

  const inputAntes = {
    ...input,
    mesesDisponiveis: mesesDisponiveisAntes,
    velocidadeAjustada: velocidadeAjustadaAntes,
  };
  const sugestaoAntes = getReposicaoCompraView(inputAntes, diasCorridosMes);
  const qtdAntes = getSuggestedQtyValue(sugestaoAntes);

  console.log(`\n  Antes da mudança (com piso de 1 mês):`);
  console.log(`    mesesDisponiveis:   ${fmt(mesesDisponiveisAntes)}`);
  console.log(`    velocidadeAjustada: ${fmt(velocidadeAjustadaAntes)} un/mês`);
  console.log(`    QTD SUGERIDA:       ${qtdAntes}`);

  console.log(`\n  Depois da mudança (sem piso):`);
  console.log(`    mesesDisponiveis:   ${fmt(m.mesesDisponiveis)}`);
  console.log(`    velocidadeAjustada: ${fmt(m.velocidadeAjustada)} un/mês`);
  console.log(`    tipo:               ${tipoAtual}`);
  console.log(`    QTD SUGERIDA:       ${qtdAtual}`);
  console.log(`    qtdFinal:           ${sugestaoAtual.qtdFinal}`);
  console.log(`    qtdS:               ${sugestaoAtual.qtdS}`);
  console.log(`    qtdPO:              ${sugestaoAtual.qtdPO}`);

  const variacao = qtdAntes > 0 ? ((qtdAtual - qtdAntes) / qtdAntes * 100).toFixed(1) : "∞";
  console.log(`\n  VARIAÇÃO: ${qtdAntes} → ${qtdAtual} (+${variacao}%)`);

  // Passo 4: verificar se PO qualifica
  console.log("\n=== QUALIFICAÇÃO PARA BADGE PO ===");
  const poInfo = calcQtdSugestaoPOInfo(input);
  if (poInfo) {
    console.log(`  ✅ QUALIFICA PARA PO — qtd sugerida PO: ${poInfo.qtd}`);
    console.log(`     potencialMensalBruto: ${fmt(poInfo.potencialMensalBruto)}`);
    console.log(`     limiteSeguro: ${poInfo.limiteSeguro}`);
  } else {
    const dc = m.diasComEstoquePositivo ?? 0;
    const ds = m.diasSemEstoque ?? 0;
    const vAj = m.velocidadeAjustada ?? 0;
    const pot = m.qtde12m / Math.max(dc, 1);
    const e = m.estoqueTotal;
    const motivos: string[] = [];
    if (e > 1) motivos.push(`estoque=${e} > 1`);
    if (m.qtde12m < 3) motivos.push(`qtde12m=${m.qtde12m} < 3`);
    if (dc <= 0 || dc > 30) motivos.push(`diasComEstoquePositivo=${dc} fora de (0..30]`);
    if (ds < Math.max(15, dc * 2)) motivos.push(`diasSemEstoque=${ds} < ${Math.max(15, dc * 2)}`);
    if (pot < 4) motivos.push(`potencialDia=${fmt(pot)} → mensal=${fmt(pot*30)} < 4`);
    if (vAj < 4) motivos.push(`velocidadeAjustada=${fmt(vAj)} < 4`);
    console.log(`  ❌ Não qualifica para PO`);
    console.log(`     Motivos: ${motivos.join("; ")}`);
    console.log(`\n  → A elevação de ${qtdAntes}→${qtdAtual} veio da velocidadeAjustada mais alta (sem piso),`);
    console.log(`    mas não é considerada PO porque o produto não passou pelos critérios de ruptura.`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
