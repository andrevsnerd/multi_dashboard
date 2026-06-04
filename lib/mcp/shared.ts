import { z } from 'zod';

/** Schema da empresa, reutilizado por todas as tools. */
export const empresaSchema = z
  .enum(['nerd', 'scarfme'])
  .describe('Chave da empresa (nerd | scarfme). Veja listar_empresas.');

/** Data obrigatória YYYY-MM-DD. */
export const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')
  .describe('Data no formato YYYY-MM-DD');

/** Lista opcional de strings com descrição. */
export const listaOpcional = (descricao: string) =>
  z.array(z.string()).optional().describe(descricao);

/** Empacota um payload como conteúdo de texto (JSON) para o cliente MCP. */
export function texto(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/** Normaliza array vindo do Claude para `string[] | null` (vazio → null). */
export function listaOuNull(v?: string[] | null): string[] | null {
  return v && v.length > 0 ? v : null;
}
