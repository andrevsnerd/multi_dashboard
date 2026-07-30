import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';

import { findUserByUsername } from '@/lib/auth/users-store';
import { withRequest } from '@/lib/db/connection';
import { inserirAjuste } from '@/lib/repositories/ajuste-historico';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { getContadorConfirmadosByCompany } from '@/lib/utils/romaneio-confirmacao-store';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { hasPostgres } from '@/lib/db/neon';

/**
 * Limpeza segura de romaneios de SAÍDA duplicados (transferência / defeito / saída MKT).
 *
 * Regra: dois+ romaneios de saída com MESMA origem+destino+responsável e o MESMO
 * conjunto de itens (produto+cor+qtde), emitidos dentro de uma janela curta, são
 * tratados como duplicata do mesmo envio. Mantemos UM e removemos os extras —
 * MAS nunca removemos um romaneio cuja entrada a loja de destino já confirmou
 * (fonte: Neon `romaneio_item_confirmado`, chaveado pelo romaneio de saída).
 * Remover = idêntico ao botão da lixeira (modo=retornar): devolve o estoque à
 * origem (+qtde) e apaga os registros da saída. Nada é tocado no destino.
 *
 * GET  = DRY-RUN (só relatório, zero escrita).
 * POST = executa a remoção da lista explícita enviada (re-checando confirmação).
 * Somente admin.
 */

interface ItemSaida {
  produto: string;
  cor: string;
  qtde: number;
}
interface RomaneioSaida {
  romaneio: string;
  origem: string;
  destino: string;
  responsavel: string;
  tipo: string;
  emissao: string;
  emissaoMs: number;
  itens: ItemSaida[];
  assinatura: string;
}
type MembroPlano = RomaneioSaida & { confirmado: boolean; acao: 'MANTER' | 'REMOVER' };
interface GrupoPlano {
  chave: string;
  origem: string;
  destino: string;
  responsavel: string;
  assinatura: string;
  membros: MembroPlano[];
}

async function requireAdmin(request: NextRequest): Promise<{ ok: true; username: string } | { ok: false; res: NextResponse }> {
  const username = request.headers.get('x-auth-username')?.trim() || '';
  const user = username ? await findUserByUsername(username) : null;
  if (!user || user.role !== 'admin') {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Acesso negado. Apenas administradores.' },
        { status: 403 }
      ),
    };
  }
  return { ok: true, username };
}

const TIPOS_PADRAO = ['TRANSFERENCIA ENTRE LOJAS', 'TRANSFERENCIA', 'DEFEITO', 'SAÍDA MKT', 'SAIDA MKT'];

function assinaturaDosItens(itens: ItemSaida[]): string {
  return itens
    .map((i) => `${i.produto}:${i.cor}:${i.qtde}`)
    .sort()
    .join('|');
}

/** Set de romaneios (de saída) que possuem QUALQUER confirmação da loja de destino. */
async function getRomaneiosConfirmados(company: string): Promise<Set<string>> {
  const contador = await getContadorConfirmadosByCompany(company);
  const set = new Set<string>();
  for (const chave of contador.keys()) {
    const romaneio = String(chave).split('|')[0]?.trim();
    if (romaneio) set.add(romaneio);
  }
  return set;
}

/** Lê os romaneios de saída (com itens) na janela e monta a estrutura agrupável. */
async function lerSaidas(dias: number, tipos: string[], origensPermitidas: Set<string> | null): Promise<RomaneioSaida[]> {
  const rows = await withRequest(async (req) => {
    req.input('dias', sql.Int, dias);
    const result = await req.query<{
      ROMANEIO: string;
      ORIGEM: string;
      DESTINO: string;
      RESP: string;
      TIPO: string;
      EMISSAO: string;
      PRODUTO: string;
      COR: string;
      QTDE: number;
    }>(`
      SELECT
        LTRIM(RTRIM(s.ROMANEIO_PRODUTO)) AS ROMANEIO,
        LTRIM(RTRIM(ISNULL(s.FILIAL, ''))) AS ORIGEM,
        LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) AS DESTINO,
        LTRIM(RTRIM(ISNULL(s.RESPONSAVEL, ''))) AS RESP,
        LTRIM(RTRIM(ISNULL(s.TIPO_ROMANEIO, ''))) AS TIPO,
        CONVERT(VARCHAR(19), s.EMISSAO, 120) AS EMISSAO,
        LTRIM(RTRIM(ISNULL(i.PRODUTO, ''))) AS PRODUTO,
        LTRIM(RTRIM(ISNULL(i.COR_PRODUTO, ''))) AS COR,
        SUM(ISNULL(i.QTDE, 0)) AS QTDE
      FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
      JOIN ESTOQUE_PROD1_SAI i WITH (NOLOCK)
        ON i.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO
        AND LTRIM(RTRIM(i.FILIAL)) = LTRIM(RTRIM(s.FILIAL))
      WHERE s.EMISSAO >= DATEADD(DAY, -@dias, GETDATE())
      GROUP BY s.ROMANEIO_PRODUTO, s.FILIAL, s.FILIAL_DESTINO, s.RESPONSAVEL, s.TIPO_ROMANEIO, s.EMISSAO, i.PRODUTO, i.COR_PRODUTO
      ORDER BY s.EMISSAO ASC
    `);
    return result.recordset;
  });

  const tiposUpper = new Set(tipos.map((t) => t.toUpperCase()));
  const porRomaneio = new Map<string, RomaneioSaida>();
  for (const r of rows) {
    const tipo = (r.TIPO || '').toUpperCase();
    if (tiposUpper.size > 0 && !tiposUpper.has(tipo)) continue;
    if (origensPermitidas && !origensPermitidas.has((r.ORIGEM || '').toUpperCase())) continue;

    // Chave única por (romaneio + origem) — ESTOQUE_PROD_SAI.FILIAL é o nome da origem.
    const key = `${r.ROMANEIO}||${r.ORIGEM}`;
    let rom = porRomaneio.get(key);
    if (!rom) {
      const ms = new Date(r.EMISSAO.replace(' ', 'T')).getTime();
      rom = {
        romaneio: r.ROMANEIO,
        origem: r.ORIGEM,
        destino: r.DESTINO,
        responsavel: r.RESP,
        tipo: r.TIPO,
        emissao: r.EMISSAO,
        emissaoMs: Number.isNaN(ms) ? 0 : ms,
        itens: [],
        assinatura: '',
      };
      porRomaneio.set(key, rom);
    }
    rom.itens.push({ produto: r.PRODUTO, cor: r.COR, qtde: Number(r.QTDE) || 0 });
  }

  const lista = [...porRomaneio.values()];
  for (const rom of lista) rom.assinatura = assinaturaDosItens(rom.itens);
  return lista;
}

/** Agrupa em clusters de duplicatas e decide manter/remover. */
function montarPlano(saidas: RomaneioSaida[], windowMin: number, confirmados: Set<string>): GrupoPlano[] {
  const janelaMs = windowMin * 60 * 1000;

  // Agrupa por origem+destino+responsável+assinatura de itens.
  const buckets = new Map<string, RomaneioSaida[]>();
  for (const s of saidas) {
    const k = `${s.origem}||${s.destino}||${s.responsavel}||${s.assinatura}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(s);
  }

  const grupos: GrupoPlano[] = [];
  for (const [, membros] of buckets) {
    if (membros.length < 2) continue;
    membros.sort((a, b) => a.emissaoMs - b.emissaoMs);

    // Clusteriza por proximidade temporal (gap ao anterior <= janela).
    let cluster: RomaneioSaida[] = [];
    const flush = () => {
      if (cluster.length >= 2) grupos.push(finalizarGrupo(cluster, confirmados));
      cluster = [];
    };
    for (const m of membros) {
      if (cluster.length === 0) {
        cluster.push(m);
      } else {
        const gap = m.emissaoMs - cluster[cluster.length - 1].emissaoMs;
        if (gap >= 0 && gap <= janelaMs) cluster.push(m);
        else {
          flush();
          cluster.push(m);
        }
      }
    }
    flush();
  }
  return grupos;
}

function finalizarGrupo(cluster: RomaneioSaida[], confirmados: Set<string>): GrupoPlano {
  const confirmadosNoGrupo = cluster.filter((m) => confirmados.has(m.romaneio));
  const primeiro = cluster[0]; // mais antigo (já ordenado asc)

  const membros: MembroPlano[] = cluster.map((m) => {
    const confirmado = confirmados.has(m.romaneio);
    let acao: 'MANTER' | 'REMOVER';
    if (confirmadosNoGrupo.length >= 1) {
      // Mantém os confirmados; remove só os NÃO confirmados.
      acao = confirmado ? 'MANTER' : 'REMOVER';
    } else {
      // Nenhum confirmado: mantém o mais antigo, remove os demais.
      acao = m.romaneio === primeiro.romaneio ? 'MANTER' : 'REMOVER';
    }
    return { ...m, confirmado, acao };
  });

  return {
    chave: `${primeiro.origem}||${primeiro.destino}||${primeiro.responsavel}||${primeiro.assinatura}`,
    origem: primeiro.origem,
    destino: primeiro.destino,
    responsavel: primeiro.responsavel,
    assinatura: primeiro.assinatura,
    membros,
  };
}

function parseParams(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const company = (sp.get('company') || 'scarfme').trim();
  const dias = Math.min(Math.max(parseInt(sp.get('dias') || '60', 10) || 60, 1), 365);
  const windowMin = Math.min(Math.max(parseInt(sp.get('windowMin') || '15', 10) || 15, 1), 120);
  const tiposParam = sp.get('tipos');
  const tipos = tiposParam ? tiposParam.split(',').map((t) => t.trim()).filter(Boolean) : TIPOS_PADRAO;
  return { company, dias, windowMin, tipos };
}

async function origensDaCompany(company: string): Promise<Set<string> | null> {
  const cfg = await resolveCompanyDynamic(company);
  const inv = cfg?.filialFilters?.inventory ?? [];
  if (!inv.length) return null;
  return new Set(inv.map((f) => (f || '').trim().toUpperCase()).filter(Boolean));
}

/** GET — DRY-RUN: apenas relatório, não escreve nada. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.res;

  try {
    const { company, dias, windowMin, tipos } = parseParams(request);
    const origens = await origensDaCompany(company);
    const [saidas, confirmados] = await Promise.all([
      lerSaidas(dias, tipos, origens),
      getRomaneiosConfirmados(company),
    ]);
    const grupos = montarPlano(saidas, windowMin, confirmados);

    const remover = grupos.flatMap((g) => g.membros.filter((m) => m.acao === 'REMOVER'));
    const gruposComRemocao = grupos.filter((g) => g.membros.some((m) => m.acao === 'REMOVER'));
    const gruposTodosConfirmados = grupos.filter((g) => g.membros.every((m) => m.confirmado));

    return NextResponse.json({
      dryRun: true,
      company,
      // Transparência: de onde vêm as confirmações. Se não for 'neon', a proteção
      // de "não apagar confirmado" NÃO é confiável e a execução (POST) é bloqueada.
      fonteConfirmacao: hasPostgres() ? 'neon' : 'arquivo-local (NAO CONFIAVEL — execucao sera bloqueada)',
      parametros: { dias, windowMin, tipos },
      resumo: {
        gruposDuplicados: grupos.length,
        gruposComRemocao: gruposComRemocao.length,
        romaneiosARemover: remover.length,
        gruposTodosConfirmados: gruposTodosConfirmados.length,
      },
      // Lista pronta para reenviar no POST (execução).
      removerSugerido: remover.map((m) => ({ romaneio: m.romaneio, filial: m.origem, tipo: m.tipo })),
      grupos,
    });
  } catch (error) {
    console.error('[transferencias-duplicadas][GET]', error);
    return NextResponse.json({ error: 'Erro ao gerar prévia de duplicatas' }, { status: 500 });
  }
}

/** Reverte (devolve à origem) e apaga UM romaneio de saída — idêntico ao botão da lixeira. */
async function reverterEExcluirSaida(romaneio: string, filial: string): Promise<ItemSaida[]> {
  // Lê itens ANTES de apagar (para auditoria e retorno).
  const itens = await withRequest(async (req) => {
    req.input('romaneio', sql.VarChar, romaneio);
    req.input('filial', sql.VarChar, filial);
    const r = await req.query<{ PRODUTO: string; COR: string; QTDE: number }>(`
      SELECT PRODUTO, ISNULL(COR_PRODUTO, '') AS COR, SUM(ISNULL(QTDE, 0)) AS QTDE
      FROM ESTOQUE_PROD1_SAI WITH (NOLOCK)
      WHERE ROMANEIO_PRODUTO = @romaneio AND LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filial))
      GROUP BY PRODUTO, ISNULL(COR_PRODUTO, '')
    `);
    return r.recordset.map((x) => ({ produto: (x.PRODUTO || '').trim(), cor: (x.COR || '').trim(), qtde: Number(x.QTDE) || 0 }));
  });

  await withRequest(async (req) => {
    req.input('romaneio', sql.VarChar, romaneio);
    req.input('filial', sql.VarChar, filial);

    // 1) Devolve o estoque à origem (+qtde) — igual ao modo=retornar da lixeira.
    await req.query(`
      UPDATE ep
      SET ep.ESTOQUE = ep.ESTOQUE + agg.QTDE
      FROM ESTOQUE_PRODUTOS ep
      INNER JOIN FILIAIS f WITH (NOLOCK)
        ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
      INNER JOIN (
        SELECT PRODUTO, ISNULL(COR_PRODUTO, '') AS COR, SUM(ISNULL(QTDE, 0)) AS QTDE
        FROM ESTOQUE_PROD1_SAI WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = @romaneio AND LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filial))
        GROUP BY PRODUTO, ISNULL(COR_PRODUTO, '')
      ) agg
        ON ep.PRODUTO = agg.PRODUTO AND ISNULL(ep.COR_PRODUTO, '') = agg.COR
      WHERE (LTRIM(RTRIM(f.COD_FILIAL)) = LTRIM(RTRIM(@filial))
             OR LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(@filial)))
    `);

    // 2) Apaga os registros da saída (mesma ordem/tabelas da rota da lixeira).
    await req.query(`DELETE FROM ESTOQUE_PROD1_SAI WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial`);
    await req.query(`DELETE FROM LOJA_SAIDAS_PRODUTO WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial`);
    await req.query(`DELETE FROM LOJA_SAIDAS WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial`);
    await req.query(`DELETE FROM ESTOQUE_PROD_SAI WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial`);
  });

  return itens;
}

/** POST — executa a remoção da lista explícita (re-checando confirmação). */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.res;

  try {
    const body = (await request.json()) as {
      company?: string;
      confirm?: boolean;
      remover?: Array<{ romaneio: string; filial: string }>;
    };
    const company = (body.company || 'scarfme').trim();
    const remover = Array.isArray(body.remover) ? body.remover : [];

    // TRAVA CRÍTICA: sem Neon, não conseguimos verificar de forma confiável quais
    // romaneios a loja confirmou — então a execução é PROIBIDA (evita apagar um
    // romaneio confirmado por engano). Só roda onde as confirmações são reais.
    if (!hasPostgres()) {
      return NextResponse.json(
        { error: 'Confirmações não disponíveis (Neon não configurado neste ambiente). Execução bloqueada por segurança. Rode em produção.' },
        { status: 409 }
      );
    }
    if (body.confirm !== true) {
      return NextResponse.json({ error: 'Faltou confirm:true — execução abortada por segurança.' }, { status: 400 });
    }
    if (remover.length === 0) {
      return NextResponse.json({ error: 'Lista "remover" vazia.' }, { status: 400 });
    }

    // Re-checa confirmação AGORA (a loja pode ter confirmado após a prévia).
    const confirmados = await getRomaneiosConfirmados(company);

    const removidos: Array<{ romaneio: string; filial: string; itens: ItemSaida[] }> = [];
    const pulados: Array<{ romaneio: string; filial: string; motivo: string }> = [];

    // Resolvido uma vez: o vínculo não muda no meio do lote.
    const responsavelLinx = await resolveResponsavelLinx(auth.username);

    for (const alvo of remover) {
      const romaneio = (alvo.romaneio || '').trim();
      const filial = (alvo.filial || '').trim();
      if (!romaneio || !filial) {
        pulados.push({ romaneio, filial, motivo: 'dados incompletos' });
        continue;
      }
      if (confirmados.has(romaneio)) {
        pulados.push({ romaneio, filial, motivo: 'confirmado pela loja (não removido)' });
        continue;
      }

      // Verifica que o romaneio ainda existe (itens presentes) antes de mexer.
      const existe = await withRequest(async (req) => {
        req.input('romaneio', sql.VarChar, romaneio);
        req.input('filial', sql.VarChar, filial);
        const r = await req.query<{ TOTAL: number }>(`
          SELECT COUNT(*) AS TOTAL FROM ESTOQUE_PROD1_SAI WITH (NOLOCK)
          WHERE ROMANEIO_PRODUTO = @romaneio AND LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filial))
        `);
        return (r.recordset[0]?.TOTAL || 0) > 0;
      });
      if (!existe) {
        pulados.push({ romaneio, filial, motivo: 'romaneio inexistente ou já removido' });
        continue;
      }

      const itens = await reverterEExcluirSaida(romaneio, filial);
      removidos.push({ romaneio, filial, itens });

      // Auditoria (não-bloqueante): devolução à origem (+qtd), igual à lixeira.
      inserirAjuste({
        filial,
        itens: itens.map((i) => ({ produto: i.produto, cor: i.cor, qtde: i.qtde })),
        romaneioRef: romaneio,
        tipoAjuste: 'EXCLUSAO_DUPLICADA_SAIDA',
        responsavel: responsavelLinx,
        obs: `Duplicata removida (retorno à origem). Romaneio ${romaneio} / ${filial}.`,
      }).catch((err) => console.error('[transferencias-duplicadas] auditoria falhou:', err));
    }

    return NextResponse.json({
      success: true,
      company,
      removidosCount: removidos.length,
      puladosCount: pulados.length,
      removidos,
      pulados,
    });
  } catch (error) {
    console.error('[transferencias-duplicadas][POST]', error);
    return NextResponse.json({ error: 'Erro ao executar remoção de duplicatas' }, { status: 500 });
  }
}
