// Diagnóstico ERP: status real dos romaneios de saída pra Galeão (029776–029906).
// Mostra se existem em ESTOQUE_PROD_SAI / LOJA_SAIDAS, a data de EMISSAO e se foram cancelados.
// Lê credenciais do .env.local. Conexão direta (mesma do app, sem proxy).
import sql from "mssql";
import fs from "fs";

// ---- carrega .env.local manualmente ----
const env = {};
try {
  for (const line of fs.readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {
  console.error("Não consegui ler .env.local:", e.message);
  process.exit(1);
}

const baseConfig = {
  user: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
  port: env.DB_PORT ? Number(env.DB_PORT) : 1433,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 30000,
  requestTimeout: 120000,
};

const servers = [env.DB_SERVER, "189.126.197.82"].filter(Boolean);

async function connect() {
  let lastErr;
  for (const server of servers) {
    try {
      console.log(`🔌 conectando em ${server}...`);
      const pool = await sql.connect({ ...baseConfig, server });
      console.log(`✅ conectado em ${server}\n`);
      return pool;
    } catch (e) {
      console.error(`❌ falhou em ${server}: ${e.message}`);
      lastErr = e;
    }
  }
  throw lastErr;
}

const RANGE_INI = "029776";
const RANGE_FIM = "029906";

async function main() {
  const pool = await connect();

  for (const tabela of ["ESTOQUE_PROD_SAI", "LOJA_SAIDAS"]) {
    const temCancelada = tabela === "LOJA_SAIDAS";
    const colCancelada = temCancelada ? ", MAX(CAST(SAIDA_CANCELADA AS INT)) AS CANCELADA" : "";
    const q = `
      SELECT
        LTRIM(RTRIM(ROMANEIO_PRODUTO)) AS ROM,
        LTRIM(RTRIM(FILIAL)) AS FILIAL,
        LTRIM(RTRIM(ISNULL(FILIAL_DESTINO,''))) AS DESTINO,
        CONVERT(VARCHAR(10), MIN(EMISSAO), 120) AS EMISSAO
        ${colCancelada}
      FROM ${tabela} WITH (NOLOCK)
      WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) BETWEEN '${RANGE_INI}' AND '${RANGE_FIM}'
        AND (FILIAL LIKE '%OSCAR%' OR FILIAL LIKE '%VILLA LOBOS%')
      GROUP BY LTRIM(RTRIM(ROMANEIO_PRODUTO)), LTRIM(RTRIM(FILIAL)), LTRIM(RTRIM(ISNULL(FILIAL_DESTINO,'')))
      ORDER BY ROM
    `;
    const r = await pool.request().query(q);
    const rows = r.recordset;
    console.log(`=== ${tabela}: ${rows.length} linha(s) no range ${RANGE_INI}–${RANGE_FIM} (origem OSCAR/VILLA LOBOS) ===`);
    if (rows.length) {
      const emissoes = rows.map((x) => x.EMISSAO).filter(Boolean).sort();
      console.log(`  EMISSAO min/max: ${emissoes[0]} .. ${emissoes[emissoes.length - 1]}`);
      if (temCancelada) {
        const canc = rows.filter((x) => x.CANCELADA === 1).length;
        console.log(`  canceladas (SAIDA_CANCELADA=1): ${canc} de ${rows.length}`);
      }
      console.log(`  amostra:`);
      for (const x of rows.slice(0, 5)) {
        console.log(`    rom ${x.ROM} | ${x.FILIAL} → "${x.DESTINO}" | emissao ${x.EMISSAO}${temCancelada ? ` | cancelada=${x.CANCELADA}` : ""}`);
      }
    }
    console.log("");
  }

  // Quantos do range cairiam dentro de 90 vs 120 dias por EMISSAO (na ESTOQUE_PROD_SAI)
  const janela = await pool.request().query(`
    SELECT
      SUM(CASE WHEN EMISSAO >= DATEADD(DAY,-90, GETDATE())  THEN 1 ELSE 0 END) AS dentro_90,
      SUM(CASE WHEN EMISSAO >= DATEADD(DAY,-120,GETDATE()) THEN 1 ELSE 0 END) AS dentro_120,
      SUM(CASE WHEN EMISSAO <  DATEADD(DAY,-120,GETDATE()) THEN 1 ELSE 0 END) AS fora_120,
      COUNT(*) AS total
    FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) BETWEEN '${RANGE_INI}' AND '${RANGE_FIM}'
      AND (FILIAL LIKE '%OSCAR%' OR FILIAL LIKE '%VILLA LOBOS%')
  `);
  console.log("Janela por EMISSAO (ESTOQUE_PROD_SAI):", janela.recordset[0]);

  // Total de saídas (ambas tabelas, dedup, TODAS as filiais) nos últimos 90 dias.
  // Se > 1000, o TOP (1000) da query corta as mais antigas — explicaria o sumiço.
  const totalUnificado = await pool.request().query(`
    SELECT COUNT(*) AS total FROM (
      SELECT es.ROMANEIO_PRODUTO, es.FILIAL
      FROM ESTOQUE_PROD_SAI es WITH (NOLOCK)
      WHERE es.EMISSAO >= DATEADD(DAY,-90, GETDATE())
      UNION ALL
      SELECT s.ROMANEIO_PRODUTO, s.FILIAL
      FROM LOJA_SAIDAS s WITH (NOLOCK)
      WHERE NOT EXISTS (
        SELECT 1 FROM ESTOQUE_PROD_SAI es2 WITH (NOLOCK)
        WHERE es2.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO
          AND LTRIM(RTRIM(ISNULL(es2.FILIAL,''))) = LTRIM(RTRIM(ISNULL(s.FILIAL,'')))
      )
      AND (s.SAIDA_CANCELADA = 0 OR s.SAIDA_CANCELADA IS NULL)
      AND s.EMISSAO >= DATEADD(DAY,-90, GETDATE())
    ) x
  `);
  console.log("TOTAL saídas unificadas (90d, todas filiais):", totalUnificado.recordset[0].total, "| teto da query: 1000");

  await pool.close();
}

main().catch((e) => { console.error("Falhou:", e.message); process.exit(1); });
