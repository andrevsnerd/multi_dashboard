/**
 * Script de debug para comparar query do sistema com script Python
 * Execute: npx ts-node debug_clientes_comparacao.ts
 */

import sql from 'mssql';
import { fetchClientes, fetchClientesCount } from './lib/repositories/clientes';

const DB_CONFIG = {
  server: '189.126.197.82',
  database: 'LINX_PRODUCAO',
  user: 'andre.nerd',
  password: 'nerd123@',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

async function compararQueries() {
  let pool: sql.ConnectionPool | null = null;
  
  try {
    console.log('='.repeat(80));
    console.log('COMPARAÇÃO: Script Python vs Sistema Web');
    console.log('='.repeat(80));
    
    // Conectar ao banco
    console.log('\n[1] Conectando ao banco de dados...');
    pool = await sql.connect(DB_CONFIG);
    console.log('✓ Conectado');
    
    // Query do script Python (exata)
    const queryPython = `
      SELECT 
        CADASTRAMENTO AS DATA_CADASTRO,
        CLIENTE_VAREJO AS NOME_CLIENTE,
        CASE WHEN DDD IS NOT NULL AND TELEFONE IS NOT NULL THEN DDD + ' ' + TELEFONE ELSE ISNULL(TELEFONE, '') END AS TELEFONE,
        CASE WHEN DDD_CELULAR IS NOT NULL AND CELULAR IS NOT NULL THEN DDD_CELULAR + ' ' + CELULAR ELSE ISNULL(CELULAR, '') END AS CELULAR,
        ISNULL(EMAIL, '') AS EMAIL,
        ISNULL(CPF_CGC, '') AS CPF_CNPJ,
        VENDEDOR AS VENDEDOR,
        FILIAL AS FILIAL
      FROM CLIENTES_VAREJO WITH (NOLOCK)
      WHERE 
        YEAR(CADASTRAMENTO) >= 2025
        AND (YEAR(CADASTRAMENTO) > 2025 OR (YEAR(CADASTRAMENTO) = 2025 AND MONTH(CADASTRAMENTO) >= 11))
        AND LTRIM(RTRIM(CAST(FILIAL AS VARCHAR))) = 'NERD MORUMBI RDRRRJ'
      ORDER BY CADASTRAMENTO, CLIENTE_VAREJO
    `;
    
    console.log('\n[2] Executando query do Script Python...');
    const resultPython = await pool.request().query(queryPython);
    const clientesPython = resultPython.recordset;
    console.log(`✓ Script Python encontrou: ${clientesPython.length} clientes`);
    
    // Query do sistema web (simulando período 01/11 a 27/11)
    const startDate = '2025-11-01';
    const endDate = '2025-11-28'; // +1 dia (exclusivo)
    
    const querySistema = `
      SELECT 
        CAST(cv.CADASTRAMENTO AS DATE) AS data,
        ISNULL(cv.CLIENTE_VAREJO, 'SEM NOME') AS nomeCliente,
        CASE 
          WHEN cv.DDD IS NOT NULL AND cv.TELEFONE IS NOT NULL 
          THEN cv.DDD + ' ' + cv.TELEFONE 
          ELSE ISNULL(cv.TELEFONE, '') 
        END AS telefone,
        ISNULL(cv.CPF_CGC, '') AS cpf,
        ISNULL(cv.ENDERECO, '') AS endereco,
        ISNULL(cv.COMPLEMENTO, '') AS complemento,
        ISNULL(cv.BAIRRO, '') AS bairro,
        ISNULL(cv.CIDADE, '') AS cidade,
        ISNULL(lv.VENDEDOR_APELIDO, ISNULL(lv.NOME_VENDEDOR, cv.VENDEDOR)) AS vendedor,
        cv.FILIAL AS filial
      FROM CLIENTES_VAREJO cv WITH (NOLOCK)
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
      WHERE CAST(cv.CADASTRAMENTO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(cv.CADASTRAMENTO AS DATE) < CAST(@endDate AS DATE)
        AND LTRIM(RTRIM(CAST(cv.FILIAL AS VARCHAR))) = LTRIM(RTRIM(CAST(@filial AS VARCHAR)))
      ORDER BY cv.CADASTRAMENTO ASC, cv.CLIENTE_VAREJO
    `;
    
    console.log('\n[3] Executando query do Sistema Web (01/11 a 27/11)...');
    const requestSistema = pool.request();
    requestSistema.input('startDate', sql.Date, startDate);
    requestSistema.input('endDate', sql.Date, endDate);
    requestSistema.input('filial', sql.VarChar, 'NERD MORUMBI RDRRRJ');
    const resultSistema = await requestSistema.query(querySistema);
    const clientesSistema = resultSistema.recordset;
    console.log(`✓ Sistema Web encontrou: ${clientesSistema.length} clientes`);
    
    // Comparar resultados
    console.log('\n[4] Comparando resultados...');
    console.log(`   Script Python: ${clientesPython.length} clientes`);
    console.log(`   Sistema Web:   ${clientesSistema.length} clientes`);
    console.log(`   Diferença:     ${clientesPython.length - clientesSistema.length} clientes`);
    
    // Criar sets para comparação (usando nome + data como chave)
    const setPython = new Set(
      clientesPython.map((c: any) => 
        `${c.DATA_CADASTRO?.toISOString()?.split('T')[0]}_${(c.NOME_CLIENTE || '').trim().toUpperCase()}`
      )
    );
    
    const setSistema = new Set(
      clientesSistema.map((c: any) => {
        const data = c.data instanceof Date 
          ? c.data.toISOString().split('T')[0]
          : c.data;
        return `${data}_${(c.nomeCliente || '').trim().toUpperCase()}`;
      })
    );
    
    // Encontrar clientes no Python mas não no Sistema
    const apenasPython: any[] = [];
    clientesPython.forEach((c: any) => {
      const key = `${c.DATA_CADASTRO?.toISOString()?.split('T')[0]}_${(c.NOME_CLIENTE || '').trim().toUpperCase()}`;
      if (!setSistema.has(key)) {
        apenasPython.push(c);
      }
    });
    
    // Encontrar clientes no Sistema mas não no Python
    const apenasSistema: any[] = [];
    clientesSistema.forEach((c: any) => {
      const data = c.data instanceof Date 
        ? c.data.toISOString().split('T')[0]
        : c.data;
      const key = `${data}_${(c.nomeCliente || '').trim().toUpperCase()}`;
      if (!setPython.has(key)) {
        apenasSistema.push(c);
      }
    });
    
    console.log('\n[5] Análise de diferenças:');
    console.log(`   Clientes apenas no Script Python: ${apenasPython.length}`);
    console.log(`   Clientes apenas no Sistema Web:   ${apenasSistema.length}`);
    
    if (apenasPython.length > 0) {
      console.log('\n[6] Clientes que estão no Script Python mas NÃO no Sistema Web:');
      apenasPython.slice(0, 20).forEach((c, idx) => {
        const data = c.DATA_CADASTRO instanceof Date 
          ? c.DATA_CADASTRO.toISOString().split('T')[0]
          : c.DATA_CADASTRO;
        console.log(`   ${idx + 1}. [${data}] ${c.NOME_CLIENTE} - Vendedor: ${c.VENDEDOR || 'Sem vendedor'}`);
      });
      if (apenasPython.length > 20) {
        console.log(`   ... e mais ${apenasPython.length - 20} clientes`);
      }
    }
    
    if (apenasSistema.length > 0) {
      console.log('\n[7] Clientes que estão no Sistema Web mas NÃO no Script Python:');
      apenasSistema.slice(0, 20).forEach((c, idx) => {
        const data = c.data instanceof Date 
          ? c.data.toISOString().split('T')[0]
          : c.data;
        console.log(`   ${idx + 1}. [${data}] ${c.nomeCliente} - Vendedor: ${c.vendedor || 'Sem vendedor'}`);
      });
      if (apenasSistema.length > 20) {
        console.log(`   ... e mais ${apenasSistema.length - 20} clientes`);
      }
    }
    
    // Verificar se há problema com período
    console.log('\n[8] Verificando datas...');
    const datasPython = clientesPython.map((c: any) => {
      const d = c.DATA_CADASTRO instanceof Date ? c.DATA_CADASTRO : new Date(c.DATA_CADASTRO);
      return d.toISOString().split('T')[0];
    });
    const datasSistema = clientesSistema.map((c: any) => {
      const d = c.data instanceof Date ? c.data : new Date(c.data);
      return d.toISOString().split('T')[0];
    });
    
    const minPython = Math.min(...datasPython.map(d => new Date(d).getTime()));
    const maxPython = Math.max(...datasPython.map(d => new Date(d).getTime()));
    const minSistema = Math.min(...datasSistema.map(d => new Date(d).getTime()));
    const maxSistema = Math.max(...datasSistema.map(d => new Date(d).getTime()));
    
    console.log(`   Script Python: ${new Date(minPython).toISOString().split('T')[0]} até ${new Date(maxPython).toISOString().split('T')[0]}`);
    console.log(`   Sistema Web:   ${new Date(minSistema).toISOString().split('T')[0]} até ${new Date(maxSistema).toISOString().split('T')[0]}`);
    
    // Verificar se há datas fora do período esperado
    const datasForaPeriodo = datasPython.filter(d => {
      const date = new Date(d);
      return date < new Date('2025-11-01') || date >= new Date('2025-11-28');
    });
    
    if (datasForaPeriodo.length > 0) {
      console.log(`\n[AVISO] Script Python encontrou ${datasForaPeriodo.length} clientes fora do período 01/11 a 27/11:`);
      console.log(`   Datas: ${[...new Set(datasForaPeriodo)].join(', ')}`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('FIM DA COMPARAÇÃO');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('\n[ERRO]', error);
    throw error;
  } finally {
    if (pool) {
      await pool.close();
      console.log('\n[INFO] Conexão fechada');
    }
  }
}

// Executar
compararQueries().catch(console.error);

