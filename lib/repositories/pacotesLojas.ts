import 'server-only';

/**
 * "Já chegou na loja?" — acompanha a entrega das mudanças de produto/preço às lojas.
 *
 * Caminho no Linx (medido em 30/10 e 12/11/2026):
 *   1. mudança em PRODUTOS/PRODUTOS_PRECOS/PRODUTOS_PRECO_COR → gatilho LXI/LXU_ETL_* põe
 *      'PRODUTO=<código>' na fila LJ_ETL_REPOSITORIO (só ENVIA_LOJA_VAREJO = 1 e
 *      TIPO_STATUS_PRODUTO = 3 ou INATIVO = 1);
 *   2. ~5 min depois o ETL vira a fila em UM pacote por loja em LJ_ETL_ARQUIVO
 *      (ID_ETL_TIPO 151 = PRODUTOS; zip com o objeto .NET serializado) e limpa a fila;
 *   3. a loja baixa o pacote e ele é APAGADO do servidor.
 * Então, por loja: produto na fila = ainda não empacotado; dentro de um pacote pendente da
 * loja = aguardando a loja baixar; nenhum dos dois = entregue. Pacote processado some, por
 * isso "sem pacote" NÃO quer dizer que a loja não recebe.
 *
 * O pacote vem do banco em base64 (texto) para atravessar o proxy HTTP de produção.
 */

import sql from 'mssql';
import zlib from 'node:zlib';

import { withRequest } from '@/lib/db/connection';
import { FILIAIS } from '@/lib/config/filial-registry';
import { mapearCodigosOuBarras, type PrecoCompany } from '@/lib/repositories/precos';

/** LJ_LX_ETL_TIPO 'PRODUTOS' (o pacote que leva cadastro, preço e preço por cor). */
const ETL_TIPO_PRODUTOS = 151;

function limpar(value: unknown): string {
  return String(value ?? '').trim();
}

/** DATA_HORA do Linx é hora de Brasília rotulada como UTC: devolve o relógio gravado. */
function relogio(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 19);
  return limpar(value).replace(' ', 'T').slice(0, 19);
}

/** Código inteiro, não prefixo: '14.15.55' não pode casar com '14.15.553'. */
function padraoCodigo(produto: string): RegExp {
  const esc = produto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9.])${esc}(?![A-Za-z0-9.])`);
}

/** Texto de todos os arquivos do zip (só cabeçalhos locais; deflate ou sem compressão). */
function textoDoZip(buf: Buffer): string {
  const partes: string[] = [];
  let o = 0;
  while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) {
    const metodo = buf.readUInt16LE(o + 8);
    const tamanho = buf.readUInt32LE(o + 18);
    const nome = buf.readUInt16LE(o + 26);
    const extra = buf.readUInt16LE(o + 28);
    const ini = o + 30 + nome + extra;
    const dados = buf.subarray(ini, ini + tamanho);
    try {
      partes.push((metodo === 8 ? zlib.inflateRawSync(dados) : dados).toString('latin1'));
    } catch {
      // Arquivo corrompido não derruba a análise: só não conta como "contém".
    }
    o = ini + tamanho;
  }
  // Não é zip: procura direto no conteúdo.
  if (partes.length === 0) partes.push(buf.toString('latin1'));
  return partes.join('\n');
}

export interface PacoteProduto {
  produto: string;
  descricao: string;
  /** O Linx manda este produto para as lojas? (ENVIA_LOJA_VAREJO + status liberado) */
  vaiParaLoja: boolean;
  motivo: string | null;
  /** Ainda na fila LJ_ETL_REPOSITORIO (o ETL não empacotou). */
  naFila: boolean;
}

export type StatusLoja = 'entregue' | 'aguardando' | 'fila' | 'nao-vai';

export interface PacoteLoja {
  codigo: string;
  loja: string;
  /** Relógio de Brasília. A coluna nem sempre acompanha cada download. */
  ultimaComunicacao: string | null;
  pacotesPendentes: number;
  pendenteDesde: string | null;
  /** Produtos analisados ainda dentro de um pacote pendente desta loja. */
  aguardando: string[];
  status: StatusLoja;
}

export interface AnalisePacotes {
  geradoEm: string;
  /** Lote analisado (quando veio por lote) e quando foi gravado. */
  lote: string | null;
  loteData: string | null;
  produtos: PacoteProduto[];
  naoEncontrados: string[];
  lojas: PacoteLoja[];
}

/** Produtos de um lote do histórico de preço (por produto e por cor) e a data dele. */
async function produtosDoLote(lote: string): Promise<{ produtos: string[]; data: string | null }> {
  return withRequest(async (request) => {
    request.input('plLote', sql.VarChar, lote);
    const r = await request.query<{ produto: string; data: Date | string }>(`
      SELECT LTRIM(RTRIM(PRODUTO)) AS produto, MIN(DATA_ALTERACAO) AS data
      FROM NERD_PRECO_HISTORICO WITH (NOLOCK) WHERE LOTE = @plLote GROUP BY PRODUTO
      UNION ALL
      SELECT LTRIM(RTRIM(PRODUTO)), MIN(DATA_ALTERACAO)
      FROM NERD_PRECO_COR_HISTORICO WITH (NOLOCK) WHERE LOTE = @plLote GROUP BY PRODUTO
    `);
    const datas = r.recordset.map((row) => relogio(row.data)).filter(Boolean) as string[];
    return {
      produtos: [...new Set(r.recordset.map((row) => limpar(row.produto)).filter(Boolean))],
      data: datas.sort()[0] ?? null,
    };
  });
}

export async function analisarPacotesLojas(params: {
  company: PrecoCompany;
  lote?: string | null;
  codigos?: string[];
}): Promise<AnalisePacotes> {
  const lote = limpar(params.lote) || null;
  let produtos: string[] = [];
  let loteData: string | null = null;
  const naoEncontrados: string[] = [];

  if (lote) {
    const r = await produtosDoLote(lote);
    if (r.produtos.length === 0) throw new Error(`Lote ${lote} não encontrado no histórico de preço.`);
    produtos = r.produtos;
    loteData = r.data;
  } else {
    const entradas = [...new Set((params.codigos ?? []).map(limpar).filter(Boolean))];
    if (entradas.length === 0) throw new Error('Informe um lote ou ao menos um código.');
    const mapa = await mapearCodigosOuBarras(entradas);
    for (const e of entradas) {
      const p = mapa.get(e);
      if (p) produtos.push(p);
      else naoEncontrados.push(e);
    }
    produtos = [...new Set(produtos)];
  }
  if (produtos.length > 300) throw new Error(`São ${produtos.length} produtos; analise até 300 por vez.`);

  // Lojas físicas da empresa (cadastro de filiais da dash) que conversam com o ETL.
  const daEmpresa = FILIAIS.filter((f) => f.company === params.company && f.modules.includes('sales') && !f.ecommerce);
  const nomeDe = new Map(daEmpresa.map((f) => [f.id, f.dbNameFallback || f.display]));
  const codigosLoja = [...nomeDe.keys()];

  const resultado = await withRequest(async (request) => {
    const phP = produtos.map((p, i) => {
      request.input(`pp${i}`, sql.VarChar, p);
      return `@pp${i}`;
    });
    const phL = codigosLoja.map((c, i) => {
      request.input(`pl${i}`, sql.VarChar, c);
      return `@pl${i}`;
    });
    const phFila = produtos.map((p, i) => {
      request.input(`pf${i}`, sql.VarChar, `PRODUTO=${p}`);
      return `@pf${i}`;
    });

    const cad = await request.query<Record<string, unknown>>(`
      SELECT LTRIM(RTRIM(PRODUTO)) AS produto, LTRIM(RTRIM(DESC_PRODUTO)) AS descricao,
             CAST(ISNULL(ENVIA_LOJA_VAREJO, 0) AS INT) AS envia, TIPO_STATUS_PRODUTO AS status,
             CAST(ISNULL(INATIVO, 0) AS INT) AS inativo
      FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO IN (${phP.join(', ')})
    `);
    const fila = await request.query<{ filtro: string; filial: string | null }>(`
      SELECT LTRIM(RTRIM(FILTRO)) AS filtro, LTRIM(RTRIM(CODIGO_FILIAL)) AS filial
      FROM LJ_ETL_REPOSITORIO WITH (NOLOCK)
      WHERE TABELA = 'PRODUTOS' AND LTRIM(RTRIM(FILTRO)) IN (${phFila.join(', ')})
    `);
    const versoes = codigosLoja.length
      ? await request.query<{ filial: string; ult: Date | string | null }>(`
          SELECT LTRIM(RTRIM(CODIGO_FILIAL)) AS filial, MAX(DATA_HORA_COMUNICACAO) AS ult
          FROM LJ_ETL_VERSAO_LOJA WITH (NOLOCK)
          WHERE CODIGO_FILIAL IN (${phL.join(', ')})
          GROUP BY CODIGO_FILIAL
        `)
      : { recordset: [] };
    // base64 em texto: o proxy HTTP de produção só leva JSON.
    const pacotes = codigosLoja.length
      ? await request.query<{ filial: string; criado: Date | string; b64: string | null }>(`
          SELECT LTRIM(RTRIM(a.CODIGO_FILIAL)) AS filial, a.DATA_HORA_CRIACAO AS criado,
                 CAST('' AS XML).value('xs:base64Binary(sql:column("x.bin"))', 'VARCHAR(MAX)') AS b64
          FROM LJ_ETL_ARQUIVO a WITH (NOLOCK)
          CROSS APPLY (SELECT CAST(a.XML_ARQUIVO AS VARBINARY(MAX)) AS bin) x
          WHERE a.ID_ETL_TIPO = ${ETL_TIPO_PRODUTOS} AND a.CODIGO_FILIAL IN (${phL.join(', ')})
          ORDER BY a.DATA_HORA_CRIACAO
        `)
      : { recordset: [] };
    return { cad: cad.recordset, fila: fila.recordset, versoes: versoes.recordset, pacotes: pacotes.recordset };
  });

  const naFila = new Map<string, Set<string | null>>();
  for (const f of resultado.fila) {
    const p = limpar(f.filtro).replace(/^PRODUTO=/, '');
    const s = naFila.get(p) ?? new Set();
    s.add(f.filial || null);
    naFila.set(p, s);
  }

  const listaProdutos: PacoteProduto[] = produtos.map((p) => {
    const c = resultado.cad.find((r) => limpar(r.produto) === p);
    const envia = Number(c?.envia ?? 0) === 1;
    const liberado = Number(c?.status ?? 0) === 3 || Number(c?.inativo ?? 0) === 1;
    return {
      produto: p,
      descricao: limpar(c?.descricao),
      vaiParaLoja: envia && liberado,
      motivo: !c
        ? 'não encontrado'
        : !envia
          ? 'cadastro não envia para loja (ENVIA_LOJA_VAREJO = 0)'
          : !liberado
            ? 'produto não está LIBERADO (status ≠ 3)'
            : null,
      naFila: naFila.has(p),
    };
  });

  // Pacotes pendentes por loja e quais produtos analisados estão dentro deles.
  const porLoja = new Map<string, { n: number; desde: string | null; contem: Set<string> }>();
  for (const pk of resultado.pacotes) {
    const loja = limpar(pk.filial);
    const acc = porLoja.get(loja) ?? { n: 0, desde: null, contem: new Set<string>() };
    acc.n += 1;
    const criado = relogio(pk.criado);
    if (criado && (!acc.desde || criado < acc.desde)) acc.desde = criado;
    if (pk.b64) {
      const texto = textoDoZip(Buffer.from(pk.b64, 'base64'));
      for (const p of produtos) if (padraoCodigo(p).test(texto)) acc.contem.add(p);
    }
    porLoja.set(loja, acc);
  }

  const ultima = new Map(resultado.versoes.map((v) => [limpar(v.filial), relogio(v.ult)]));
  const vaoParaLoja = listaProdutos.filter((p) => p.vaiParaLoja).map((p) => p.produto);
  const lojas: PacoteLoja[] = codigosLoja.map((codigo) => {
    const acc = porLoja.get(codigo);
    const aguardando = vaoParaLoja.filter((p) => acc?.contem.has(p));
    const fila = vaoParaLoja.filter((p) => {
      const s = naFila.get(p);
      return !!s && (s.has(null) || s.has(codigo));
    });
    const status: StatusLoja =
      vaoParaLoja.length === 0 ? 'nao-vai' : fila.length > 0 ? 'fila' : aguardando.length > 0 ? 'aguardando' : 'entregue';
    return {
      codigo,
      loja: nomeDe.get(codigo) ?? codigo,
      ultimaComunicacao: ultima.get(codigo) ?? null,
      pacotesPendentes: acc?.n ?? 0,
      pendenteDesde: acc?.desde ?? null,
      aguardando,
      status,
    };
  });

  // Filial antiga/desativada nunca recebe pacote e pareceria "entregue": só entram as lojas
  // que falaram com o ETL nos últimos 30 dias.
  const corte = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 19);
  const ativas = lojas.filter((l) => l.ultimaComunicacao && l.ultimaComunicacao >= corte);

  return {
    geradoEm: new Date().toISOString(),
    lote,
    loteData,
    produtos: listaProdutos,
    naoEncontrados,
    lojas: ativas.sort((a, b) => a.loja.localeCompare(b.loja)),
  };
}
