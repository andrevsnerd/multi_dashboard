import { withRequest } from "@/lib/db/connection";
import sql from "mssql";

/**
 * Detecção de transferências ENTRE LOJAS feitas FORA do app (direto no Linx).
 *
 * Lê os romaneios de SAÍDA do tipo "TRANSFERENCIA ENTRE LOJAS"
 * (ESTOQUE_PROD_SAI + ESTOQUE_PROD1_SAI) dentro da janela e casa cada item com a
 * perna de ENTRADA correspondente (LOJA_ENTRADAS + LOJA_ENTRADAS_PRODUTO, ligada
 * pela ROMANEIO_NF_SAIDA) para saber se o destino já recebeu.
 *
 * NÃO grava nada no Linx — apenas ENXERGA. A gravação do status "realizada" é
 * feita depois no Neon (transferencia_pendente + romaneio_item_confirmado),
 * espelhando exatamente uma transferência executada pela própria tela.
 */
export interface TransferenciaExternaDetectada {
  romaneio: string;
  /** Nome da filial de origem como está no Linx (ainda não canonizado). */
  origem: string;
  /** Nome da filial de destino como está no Linx (ainda não canonizado). */
  destino: string;
  /** EMISSÃO da saída (ISO string, hora local do servidor de banco). */
  emissao: string;
  produto: string;
  corCodigo: string | null;
  /** Quantidade que saiu da origem (SUM de ESTOQUE_PROD1_SAI.QTDE). */
  quantidade: number;
  /** Quantidade já recebida no destino (SUM de LOJA_ENTRADAS_PRODUTO.QTDE_ENTRADA). */
  qtdEntrada: number;
}

/**
 * Busca as transferências entre lojas do Linx cuja ORIGEM esteja no escopo de
 * filiais informado (nomes das filiais da empresa — inclui membros de grupo e
 * rótulos operacionais para não perder rodízios).
 */
export async function fetchTransferenciasExternasLinx(
  scopeFiliais: string[],
  dias = 45
): Promise<TransferenciaExternaDetectada[]> {
  const diasClamp = Math.min(Math.max(Math.floor(dias) || 45, 1), 365);
  const escopo = Array.from(
    new Set((scopeFiliais || []).map((f) => (f || "").trim().toUpperCase()).filter(Boolean))
  );

  // Sem escopo, não filtramos por empresa → evita varrer/misturar as duas empresas.
  if (escopo.length === 0) return [];

  return withRequest(async (req) => {
    escopo.forEach((f, i) => req.input(`fil${i}`, sql.VarChar, f));
    const escopoIn = escopo.map((_, i) => `@fil${i}`).join(", ");

    // saidas: 1 linha por (romaneio, origem, destino, produto, cor) com a qtd que saiu.
    // entradas: 1 linha por (romaneio de saída, produto, cor) com a qtd já recebida.
    // O LEFT JOIN casa a perna de entrada quando ela existe (recebida no destino).
    const query = `
      ;WITH saidas AS (
        SELECT
          LTRIM(RTRIM(s.ROMANEIO_PRODUTO)) AS romaneio,
          LTRIM(RTRIM(ISNULL(s.FILIAL, ''))) AS origem,
          LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) AS destino,
          MIN(s.EMISSAO) AS emissao,
          p.PRODUTO AS produto,
          LTRIM(RTRIM(CAST(p.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo,
          SUM(ISNULL(p.QTDE, 0)) AS quantidade
        FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
        JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK)
          ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
         AND LTRIM(RTRIM(ISNULL(s.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(p.FILIAL, '')))
        WHERE s.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())
          AND UPPER(LTRIM(RTRIM(ISNULL(s.TIPO_ROMANEIO, '')))) LIKE '%TRANSFERENCIA ENTRE LOJAS%'
          AND LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) <> ''
          AND ISNULL(p.QTDE, 0) > 0
          AND UPPER(LTRIM(RTRIM(ISNULL(s.FILIAL, '')))) IN (${escopoIn})
        GROUP BY
          LTRIM(RTRIM(s.ROMANEIO_PRODUTO)),
          LTRIM(RTRIM(ISNULL(s.FILIAL, ''))),
          LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))),
          p.PRODUTO,
          LTRIM(RTRIM(CAST(p.COR_PRODUTO AS VARCHAR(20))))
      ),
      entradas AS (
        SELECT
          LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, ''))) AS romaneio,
          lep.PRODUTO AS produto,
          LTRIM(RTRIM(CAST(lep.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo,
          SUM(ISNULL(lep.QTDE_ENTRADA, 0)) AS qtdEntrada
        FROM LOJA_ENTRADAS le WITH (NOLOCK)
        JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
          ON lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
         AND lep.FILIAL = le.FILIAL
        WHERE ISNULL(le.ENTRADA_CANCELADA, 0) = 0
          AND LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, ''))) <> ''
          AND le.EMISSAO >= DATEADD(DAY, -${diasClamp + 60}, GETDATE())
        GROUP BY
          LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, ''))),
          lep.PRODUTO,
          LTRIM(RTRIM(CAST(lep.COR_PRODUTO AS VARCHAR(20))))
      )
      SELECT
        sa.romaneio,
        sa.origem,
        sa.destino,
        (CONVERT(VARCHAR(10), sa.emissao, 120) + 'T' + CONVERT(VARCHAR(8), sa.emissao, 108)) AS emissao,
        sa.produto,
        sa.corCodigo,
        sa.quantidade,
        ISNULL(en.qtdEntrada, 0) AS qtdEntrada
      FROM saidas sa
      LEFT JOIN entradas en
        ON en.romaneio = sa.romaneio
       AND en.produto = sa.produto
       AND COALESCE(en.corCodigo, '') = COALESCE(sa.corCodigo, '')
    `;

    const result = await req.query<{
      romaneio: string;
      origem: string;
      destino: string;
      emissao: string;
      produto: string;
      corCodigo: string | null;
      quantidade: number | null;
      qtdEntrada: number | null;
    }>(query);

    return result.recordset.map((row) => ({
      romaneio: (row.romaneio || "").trim(),
      origem: (row.origem || "").trim(),
      destino: (row.destino || "").trim(),
      emissao: (row.emissao || "").trim(),
      produto: (row.produto || "").trim(),
      corCodigo: row.corCodigo != null ? String(row.corCodigo).trim() : null,
      quantidade: Number(row.quantidade ?? 0),
      qtdEntrada: Number(row.qtdEntrada ?? 0),
    }));
  });
}
