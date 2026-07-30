/**
 * Normaliza o RESPONSAVEL histórico de NERD_AJUSTE_HISTORICO para o usuário do LINX
 * atrelado a cada login do dashboard (transferencia_permissoes.responsavel_padrao).
 *
 * Motivo: até hoje algumas rotas gravavam o login do dashboard ("andre.sabetta") em vez
 * do login do Linx ("ANDRE.SABETTA"), e é isso que aparece na coluna Responsável do
 * Extrato de Produto. O código já foi corrigido (lib/server/responsavel-linx.ts); este
 * script arruma o que ficou gravado antes.
 *
 * Mexe SÓ na nossa tabela de auditoria — nunca em tabela do Linx.
 *
 * Uso:
 *   node scripts/normalizar-responsavel-linx.mjs           # dry-run
 *   node scripts/normalizar-responsavel-linx.mjs --apply   # aplica
 */
import sql from 'mssql';
import fs from 'fs';
import { neon } from '@neondatabase/serverless';

const APPLY = process.argv.includes('--apply');

const envRaw = fs.readFileSync('c:/NERD/multi_dashboard/.env.local', 'utf8');
const envVar = (name) => {
  const m = envRaw.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
};
const base = {
  database: envVar('DB_DATABASE'), user: envVar('DB_USERNAME'), password: envVar('DB_PASSWORD'),
  port: Number(envVar('DB_PORT') || 1433),
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 180000, connectionTimeout: 30000,
};
const q = async (pool, text) => (await pool.request().query(text)).recordset;
const head = (t) => console.log(`\n${'═'.repeat(88)}\n${t}\n${'═'.repeat(88)}`);

async function connect() {
  let last;
  for (const server of [envVar('DB_SERVER'), '189.126.197.82']) {
    try { const p = await sql.connect({ ...base, server }); console.log(`✅ SQL Server: ${server}`); return p; }
    catch (e) { console.log(`❌ ${server}: ${e.message}`); last = e; }
  }
  throw last;
}

async function main() {
  console.log(APPLY ? '⚠️  MODO APPLY' : '🔍 DRY-RUN — nada será escrito');

  // Vínculo login do dashboard → usuário do Linx (mesma fonte que o app usa).
  const dbUrl = envVar('DATABASE_URL');
  if (!dbUrl) { console.error('DATABASE_URL não encontrada no .env.local'); process.exit(1); }
  const neonSql = neon(dbUrl);
  const vinculos = await neonSql`
    SELECT username, responsavel_padrao FROM transferencia_permissoes
    WHERE responsavel_padrao IS NOT NULL AND TRIM(responsavel_padrao) <> ''`;
  const mapa = new Map(vinculos.map((v) => [v.username.trim().toLowerCase(), v.responsavel_padrao.trim()]));
  console.log(`vínculos cadastrados: ${mapa.size}`);

  const pool = await connect();

  head('Responsáveis gravados hoje em NERD_AJUSTE_HISTORICO');
  const atuais = await q(pool, `
    SELECT LTRIM(RTRIM(ISNULL(RESPONSAVEL,''))) AS RESP, COUNT(*) AS N
    FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
    GROUP BY LTRIM(RTRIM(ISNULL(RESPONSAVEL,''))) ORDER BY N DESC`);

  const plano = atuais.map((r) => {
    const alvo = mapa.get(r.RESP.toLowerCase());
    return {
      RESPONSAVEL: r.RESP || '(vazio)',
      LINHAS: r.N,
      VIRA: alvo && alvo !== r.RESP ? alvo : '—',
      ACAO: !alvo ? 'sem vínculo (mantém)' : alvo === r.RESP ? 'já correto' : 'CORRIGE',
    };
  });
  console.table(plano);

  const corrigir = plano.filter((p) => p.ACAO === 'CORRIGE');
  const totalLinhas = corrigir.reduce((s, p) => s + p.LINHAS, 0);
  console.log(`\na corrigir: ${corrigir.length} responsável(is), ${totalLinhas} linha(s)`);

  if (!APPLY || corrigir.length === 0) {
    console.log(corrigir.length === 0 ? '\nnada a fazer.' : '\n🔍 DRY-RUN. Rode com --apply para efetivar.');
    await pool.close();
    return;
  }

  for (const p of corrigir) {
    const de = p.RESPONSAVEL.replace(/'/g, "''");
    const para = p.VIRA.replace(/'/g, "''");
    const r = await q(pool, `
      UPDATE NERD_AJUSTE_HISTORICO
      SET RESPONSAVEL = '${para}'
      WHERE LTRIM(RTRIM(ISNULL(RESPONSAVEL,''))) = '${de}'
        AND RESPONSAVEL COLLATE Latin1_General_CS_AS <> '${para}';
      SELECT @@ROWCOUNT AS N`);
    console.log(`  ${p.RESPONSAVEL} → ${p.VIRA}: ${r[0].N} linha(s)`);
  }

  head('Depois');
  console.table(await q(pool, `
    SELECT LTRIM(RTRIM(ISNULL(RESPONSAVEL,''))) AS RESP, COUNT(*) AS N
    FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
    GROUP BY LTRIM(RTRIM(ISNULL(RESPONSAVEL,''))) ORDER BY N DESC`));

  await pool.close();
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
