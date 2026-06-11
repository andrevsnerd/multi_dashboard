/**
 * Validação independente do "Relatório Claude" — grupo PANNEAUX (ScarfMe).
 * Espelha as queries de lib/repositories/claudeReport.ts (LOJA c/ desconto +
 * E-COMMERCE via FATURAMENTO), filtrando p.GRUPO_PRODUTO = 'PANNEAUX',
 * excluindo a filial MATRIZ. Roda várias janelas e imprime JSON compacto.
 *
 * Uso: node scripts/valida-panneaux.mjs
 */
import sql from 'mssql';

const config = {
  server: '177.92.78.250',
  database: 'LINX_PRODUCAO',
  user: 'andre.sabetta',
  password: 'asabetta',
  port: 1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 300000,
  connectionTimeout: 30000,
};

// Filiais físicas (POS) — exclui SCARF ME - MATRIZ (excluída no relatório).
const POS_FILIAIS = [
  'GUARULHOS - RSR',
  'IGUATEMI SP - JJJ',
  'MORUMBI - JJJ',
  'OSCAR FREIRE - FSZ',
  'SCARF ME - HIGIENOPOLIS 2',
  'SCARFME - IBIRAPUERA LLL',
  'SCARFME ME - PAULISTA FFF',
  'SCARF ME - PAULISTA RSR',
  'SCARF ME - PAULISTA FFFR',
  'SCARF ME PAULISTA FFFR',
  'VILLA LOBOS - LLL',
  'SCARFME LLL -  GALEAO RJ',
];
// Filiais de e-commerce.
const ECOM_FILIAIS = [
  'SCARFME MATRIZ CMS',
  'SCARF ME - MATRIZ LLL',
  'SCARF ME MATRIZ - FFF',
  'MSC COMERCIO DE LENCOS LT',
];

const quote = (arr) => arr.map((f) => `'${f.replace(/'/g, "''")}'`).join(', ');

function posQuery(start, end) {
  return `
    WITH vendas_cte AS (
      SELECT CAST(vp.DATA_VENDA AS DATE) AS DATA, ISNULL(f.FILIAL,'') AS FILIAL,
        ISNULL(vp.PRODUTO,'') AS PRODUTO, ISNULL(vp.COR_PRODUTO,'') AS COR,
        UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) AS SUBGRUPO,
        UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO,'')))) AS TIPO,
        UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO,'')))) AS COLECAO,
        UPPER(LTRIM(RTRIM(ISNULL(cb.DESC_COR,'')))) AS COR_DESC,
        vp.QTDE AS QTDE,
        CAST((vp.PRECO_LIQUIDO*vp.QTDE)-(vp.QTDE*vp.PRECO_LIQUIDO*ISNULL(vp.FATOR_DESCONTO_VENDA,0)) AS DECIMAL(38,6)) AS RECEITA
      FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
      INNER JOIN LOJA_VENDA v WITH (NOLOCK) ON v.CODIGO_FILIAL=vp.CODIGO_FILIAL AND v.TICKET=vp.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL=vp.CODIGO_FILIAL
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO=vp.PRODUTO
      LEFT JOIN CORES_BASICAS cb WITH (NOLOCK) ON cb.COR=vp.COR_PRODUTO
      WHERE vp.DATA_VENDA>='${start}' AND vp.DATA_VENDA<'${end}'
        AND vp.QTDE_CANCELADA=0 AND vp.QTDE>0
        AND f.FILIAL IN (${quote(POS_FILIAIS)})
        AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO,''))))='PANNEAUX'
    ),
    trocas_cte AS (
      SELECT CAST(v.DATA_VENDA AS DATE) AS DATA, ISNULL(f.FILIAL,'') AS FILIAL,
        ISNULL(vt.PRODUTO,'') AS PRODUTO, ISNULL(vt.COR_PRODUTO,'') AS COR,
        UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) AS SUBGRUPO,
        UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO,'')))) AS TIPO,
        UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO,'')))) AS COLECAO,
        UPPER(LTRIM(RTRIM(ISNULL(cb.DESC_COR,'')))) AS COR_DESC,
        -vt.QTDE AS QTDE,
        CAST(-(vt.PRECO_LIQUIDO*vt.QTDE) AS DECIMAL(38,6)) AS RECEITA
      FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
      INNER JOIN LOJA_VENDA v WITH (NOLOCK) ON v.CODIGO_FILIAL=vt.CODIGO_FILIAL AND v.TICKET=vt.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL=vt.CODIGO_FILIAL
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO=vt.PRODUTO
      LEFT JOIN CORES_BASICAS cb WITH (NOLOCK) ON cb.COR=vt.COR_PRODUTO
      WHERE vt.QTDE_CANCELADA=0 AND v.DATA_VENDA>='${start}' AND v.DATA_VENDA<'${end}'
        AND f.FILIAL IN (${quote(POS_FILIAIS)})
        AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO,''))))='PANNEAUX'
    )
    SELECT 'LOJA' AS CANAL, FILIAL, PRODUTO, COR,
      MAX(SUBGRUPO) AS SUBGRUPO, MAX(TIPO) AS TIPO, MAX(COLECAO) AS COLECAO, MAX(COR_DESC) AS COR_DESC,
      SUM(QTDE) AS QTDE, SUM(RECEITA) AS RECEITA
    FROM (SELECT * FROM vendas_cte UNION ALL SELECT * FROM trocas_cte) c
    WHERE PRODUTO<>'' AND FILIAL<>''
    GROUP BY FILIAL, PRODUTO, COR
    HAVING SUM(RECEITA)<>0`;
}

function ecomQuery(start, end) {
  return `
    SELECT 'E-COMMERCE' AS CANAL, ISNULL(f.FILIAL,'') AS FILIAL,
      ISNULL(fp.PRODUTO,'') AS PRODUTO, ISNULL(fp.COR_PRODUTO,'') AS COR,
      MAX(UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,''))))) AS SUBGRUPO,
      MAX(UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO,''))))) AS TIPO,
      MAX(UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO,''))))) AS COLECAO,
      MAX(UPPER(LTRIM(RTRIM(ISNULL(cb.DESC_COR,''))))) AS COR_DESC,
      SUM(CASE WHEN fp.QTDE>0 THEN fp.QTDE ELSE 0 END) AS QTDE,
      SUM(ISNULL(fp.VALOR_LIQUIDO,0)) AS RECEITA
    FROM FATURAMENTO f WITH (NOLOCK)
    JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
      ON f.FILIAL=fp.FILIAL AND f.NF_SAIDA=fp.NF_SAIDA AND f.SERIE_NF=fp.SERIE_NF
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO=fp.PRODUTO
    LEFT JOIN CORES_BASICAS cb WITH (NOLOCK) ON cb.COR=fp.COR_PRODUTO
    WHERE CAST(f.EMISSAO AS DATE)>=CAST('${start}' AS DATE) AND CAST(f.EMISSAO AS DATE)<CAST('${end}' AS DATE)
      AND f.NOTA_CANCELADA=0 AND f.NATUREZA_SAIDA IN ('100.02','100.022') AND fp.QTDE>0
      AND f.FILIAL IN (${quote(ECOM_FILIAIS)})
      AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO,''))))='PANNEAUX'
    GROUP BY ISNULL(f.FILIAL,''), ISNULL(fp.PRODUTO,''), ISNULL(fp.COR_PRODUTO,'')
    HAVING SUM(ISNULL(fp.VALOR_LIQUIDO,0))>0`;
}

function aggregate(rows) {
  let revenue = 0, units = 0;
  const skus = new Set(), products = new Set(), skusNorm = new Set();
  const normCor = (c) => { const n = parseInt(String(c).trim(), 10); return Number.isNaN(n) ? String(c).trim().toUpperCase() : String(n); };
  const bySub = {}, byTipo = {}, byCor = {}, byCol = {}, byFilial = {};
  let posRev = 0, posUn = 0, ecomRev = 0, ecomUn = 0;
  for (const r of rows) {
    const rev = Number(r.RECEITA) || 0, qt = Number(r.QTDE) || 0;
    revenue += rev; units += qt;
    skus.add(`${r.PRODUTO}||${r.COR}`); products.add(r.PRODUTO); skusNorm.add(`${r.PRODUTO}||${normCor(r.COR)}`);
    const add = (obj, k) => { const key = k || '(vazio)'; if (!obj[key]) obj[key] = { rev: 0, un: 0, sk: new Set() }; obj[key].rev += rev; obj[key].un += qt; obj[key].sk.add(`${r.PRODUTO}||${r.COR}`); };
    add(bySub, r.SUBGRUPO); add(byTipo, r.TIPO); add(byCor, r.COR_DESC); add(byCol, r.COLECAO); add(byFilial, r.FILIAL);
    if (r.CANAL === 'E-COMMERCE') { ecomRev += rev; ecomUn += qt; } else { posRev += rev; posUn += qt; }
  }
  const top = (obj, n = 20) => Object.entries(obj).map(([k, v]) => ({ k, rev: Math.round(v.rev), un: v.un, sk: v.sk.size })).sort((a, b) => b.rev - a.rev).slice(0, n);
  return {
    revenue: Math.round(revenue), units, skus: skus.size, skusNorm: skusNorm.size, products: products.size,
    canais: { loja: { rev: Math.round(posRev), un: posUn }, ecom: { rev: Math.round(ecomRev), un: ecomUn } },
    subgrupos: top(bySub), tipos: top(byTipo, 20), cores: top(byCor, 20), colecoes: top(byCol, 15), filiais: top(byFilial, 20),
  };
}

async function runWindow(pool, label, start, end, full) {
  const [pos, ecom] = await Promise.all([
    pool.request().query(posQuery(start, end)),
    pool.request().query(ecomQuery(start, end)),
  ]);
  const rows = [...pos.recordset, ...ecom.recordset];
  const agg = aggregate(rows);
  console.log(`\n${'='.repeat(72)}\n### ${label}  [${start} → ${end})`);
  if (full) {
    console.log(JSON.stringify(agg, null, 1));
  } else {
    console.log(JSON.stringify({ revenue: agg.revenue, units: agg.units, skus: agg.skus, skusNorm: agg.skusNorm, products: agg.products, canais: agg.canais }));
  }
  return agg;
}

async function diag2025(pool) {
  // Onde está o ecom de 2025? FATURAMENTO PANNEAUX Jan-Jun/25, por filial + natureza, SEM filtro de filial/natureza.
  const q = `
    SELECT ISNULL(f.FILIAL,'') AS FILIAL, ISNULL(f.NATUREZA_SAIDA,'') AS NAT,
      SUM(CASE WHEN fp.QTDE>0 THEN fp.QTDE ELSE 0 END) AS QTDE,
      SUM(ISNULL(fp.VALOR_LIQUIDO,0)) AS RECEITA
    FROM FATURAMENTO f WITH (NOLOCK)
    JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK) ON f.FILIAL=fp.FILIAL AND f.NF_SAIDA=fp.NF_SAIDA AND f.SERIE_NF=fp.SERIE_NF
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO=fp.PRODUTO
    WHERE CAST(f.EMISSAO AS DATE)>='2025-01-01' AND CAST(f.EMISSAO AS DATE)<'2025-06-12'
      AND f.NOTA_CANCELADA=0 AND fp.QTDE>0
      AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO,''))))='PANNEAUX'
    GROUP BY ISNULL(f.FILIAL,''), ISNULL(f.NATUREZA_SAIDA,'')
    HAVING SUM(ISNULL(fp.VALOR_LIQUIDO,0))>0
    ORDER BY RECEITA DESC`;
  const r = await pool.request().query(q);
  console.log(`\n${'='.repeat(72)}\n### DIAG: FATURAMENTO PANNEAUX Jan→11/Jun/25 (todas filiais, todas naturezas)`);
  r.recordset.forEach((row) => console.log(`  ${row.FILIAL.trim()} | NAT=${row.NAT} | ${Math.round(row.RECEITA)} | ${row.QTDE}un`));
}

async function main() {
  const pool = await sql.connect(config);
  await runWindow(pool, 'PRINCIPAL Jan→11/Jun/26', '2026-01-01', '2026-06-12', false);
  await pool.close();
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
