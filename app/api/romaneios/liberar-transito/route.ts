import { NextResponse } from "next/server";
import { getConnectionPool } from "@/lib/db/connection";
import { ProxyPool, shouldUseProxy } from "@/lib/db/proxy";

interface LiberarTransitoRequest {
  romaneio: string;
  filialDestino: string;
  filialOrigem?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LiberarTransitoRequest;
    const romaneio = body.romaneio?.trim() || "";
    const filialDestino = body.filialDestino?.trim() || "";
    const filialOrigem = body.filialOrigem?.trim() || "";

    if (!romaneio || !filialDestino) {
      return NextResponse.json(
        { error: "romaneio e filialDestino são obrigatórios." },
        { status: 400 }
      );
    }

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    const req = pool.request();
    req.input("romaneio", romaneio);
    req.input("filialDestino", filialDestino);
    req.input("filialOrigem", filialOrigem);

    const result = await req.query(`
      DECLARE @updated INT;

      UPDATE LOJA_ENTRADAS
         SET STATUS_TRANSITO = 4,
             ENTRADA_CONFERIDA = 1,
             ENTRADA_ENCERRADA = 1,
             DATA_PARA_TRANSFERENCIA = GETDATE(),
             OBS = CASE
               WHEN OBS IS NULL OR LTRIM(RTRIM(CONVERT(VARCHAR(200), OBS))) = ''
                 THEN 'Retirado do Transito pela Tela de Liberação'
               WHEN CONVERT(VARCHAR(200), OBS) LIKE '%Retirado do Transito pela Tela de Liberação%'
                 THEN OBS
               ELSE CONVERT(VARCHAR(200), OBS) + ' - Retirado do Transito pela Tela de Liberação'
             END
       WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
         AND LTRIM(RTRIM(FILIAL)) = @filialDestino
         AND (@filialOrigem = '' OR LTRIM(RTRIM(ISNULL(FILIAL_ORIGEM, ''))) = @filialOrigem)
         AND ISNULL(LTRIM(RTRIM(FILIAL_ORIGEM)), '') <> ''
         AND (
           ISNULL(LTRIM(RTRIM(ROMANEIO_NF_SAIDA)), '') <> ''
           OR EXISTS (
             SELECT 1
               FROM LOJA_ENTRADAS_PRODUTO lep2
              WHERE lep2.ROMANEIO_PRODUTO = LOJA_ENTRADAS.ROMANEIO_PRODUTO
                AND lep2.FILIAL = LOJA_ENTRADAS.FILIAL
           )
         )
         AND (
           STATUS_TRANSITO IS NULL
           OR STATUS_TRANSITO < 4
           OR ISNULL(ENTRADA_ENCERRADA, 0) = 0
         )
         AND EXISTS (
           SELECT 1
             FROM LOJA_ENTRADAS_PRODUTO lep
            WHERE lep.ROMANEIO_PRODUTO = LOJA_ENTRADAS.ROMANEIO_PRODUTO
              AND lep.FILIAL = LOJA_ENTRADAS.FILIAL
         );

      SET @updated = @@ROWCOUNT;

      SELECT
        @updated AS UPDATED,
        STATUS_TRANSITO,
        ENTRADA_CONFERIDA
      FROM LOJA_ENTRADAS
      WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
        AND LTRIM(RTRIM(FILIAL)) = @filialDestino
        AND (@filialOrigem = '' OR LTRIM(RTRIM(ISNULL(FILIAL_ORIGEM, ''))) = @filialOrigem);
    `);

    const row = result.recordset?.[0] as
      | { UPDATED?: number; STATUS_TRANSITO?: number | null; ENTRADA_CONFERIDA?: boolean | number | null }
      | undefined;

    const success =
      Number(row?.UPDATED ?? 0) === 1 &&
      Number(row?.STATUS_TRANSITO ?? 0) === 4 &&
      (row?.ENTRADA_CONFERIDA === true || Number(row?.ENTRADA_CONFERIDA ?? 0) === 1);

    if (!success) {
      return NextResponse.json(
        { error: "Não foi possível liberar este trânsito com segurança." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Trânsito ${romaneio} liberado com sucesso.`,
    });
  } catch (error) {
    console.error("Erro ao liberar trânsito do Linx", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao liberar trânsito do Linx." },
      { status: 500 }
    );
  }
}
