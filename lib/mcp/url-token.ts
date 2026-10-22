/**
 * Permite passar o token via `?token=` (ou `?k=`) na URL, além do header
 * `Authorization: Bearer`. Necessário para conectores (Claude.ai/Desktop) que
 * só aceitam uma URL e não um header customizado, sem precisar de OAuth.
 * Quando presente e sem header de auth, normalizamos para o header esperado.
 * Use sempre HTTPS — o token vai na URL.
 *
 * Mesma lógica do wrapper em app/api/[transport]/route.ts (MCP geral).
 */
export function withUrlToken(
  next: (req: Request) => Promise<Response> | Response
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.headers.get('authorization')) return next(req);
    const urlToken =
      new URL(req.url).searchParams.get('token') || new URL(req.url).searchParams.get('k');
    if (!urlToken) return next(req);

    const headers = new Headers(req.headers);
    headers.set('authorization', `Bearer ${urlToken}`);

    // Reconstrói o Request preservando o corpo (POST). `new Request(req, {headers})`
    // não recarrega o body já em stream, então lemos o buffer e remontamos.
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const body = hasBody ? await req.arrayBuffer() : undefined;
    return next(new Request(req.url, { method: req.method, headers, body }));
  };
}
