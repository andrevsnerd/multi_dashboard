import { neon } from "@neondatabase/serverless";

/**
 * URL do Postgres (Neon). No Vercel, use a variável injetada pela integração Neon.
 * Local: crie um projeto em neon.tech e defina DATABASE_URL ou POSTGRES_URL no .env.local
 */
function getPostgresUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

export function hasPostgres(): boolean {
  return !!getPostgresUrl();
}

/** Cliente SQL serverless para Neon. Só use quando hasPostgres() for true. */
export function getNeonSql() {
  const url = getPostgresUrl();
  if (!url) throw new Error("DATABASE_URL ou POSTGRES_URL não definida");
  return neon(url);
}
