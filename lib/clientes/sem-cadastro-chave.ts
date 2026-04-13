export const SEM_CAD_CHAVE_PREFIX = "SEM_CAD_";

/** Desmonta chave gerada no ranking para ticket sem cadastro (filial pode conter "_"). */
export function parseSemCadastroChave(chave: string): {
  filial: string;
  pedido: string;
  ticket: string;
} | null {
  const t = chave.trim();
  if (!t.startsWith(SEM_CAD_CHAVE_PREFIX)) return null;
  const rest = t.slice(SEM_CAD_CHAVE_PREFIX.length);
  const parts = rest.split("_");
  if (parts.length < 3) return null;
  const ticket = parts[parts.length - 1] ?? "";
  const pedido = parts[parts.length - 2] ?? "";
  const filial = parts.slice(0, -2).join("_");
  if (!filial || !pedido || !ticket) return null;
  return { filial, pedido, ticket };
}
