/**
 * Confere se o ESTOQUE do Linx ainda bate com a soma dos movimentos.
 *
 * É o teste de regressão da regra "RECONSTRUIR ESTOQUE POR MOVIMENTO" do CLAUDE.md.
 * Não roda sozinho, não roda no build, não escreve NADA — só SELECT e print.
 *
 * Duas partes:
 *   LARGURA    — uma query agregada por filial que mede TODOS os SKUs de uma vez e
 *                imprime a taxa de fechamento. É o que pega uma quebra na fórmula.
 *   PROFUNDIDADE — meia dúzia de casos difíceis consultados pela própria API do
 *                extrato, que é o que confirma que o CÓDIGO está certo, não só o SQL.
 *
 * Uso:
 *   node scripts/conferir-movimento-estoque.mjs                 # largura (filiais NERD) + profundidade
 *   node scripts/conferir-movimento-estoque.mjs --filial=NERD   # só uma filial
 *   node scripts/conferir-movimento-estoque.mjs --largura       # pula os casos via API
 *   node scripts/conferir-movimento-estoque.mjs --fundo         # só os casos via API
 *   node scripts/conferir-movimento-estoque.mjs --residuo=20    # lista os N piores SKUs que não fecham
 *
 * A parte de PROFUNDIDADE precisa do `npm run dev` de pé (usa http://localhost:3000).
 * Se não estiver, ela avisa e pula — a de LARGURA funciona sozinha.
 */

import sql from 'mssql';

const config = {
  server: '177.92.78.250',
  database: 'LINX_PRODUCAO',
  user: 'andre.sabetta',
  password: 'asabetta',
  port: 1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 600000,
  connectionTimeout: 30000,
};

const BASE_URL = process.env.EXTRATO_BASE_URL || 'http://localhost:3000';
const AUTH_USER = process.env.EXTRATO_USER || 'andre.sabetta';

/**
 * Filiais medidas por padrão, com o CODIGO_FILIAL que a venda usa (LOJA_VENDA_PRODUTO
 * só tem código; as tabelas de estoque só têm nome). Matriz primeiro.
 */
const FILIAIS = [
  ['NERD', '000069'],
  ['NERD MORUMBI RDRRRJ', '000099'],
  ['NERD CENTER NORTE', '000089'],
  ['NERD HIGIENOPOLIS', '000073'],
  ['NERD MORUMBI RDRRX', '000115'],
  ['NERD LEBLON', '000095'],
  ['NERD ELDORADO', '000114'],
  ['NERD VILLA LOBOS', '000076'],
];

/**
 * Casos difíceis, cada um escolhido porque quebra de um jeito diferente. Mexer nessa
 * lista só para ACRESCENTAR: cada linha aqui é um bug que já aconteceu.
 */
const CASOS = [
  // O caso que abriu a investigação: 10 linhas de venda cancelada viravam +10 de
  // devolução fantasma, e 2 devoluções reais de Villa Lobos não eram lidas.
  { produto: 'W1.01.0007', cor: '06', filial: '', espera: 'TROCA/DEVOLUÇÃO' },
  // Só fecha com a NF de saída: os movimentos somam −1 e o estoque é −9.
  { produto: 'N5.1.0012', cor: 'K9', filial: 'NERD', espera: 'NF DE SAÍDA' },
  // Matriz com muita NF de saída e mais de 100 movimentos.
  { produto: 'G6.02.6', cor: '01', filial: 'NERD', espera: 'NF DE SAÍDA' },
  // Devolução em loja, volume alto de movimento na rede.
  { produto: 'F6.11.17', cor: '06', filial: '', espera: 'TROCA/DEVOLUÇÃO' },
  // Grade múltipla (PP/P/M/G): confere que o detalhe por tamanho não quebrou.
  { produto: '96.03.0139', cor: '06', filial: '', grade: true },
  // Negativo grande e legítimo na matriz (950 entraram, 1.050 saíram).
  { produto: 'N5.9.0032', cor: 'N3', filial: 'NERD' },
  // Saiu sem nunca ter entrado na matriz.
  { produto: 'X2.03.0025', cor: '179', filial: 'NERD' },
];

const args = process.argv.slice(2);
const arg = (nome) => {
  const hit = args.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const temFlag = (nome) => args.includes(`--${nome}`);

const soLargura = temFlag('largura');
const soFundo = temFlag('fundo');
const residuoTop = Number(arg('residuo') || 0);
const filialUnica = arg('filial');

/**
 * A conta canônica do CLAUDE.md, em SQL, por produto × cor de uma filial.
 * `E1..T1` ficam expostos para o modo --residuo poder mostrar de onde vem a sobra.
 */
function sqlReconciliacao(filial, codFilial) {
  const f = filial.replace(/'/g, "''");
  const c = codFilial.replace(/'/g, "''");
  return `
WITH base AS (
  SELECT PRODUTO, RTRIM(ISNULL(COR_PRODUTO, '')) AS COR, ESTOQUE
  FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE FILIAL = '${f}'
),
ent AS (
  SELECT p.PRODUTO, RTRIM(ISNULL(p.COR_PRODUTO, '')) COR, SUM(p.QTDE) Q
  FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
  JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK) ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
    AND (p.FILIAL IS NULL OR LTRIM(RTRIM(p.FILIAL)) = '' OR p.FILIAL = e.FILIAL)
  WHERE e.FILIAL = '${f}' GROUP BY p.PRODUTO, RTRIM(ISNULL(p.COR_PRODUTO, ''))
),
sai AS (
  SELECT p.PRODUTO, RTRIM(ISNULL(p.COR_PRODUTO, '')) COR, SUM(p.QTDE) Q
  FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
  JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK) ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
    AND (p.FILIAL IS NULL OR LTRIM(RTRIM(p.FILIAL)) = '' OR p.FILIAL = s.FILIAL)
  WHERE s.FILIAL = '${f}' GROUP BY p.PRODUTO, RTRIM(ISNULL(p.COR_PRODUTO, ''))
),
ctg AS (
  SELECT a.PRODUTO, RTRIM(ISNULL(a.COR_PRODUTO, '')) COR, SUM(a.QTDE_AJUSTE) Q
  FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
  JOIN ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK) ON c.NOME_CONTAGEM = a.NOME_CONTAGEM
  WHERE c.FILIAL = '${f}' AND c.ESTOQUE_AJUSTADO = 1
  GROUP BY a.PRODUTO, RTRIM(ISNULL(a.COR_PRODUTO, ''))
),
le AS (
  SELECT lep.PRODUTO, RTRIM(ISNULL(lep.COR_PRODUTO, '')) COR, SUM(lep.QTDE_ENTRADA) Q
  FROM LOJA_ENTRADAS l WITH (NOLOCK)
  JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
    ON l.FILIAL = lep.FILIAL AND l.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
  WHERE l.FILIAL = '${f}' GROUP BY lep.PRODUTO, RTRIM(ISNULL(lep.COR_PRODUTO, ''))
),
ls AS (
  SELECT lsp.PRODUTO, RTRIM(ISNULL(lsp.COR_PRODUTO, '')) COR, SUM(lsp.QTDE_SAIDA) Q
  FROM LOJA_SAIDAS l WITH (NOLOCK)
  JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
    ON l.FILIAL = lsp.FILIAL AND l.ROMANEIO_PRODUTO = lsp.ROMANEIO_PRODUTO
  WHERE l.FILIAL = '${f}' GROUP BY lsp.PRODUTO, RTRIM(ISNULL(lsp.COR_PRODUTO, ''))
),
-- Movimento da venda é QTDE, e só. NUNCA subtrair QTDE_CANCELADA (ver CLAUDE.md).
ven AS (
  SELECT vp.PRODUTO, RTRIM(ISNULL(vp.COR_PRODUTO, '')) COR, SUM(vp.QTDE) Q
  FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
  WHERE vp.CODIGO_FILIAL = '${c}' AND ISNULL(vp.NAO_MOVIMENTA_ESTOQUE, 0) = 0
  GROUP BY vp.PRODUTO, RTRIM(ISNULL(vp.COR_PRODUTO, ''))
),
tro AS (
  SELECT t.PRODUTO, RTRIM(ISNULL(t.COR_PRODUTO, '')) COR, SUM(t.QTDE) Q
  FROM LOJA_VENDA_TROCA t WITH (NOLOCK)
  WHERE t.CODIGO_FILIAL = '${c}' AND ISNULL(t.NAO_MOVIMENTA_ESTOQUE, 0) = 0
  GROUP BY t.PRODUTO, RTRIM(ISNULL(t.COR_PRODUTO, ''))
),
-- Sem filtro de NATUREZA_SAIDA: qualquer NF de saída baixa estoque.
nf AS (
  SELECT fp.PRODUTO, RTRIM(ISNULL(fp.COR_PRODUTO, '')) COR, SUM(fp.QTDE) Q
  FROM FATURAMENTO fa WITH (NOLOCK)
  JOIN FATURAMENTO_PROD fp WITH (NOLOCK)
    ON fa.FILIAL = fp.FILIAL AND fa.NF_SAIDA = fp.NF_SAIDA AND fa.SERIE_NF = fp.SERIE_NF
  WHERE fa.FILIAL = '${f}' AND ISNULL(fa.NOTA_CANCELADA, 0) = 0
  GROUP BY fp.PRODUTO, RTRIM(ISNULL(fp.COR_PRODUTO, ''))
),
j AS (
  SELECT b.PRODUTO, b.COR, b.ESTOQUE,
    ISNULL(ent.Q, 0) E1, ISNULL(sai.Q, 0) S1, ISNULL(ctg.Q, 0) A1,
    ISNULL(le.Q, 0) E2, ISNULL(ls.Q, 0) S2, ISNULL(ven.Q, 0) V1,
    ISNULL(tro.Q, 0) T1, ISNULL(nf.Q, 0) S3
  FROM base b
  LEFT JOIN ent ON ent.PRODUTO = b.PRODUTO AND ent.COR = b.COR
  LEFT JOIN sai ON sai.PRODUTO = b.PRODUTO AND sai.COR = b.COR
  LEFT JOIN ctg ON ctg.PRODUTO = b.PRODUTO AND ctg.COR = b.COR
  LEFT JOIN le  ON le.PRODUTO  = b.PRODUTO AND le.COR  = b.COR
  LEFT JOIN ls  ON ls.PRODUTO  = b.PRODUTO AND ls.COR  = b.COR
  LEFT JOIN ven ON ven.PRODUTO = b.PRODUTO AND ven.COR = b.COR
  LEFT JOIN tro ON tro.PRODUTO = b.PRODUTO AND tro.COR = b.COR
  LEFT JOIN nf  ON nf.PRODUTO  = b.PRODUTO AND nf.COR  = b.COR
),
calc AS (
  SELECT *, E1 - S1 + A1 + E2 - S2 - V1 + T1 - S3 AS SALDO FROM j
  WHERE E1 + S1 + A1 + E2 + S2 + V1 + T1 + S3 <> 0
)`;
}

async function medirLargura(pool, filiais) {
  console.log('\nLARGURA — estoque do Linx × soma dos movimentos, SKU por SKU\n');
  console.log('  filial                    fecham /  total     taxa   resíduo');
  console.log('  ' + '─'.repeat(62));

  let piorTaxa = 100;
  const residuos = [];

  for (const [filial, cod] of filiais) {
    const q = `${sqlReconciliacao(filial, cod)}
      SELECT COUNT(*) AS TOTAL,
             SUM(CASE WHEN ESTOQUE = SALDO THEN 1 ELSE 0 END) AS FECHAM
      FROM calc`;
    const r = await pool.request().query(q);
    const { TOTAL, FECHAM } = r.recordset[0];
    const total = Number(TOTAL || 0);
    const fecham = Number(FECHAM || 0);
    const taxa = total > 0 ? (fecham / total) * 100 : 100;
    if (taxa < piorTaxa) piorTaxa = taxa;
    const sobra = total - fecham;
    console.log(
      `  ${filial.padEnd(24)} ${String(fecham).padStart(6)} / ${String(total).padStart(6)}` +
      `  ${taxa.toFixed(2).padStart(7)}%  ${sobra > 0 ? `${sobra} SKU${sobra > 1 ? 's' : ''}` : '—'}`
    );
    if (sobra > 0) residuos.push([filial, cod, sobra]);
  }

  if (residuoTop > 0 && residuos.length > 0) {
    for (const [filial, cod] of residuos) {
      const q = `${sqlReconciliacao(filial, cod)}
        SELECT TOP ${residuoTop} PRODUTO, COR, ESTOQUE, SALDO, ESTOQUE - SALDO AS SOBRA,
               E1, S1, A1, E2, S2, V1, T1, S3
        FROM calc WHERE ESTOQUE <> SALDO ORDER BY ABS(ESTOQUE - SALDO) DESC`;
      const r = await pool.request().query(q);
      console.log(`\n  resíduo — ${filial} (${r.recordset.length} piores)`);
      console.log('    produto/cor            estoque  saldo  sobra   ent  sai  aju  le  ls  ven  tro   nf');
      for (const x of r.recordset) {
        console.log(
          `    ${(x.PRODUTO.trim() + '/' + x.COR).padEnd(22)} ${String(x.ESTOQUE).padStart(7)}` +
          ` ${String(x.SALDO).padStart(6)} ${String(x.SOBRA).padStart(6)}   ` +
          [x.E1, x.S1, x.A1, x.E2, x.S2, x.V1, x.T1, x.S3].map((v) => String(v).padStart(4)).join(' ')
        );
      }
    }
  } else if (residuos.length > 0) {
    console.log('\n  (rode com --residuo=20 para listar os SKUs que não fecham)');
  }

  return piorTaxa;
}

async function medirProfundidade() {
  console.log('\nPROFUNDIDADE — casos difíceis pela API do extrato\n');

  let ok = 0;
  let falhas = 0;

  for (const caso of CASOS) {
    const url =
      `${BASE_URL}/api/extrato-produto?produto=${encodeURIComponent(caso.produto)}` +
      `&cor=${encodeURIComponent(caso.cor)}` +
      (caso.filial ? `&filial=${encodeURIComponent(caso.filial)}` : '');
    const rotulo = `${caso.produto}/${caso.cor}/${caso.filial || 'TODAS'}`;

    let d;
    try {
      const res = await fetch(url, { headers: { 'x-auth-username': AUTH_USER } });
      d = await res.json();
    } catch (e) {
      console.log(`  ?? ${rotulo} — dev server fora do ar (${e.message})`);
      console.log('     (suba o npm run dev, ou rode só --largura)');
      return null;
    }

    if (d.error) {
      console.log(`  !! ${rotulo} — ${d.error}`);
      falhas += 1;
      continue;
    }

    const saldo = d.linhas.reduce((s, l) => s + l.qtde, 0);
    const sobra = d.estoqueAtual - saldo;
    const tipos = new Set(d.linhas.map((l) => l.tipo));
    const problemas = [];
    if (sobra !== 0) problemas.push(`sobra ${sobra}`);
    if (d.erros.length > 0) problemas.push(`erros: ${d.erros.join('; ')}`);
    // O caso existe para provar que uma fonte específica está sendo lida — se ela
    // desaparecer da resposta, alguém tirou a fonte e o teste tem que gritar.
    if (caso.espera && !tipos.has(caso.espera)) problemas.push(`sem linha de ${caso.espera}`);
    if (caso.grade && (d.tamanhos || []).length < 2) problemas.push('grade múltipla não veio');

    if (problemas.length === 0) {
      ok += 1;
      console.log(
        `  ok ${rotulo.padEnd(30)} estoque=${String(d.estoqueAtual).padStart(5)}` +
        ` saldo=${String(saldo).padStart(5)}  ${d.linhas.length} mov`
      );
    } else {
      falhas += 1;
      console.log(
        `  XX ${rotulo.padEnd(30)} estoque=${String(d.estoqueAtual).padStart(5)}` +
        ` saldo=${String(saldo).padStart(5)}  → ${problemas.join(' | ')}`
      );
    }
  }

  console.log(`\n  ${ok} ok · ${falhas} com problema · de ${CASOS.length}`);
  return falhas;
}

async function main() {
  console.log('═'.repeat(66));
  console.log('CONFERÊNCIA — movimento de estoque × ESTOQUE_PRODUTOS (só leitura)');
  console.log('═'.repeat(66));

  const filiais = filialUnica
    ? FILIAIS.filter(([f]) => f.toUpperCase() === filialUnica.toUpperCase())
    : FILIAIS;

  if (filialUnica && filiais.length === 0) {
    console.error(`\nFilial "${filialUnica}" não está na lista. Conhecidas:`);
    FILIAIS.forEach(([f, c]) => console.error(`  ${f} (${c})`));
    process.exit(2);
  }

  let piorTaxa = null;
  let falhasFundo = null;

  if (!soFundo) {
    const pool = await sql.connect(config);
    try {
      piorTaxa = await medirLargura(pool, filiais);
    } finally {
      await pool.close();
    }
  }

  if (!soLargura) {
    falhasFundo = await medirProfundidade();
  }

  console.log('\n' + '─'.repeat(66));
  // A referência é 09/09/2026: 99,96% na matriz e 100% em RDRRRJ. Abaixo de 99% a
  // fórmula provavelmente foi quebrada — confira o CLAUDE.md antes de sair mexendo.
  if (piorTaxa !== null) {
    console.log(
      piorTaxa >= 99
        ? `Taxa mínima ${piorTaxa.toFixed(2)}% — dentro do esperado (referência: 99,96% na matriz).`
        : `ATENÇÃO: taxa mínima ${piorTaxa.toFixed(2)}%, abaixo de 99%. A fórmula pode ter sido quebrada — ver CLAUDE.md.`
    );
  }
  if (falhasFundo !== null && falhasFundo > 0) {
    console.log(`ATENÇÃO: ${falhasFundo} caso(s) difícil(eis) com problema.`);
  }
  console.log('─'.repeat(66) + '\n');

  const quebrou = (piorTaxa !== null && piorTaxa < 99) || (falhasFundo !== null && falhasFundo > 0);
  process.exit(quebrou ? 1 : 0);
}

main().catch((err) => {
  console.error('\nERRO FATAL:', err.message);
  process.exit(2);
});
