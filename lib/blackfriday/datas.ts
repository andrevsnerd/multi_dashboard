/** Helpers de data/concorrência das rotas do painel Black Friday. */

/** Filiais que não vendem ao público (depósito/matriz) — mesma lista da Produto Giro. */
export const MATRIZ_FILIAIS: Record<string, string[]> = {
  scarfme: ["SCARF ME - MATRIZ"],
  nerd: ["NERD"],
};

/** Teto de dias consultados um a um (a campanha não passa disso). */
export const MAX_DIAS = 62;

const FUSO_BRASILIA_MS = 3 * 60 * 60 * 1000;

/** Agora no relógio de Brasília: `ymd` do dia e o instante como pseudo-UTC. */
export function hojeBrasilia(): { ymd: string; pseudoUtcMs: number } {
  const pseudoUtcMs = Date.now() - FUSO_BRASILIA_MS;
  return { ymd: new Date(pseudoUtcMs).toISOString().slice(0, 10), pseudoUtcMs };
}

export function isYmd(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function addDiasYmd(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

/** Dias 'yyyy-MM-dd' de start a end (inclusive), no máximo MAX_DIAS (os mais recentes). */
export function listarDias(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  let cur = startYmd;
  while (cur <= endYmd) {
    out.push(cur);
    cur = addDiasYmd(cur, 1);
  }
  return out.slice(-MAX_DIAS);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
