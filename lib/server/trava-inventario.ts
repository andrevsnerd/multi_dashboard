import { query } from '@/lib/db/connection';
import { getActiveFilial } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { parseRomaneioDateTime } from '@/lib/utils/romaneios-date';
import {
  getTravasInventario,
  type TravaInventarioFilial,
} from '@/lib/utils/trava-inventario-store';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TRAVA DE INVENTÁRIO — romaneio anterior ao inventário não se confirma.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Depois do inventário, o estoque da filial é o que foi CONTADO. Um romaneio
 * emitido antes disso e confirmado depois soma de novo peça que já estava (ou que
 * nunca chegou) na contagem — infla o estoque.
 *
 * A trava é MANUAL: o admin aplica por filial na página Romaneios (normalmente com
 * a data do último inventário INV...), e ela vale até ele remover. Regra:
 *
 *   filial de DESTINO travada  e  dia do romaneio < data de corte  →  só consulta.
 *
 * Conferir uma confirmação NÃO consulta o Linx: lê as travas salvas (Neon, em
 * cache) e compara com a data do romaneio que a tela já tem. O Linx só é lido
 * quando o admin pede a lista de inventários (`listarUltimosInventariosLinx`).
 */

export type { TravaInventarioFilial };

export interface TravaInventario {
  trava: TravaInventarioFilial;
  /** Dia do romaneio, YYYY-MM-DD. Vazio quando a data não veio. */
  dataRomaneio: string;
}

function normFilial(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Dia (YYYY-MM-DD, horário de Brasília) de uma data de romaneio vinda da tela. */
export function diaDoRomaneio(value: string | null | undefined): string {
  const parsed = parseRomaneioDateTime(value || '');
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Trava aplicada na filial (como veio ou na perna ATIVA do grupo), ou null. */
export async function travaDaFilial(
  companyKey: string | null | undefined,
  filial: string
): Promise<TravaInventarioFilial | null> {
  const raw = (filial || '').trim();
  if (!raw) return null;

  const keys = companyKey ? [companyKey] : ['nerd', 'scarfme'];
  for (const key of keys) {
    const travas = await getTravasInventario(key);
    if (travas.length === 0) continue;
    const company = await resolveCompanyDynamic(key);
    const candidatos = new Set([normFilial(raw)]);
    if (company) candidatos.add(normFilial(getActiveFilial(company, raw)));
    const achou = travas.find(
      (t) => candidatos.has(normFilial(t.filial)) || (t.codFilial && candidatos.has(normFilial(t.codFilial)))
    );
    if (achou) return achou;
  }
  return null;
}

/**
 * O romaneio está travado? `null` = pode confirmar.
 * Filial travada sem data do romaneio → trava (na dúvida, não deixa confirmar).
 */
export async function verificarTravaInventario(params: {
  companyKey?: string | null;
  filialDestino: string;
  dataRomaneio?: string | null;
}): Promise<TravaInventario | null> {
  const trava = await travaDaFilial(params.companyKey, params.filialDestino);
  if (!trava) return null;
  const dataRomaneio = diaDoRomaneio(params.dataRomaneio);
  if (dataRomaneio && dataRomaneio >= trava.dataCorte) return null;
  return { trava, dataRomaneio };
}

function fmtDia(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Mensagem única do bloqueio — usada na API e na tela. */
export function mensagemTravaInventario(t: TravaInventario): string {
  const origem = t.trava.inventarioNome ? ` (inventário ${t.trava.inventarioNome})` : '';
  const data = t.dataRomaneio ? `de ${fmtDia(t.dataRomaneio)} ` : '';
  return (
    `${t.trava.filial} está travada para romaneios anteriores a ${fmtDia(t.trava.dataCorte)}${origem}. ` +
    `Este romaneio ${data}fica só para consulta: confirmar agora somaria ao estoque peças que o inventário já contou.`
  );
}

export interface InventarioLinx {
  filial: string;
  codFilial: string | null;
  nome: string;
  /** YYYY-MM-DD, como gravado no Linx. */
  data: string;
}

/**
 * Último inventário (ajuste com descrição INV...) de cada filial, direto do Linx.
 * Só roda quando o admin abre a lista na página Romaneios — nunca na confirmação.
 */
export async function listarUltimosInventariosLinx(): Promise<InventarioLinx[]> {
  const rows = await query<{ FILIAL: string; COD_FILIAL: string | null; NOME: string; DATA: string }>(`
    SELECT x.FILIAL, x.COD_FILIAL, x.NOME, x.DATA
      FROM (
        SELECT RTRIM(c.FILIAL) AS FILIAL,
               RTRIM(f.COD_FILIAL) AS COD_FILIAL,
               RTRIM(c.NOME_CONTAGEM) AS NOME,
               CONVERT(CHAR(10), c.EMISSAO, 23) AS DATA,
               ROW_NUMBER() OVER (PARTITION BY c.FILIAL ORDER BY c.EMISSAO DESC) AS RN
          FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
          LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.FILIAL = c.FILIAL
         WHERE c.ESTOQUE_AJUSTADO = 1
           AND c.NOME_CONTAGEM LIKE 'INV%'
      ) x
     WHERE x.RN = 1
     ORDER BY x.DATA DESC, x.FILIAL
  `);
  return rows
    .map((r) => ({
      filial: (r.FILIAL || '').trim(),
      codFilial: r.COD_FILIAL ? r.COD_FILIAL.trim() : null,
      nome: (r.NOME || '').trim(),
      data: (r.DATA || '').trim(),
    }))
    .filter((r) => r.filial && r.data);
}
