/**
 * Testes do motor de Projeção de vendas ([lib/utils/projecao-vendas.ts]).
 *
 * Não há runner de testes no projeto — roda compilando SÓ o motor (que é puro, sem imports)
 * e executando com node:
 *
 *   npx tsc lib/utils/projecao-vendas.ts --outDir tmp/build-projecao --module commonjs --target es2020 --strict
 *   node tmp/test-projecao.js
 *
 * (os erros de tipo do tedious na compilação são ruído de ambient types e não afetam o motor)
 *
 * Cobre: item ativo, item parado, zero no meio da janela, item novo (zeros de liderança),
 * item que só vendeu no mês corrente, item que nunca vendeu, consumo do estoque (mês parcial,
 * soma == estoque, mês em que zera, dias), horizonte excedido, sem giro, índice sazonal,
 * arredondamento por maior resto e o caso do vendedor esparso (parado 0 + base antiga).
 */

const p = require("./build-projecao/projecao-vendas.js");

const s = (arr, startMes) => arr.map((q, i) => ({ mes: p.addMeses(startMes, i), qtde: q }));
let falhas = 0;
function check(nome, real, esperado, tol = 0.001) {
  const ok = typeof esperado === "number" ? Math.abs(real - esperado) < tol : real === esperado;
  if (!ok) { falhas++; console.log(`FALHOU ${nome}: real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`); }
  else console.log(`ok  ${nome} = ${JSON.stringify(real)}`);
}

const MES_ATUAL = "2026-08";

// 1. item ativo: 3 meses fechados vendendo (mai jun jul) + venda parcial em ago
let r = p.calcRitmoMensal({ serie: s([12, 9, 14, 5], "2026-05"), mesAtual: MES_ATUAL });
check("1 ritmo ativo", r.ritmoMes, (12 + 9 + 14) / 3);
check("1 base", `${r.baseInicio}..${r.baseFim}`, "2026-05..2026-07");
check("1 parado", r.mesesParado, 0);
check("1 confianca", r.confianca, "alta");
check("1 motivo", r.motivo, "recente");

// 2. item parado: vendeu 18 e 22 em jan/fev-26, zero desde então
r = p.calcRitmoMensal({ serie: s([18, 22, 0, 0, 0, 0, 0, 0], "2026-01"), mesAtual: MES_ATUAL });
check("2 ritmo parado", r.ritmoMes, 20);
check("2 base", `${r.baseInicio}..${r.baseFim}`, "2026-01..2026-02");
check("2 mesesParado", r.mesesParado, 5); // mar,abr,mai,jun,jul
check("2 motivo", r.motivo, "historico");
check("2 confianca", r.confianca, "baixa");

// 3. zero interior conta no divisor
r = p.calcRitmoMensal({ serie: s([10, 0, 14, 0], "2026-05"), mesAtual: MES_ATUAL });
check("3 ritmo zero interior", r.ritmoMes, 8);
check("3 baseMeses", r.baseMeses, 3);

// 4. zeros de lideranca (item nao existia) nao entram
r = p.calcRitmoMensal({ serie: s([0, 0, 0, 0, 0, 30, 28, 4], "2026-01"), mesAtual: MES_ATUAL });
check("4 ritmo item novo", r.ritmoMes, 29); // jun+jul / 2
check("4 base", `${r.baseInicio}..${r.baseFim}`, "2026-06..2026-07");
check("4 baseMeses", r.baseMeses, 2);

// 5. so vendeu no mes corrente -> piso de 1 mes, sem extrapolar
r = p.calcRitmoMensal({ serie: s([0, 0, 7], "2026-06"), mesAtual: MES_ATUAL });
check("5 ritmo mes corrente", r.ritmoMes, 7);
check("5 motivo", r.motivo, "mes_corrente");

// 6. nunca vendeu
r = p.calcRitmoMensal({ serie: s([0, 0, 0], "2026-06"), mesAtual: MES_ATUAL });
check("6 sem historico", r.motivo, "sem_historico");
check("6 ritmo", r.ritmoMes, 0);

// 7. projecao: estoque 60, ritmo 12/mes, dia 27 de agosto (31 dias -> 5 dias restantes)
let proj = p.projetarConsumoEstoque({ estoque: 60, ritmoMes: 12, mesAtual: "2026-08", diaAtual: 27, maxMeses: 12 });
check("7 ago parcial", proj.meses[0].qtde, 12 * (5 / 31));
check("7 set cheio", proj.meses[1].qtde, 12);
const somaProj = proj.meses.reduce((a, m) => a + m.qtde, 0);
check("7 soma = estoque", somaProj, 60);
check("7 mesAcaba", proj.mesAcaba, "2027-01");
check("7 sobra", proj.sobra, 0);
// dias: 5 (ago) + 30 set + 31 out + 30 nov + 31 dez = 127; restam 60-1.935-12*4 = 10.065 em jan
// capacidade jan = 12 -> 10.065/12*31 = 26.0 dias -> total ~153
check("7 diasParaAcabar ~", Math.round(proj.diasParaAcabar), 153);

// 8. estoque que nao acaba no horizonte
proj = p.projetarConsumoEstoque({ estoque: 500, ritmoMes: 3, mesAtual: "2026-08", diaAtual: 1, maxMeses: 12 });
check("8 excede horizonte", proj.excedeHorizonte, true);
check("8 dias null", proj.diasParaAcabar, null);
check("8 cobertura meses", Math.round(proj.coberturaMeses), 167);

// 9. sem giro
proj = p.projetarConsumoEstoque({ estoque: 40, ritmoMes: 0, mesAtual: "2026-08", diaAtual: 15, maxMeses: 12 });
check("9 sem giro dias", proj.diasParaAcabar, null);
check("9 sem giro sobra", proj.sobra, 40);
check("9 sem giro col1", proj.meses[0].qtde, 0);

// 10. sazonalidade: serie de 24 meses com dezembro dobrado
const serieAg = [];
for (let i = 0; i < 24; i += 1) {
  const mes = p.addMeses("2024-08", i);
  const cal = Number(mes.split("-")[1]);
  serieAg.push({ mes, qtde: cal === 12 ? 200 : 100 });
}
const idx = p.buildIndiceSazonal({ serieAgregada: serieAg, mesAtual: MES_ATUAL });
check("10 indice dez > 1", idx.get(12) > 1.4, true);
check("10 indice jun < 1", idx.get(6) < 1, true);
const semDados = p.buildIndiceSazonal({ serieAgregada: serieAg.slice(0, 6), mesAtual: MES_ATUAL });
check("10 poucos meses -> null", semDados, null);

// 11. arredondamento preserva soma
const vals = [1.6, 1.6, 1.6, 1.6, 1.6];
const arr = p.arredondarPreservandoSoma(vals);
check("11 soma preservada", arr.reduce((a, b) => a + b, 0), 8);
check("11 distribuicao", JSON.stringify(arr), JSON.stringify([2, 2, 2, 1, 1]));

// 12. projecao sazonal consome mais rapido no pico
const projSaz = p.projetarConsumoEstoque({ estoque: 60, ritmoMes: 12, mesAtual: "2026-11", diaAtual: 1, maxMeses: 12, indiceSazonal: idx });
check("12 dez sazonal > nov", projSaz.meses[1].capacidade > projSaz.meses[0].capacidade, true);

// 13. vendedor esparso: vendeu jan/fev-26, ficou parado, voltou a vender no mes corrente (ago)
r = p.calcRitmoMensal({ serie: s([10, 14, 0, 0, 0, 0, 0, 3], "2026-01"), mesAtual: MES_ATUAL });
check("13 base fica no trecho antigo", `${r.baseInicio}..${r.baseFim}`, "2026-01..2026-02");
check("13 ritmo", r.ritmoMes, 12);
check("13 mesesParado = 0 (vendeu agora)", r.mesesParado, 0);
check("13 baseIdadeMeses", r.baseIdadeMeses, 5);
check("13 motivo = historico (base antiga)", r.motivo, "historico");
check("13 confianca", r.confianca, "media");

// 14. item ativo de verdade: base recente -> idade 0 e confianca alta
r = p.calcRitmoMensal({ serie: s([12, 9, 14, 5], "2026-05"), mesAtual: MES_ATUAL });
check("14 baseIdadeMeses", r.baseIdadeMeses, 0);
check("14 mesesParado", r.mesesParado, 0);

// 15. parado de verdade: ultima venda fev-26, nada depois
r = p.calcRitmoMensal({ serie: s([18, 22, 0, 0, 0, 0, 0, 0], "2026-01"), mesAtual: MES_ATUAL });
check("15 mesesParado", r.mesesParado, 5);
check("15 baseIdadeMeses", r.baseIdadeMeses, 5);

// 16. modo "so a demanda": nao limita ao estoque, mas mantem dias/mes que acaba
proj = p.projetarConsumoEstoque({ estoque: 5, ritmoMes: 30, mesAtual: "2026-08", diaAtual: 1, maxMeses: 12, limitarAoEstoque: false });
check("16 mes cheio sem teto", proj.meses[1].qtde, 30);
check("16 demanda 12m", Math.round(proj.demandaHorizonte), 360);
check("16 ainda diz quando acaba", proj.mesAcaba, "2026-08");
check("16 dias p/ acabar ~5", Math.round(proj.diasParaAcabar), 5);
check("16 sobra", proj.sobra, 0);

// 17. estoque zerado: com teto vira fila de zeros; sem teto mostra a demanda (caso do dono)
const comTeto = p.projetarConsumoEstoque({ estoque: 0, ritmoMes: 20, mesAtual: "2026-08", diaAtual: 15, maxMeses: 12 });
const semTeto = p.projetarConsumoEstoque({ estoque: 0, ritmoMes: 20, mesAtual: "2026-08", diaAtual: 15, maxMeses: 12, limitarAoEstoque: false });
check("17 com teto: tudo zero", comTeto.meses.every((m) => m.qtde === 0), true);
check("17 sem teto: set = 20", semTeto.meses[1].qtde, 20);
check("17 demanda igual nos dois modos", Math.round(comTeto.demandaHorizonte), Math.round(semTeto.demandaHorizonte));

// 18. com teto, a soma continua fechando com o estoque
proj = p.projetarConsumoEstoque({ estoque: 47, ritmoMes: 10, mesAtual: "2026-08", diaAtual: 10, maxMeses: 12 });
check("18 soma == estoque", proj.meses.reduce((a, m) => a + m.qtde, 0), 47);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
