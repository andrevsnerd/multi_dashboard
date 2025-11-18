/**
 * Script de teste rápido do proxy
 */

require('dotenv').config({ path: '.env.local' });
const sql = require('mssql');

const config = {
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  requestTimeout: 10000,
  connectionTimeout: 5000,
};

async function test() {
  console.log('🔄 Testando conexão com o banco de dados...');
  console.log(`   Servidor: ${config.server}`);
  console.log(`   Database: ${config.database}`);
  console.log('');
  
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query('SELECT @@VERSION as version');
    console.log('✅ Conexão com banco de dados OK!');
    console.log(`   SQL Server versão: ${result.recordset[0].version.substring(0, 50)}...`);
    
    // Testar uma query simples
    const testQuery = await pool.request().query('SELECT TOP 1 1 as test');
    console.log('✅ Query de teste executada com sucesso!');
    
    await pool.close();
    console.log('');
    console.log('🎉 Tudo pronto! O proxy deve funcionar corretamente.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao conectar:', error.message);
    if (error.code === 'ETIMEOUT') {
      console.error('   ⚠️  Timeout: Verifique se o SQL Server está acessível');
    } else if (error.code === 'ELOGIN') {
      console.error('   ⚠️  Erro de login: Verifique usuário e senha');
    } else if (error.code === 'ESOCKET') {
      console.error('   ⚠️  Erro de socket: Verifique se o servidor está acessível na porta ' + config.port);
    }
    process.exit(1);
  }
}

test();

