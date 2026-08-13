import fs from 'fs';
import { neon } from '@neondatabase/serverless';

const env = fs.readFileSync('.env.local', 'utf8');
const sql = neon(env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1]);

const alvos = [
  'nerd.centernorte',
  'nerd.morumbi',
  'nerd.morumbi2',
  'nerd.villa',
  'nerd.higi',
  'nerd.leblon',
  'nerd.eldorado',
];

// Só gerentes NERD da lista, e só quem ainda não tem "vm" (idempotente).
const updated = await sql`
  update dashboard_users
  set permissions = permissions || '["vm"]'::jsonb
  where username = any(${alvos})
    and role = 'gerente'
    and not (permissions @> '["vm"]'::jsonb)
  returning username, permissions
`;

console.log('atualizados:', updated.length);
for (const r of updated) {
  console.log(`  ${r.username} -> ${JSON.stringify(r.permissions)}`);
}

// Conferência: ninguém fora da lista ganhou vm.
const comVm = await sql`
  select username, role, allowed_companies
  from dashboard_users
  where permissions @> '["vm"]'::jsonb
  order by role, username
`;
console.log('\ntodos com permissao vm agora:');
for (const r of comVm) {
  console.log(`  ${r.username} | ${r.role} | ${JSON.stringify(r.allowed_companies)}`);
}
