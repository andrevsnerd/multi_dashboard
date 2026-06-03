// Audita/corrige destinos e confirmações de romaneio da filial Galeão que ficaram
// salvos com o nome ERRADO (1 espaço) "SCARFME LLL - GALEAO RJ" em vez do nome real
// do DB (2 espaços após o hífen) "SCARFME LLL -  GALEAO RJ".
//
// Tabelas no Neon (Postgres):
//   - destino_romaneio_saida (colunas filial_origem [PK], filial_destino)
//   - romaneio_item_confirmado (coluna filial_destino [PK])
//
// O renomear NÃO apaga linhas; o risco é o valor antigo (1 espaço) não casar mais
// com a lista de filiais (2 espaços) — destino aparece cru e confirmações parecem órfãs.
//
// Requer uma connection string Postgres no ambiente (mesma do app):
//   DATABASE_URL | POSTGRES_URL | NEON_DATABASE_URL | POSTGRES_PRISMA_URL | POSTGRES_URL_NON_POOLING
//
//   Dry-run (só mostra o que mudaria):  node scripts/migrar-destino-galeao.mjs
//   Aplicar de fato:                    node scripts/migrar-destino-galeao.mjs --apply
//
// Dica para rodar contra produção localmente: `vercel env pull .env.production.local`
// e exporte a DATABASE_URL antes de executar.

import { neon } from "@neondatabase/serverless";

const CANONICAL = "SCARFME LLL -  GALEAO RJ"; // 2 espaços (nome real do DB)
const CANONICAL_COLLAPSED = "SCARFME LLL - GALEAO RJ"; // 1 espaço (forma colapsada para detecção)
const APPLY = process.argv.includes("--apply");

function getUrl() {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.NEON_DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ];
  for (const c of candidates) {
    const v = typeof c === "string" ? c.trim() : "";
    if (v) return v;
  }
  return undefined;
}

const url = getUrl();
if (!url) {
  console.error(
    "Postgres/Neon não configurado. Defina DATABASE_URL (ou POSTGRES_URL/NEON_DATABASE_URL/...)."
  );
  process.exit(1);
}

const sql = neon(url);

// "Errado" = colapsado bate no canônico, mas o valor cru difere do canônico (2 espaços).
// regexp_replace(valor, '\s+', ' ', 'g') normaliza o espaçamento para comparação.
const log = (...a) => console.log(...a);

async function main() {
  log(`Modo: ${APPLY ? "APPLY (grava)" : "DRY-RUN (não grava)"}`);
  log(`Canônico: "${CANONICAL}"\n`);

  // ---------- destino_romaneio_saida ----------
  const destWrong = await sql`
    SELECT company_key, romaneio_id, filial_origem, filial_destino
    FROM destino_romaneio_saida
    WHERE (
      filial_destino <> ${CANONICAL}
      AND regexp_replace(filial_destino, '\\s+', ' ', 'g') = ${CANONICAL_COLLAPSED}
    ) OR (
      filial_origem <> ${CANONICAL}
      AND regexp_replace(filial_origem, '\\s+', ' ', 'g') = ${CANONICAL_COLLAPSED}
    )
  `;
  log(`[destino_romaneio_saida] ${destWrong.length} linha(s) com Galeão fora do padrão:`);
  for (const r of destWrong) {
    log(
      `  - ${r.company_key} | rom ${r.romaneio_id} | origem="${r.filial_origem}" destino="${r.filial_destino}"`
    );
  }

  // ---------- romaneio_item_confirmado ----------
  const confWrong = await sql`
    SELECT company_key, romaneio_id, filial_destino, produto, cor_produto
    FROM romaneio_item_confirmado
    WHERE filial_destino <> ${CANONICAL}
      AND regexp_replace(filial_destino, '\\s+', ' ', 'g') = ${CANONICAL_COLLAPSED}
  `;
  log(`\n[romaneio_item_confirmado] ${confWrong.length} linha(s) com Galeão fora do padrão:`);
  for (const r of confWrong) {
    log(
      `  - ${r.company_key} | rom ${r.romaneio_id} | destino="${r.filial_destino}" | ${r.produto}/${r.cor_produto}`
    );
  }

  if (!APPLY) {
    log(`\nDRY-RUN concluído. Rode com --apply para gravar as correções.`);
    return;
  }

  log(`\nAplicando correções...`);

  // filial_destino em destino_romaneio_saida NÃO é PK → update direto e seguro.
  const upDestDestino = await sql`
    UPDATE destino_romaneio_saida
    SET filial_destino = ${CANONICAL}
    WHERE filial_destino <> ${CANONICAL}
      AND regexp_replace(filial_destino, '\\s+', ' ', 'g') = ${CANONICAL_COLLAPSED}
  `;
  log(`  destino_romaneio_saida.filial_destino: ${upDestDestino.length ?? 0} (ver count abaixo)`);

  // filial_origem é parte da PK → só atualiza onde não geraria conflito.
  const upDestOrigem = await sql`
    UPDATE destino_romaneio_saida d
    SET filial_origem = ${CANONICAL}
    WHERE d.filial_origem <> ${CANONICAL}
      AND regexp_replace(d.filial_origem, '\\s+', ' ', 'g') = ${CANONICAL_COLLAPSED}
      AND NOT EXISTS (
        SELECT 1 FROM destino_romaneio_saida d2
        WHERE d2.company_key = d.company_key
          AND d2.romaneio_id = d.romaneio_id
          AND d2.filial_origem = ${CANONICAL}
      )
  `;
  log(`  destino_romaneio_saida.filial_origem atualizado (sem conflito de PK).`);

  // filial_destino é parte da PK em romaneio_item_confirmado → só atualiza sem conflito.
  const upConf = await sql`
    UPDATE romaneio_item_confirmado c
    SET filial_destino = ${CANONICAL}
    WHERE c.filial_destino <> ${CANONICAL}
      AND regexp_replace(c.filial_destino, '\\s+', ' ', 'g') = ${CANONICAL_COLLAPSED}
      AND NOT EXISTS (
        SELECT 1 FROM romaneio_item_confirmado c2
        WHERE c2.company_key = c.company_key
          AND c2.romaneio_id = c.romaneio_id
          AND c2.filial_destino = ${CANONICAL}
          AND c2.produto = c.produto
          AND c2.cor_produto = c.cor_produto
      )
  `;
  log(`  romaneio_item_confirmado.filial_destino atualizado (sem conflito de PK).`);

  // Reporta possíveis conflitos remanescentes (linhas que não puderam migrar por já existir o canônico).
  const restoDest = await sql`
    SELECT COUNT(*)::int AS n FROM destino_romaneio_saida
    WHERE filial_origem <> ${CANONICAL}
      AND regexp_replace(filial_origem, '\\s+', ' ', 'g') = ${CANONICAL_COLLAPSED}
  `;
  const restoConf = await sql`
    SELECT COUNT(*)::int AS n FROM romaneio_item_confirmado
    WHERE filial_destino <> ${CANONICAL}
      AND regexp_replace(filial_destino, '\\s+', ' ', 'g') = ${CANONICAL_COLLAPSED}
  `;
  if ((restoDest[0]?.n ?? 0) > 0 || (restoConf[0]?.n ?? 0) > 0) {
    log(
      `\n⚠ Conflitos não migrados (já existe linha canônica): ` +
        `origem=${restoDest[0]?.n ?? 0}, confirmados=${restoConf[0]?.n ?? 0}. ` +
        `Esses casos já têm o registro correto e os antigos são duplicatas — revise manualmente se quiser removê-los.`
    );
  }

  log(`\nConcluído.`);
}

main().catch((e) => {
  console.error("Falhou:", e);
  process.exit(1);
});
