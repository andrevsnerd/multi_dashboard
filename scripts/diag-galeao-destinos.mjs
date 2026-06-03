// Diagnóstico: quando os destinos de Galeão foram salvos e em quais origens/romaneios,
// para entender por que podem não aparecer na página de romaneios (janela de 90 dias).
import { neon } from "@neondatabase/serverless";

function getUrl() {
  for (const c of [process.env.DATABASE_URL, process.env.POSTGRES_URL, process.env.NEON_DATABASE_URL]) {
    const v = typeof c === "string" ? c.trim() : "";
    if (v) return v;
  }
  return undefined;
}
const url = getUrl();
if (!url) { console.error("Defina DATABASE_URL"); process.exit(1); }
const sql = neon(url);

const rows = await sql`
  SELECT filial_origem, filial_destino,
         MIN(updated_at) AS primeiro,
         MAX(updated_at) AS ultimo,
         COUNT(*)::int AS n,
         MIN(romaneio_id) AS rom_min,
         MAX(romaneio_id) AS rom_max
  FROM destino_romaneio_saida
  WHERE regexp_replace(filial_destino, '\\s+', ' ', 'g') = 'SCARFME LLL - GALEAO RJ'
  GROUP BY filial_origem, filial_destino
  ORDER BY ultimo DESC
`;

console.log("Hoje:", new Date().toISOString().slice(0, 10));
console.log("Destinos Galeão por origem:\n");
for (const r of rows) {
  const ult = r.ultimo ? new Date(r.ultimo).toISOString().slice(0, 10) : "—";
  const prim = r.primeiro ? new Date(r.primeiro).toISOString().slice(0, 10) : "—";
  const diasDesdeUltimo = r.ultimo
    ? Math.floor((Date.now() - new Date(r.ultimo).getTime()) / 86400000)
    : null;
  console.log(
    `  origem="${r.filial_origem}" | destino="${r.filial_destino}" | ${r.n} romaneio(s) ${r.rom_min}..${r.rom_max}\n` +
    `    salvos de ${prim} a ${ult} (último há ~${diasDesdeUltimo} dias)`
  );
}

// Quantos estão dentro vs fora da janela de 90 dias
const janela = await sql`
  SELECT
    SUM(CASE WHEN updated_at >= NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END)::int AS dentro_90d,
    SUM(CASE WHEN updated_at <  NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END)::int AS fora_90d,
    COUNT(*)::int AS total
  FROM destino_romaneio_saida
  WHERE regexp_replace(filial_destino, '\\s+', ' ', 'g') = 'SCARFME LLL - GALEAO RJ'
`;
console.log("\nJanela de 90 dias (por updated_at):", janela[0]);
