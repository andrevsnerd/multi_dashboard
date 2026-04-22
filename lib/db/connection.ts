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

/** Fallback padrão (mesmo IP do script Python / Linx) quando não há segundo host distinto. */
const DEFAULT_DB_FALLBACK = '189.126.197.82';

function buildDbServerList(): string[] {
  const explicitFallback =
    (process.env.DB_SERVER_FALLBACK || '').trim() || DEFAULT_DB_FALLBACK;
  const primary = (DB_SERVER || '').trim();
  const unique = new Set<string>();
  if (primary) unique.add(primary);
  if (explicitFallback) unique.add(explicitFallback);
  // Se principal e fallback explícito forem o MESMO IP, o array virava [ip, ip] e o
  // filter abaixo removia o segundo → só uma tentativa. Garante o IP padrão do projeto.
  if (unique.size === 1) {
    const only = [...unique][0];
    if (only !== DEFAULT_DB_FALLBACK) unique.add(DEFAULT_DB_FALLBACK);
  }
  return [...unique];
}

const DB_SERVERS = buildDbServerList();

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

function getErrorCodes(error: unknown): string[] {
  const codes = new Set<string>();

  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const maybeCode = (value as { code?: unknown }).code;
    if (typeof maybeCode === 'string' && maybeCode.trim()) codes.add(maybeCode.trim().toUpperCase());
    const originalError = (value as { originalError?: unknown }).originalError;
    if (originalError && originalError !== value) collect(originalError);
    const cause = (value as { cause?: unknown }).cause;
    if (cause && cause !== value) collect(cause);
    if (value instanceof AggregateError) {
      for (const inner of value.errors) collect(inner);
    }
  };

  collect(error);
  return [...codes];
}

export function isDatabaseConnectionError(error: unknown): boolean {
  const codes = getErrorCodes(error);
  if (codes.some((code) => ['ESOCKET', 'ETIMEOUT', 'ELOGIN', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND'].includes(code))) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error ?? '').toLowerCase();

  return (
    message.includes('failed to connect') ||
    message.includes('could not connect') ||
    message.includes('connectionerror') ||
    message.includes('esocket') ||
    message.includes('timeout') ||
    message.includes('login failed')
  );
}

export function getPublicDatabaseErrorMessage(error: unknown): string {
  if (!isDatabaseConnectionError(error)) {
    return 'Erro ao acessar o banco de dados.';
  }

  const hasProxyUrl = !!(process.env.PROXY_URL || '').trim();
  const shouldSuggestProxy = hasProxyUrl && !shouldUseProxy();

  if (shouldSuggestProxy) {
    return 'Banco de dados indisponível por conexão direta. Se este ambiente usa proxy, habilite FORCE_PROXY=true para rotear as consultas pelo proxy.';
  }

  return 'Banco de dados indisponível no momento. Não foi possível conectar ao SQL Server.';
}

export async function getConnectionPool(): Promise<sql.ConnectionPool> {
  // Se estiver usando proxy, não tenta conectar diretamente
  if (shouldUseProxy()) {
    throw new Error(
      'Conexão direta não disponível. Use query() ao invés de getConnectionPool() quando usar proxy.'
    );
  }

  if (!pool || !pool.connected) {
    if (pool) {
      try { await pool.close(); } catch {}
      pool = null;
    }

    const ordered = [activeServer, ...DB_SERVERS.filter(s => s !== activeServer)];
    console.log(`[DB] Servidores na rotação: ${ordered.join(' → ')}`);
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

