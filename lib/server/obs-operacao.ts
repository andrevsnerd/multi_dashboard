import { withRequest } from '@/lib/db/connection';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  OBS DOS ROMANEIOS — toda operação do dashboard fica documentada no Linx.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Decisão do dono (14/10/2026): o OBS do cabeçalho do romaneio (ESTOQUE_PROD_SAI /
 * ESTOQUE_PROD_ENT e LOJA_SAIDAS / LOJA_ENTRADAS) é o que aparece no Extrato de
 * Produto. Todo romaneio que o dashboard cria leva um bloco padrão — de onde veio,
 * para onde foi, referência, quantidade, tela, quem e quando — e toda operação
 * posterior (conferência, acréscimo de item, correção) acrescenta uma linha no
 * romaneio mexido.
 *
 * O item do romaneio não tem OBS no Linx (só o cabeçalho), então o detalhe por
 * item, quando importa, vai em linhas dentro do OBS do cabeçalho.
 *
 * Marcadores que outras partes procuram por LIKE (ex.: "REF SAIDA <rom>/<origem>"
 * da trava de entrada duplicada) continuam no texto — este bloco só acrescenta.
 */

export { agoraBrasil, montarObsOperacao, descreverItens } from '@/lib/utils/obs-operacao-texto';
export type { ObsOperacaoParams } from '@/lib/utils/obs-operacao-texto';

function lit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Acrescenta uma linha ao OBS de um romaneio que já existe (cabeçalho do ERP e da
 * loja). Best-effort: documentação não pode derrubar a operação que já foi feita,
 * então falha aqui é só logada.
 */
export async function anotarObsRomaneio(p: {
  tipo: 'saida' | 'entrada';
  romaneio: string;
  filial: string;
  linha: string;
}): Promise<void> {
  const romaneio = (p.romaneio || '').trim();
  const filial = (p.filial || '').trim();
  const linha = (p.linha || '').trim();
  if (!romaneio || !filial || !linha) return;
  const cab = p.tipo === 'saida' ? 'ESTOQUE_PROD_SAI' : 'ESTOQUE_PROD_ENT';
  const loja = p.tipo === 'saida' ? 'LOJA_SAIDAS' : 'LOJA_ENTRADAS';
  const filialSql = `(SELECT TOP 1 FILIAL FROM FILIAIS WITH (NOLOCK) WHERE LTRIM(RTRIM(FILIAL)) = ${lit(filial)} OR LTRIM(RTRIM(COD_FILIAL)) = ${lit(filial)})`;
  const novo = (col: string) =>
    `CASE WHEN ISNULL(DATALENGTH(${col}), 0) = 0 THEN ${lit(linha)} ELSE CAST(${col} AS VARCHAR(MAX)) + CHAR(13) + CHAR(10) + ${lit(linha)} END`;
  try {
    await withRequest(async (req) => {
      await req.query(`
        UPDATE ${cab} SET OBS = ${novo('OBS')}
         WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = ${lit(romaneio)} AND FILIAL = ${filialSql};
        UPDATE ${loja} SET OBS = ${novo('OBS')}
         WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = ${lit(romaneio)} AND FILIAL = ${filialSql};
      `);
    });
  } catch (e) {
    console.error('[obs-operacao] não deu para anotar o romaneio', romaneio, filial, e);
  }
}
