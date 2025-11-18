import sql from 'mssql';
import { shouldUseProxy, queryViaProxy } from './proxy';

const {
  DB_SERVER,
  DB_DATABASE,
  DB_USERNAME,
  DB_PASSWORD,
  DB_PORT,
} = process.env;

// No Vercel, se PROXY_URL estiver configurado, não precisa das variáveis do banco
if (!shouldUseProxy()) {
  if (!DB_SERVER || !DB_DATABASE || !DB_USERNAME || !DB_PASSWORD) {
    throw new Error(
      'Variáveis de ambiente para conexão com o banco não estão completas. Verifique o arquivo .env.local.'
    );
  }
}

const config: sql.config = {
  user: DB_USERNAME!,
  password: DB_PASSWORD!,
  server: DB_SERVER!,
  database: DB_DATABASE!,
  port: DB_PORT ? Number(DB_PORT) : 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 30000,
  },
  requestTimeout: 60000, // 60 segundos (aumentado para queries complexas)
  connectionTimeout: 30000, // 30 segundos para estabelecer conexão
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export async function getConnectionPool(): Promise<sql.ConnectionPool> {
  // Se estiver usando proxy, não tenta conectar diretamente
  if (shouldUseProxy()) {
    throw new Error(
      'Conexão direta não disponível. Use query() ao invés de getConnectionPool() quando usar proxy.'
    );
  }

  if (!poolPromise) {
    poolPromise = sql.connect(config);
  }

  const pool = await poolPromise;

  if (!pool.connected) {
    await pool.connect();
  }

  return pool;
}

export async function withRequest<T>(
  handler: (request: sql.Request) => Promise<T>
): Promise<T> {
  // Se estiver usando proxy, não pode usar withRequest
  if (shouldUseProxy()) {
    throw new Error(
      'withRequest não disponível com proxy. Use query() para queries simples.'
    );
  }

  const pool = await getConnectionPool();
  const request = pool.request();
  return handler(request);
}

export async function query<T>(queryText: string): Promise<T[]> {
  // Se estiver usando proxy, usa o proxy
  if (shouldUseProxy()) {
    return queryViaProxy<T>(queryText);
  }

  // Caso contrário, usa conexão direta
  return withRequest(async (request) => {
    const result = await request.query<T>(queryText);
    return result.recordset as T[];
  });
}



