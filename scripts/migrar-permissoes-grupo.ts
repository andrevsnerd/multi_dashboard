/**
 * Converte as permissões de transferência (Neon: transferencia_permissoes) para o formato
 * por GRUPO: filial de grupo passa a ser gravada como `grupo:<id>` e, na leitura, vira a
 * perna ATIVA do grupo. Ver o topo de lib/utils/transferencia-permissoes-store.ts.
 *
 * Por padrão só SIMULA: mostra, por usuário, o que está gravado, o que seria gravado e a
 * filial que cada valor resolve hoje — antes e depois. Com a conversão, nenhuma filial
 * resolvida deveria mudar; se mudar, o script avisa e NÃO grava aquele usuário.
 *
 * Rode SÓ depois do deploy do código que entende `grupo:` — o código antigo não casa
 * esse formato e o usuário ficaria sem filial.
 *
 *   npx tsx --conditions=react-server scripts/migrar-permissoes-grupo.ts           # simula
 *   npx tsx --conditions=react-server scripts/migrar-permissoes-grupo.ts --apply   # grava
 */
import fs from 'fs';

// Carrega o .env.local (DATABASE_URL do Neon + Linx) antes de importar o store.
for (const linha of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

type Lista = 'filiaisOrigem' | 'filiaisDestino' | 'filiaisDestinoControle' | 'filiaisAdicionais';
const LISTAS: Lista[] = ['filiaisOrigem', 'filiaisDestino', 'filiaisDestinoControle', 'filiaisAdicionais'];

async function main() {
  const aplicar = process.argv.includes('--apply');
  const { getNeonSql } = await import('@/lib/db/neon');
  const store = await import('@/lib/utils/transferencia-permissoes-store');
  type Permissao = Awaited<ReturnType<typeof store.paraArmazenamento>>;

  const { FILIAIS, getFilialById } = await import('@/lib/config/filial-registry');
  const { idForFilialRef } = await import('@/lib/server/company-live');

  /**
   * Correção de ÉPOCA: nome de filial que ERA e-commerce (FilialDef.ecommerceUntil) num
   * cadastro salvo antes dessa data foi escolhido como E-COMMERCE — ex.: "MSC COMERCIO DE
   * LENCOS LT" gravado em abril/2026. Lido hoje, cairia na Higienópolis (papel atual da MSC).
   */
  const corrigirEpoca = async (valor: string, salvoEm: string): Promise<string> => {
    const raw = (valor || '').trim();
    if (!raw || store.isGrupoRef(raw) || /^\d+$/.test(raw) || raw.toUpperCase() === 'TODAS') return raw;
    const def = getFilialById(await idForFilialRef(raw));
    if (!def?.ecommerceUntil || !salvoEm || salvoEm >= def.ecommerceUntil) return raw;
    const grupoEcom = FILIAIS.find((f) => f.company === def.company && f.ecommerce && f.group)?.group;
    return grupoEcom ? `${store.GRUPO_REF_PREFIX}${grupoEcom}` : raw;
  };

  const sql = getNeonSql();
  const rows = await sql`
    SELECT username, to_char(updated_at, 'YYYY-MM-DD') AS salvo_em, filiais_origem, filiais_destino,
           COALESCE(filiais_destino_controle, '[]'::jsonb) AS filiais_destino_controle,
           COALESCE(filiais_adicionais, '[]'::jsonb) AS filiais_adicionais,
           tipos_romaneio_permitidos, responsavel_padrao, tipo_romaneio_padrao,
           responsavel_fixo, tipo_romaneio_fixo,
           COALESCE(pode_ver_outras_filiais, false) AS pode_ver_outras_filiais,
           filial_atribuida
    FROM transferencia_permissoes ORDER BY username`;

  let alterados = 0;
  let bloqueados = 0;
  for (const r of rows) {
    const bruto: Permissao = {
      username: r.username,
      filiaisOrigem: r.filiais_origem || [],
      filiaisDestino: r.filiais_destino || [],
      filiaisDestinoControle: r.filiais_destino_controle || [],
      filiaisAdicionais: r.filiais_adicionais || [],
      tiposRomaneioPermitidos: r.tipos_romaneio_permitidos || [],
      responsavelPadrao: r.responsavel_padrao || undefined,
      tipoRomaneioPadrao: r.tipo_romaneio_padrao || undefined,
      responsavelFixo: r.responsavel_fixo || false,
      tipoRomaneioFixo: r.tipo_romaneio_fixo || false,
      podeVerOutrasFiliais: r.pode_ver_outras_filiais === true,
      filialAtribuida: r.filial_atribuida != null ? String(r.filial_atribuida).trim() || null : null,
    };

    // Intenção do cadastro: o bruto com a correção de época aplicada.
    const salvoEm = String(r.salvo_em || '');
    const correcoes: string[] = [];
    const corrigir = async (v: string) => {
      const c = await corrigirEpoca(v, salvoEm);
      if (c !== v.trim()) correcoes.push(`"${v.trim()}" (salvo em ${salvoEm}) → ${c}`);
      return c;
    };
    const intencao: Permissao = { ...bruto };
    for (const k of LISTAS) intencao[k] = await Promise.all((bruto[k] ?? []).map(corrigir));
    intencao.filialAtribuida = bruto.filialAtribuida ? await corrigir(bruto.filialAtribuida) : null;

    const novo = await store.paraArmazenamento(intencao);
    // A conversão para grupo não pode mudar a filial resolvida da INTENÇÃO; só a correção
    // de época muda (de propósito) o que o usuário vê hoje.
    const resolvidoAntes = await store.normalizePermissao(intencao);
    const resolvidoDepois = await store.normalizePermissao(novo);

    const mudouGravado =
      LISTAS.some((k) => JSON.stringify(bruto[k]) !== JSON.stringify(novo[k])) ||
      (bruto.filialAtribuida ?? null) !== (novo.filialAtribuida ?? null);
    if (!mudouGravado) continue;
    alterados++;

    const chave = (p: Permissao) =>
      JSON.stringify([...LISTAS.map((k) => [...(p[k] ?? [])].sort()), p.filialAtribuida ?? null]);
    const mudouResolvido = chave(resolvidoAntes) !== chave(resolvidoDepois);

    console.log(`\n── ${r.username}${mudouResolvido ? '   ⚠ A FILIAL RESOLVIDA MUDA — não grava' : ''}`);
    for (const c of correcoes) console.log(`  ✱ correção de época: ${c}`);
    const mostrar = (rotulo: string, antes: unknown, depois: unknown, resolvido: unknown) => {
      if (JSON.stringify(antes) === JSON.stringify(depois)) return;
      console.log(`  ${rotulo}`);
      console.log(`    gravado : ${JSON.stringify(antes)}`);
      console.log(`    novo    : ${JSON.stringify(depois)}`);
      console.log(`    resolve : ${JSON.stringify(resolvido)}`);
    };
    mostrar('filialAtribuida', bruto.filialAtribuida, novo.filialAtribuida, resolvidoDepois.filialAtribuida);
    for (const k of LISTAS) mostrar(k, bruto[k], novo[k], resolvidoDepois[k]);

    if (mudouResolvido) {
      bloqueados++;
      console.log(`    antes resolvia: ${chave(resolvidoAntes)}`);
      console.log(`    depois resolve: ${chave(resolvidoDepois)}`);
      continue;
    }
    if (aplicar) {
      await store.savePermissao(novo);
      console.log('  ✔ gravado');
    }
  }

  console.log(
    `\n${rows.length} usuários · ${alterados} com filial de grupo` +
      (bloqueados ? ` · ${bloqueados} bloqueados (resolução mudaria)` : '') +
      (aplicar ? ' · gravado' : ' · SIMULAÇÃO (use --apply para gravar)')
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
