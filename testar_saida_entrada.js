/**
 * Teste completo: saída + entrada do produto N4.24.0281 cor BRANCO na filial NERD
 * Verifica se o estoque diminui 1 na saída e volta ao normal na entrada.
 */

const sql = require('mssql');
const { executeSaidaLote, executeEntradaLote } = require('./lib/saida-entrada-executor');

const DB_CONFIG = {
  server: '177.92.78.250',
  database: 'LINX_PRODUCAO',
  user: 'andre.nerd',
  password: 'nerd123@',
  options: { encrypt: false, trustServerCertificate: true, connectTimeout: 30000 },
};

const PRODUTO = 'N4.24.0281';
const FILIAL = 'NERD';

async function checarEstoque(pool, label) {
  const req = pool.request();
  req.input('produto', PRODUTO.trim());
  req.input('filial', FILIAL.trim());
  const res = await req.query(`
    SELECT PRODUTO, FILIAL, COR_PRODUTO, ESTOQUE
    FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
    WHERE PRODUTO = @produto AND FILIAL = @filial
    ORDER BY COR_PRODUTO
  `);
  console.log(`\n[${label}]`);
  if (res.recordset.length === 0) {
    console.log('  (nenhum registro encontrado)');
  } else {
    for (const r of res.recordset) {
      console.log(`  COR: ${(r.COR_PRODUTO || '').trim().padEnd(12)} ESTOQUE: ${r.ESTOQUE}`);
    }
  }
  return res.recordset;
}

async function encontrarCor(pool) {
  const req = pool.request();
  req.input('produto', PRODUTO.trim());
  req.input('filial', FILIAL.trim());
  const res = await req.query(`
    SELECT ep.COR_PRODUTO, ep.ESTOQUE, pc.DESC_COR_PRODUTO AS DESC_COR
    FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
    LEFT JOIN PRODUTO_CORES pc WITH (NOLOCK)
      ON pc.PRODUTO = ep.PRODUTO AND pc.COR_PRODUTO = ep.COR_PRODUTO
    WHERE ep.PRODUTO = @produto AND ep.FILIAL = @filial
    ORDER BY ep.ESTOQUE DESC
  `);
  return res.recordset;
}

async function main() {
  console.log('='.repeat(60));
  console.log('TESTE: SAÍDA + ENTRADA');
  console.log(`Produto: ${PRODUTO} | Filial: ${FILIAL}`);
  console.log('='.repeat(60));

  let pool;
  try {
    pool = await sql.connect(DB_CONFIG);
    console.log('[OK] Conectado ao banco');

    // 1. Encontrar cor correta (branco)
    console.log('\n--- Cores disponíveis no estoque ---');
    const cores = await encontrarCor(pool);
    if (cores.length === 0) {
      console.log('ERRO: Produto não encontrado no estoque da filial NERD');
      return;
    }
    for (const c of cores) {
      console.log(`  COR: ${(c.COR_PRODUTO || '').trim().padEnd(6)} | DESC: ${(c.DESC_COR || '').trim().padEnd(20)} | ESTOQUE: ${c.ESTOQUE}`);
    }

    // Escolher a cor branca (procura por BRANCO na descrição ou pega a primeira com estoque > 0)
    let corEscolhida = null;
    for (const c of cores) {
      const desc = (c.DESC_COR || '').toUpperCase();
      if (desc.includes('BRAN') && c.ESTOQUE > 0) { corEscolhida = c; break; }
    }
    if (!corEscolhida) {
      // fallback: primeira com estoque > 0
      corEscolhida = cores.find(c => c.ESTOQUE > 0);
    }
    if (!corEscolhida) {
      console.log('\nERRO: Nenhuma cor com estoque > 0 encontrada. Não é possível fazer saída.');
      return;
    }

    const COR = (corEscolhida.COR_PRODUTO || '').trim();
    console.log(`\n→ Usando COR: "${COR}" (${(corEscolhida.DESC_COR || '').trim()}), Estoque atual: ${corEscolhida.ESTOQUE}`);

    // 2. Estoque inicial
    const antes = await checarEstoque(pool, 'ESTOQUE INICIAL');
    const estoqueInicial = antes.find(r => (r.COR_PRODUTO || '').trim() === COR)?.ESTOQUE ?? 0;

    // 3. Executar SAÍDA
    console.log('\n--- Executando SAÍDA (quantidade: 1) ---');
    try {
      const resSaida = await executeSaidaLote(pool, {
        itens: [{ produto: PRODUTO, corProduto: COR, quantidade: 1 }],
        filial: FILIAL,
        tipoRomaneio: 'TRANSFERENCIA',
        responsavel: 'TESTE',
        observacao: 'TESTE AUTOMATICO SAIDA',
      });
      console.log(`[OK] Saída: ${resSaida.message}`);
    } catch (e) {
      console.log(`[ERRO] Saída falhou: ${e.message}`);
      return;
    }

    // 4. Estoque após saída
    const aposSaida = await checarEstoque(pool, 'ESTOQUE APÓS SAÍDA');
    const estoqueSaida = aposSaida.find(r => (r.COR_PRODUTO || '').trim() === COR)?.ESTOQUE ?? 0;
    const deltaSaida = estoqueSaida - estoqueInicial;
    console.log(`  → Variação: ${deltaSaida > 0 ? '+' : ''}${deltaSaida} (esperado: -1) ${deltaSaida === -1 ? '✓ CORRETO' : '✗ ERRO!'}`);

    // 5. Executar ENTRADA
    console.log('\n--- Executando ENTRADA (quantidade: 1) ---');
    try {
      const resEntrada = await executeEntradaLote(pool, {
        itens: [{ produto: PRODUTO, corProduto: COR, quantidade: 1 }],
        filial: FILIAL,
        tipoRomaneio: 'ENTRADA AVULSA',
        responsavel: 'TESTE',
        observacao: 'TESTE AUTOMATICO ENTRADA',
      });
      console.log(`[OK] Entrada: ${resEntrada.message}`);
    } catch (e) {
      console.log(`[ERRO] Entrada falhou: ${e.message}`);
      return;
    }

    // 6. Estoque após entrada
    const aposEntrada = await checarEstoque(pool, 'ESTOQUE APÓS ENTRADA');
    const estoqueEntrada = aposEntrada.find(r => (r.COR_PRODUTO || '').trim() === COR)?.ESTOQUE ?? 0;
    const deltaEntrada = estoqueEntrada - estoqueSaida;
    const deltaTotal = estoqueEntrada - estoqueInicial;
    console.log(`  → Variação: ${deltaEntrada > 0 ? '+' : ''}${deltaEntrada} (esperado: +1) ${deltaEntrada === 1 ? '✓ CORRETO' : '✗ ERRO!'}`);

    // 7. Resultado final
    console.log('\n' + '='.repeat(60));
    console.log('RESULTADO FINAL');
    console.log('='.repeat(60));
    console.log(`  Estoque inicial : ${estoqueInicial}`);
    console.log(`  Após saída      : ${estoqueSaida}  (delta: ${deltaSaida > 0 ? '+' : ''}${deltaSaida})`);
    console.log(`  Após entrada    : ${estoqueEntrada}  (delta: ${deltaEntrada > 0 ? '+' : ''}${deltaEntrada})`);
    console.log(`  Delta total     : ${deltaTotal > 0 ? '+' : ''}${deltaTotal} (esperado: 0)`);
    console.log(`\n  ${deltaTotal === 0 && deltaSaida === -1 && deltaEntrada === 1 ? '✓ TESTE PASSOU - Fluxo funcionando corretamente!' : '✗ TESTE FALHOU - Verificar erros acima'}`);

  } catch (err) {
    console.error('\n[ERRO FATAL]', err.message);
  } finally {
    if (pool) await pool.close();
  }
}

main();
