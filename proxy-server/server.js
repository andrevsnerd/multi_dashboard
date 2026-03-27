/**
 * Servidor Proxy Local
 * 
 * Ponte entre o Vercel e o SQL Server.
 * Pode rodar na máquina local + túnel (ngrok/Cloudflare) ou
 * diretamente em VM/EC2 (ex.: AWS) com IP público — sem túnel.
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
    min: 2,
    idleTimeoutMillis: 600000,     // 10 min (era 30s — muito baixo, causava timeout ao recriar conexões)
    acquireTimeoutMillis: 60000,   // 60s para adquirir conexão do pool
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
  },
  requestTimeout: 300000, // 5 min (vendedores/sales-summary podem levar 2min+)
  connectionTimeout: 30000,
};

// Pool de conexão
let pool = null;
let activeServer = process.env.DB_SERVER;

const DEFAULT_DB_FALLBACK = '189.126.197.82';

function buildDbServerList() {
  const explicitFallback = (process.env.DB_SERVER_FALLBACK || '').trim() || DEFAULT_DB_FALLBACK;
  const primary = (process.env.DB_SERVER || '').trim();
  const unique = new Set();
  if (primary) unique.add(primary);
  if (explicitFallback) unique.add(explicitFallback);
  if (unique.size === 1) {
    const only = [...unique][0];
    if (only !== DEFAULT_DB_FALLBACK) unique.add(DEFAULT_DB_FALLBACK);
  }
  return [...unique];
}

const DB_SERVERS = buildDbServerList();

async function tryConnect(server) {
  const config = { ...dbConfig, server };
  console.log(`🔌 Tentando conectar em ${server}...`);
  const p = await sql.connect(config);
  activeServer = server;
  console.log(`✅ Conectado em ${server}`);
  return p;
}

async function getPool() {
  if (!pool || !pool.connected) {
    if (pool) {
      try { await pool.close(); } catch (_) {}
      pool = null;
    }
    // Tenta o servidor ativo primeiro, depois os demais
    const ordered = [activeServer, ...DB_SERVERS.filter(s => s !== activeServer)];
    console.log(`[DB] Servidores na rotação: ${ordered.join(' → ')}`);
    let lastError;
    for (const server of ordered) {
      try {
        pool = await tryConnect(server);
        return pool;
      } catch (err) {
        console.error(`❌ Falhou em ${server}: ${err.message}`);
        lastError = err;
      }
    }
    throw lastError;
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

    // Adicionar parâmetros - usar input(key, value) para mssql inferir tipo (evita parameter.type.validate)
    Object.keys(params).forEach(key => {
      const value = params[key];
      request.input(key, value);
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

// Endpoint para executar transferência (usado pelo Vercel quando via proxy)
app.post('/transfer', authenticate, async (req, res) => {
  try {
    const body = req.body;
    const {
      produto,
      corProduto,
      filialOrigem,
      filialDestino,
      qtdeSaida,
      qtdeEntrada,
      tipoRomaneio = 'TRANSFERENCIA',
      responsavel = 'LOGISTICA',
      observacao = null,
    } = body;

    if (!produto || !filialOrigem || !filialDestino || qtdeSaida <= 0 || qtdeEntrada <= 0) {
      return res.status(400).json({ success: false, error: 'Dados inválidos para transferência' });
    }

    const pool = await getPool();
    const { executeTransfer } = require('../lib/transfer-executor');
    const result = await executeTransfer(pool, {
      produto,
      corProduto: corProduto || null,
      filialOrigem,
      filialDestino,
      qtdeSaida,
      qtdeEntrada,
      tipoRomaneio,
      responsavel,
      observacao: observacao || null,
    });

    res.json({
      success: true,
      romaneioSaida: result.romaneioSaida,
      romaneioEntrada: result.romaneioEntrada,
      message: result.message,
    });
  } catch (error) {
    console.error('[Transfer] Erro:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao executar transferência',
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
    
    // Escutar em 0.0.0.0 para aceitar conexões externas (ex.: Vercel → EC2)
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor Proxy rodando na porta ${PORT} (0.0.0.0)`);
      console.log(`📡 Aguardando requisições...`);
      console.log(`\n🔑 Token: ${PROXY_SECRET}`);
      console.log(`   No Vercel: PROXY_URL=http://<IP_DESTA_MAQUINA>:${PORT} e PROXY_SECRET com o valor acima`);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

start();

