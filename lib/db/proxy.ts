/**
 * Cliente Proxy para conectar ao servidor proxy local
 * Usado quando a aplicação está rodando no Vercel
 */

const PROXY_URL = process.env.PROXY_URL || '';
const PROXY_SECRET = process.env.PROXY_SECRET || '';
const REQUEST_TIMEOUT = 30000; // 30 segundos
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000; // 1 segundo

/**
 * Verifica se deve usar o proxy (quando está no Vercel)
 */
export function shouldUseProxy(): boolean {
  // Usa proxy se PROXY_URL estiver configurado
  // No Vercel, NODE_ENV é sempre 'production', mas também pode ser usado em outros ambientes
  const isProduction = process.env.NODE_ENV === 'production';
  const hasProxyUrl = !!PROXY_URL;
  const hasDbConfig = !!process.env.DB_SERVER;
  
  // Log para debug (apenas em produção para não poluir logs locais)
  if (isProduction && hasProxyUrl) {
    console.log('[Proxy] Configuração detectada:', {
      hasProxyUrl,
      isProduction,
      hasDbConfig,
      proxyUrl: PROXY_URL ? `${PROXY_URL.substring(0, 20)}...` : 'não configurado',
    });
  }
  
  // Se tiver PROXY_URL configurado, usa proxy (mesmo em dev se necessário)
  // Mas prioriza produção quando ambas estão configuradas
  if (hasProxyUrl) {
    // Se estiver em produção OU se não tiver variáveis de banco configuradas, usa proxy
    return isProduction || !hasDbConfig;
  }
  
  return false;
}

/**
 * Cria um AbortController com timeout
 */
function createTimeoutController(timeout: number): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  return {
    controller,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Detecta o tipo de erro e retorna mensagem apropriada
 */
function getErrorMessage(error: unknown, proxyUrl: string): string {
  if (error instanceof Error) {
    const errorMessage = error.message.toLowerCase();
    const cause = (error as any).cause;

    // Erro de conexão TLS/SSL
    if (
      errorMessage.includes('tls') ||
      errorMessage.includes('ssl') ||
      errorMessage.includes('econnreset') ||
      errorMessage.includes('socket disconnected') ||
      (cause && (cause.code === 'ECONNRESET' || cause.code === 'ECONNREFUSED'))
    ) {
      return `Erro de conexão com o proxy: O servidor proxy não está acessível. Verifique se o túnel ngrok está rodando e se a URL ${proxyUrl} está correta no Vercel. O túnel pode ter caído ou a URL pode ter mudado.`;
    }

    // Erro de timeout
    if (errorMessage.includes('timeout') || errorMessage.includes('aborted')) {
      return `Timeout ao conectar com o proxy: O servidor proxy não respondeu em ${REQUEST_TIMEOUT}ms. Verifique se o proxy está rodando e acessível.`;
    }

    // Erro de rede genérico
    if (errorMessage.includes('fetch failed') || errorMessage.includes('network')) {
      return `Erro de rede ao conectar com o proxy: Não foi possível estabelecer conexão com ${proxyUrl}. Verifique se o túnel está ativo.`;
    }

    return error.message;
  }

  return String(error);
}

/**
 * Executa uma query através do proxy com retry
 */
async function queryViaProxyWithRetry<T>(
  queryText: string,
  params: Record<string, any> = {},
  retryCount: number = 0
): Promise<T[]> {
  if (!PROXY_URL) {
    throw new Error('PROXY_URL não configurada. Configure a variável de ambiente PROXY_URL no Vercel.');
  }

  if (!PROXY_SECRET) {
    throw new Error('PROXY_SECRET não configurada. Configure a variável de ambiente PROXY_SECRET no Vercel.');
  }

  const { controller, cleanup } = createTimeoutController(REQUEST_TIMEOUT);

  try {
    // Headers necessários para ngrok free plan (bypass warning page)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Proxy-Token': PROXY_SECRET,
      'ngrok-skip-browser-warning': 'true', // Bypass ngrok free plan warning
      'User-Agent': 'multi-dashboard-proxy-client/1.0', // User-Agent específico para evitar bloqueios
    };

    // Log para debug (apenas primeira tentativa)
    if (retryCount === 0) {
      console.log('[Proxy] Fazendo requisição:', {
        url: `${PROXY_URL}/query`,
        hasToken: !!PROXY_SECRET,
        retryCount: 0,
      });
    }

    const response = await fetch(`${PROXY_URL}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: queryText,
        params,
      }),
      signal: controller.signal,
    });

    // Limpar timeout se a requisição completar com sucesso
    cleanup();

    // Verificar content-type antes de processar
    const contentType = response.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');

    if (!response.ok) {
      // Se retornou HTML, pode ser página de warning do ngrok
      if (isHtml) {
        const htmlText = await response.text().catch(() => '');
        if (htmlText.includes('ngrok') || htmlText.includes('Visit Site')) {
          throw new Error('Ngrok está retornando página de warning. Verifique se o header ngrok-skip-browser-warning está sendo enviado corretamente.');
        }
        throw new Error(`Erro HTTP ${response.status}: Resposta HTML inesperada`);
      }
      
      // Tentar ler como JSON
      const errorData = await response.json().catch(() => ({ 
        error: `Erro HTTP ${response.status}` 
      }));
      
      // Se for erro 502/503/504, pode ser problema de conexão - tentar retry
      if ((response.status === 502 || response.status === 503 || response.status === 504) && retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
        return queryViaProxyWithRetry(queryText, params, retryCount + 1);
      }
      
      throw new Error(errorData.error || `Erro HTTP ${response.status}`);
    }

    // Verificar se a resposta é HTML (página de warning do ngrok) mesmo com status OK
    if (isHtml) {
      const htmlText = await response.text().catch(() => '');
      if (htmlText.includes('ngrok') || htmlText.includes('Visit Site')) {
        throw new Error('Ngrok retornou página de warning ao invés de JSON. O header ngrok-skip-browser-warning pode não estar funcionando.');
      }
      throw new Error('Resposta HTML inesperada do proxy');
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Erro ao executar query');
    }

    return result.data as T[];
  } catch (error) {
    // Limpar timeout em caso de erro também
    cleanup();
    
    // Se for erro de abort (timeout) ou conexão, tentar retry
    if (
      (error instanceof Error && 
       (error.name === 'AbortError' || 
        error.message.includes('ECONNRESET') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('fetch failed'))) &&
      retryCount < MAX_RETRIES
    ) {
      console.warn(`Tentativa ${retryCount + 1} falhou, tentando novamente...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
      return queryViaProxyWithRetry(queryText, params, retryCount + 1);
    }

    // Erro final - formatar mensagem
    const errorMessage = getErrorMessage(error, PROXY_URL);
    console.error('Erro ao executar query via proxy:', {
      error: errorMessage,
      proxyUrl: PROXY_URL,
      retryCount,
    });
    
    throw new Error(errorMessage);
  }
}

/**
 * Executa uma query através do proxy
 */
export async function queryViaProxy<T>(
  queryText: string,
  params: Record<string, any> = {}
): Promise<T[]> {
  return queryViaProxyWithRetry<T>(queryText, params, 0);
}

/**
 * Interface comum para request (compatível com sql.Request e ProxyRequest)
 */
export interface RequestLike {
  input(name: string, type: any, value: any): any;
  query<T = any>(queryText: string): Promise<{ recordset: T[] }>;
}

/**
 * Simula um sql.Request para uso com withRequest via proxy
 */
export class ProxyRequest implements RequestLike {
  private params: Record<string, any> = {};

  input(name: string, type: any, value: any): ProxyRequest {
    this.params[name] = value;
    return this;
  }

  async query<T = any>(queryText: string): Promise<{ recordset: T[] }> {
    const data = await queryViaProxy<T>(queryText, this.params);
    return { recordset: data };
  }
}

/**
 * Testa a conexão com o proxy
 */
export async function testProxyConnection(): Promise<boolean> {
  if (!PROXY_URL) {
    return false;
  }

  try {
    const { controller, cleanup } = createTimeoutController(5000); // 5 segundos para health check
    const response = await fetch(`${PROXY_URL}/health`, {
      headers: {
        'ngrok-skip-browser-warning': 'true', // Bypass ngrok free plan warning
        'User-Agent': 'multi-dashboard-proxy-client/1.0',
      },
      signal: controller.signal,
    });
    cleanup();
    return response.ok;
  } catch (error) {
    const errorMessage = getErrorMessage(error, PROXY_URL);
    console.error('Erro ao testar conexão com proxy:', errorMessage);
    return false;
  }
}

