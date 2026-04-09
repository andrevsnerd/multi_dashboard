import { neon } from "@neondatabase/serverless";

/**
 * Única fonte da connection string para Neon em todo o app (usuários, compra final,
 * compras salvas, transferências, etc.). Ordem: nomes que o Vercel/Neon costumam injetar.
 *
 * Local: `.env.local` com qualquer uma das variáveis abaixo (de preferência `DATABASE_URL`).
 */
function getPostgresUrl(): string | undefined {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.NEON_DATABASE_URL,
    // Integrações “Postgres” no Vercel às vezes expõem apenas a URL pooled do Prisma:
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ];
  for (const c of candidates) {
    const v = typeof c === "string" ? c.trim() : "";
    if (v.length > 0) return v;
  }
  return undefined;
}

export function hasPostgres(): boolean {
  return !!getPostgresUrl();
}

const missingUrlMessage =
  "Postgres/Neon não configurado. Defina uma de: DATABASE_URL, POSTGRES_URL, NEON_DATABASE_URL, POSTGRES_PRISMA_URL ou POSTGRES_URL_NON_POOLING.";

/** Cliente SQL serverless para Neon. Só use quando hasPostgres() for true. */
export function getNeonSql() {
  const url = getPostgresUrl();
  if (!url) throw new Error(missingUrlMessage);
  return neon(url);
}
