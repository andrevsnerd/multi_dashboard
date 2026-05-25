/**
 * Teste: lê os top 10 produtos da Curva ABC NERD e simula o cálculo PO.
 * Mostra: campos disponíveis, se qualifica para PO, e por qual motivo não qualifica.
 *
 * Uso: npx tsx --env-file=.env.local tmp/test-po-badge.ts
 */
import { fetchTopProdutosUltimos3Meses } from "@/lib/repositories/controleEstoque";
import { calcQtdSugestaoPOInfo } from "@/lib/utils/suggestion-rules";

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toFixed(2);
}

async function main() {
  console.log("Buscando top 10 produtos NERD...\n");

  const items = await fetchTopProdutosUltimos3Meses({
    company: "nerd",
    filial: null,
    categoria: null,
    grupos: null,
    linhas: null,
    colecoes: null,
    subgrupos: null,
    grades: null,
    produtos: null,
    qtdCompra: 0,
    porCor: false,
    limit: 10,
  });

  console.log(`Retornados ${items.length} itens.\n`);
  console.log("=".repeat(90));

  for (const item of items) {
    const raw = item as Record<string, unknown>;
    const diasComEstoquePositivo = Number(raw.diasComEstoquePositivo ?? null);
    const diasSemEstoque = Number(raw.diasSemEstoque ?? null);
    const mesesDisponiveis = Number(raw.mesesDisponiveis ?? null);
    const velocidadeAjustada = Number(raw.velocidadeAjustada ?? null);

    const hasCampos =
      raw.diasComEstoquePositivo != null &&
      raw.diasSemEstoque != null &&
      raw.mesesDisponiveis != null;

    const poResult = calcQtdSugestaoPOInfo({
      qtde12m: item.vendas3meses * 4, // aproximação de 12m a partir dos 3m
      vendasMesAtual: item.vendasMesAtual,
      estoqueAtual: item.estoqueAtual,
      linha: item.linha,
      subgrupo: item.subgrupo,
      diasDesdeUltimaVenda: null,
      mesesHistoricoFilial: item.mesesHistoricoFilial,
      diasComEstoquePositivo: hasCampos ? diasComEstoquePositivo : undefined,
      diasSemEstoque: hasCampos ? diasSemEstoque : undefined,
      mesesDisponiveis: hasCampos ? mesesDisponiveis : undefined,
      velocidadeAjustada: hasCampos ? velocidadeAjustada : undefined,
    });

    console.log(`\n📦 ${item.produto} — ${item.descricao}`);
    console.log(`   Estoque atual:          ${item.estoqueAtual}`);
    console.log(`   Vendas 3m:              ${item.vendas3meses}`);
    console.log(`   Vendas mês atual:       ${item.vendasMesAtual}`);
    console.log(`   mesesHistoricoFilial:   ${fmt(item.mesesHistoricoFilial)}`);
    if (hasCampos) {
      console.log(`   diasComEstoquePositivo: ${fmt(diasComEstoquePositivo)}`);
      console.log(`   diasSemEstoque:         ${fmt(diasSemEstoque)}`);
      console.log(`   mesesDisponiveis:       ${fmt(mesesDisponiveis)}`);
      console.log(`   velocidadeAjustada:     ${fmt(velocidadeAjustada)}`);
    } else {
      console.log(`   ⚠️  diasComEstoquePositivo, diasSemEstoque, mesesDisponiveis: NÃO RETORNADOS PELA API`);
    }

    if (poResult) {
      console.log(`   ✅ BADGE PO ATIVA — qtd sugerida PO: ${poResult.qtd}`);
      console.log(`      velocidadeAjustada: ${fmt(poResult.velocidadeAjustada)} un/mês`);
      console.log(`      potencialMensalBruto: ${fmt(poResult.potencialMensalBruto)}`);
      console.log(`      diasComEstoquePositivo: ${poResult.diasComEstoquePositivo}`);
      console.log(`      limiteSeguro: ${poResult.limiteSeguro}`);
    } else {
      // Diagnosticar por que não qualifica
      const estoque = item.estoqueAtual ?? 0;
      const qtde12m = item.vendas3meses * 4;
      const dc = hasCampos ? diasComEstoquePositivo : 0;
      const ds = hasCampos ? diasSemEstoque : 365;

      const motivos: string[] = [];
      if (estoque > 1) motivos.push(`estoque=${estoque} > 1`);
      if (qtde12m < 3) motivos.push(`qtde12m≈${qtde12m} < 3`);
      if (!hasCampos) motivos.push("diasComEstoquePositivo não disponível na API");
      else {
        if (dc <= 0 || dc > 30) motivos.push(`diasComEstoquePositivo=${dc} fora do range (1..30)`);
        if (ds < Math.max(15, dc * 2)) motivos.push(`diasSemEstoque=${ds} < max(15, ${dc}*2)=${Math.max(15, dc * 2)}`);
      }

      console.log(`   ❌ PO não aplica — ${motivos.join("; ")}`);
    }
  }

  console.log("\n" + "=".repeat(90));
  console.log("Fim do teste.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
