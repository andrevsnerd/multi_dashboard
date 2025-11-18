/**
 * Cliente Proxy para conectar ao servidor proxy local
 * Usado quando a aplicação está rodando no Vercel
 */

const PROXY_URL = process.env.PROXY_URL || '';
const PROXY_SECRET = process.env.PROXY_SECRET || '';

/**
 * Verifica se deve usar o proxy (quando está no Vercel)
 */
export function shouldUseProxy(): boolean {
  // Usa proxy se PROXY_URL estiver configurado e não estiver em desenvolvimento local
  return !!PROXY_URL && process.env.NODE_ENV === 'production';
}

/**
 * Executa uma query através do proxy
 */
export async function queryViaProxy<T>(
  queryText: string,
  params: Record<string, any> = {}
): Promise<T[]> {
  if (!PROXY_URL) {
    throw new Error('PROXY_URL não configurada');
  }

  if (!PROXY_SECRET) {
    throw new Error('PROXY_SECRET não configurada');
  }

  try {
    const response = await fetch(`${PROXY_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Proxy-Token': PROXY_SECRET,
      },
      body: JSON.stringify({
        query: queryText,
        params,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `Erro HTTP ${response.status}` }));
      throw new Error(errorData.error || `Erro HTTP ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Erro ao executar query');
    }

    return result.data as T[];
  } catch (error) {
    console.error('Erro ao executar query via proxy:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
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
    const response = await fetch(`${PROXY_URL}/health`);
    return response.ok;
  } catch (error) {
    console.error('Erro ao testar conexão com proxy:', error);
    return false;
  }
}

