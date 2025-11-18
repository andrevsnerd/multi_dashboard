/**
 * Servidor Proxy Local
 * 
 * Este servidor roda na sua máquina local e atua como ponte entre
 * o Vercel (na internet) e seu SQL Server (na rede local).
 * 
 * Use um túnel (ngrok/Cloudflare) para expor este servidor na internet.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();
const PORT = process.env.PROXY_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Validar variáveis de ambiente
if (!process.env.DB_USERNAME || !process.env.DB_PASSWORD || !process.env.DB_SERVER || !process.env.DB_DATABASE) {
  console.error('❌ Erro: Variáveis de ambiente não encontradas!');
  console.error('   Verifique se o arquivo .env.local existe na raiz do projeto.');
  console.error('   Variáveis necessárias: DB_USERNAME, DB_PASSWORD, DB_SERVER, DB_DATABASE');
  process.exit(1);
}

// Configuração do SQL Server (usa as mesmas variáveis de ambiente)
const dbConfig = {
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 30000,
  },
  requestTimeout: 60000,
  connectionTimeout: 30000,
};

// Pool de conexão
let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(dbConfig);
  }
  if (!pool.connected) {
    await pool.connect();
  }
  return pool;
}

// Middleware de autenticação simples (token secreto)
const PROXY_SECRET = process.env.PROXY_SECRET || 'seu-token-secreto-aqui-mude-isso';

function authenticate(req, res, next) {
  const token = req.headers['x-proxy-token'];
  if (token !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Rota raiz - informações do proxy
app.get('/', (req, res) => {
  res.json({
    service: 'Multi-Dashboard Proxy Server',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      query: 'POST /query',
      'with-request': 'POST /with-request',
      'sales-summary': 'GET /api/sales-summary'
    },
    authentication: 'Required header: X-Proxy-Token'
  });
});

// Endpoint de health check
app.get('/health', async (req, res) => {
  try {
    const pool = await getPool();
    res.json({ 
      status: 'ok', 
      database: 'connected',
      server: dbConfig.server 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      error: error.message 
    });
  }
});

// Endpoint genérico para executar queries
app.post('/query', authenticate, async (req, res) => {
  try {
    const { query: queryText, params = {} } = req.body;
    
    if (!queryText) {
      return res.status(400).json({ error: 'Query é obrigatória' });
    }

    const pool = await getPool();
    const request = pool.request();

    // Adicionar parâmetros se fornecidos
    Object.keys(params).forEach(key => {
      const value = params[key];
      // Determinar tipo SQL
      if (typeof value === 'string') {
        request.input(key, sql.VarChar, value);
      } else if (typeof value === 'number') {
        request.input(key, sql.Int, value);
      } else if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
        request.input(key, sql.DateTime, value);
      } else if (typeof value === 'boolean') {
        request.input(key, sql.Bit, value);
      } else {
        request.input(key, sql.VarChar, String(value));
      }
    });

    const result = await request.query(queryText);
    
    res.json({
      success: true,
      data: result.recordset,
    });
  } catch (error) {
    console.error('Erro ao executar query:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Endpoint para executar queries com withRequest (suporte a funções mais complexas)
app.post('/with-request', authenticate, async (req, res) => {
  try {
    const { handler } = req.body;
    
    if (!handler || typeof handler !== 'function') {
      // Se não for uma função, tentar executar como query simples
      const { query: queryText, params = {} } = req.body;
      if (queryText) {
        return res.redirect('/query');
      }
      return res.status(400).json({ error: 'Handler ou query é obrigatório' });
    }

    // Esta função seria mais complexa de implementar
    // Por enquanto, retornamos erro sugerindo usar /query
    res.status(501).json({
      error: 'withRequest ainda não suportado completamente',
      suggestion: 'Use o endpoint /query com a query SQL diretamente'
    });
  } catch (error) {
    console.error('Erro em with-request:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Endpoints específicos para as rotas da API
app.get('/api/sales-summary', authenticate, async (req, res) => {
  try {
    const { company, filial, start, end } = req.query;
    
    // Aqui você pode chamar as funções dos repositories
    // Por enquanto, retorna um erro indicando que precisa implementar
    res.status(501).json({
      error: 'Endpoint ainda não implementado no proxy',
      message: 'Use o endpoint /query para queries customizadas'
    });
  } catch (error) {
    console.error('Erro em sales-summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
async function start() {
  try {
    // Testar conexão ao banco
    console.log('🔄 Conectando ao banco de dados...');
    await getPool();
    console.log('✅ Conectado ao banco de dados!');
    
    app.listen(PORT, () => {
      console.log(`🚀 Servidor Proxy rodando na porta ${PORT}`);
      console.log(`📡 Aguardando requisições...`);
      console.log(`\n⚠️  IMPORTANTE: Use um túnel (ngrok/Cloudflare) para expor este servidor na internet`);
      console.log(`\n💡 Para usar ngrok:`);
      console.log(`   npx ngrok http ${PORT}`);
      console.log(`\n🔑 Token de autenticação: ${PROXY_SECRET}`);
      console.log(`   Configure a variável PROXY_SECRET no Vercel com este valor`);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

start();

