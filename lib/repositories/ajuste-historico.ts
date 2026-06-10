import { query, withRequest } from '@/lib/db/connection';
import sql from 'mssql';

const TABLE = 'NERD_AJUSTE_HISTORICO';

export async function ensureAjusteTableExists(): Promise<void> {
  await query(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'${TABLE}') AND type = N'U')
    CREATE TABLE ${TABLE} (
      ID           INT IDENTITY(1,1) PRIMARY KEY,
      DATA_AJUSTE  DATETIME     NOT NULL DEFAULT GETDATE(),
      FILIAL       VARCHAR(100) NOT NULL,
      PRODUTO      VARCHAR(50)  NOT NULL,
      COR_PRODUTO  VARCHAR(50)  NOT NULL DEFAULT '',
      QTDE_AJUSTE  INT          NOT NULL,
      ROMANEIO_REF VARCHAR(50)  NULL,
      TIPO_AJUSTE  VARCHAR(100) NULL,
      RESPONSAVEL  VARCHAR(100) NULL,
      OBS          VARCHAR(500) NULL
    )
  `);
}

export interface AjusteItem {
  produto: string;
  cor: string;
  qtde: number;
}

export interface AjustePayload {
  filial: string;
  itens: AjusteItem[];
  romaneioRef?: string;
  tipoAjuste?: string;
  responsavel?: string;
  obs?: string;
}

export async function inserirAjuste(payload: AjustePayload): Promise<void> {
  await ensureAjusteTableExists();
  for (const item of payload.itens) {
    if (item.qtde === 0) continue;
    await withRequest(async (req) => {
      req.input('filial', sql.VarChar, payload.filial);
      req.input('produto', sql.VarChar, item.produto);
      req.input('cor', sql.VarChar, item.cor ?? '');
      req.input('qtde', sql.Int, item.qtde);
      req.input('romaneioRef', sql.VarChar, payload.romaneioRef ?? null);
      req.input('tipoAjuste', sql.VarChar, payload.tipoAjuste ?? null);
      req.input('responsavel', sql.VarChar, payload.responsavel ?? null);
      req.input('obs', sql.VarChar, payload.obs ?? null);
      await req.query(`
        INSERT INTO ${TABLE} (FILIAL, PRODUTO, COR_PRODUTO, QTDE_AJUSTE, ROMANEIO_REF, TIPO_AJUSTE, RESPONSAVEL, OBS)
        VALUES (@filial, @produto, @cor, @qtde, @romaneioRef, @tipoAjuste, @responsavel, @obs)
      `);
    });
  }
}

export interface AjusteHistoricoRow {
  ID: number;
  DATA_AJUSTE: Date;
  FILIAL: string;
  PRODUTO: string;
  COR_PRODUTO: string;
  QTDE_AJUSTE: number;
  ROMANEIO_REF: string | null;
  TIPO_AJUSTE: string | null;
  RESPONSAVEL: string | null;
  OBS: string | null;
}

export async function queryAjustesHistorico(
  produto: string,
  cor: string,
  filial?: string
): Promise<AjusteHistoricoRow[]> {
  try {
    const prodSql = produto.replace(/'/g, "''");
    const corSql = cor.replace(/'/g, "''");
    const filialFilter = filial
      ? `AND FILIAL LIKE '%${filial.replace(/'/g, "''")}%'`
      : '';
    return await query<AjusteHistoricoRow>(`
      SELECT * FROM ${TABLE} WITH (NOLOCK)
      WHERE PRODUTO = '${prodSql}'
        AND COR_PRODUTO = '${corSql}'
        ${filialFilter}
      ORDER BY DATA_AJUSTE
    `);
  } catch {
    return [];
  }
}
