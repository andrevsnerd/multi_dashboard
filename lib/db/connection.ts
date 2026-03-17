import sql from 'mssql';
import { shouldUseProxy, queryViaProxy, ProxyRequest, RequestLike } from './proxy';

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

const DB_SERVERS = [
  DB_SERVER,
  process.env.DB_SERVER_FALLBACK || '189.126.197.82',
].filter(Boolean) as string[];

const baseConfig = {
  user: DB_USERNAME!,
  password: DB_PASSWORD!,
  database: DB_DATABASE!,
  port: DB_PORT ? Number(DB_PORT) : 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 600000,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
  },
  requestTimeout: 300000,
  connectionTimeout: 30000,
};

let pool: sql.ConnectionPool | null = null;
let activeServer: string = DB_SERVER!;

export async function getConnectionPool(): Promise<sql.ConnectionPool> {
  // Se estiver usando proxy, não tenta conectar diretamente
  if (shouldUseProxy()) {
    throw new Error(
      'Conexão direta não disponível. Use query() ao invés de getConnectionPool() quando usar proxy.'
    );
  }

  if (!pool || !pool.connected) {
    if (pool) {
      try { await pool.close(); } catch (_) {}
      pool = null;
    }

    const ordered = [activeServer, ...DB_SERVERS.filter(s => s !== activeServer)];
    let lastError: Error | undefined;
    for (const server of ordered) {
      try {
        console.log(`🔌 Tentando conectar em ${server}...`);
        pool = await sql.connect({ ...baseConfig, server });
        activeServer = server;
        console.log(`✅ Conectado em ${server}`);
        return pool;
      } catch (err) {
        console.error(`❌ Falhou em ${server}: ${(err as Error).message}`);
        lastError = err as Error;
      }
    }
    throw lastError;
  }

  return pool;
}

export async function withRequest<T>(
  handler: (request: sql.Request | RequestLike) => Promise<T>
): Promise<T> {
  // Se estiver usando proxy, usa ProxyRequest
  if (shouldUseProxy()) {
    const proxyRequest = new ProxyRequest();
    return handler(proxyRequest as unknown as sql.Request);
  }

  // Caso contrário, usa conexão direta
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
  return withRequest(async (request: sql.Request | RequestLike) => {
    const sqlRequest = request as sql.Request;
    const result = await sqlRequest.query<T>(queryText);
    return result.recordset as T[];
  });
}



