import 'server-only';

/**
 * Adicionar COR ao cadastro de um produto no Linx — o mesmo processo da tela de
 * cadastro do ERP, feito pelo dashboard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMO O LINX FAZ (levantado no banco de produção, não deduzido)
 * ─────────────────────────────────────────────────────────────────────────────
 * Não existe stored procedure nem trigger que gere código de barra: quem monta
 * é o cliente do ERP, em três passos que este arquivo replica na MESMA ordem.
 *
 *  1. `PRODUTO_CORES` — a cor (PK = PRODUTO + COR_PRODUTO). A coluna `COR` é FK
 *     para `CORES_BASICAS`; o trigger `LXI_PRODUTO_CORES` BARRA cor que não
 *     exista lá ("Impossível Incluir #PRODUTO_CORES #porque #CORES_BASICAS
 *     #não existe") e, de brinde, replica `PRODUTOS_PRECO_FILIAL` sozinho para
 *     as tabelas com GERA_TABELA_LOJA = 1. Por isso NÃO mexemos nela na mão.
 *
 *  2. Os números saem de `SEQUENCIAIS`, alocados pela procedure DO PRÓPRIO LINX,
 *     `LX_SEQUENCIAL` — nunca por UPDATE nosso. É ela que sabe o `TAMANHO` de
 *     cada sequencial (não fixamos 6 nem 5) e que desvia para
 *     `EMPRESA_SEQUENCIAIS` quando o parâmetro CTRL_MULTI_EMPRESA está ligado
 *     (está: '.T.'; a tabela hoje está vazia, mas se ganhar linha a procedure
 *     resolve sozinha). As duas chaves:
 *       PRODUTOS_BARRA.CODIGO_BARRA → código interno (TIPO_COD_BAR 3)
 *       PRODUTOS_BARRA.CODIGO_EAN   → referência do EAN (TIPO_COD_BAR 1)
 *     O EAN-13 é `PARAMETROS.EAN_13` (prefixo GS1 da casa, '7898586') + essa
 *     referência + dígito verificador. O DV é a ÚNICA conta que sobra do nosso
 *     lado, porque o banco não tem rotina para ela: nenhum objeto do Linx
 *     (trigger, procedure ou função) lê o parâmetro EAN_13 — quem monta o código
 *     é o cliente do ERP. A fórmula foi conferida contra TODOS os 44.039 EANs
 *     '7898586' já gravados: 44.039 conferem, 0 divergem.
 *
 *  3. `PRODUTOS_BARRA` — UM PAR de códigos (interno + EAN) POR TAMANHO da grade.
 *     `TAMANHO` é o ordinal 1-based e `GRADE` é o RÓTULO do tamanho ('U', 'P',
 *     'M', 'G', '90X90'), que vem de `PRODUTOS_TAMANHOS.TAMANHO_n` — nunca o
 *     nome da grade. O trigger `LXI_PRODUTOS_BARRA` exige que a cor já exista,
 *     então a ordem 1 → 3 é obrigatória.
 *
 * Novos códigos nascem com `TIPO_COD_GTIN` NULO e `CODIGO_BARRA_PADRAO = 0` —
 * é assim que o ERP grava (conferido nas barras criadas hoje); o GTIN = 3 do
 * EAN aparece depois, pela integração.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * • Concorrência com o próprio Linx: alguém está adicionando cor no ERP ao mesmo
 *   tempo (os sequenciais andaram duas vezes durante o levantamento deste
 *   arquivo). Tudo roda num ÚNICO batch dentro de transação — o mesmo padrão de
 *   `clienteCorporativo.ts` — e a alocação é a da procedure do ERP, cujo
 *   `UPDATE ... SET @out = SEQUENCIA = ...` é atômico e mantém o lock da linha
 *   até o commit. Cada código ainda é conferido contra a PK antes de entrar.
 * • Cor duplicada por formato: '06' e '6' são a MESMA cor para o resto do
 *   sistema, mas chaves diferentes no ERP. Criar '06' num produto que já tem '6'
 *   duplicaria a cor na tela; a checagem compara os dois jeitos.
 * • Preço por cor: em produto com `VARIA_PRECO_COR = 1` (91 itens, todos
 *   ScarfMe) o preço mora em `PRODUTOS_PRECO_COR`, e o trigger do Linx NÃO
 *   cobre esse caso. A cor nova copia as linhas de preço da cor irmã, senão
 *   nasceria sem preço nenhum.
 */

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import { registrarHistoricoCadastro } from '@/lib/repositories/cadastro';

export type CorCompany = 'nerd' | 'scarfme';

/** PRODUTOS.EMPRESA por empresa do dashboard — mesmo mapa de precos.ts/etiquetas.ts. */
const EMPRESA_CODES: Record<CorCompany, number[]> = {
  nerd: [8],
  scarfme: [1, 10, 13, 15, 16],
};

/** Nº máximo de posições de grade no Linx (TAMANHO_1..TAMANHO_48). */
const MAX_TAMANHOS = 48;

function limpar(value: unknown): string {
  return String(value ?? '').trim();
}

/* ═══════════════════════ catálogo de cores ═══════════════════════ */

export interface CorCatalogo {
  /** Chave no ERP (CORES_BASICAS.COR). '01' e '1' são cores DIFERENTES aqui. */
  cor: string;
  /** Descrição do cadastro global de cores. */
  descBasica: string;
  /**
   * Descrição MAIS USADA pela empresa para esse código, e em quantos produtos.
   *
   * Existe porque o nome do cadastro global não é o nome que a loja usa: na NERD
   * o código 105 é ROSA MESCLA (CORES_BASICAS diz ROSA INDIANO), o 107 é GRAFITE
   * (global: PRETO/OFF WHITE), o 115 é DAMASCO (global: ABÓBORA) — 10 códigos
   * divergem. Escolher pelo nome global imprimiria etiqueta com o nome errado.
   *
   * É a MAIS USADA, por contagem — não a primeira nem a "maior" em ordem
   * alfabética, que dá resposta enganosa (em '06' o MAX alfabético devolve ROXO,
   * quando 2.031 produtos NERD chamam de PRETO).
   */
  descEmpresa: string | null;
  usosEmpresa: number;
  /** O produto já tem essa cor (chave exata). */
  jaNoProduto: boolean;
  /** O produto já tem essa cor em OUTRO formato ('6' quando se escolheu '06'). */
  conflitoDeFormato: boolean;
  /** Código equivalente já cadastrado no produto, quando há conflito de formato. */
  corEquivalente: string | null;
  descNoProduto: string | null;
}

interface CorCatalogoRow {
  COR: string;
  DESC_BASICA: string;
  DESC_EMPRESA: string | null;
  USOS: number | null;
  COR_NO_PRODUTO: string | null;
  DESC_NO_PRODUTO: string | null;
  COR_EQUIVALENTE: string | null;
  DESC_EQUIVALENTE: string | null;
}

export interface TamanhoParaCriar {
  tamanho: number;
  grade: string;
}

export interface PreviaAdicionarCor {
  produto: string;
  descProduto: string;
  grade: string;
  inativo: boolean;
  variaPrecoCor: boolean;
  /** Tamanhos que vão receber par de códigos. */
  tamanhos: TamanhoParaCriar[];
  /**
   * De onde saiu a lista de tamanhos: `cores-irmas` é a mais confiável (é o que
   * o produto já tem de verdade); `grade` lê o cadastro da grade; `unico` é o
   * último recurso, produto sem nada de onde copiar.
   */
  origemTamanhos: 'cores-irmas' | 'grade' | 'unico';
  /** Cores que o produto já tem. */
  coresAtuais: Array<{ cor: string; descCor: string; codigos: number }>;
  /** Prefixo GS1 (PARAMETROS.EAN_13). */
  prefixoEan: string;
  /** Prévia dos próximos códigos — só para conferência, não reserva nada. */
  proximoInterno: string;
  proximoEan: string;
  catalogo: CorCatalogo[];
}

/**
 * Catálogo de cores + tudo que a tela precisa mostrar antes de gravar.
 *
 * Vem numa chamada só: são 450 cores, então o filtro por número ou por nome
 * acontece no cliente, instantâneo, sem ida e volta por tecla digitada.
 */
export async function fetchPreviaAdicionarCor(
  company: CorCompany,
  produtoBruto: string
): Promise<PreviaAdicionarCor> {
  const produto = limpar(produtoBruto);
  if (!produto) throw new Error('Informe o produto.');

  const empresas = EMPRESA_CODES[company] ?? [];
  const filtroEmpresa = empresas.length > 0 ? `AND p.EMPRESA IN (${empresas.join(', ')})` : '';

  const base = await withRequest(async (request) => {
    request.input('pcProduto', sql.VarChar, produto);
    const r = await request.query<{
      PRODUTO: string;
      DESC_PRODUTO: string;
      GRADE: string;
      INATIVO: number | null;
      VARIA_PRECO_COR: boolean | number | null;
      EMPRESA: number | null;
    }>(`
      SELECT LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
             LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, ''))) AS DESC_PRODUTO,
             LTRIM(RTRIM(ISNULL(CAST(p.GRADE AS VARCHAR(60)), ''))) AS GRADE,
             ISNULL(p.INATIVO, 0) AS INATIVO,
             ISNULL(p.VARIA_PRECO_COR, 0) AS VARIA_PRECO_COR,
             p.EMPRESA AS EMPRESA
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE LTRIM(RTRIM(p.PRODUTO)) = @pcProduto
    `);
    return r.recordset[0] ?? null;
  });

  if (!base) throw new Error(`Produto "${produto}" não existe no cadastro.`);

  const [tamanhos, coresAtuais, catalogo, sequenciais] = await Promise.all([
    fetchTamanhosParaCriar(produto, base.GRADE),
    fetchCoresAtuais(produto),
    fetchCatalogoCores(produto, filtroEmpresa),
    fetchPreviaSequenciais(base.EMPRESA === null || base.EMPRESA === undefined ? null : Number(base.EMPRESA)),
  ]);

  return {
    produto: limpar(base.PRODUTO),
    descProduto: limpar(base.DESC_PRODUTO),
    grade: limpar(base.GRADE),
    inativo: Number(base.INATIVO ?? 0) !== 0,
    variaPrecoCor: Boolean(base.VARIA_PRECO_COR),
    tamanhos: tamanhos.lista,
    origemTamanhos: tamanhos.origem,
    coresAtuais,
    prefixoEan: sequenciais.prefixo,
    proximoInterno: sequenciais.proximoInterno,
    proximoEan: sequenciais.proximoEan,
    catalogo,
  };
}

/**
 * Tamanhos que vão receber par de códigos.
 *
 * Preferimos ESPELHAR o que as cores irmãs já têm: é a verdade do produto, e
 * imuniza contra grade cadastrada errada ou renomeada. Só quando o produto não
 * tem nenhuma barra é que lemos a grade (`PRODUTOS_TAMANHOS`) — e aí vale o que
 * está preenchido em TAMANHO_1..48, porque NUMERO_TAMANHOS é lixo (vem 16 em
 * toda grade) e TAMANHOS_DIGITADOS também diverge.
 */
async function fetchTamanhosParaCriar(
  produto: string,
  grade: string
): Promise<{ lista: TamanhoParaCriar[]; origem: PreviaAdicionarCor['origemTamanhos'] }> {
  const irmas = await withRequest(async (request) => {
    request.input('tpProduto', sql.VarChar, produto);
    const r = await request.query<{ TAMANHO: number; GRADE: string }>(`
      SELECT DISTINCT pb.TAMANHO AS TAMANHO, LTRIM(RTRIM(pb.GRADE)) AS GRADE
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE LTRIM(RTRIM(pb.PRODUTO)) = @tpProduto
      ORDER BY pb.TAMANHO
    `);
    return r.recordset;
  });

  if (irmas.length > 0) {
    return {
      lista: irmas.map((r) => ({ tamanho: Number(r.TAMANHO) || 1, grade: limpar(r.GRADE) || 'U' })),
      origem: 'cores-irmas',
    };
  }

  const g = limpar(grade);
  if (g) {
    const cols = Array.from(
      { length: MAX_TAMANHOS },
      (_, i) => `LTRIM(RTRIM(ISNULL(CAST(pt.TAMANHO_${i + 1} AS VARCHAR(20)), ''))) AS T${i + 1}`
    ).join(', ');

    const row = await withRequest(async (request) => {
      request.input('tpGrade', sql.VarChar, g);
      const r = await request.query<Record<string, string | null>>(`
        SELECT TOP 1 ${cols}
        FROM PRODUTOS_TAMANHOS pt WITH (NOLOCK)
        WHERE LTRIM(RTRIM(CAST(pt.GRADE AS VARCHAR(60)))) = @tpGrade
      `);
      return r.recordset[0] ?? null;
    });

    if (row) {
      const lista: TamanhoParaCriar[] = [];
      for (let i = 1; i <= MAX_TAMANHOS; i += 1) {
        const label = limpar(row[`T${i}`]);
        if (label) lista.push({ tamanho: i, grade: label.slice(0, 8) });
      }
      if (lista.length > 0) return { lista, origem: 'grade' };
    }
  }

  // Produto sem barra e sem grade reconhecida: um tamanho só, como o ERP faz na
  // grade UNICO (rótulo 'U').
  return { lista: [{ tamanho: 1, grade: 'U' }], origem: 'unico' };
}

async function fetchCoresAtuais(
  produto: string
): Promise<Array<{ cor: string; descCor: string; codigos: number }>> {
  return withRequest(async (request) => {
    request.input('caProduto', sql.VarChar, produto);
    const r = await request.query<{ COR: string; DESC_COR: string; CODIGOS: number }>(`
      SELECT LTRIM(RTRIM(pc.COR_PRODUTO)) AS COR,
             LTRIM(RTRIM(ISNULL(pc.DESC_COR_PRODUTO, ''))) AS DESC_COR,
             (
               SELECT COUNT(*) FROM PRODUTOS_BARRA pb WITH (NOLOCK)
               WHERE pb.PRODUTO = pc.PRODUTO AND pb.COR_PRODUTO = pc.COR_PRODUTO
             ) AS CODIGOS
      FROM PRODUTO_CORES pc WITH (NOLOCK)
      WHERE LTRIM(RTRIM(pc.PRODUTO)) = @caProduto
      ORDER BY pc.COR_PRODUTO
    `);
    return r.recordset.map((row) => ({
      cor: limpar(row.COR),
      descCor: limpar(row.DESC_COR),
      codigos: Number(row.CODIGOS) || 0,
    }));
  });
}

async function fetchCatalogoCores(produto: string, filtroEmpresa: string): Promise<CorCatalogo[]> {
  const rows = await withRequest(async (request) => {
    request.input('ccProduto', sql.VarChar, produto);
    const r = await request.query<CorCatalogoRow>(`
      SELECT LTRIM(RTRIM(cb.COR)) AS COR,
             LTRIM(RTRIM(ISNULL(cb.DESC_COR, ''))) AS DESC_BASICA,
             emp.DESC_EMPRESA,
             emp.USOS,
             exata.COR_NO_PRODUTO,
             exata.DESC_NO_PRODUTO,
             equiv.COR_EQUIVALENTE,
             equiv.DESC_EQUIVALENTE
      FROM CORES_BASICAS cb WITH (NOLOCK)
      -- Nome que a empresa realmente usa nesse código (o mais frequente).
      OUTER APPLY (
        SELECT TOP 1
          LTRIM(RTRIM(ISNULL(pc.DESC_COR_PRODUTO, ''))) AS DESC_EMPRESA,
          COUNT(*) AS USOS
        FROM PRODUTO_CORES pc WITH (NOLOCK)
        JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pc.PRODUTO
        WHERE pc.COR_PRODUTO = cb.COR
          ${filtroEmpresa}
        GROUP BY LTRIM(RTRIM(ISNULL(pc.DESC_COR_PRODUTO, '')))
        ORDER BY COUNT(*) DESC, LTRIM(RTRIM(ISNULL(pc.DESC_COR_PRODUTO, '')))
      ) emp
      -- Já está no produto com a chave exata?
      OUTER APPLY (
        SELECT TOP 1 LTRIM(RTRIM(pc.COR_PRODUTO)) AS COR_NO_PRODUTO,
                     LTRIM(RTRIM(ISNULL(pc.DESC_COR_PRODUTO, ''))) AS DESC_NO_PRODUTO
        FROM PRODUTO_CORES pc WITH (NOLOCK)
        WHERE LTRIM(RTRIM(pc.PRODUTO)) = @ccProduto AND pc.COR_PRODUTO = cb.COR
      ) exata
      -- ...ou com o mesmo número em outro formato ('6' vs '06')?
      OUTER APPLY (
        SELECT TOP 1 LTRIM(RTRIM(pc.COR_PRODUTO)) AS COR_EQUIVALENTE,
                     LTRIM(RTRIM(ISNULL(pc.DESC_COR_PRODUTO, ''))) AS DESC_EQUIVALENTE
        FROM PRODUTO_CORES pc WITH (NOLOCK)
        WHERE LTRIM(RTRIM(pc.PRODUTO)) = @ccProduto
          AND pc.COR_PRODUTO <> cb.COR
          AND TRY_CONVERT(INT, pc.COR_PRODUTO) IS NOT NULL
          AND TRY_CONVERT(INT, pc.COR_PRODUTO) = TRY_CONVERT(INT, cb.COR)
      ) equiv
      WHERE ISNULL(cb.USO_PRODUTOS, 0) = 1
      ORDER BY
        CASE WHEN emp.USOS IS NULL THEN 1 ELSE 0 END,
        ISNULL(emp.USOS, 0) DESC,
        LTRIM(RTRIM(cb.COR))
    `);
    return r.recordset;
  });

  return rows.map((row) => ({
    cor: limpar(row.COR),
    descBasica: limpar(row.DESC_BASICA),
    descEmpresa: limpar(row.DESC_EMPRESA) || null,
    usosEmpresa: Number(row.USOS ?? 0) || 0,
    jaNoProduto: Boolean(limpar(row.COR_NO_PRODUTO)),
    conflitoDeFormato: !limpar(row.COR_NO_PRODUTO) && Boolean(limpar(row.COR_EQUIVALENTE)),
    corEquivalente: limpar(row.COR_EQUIVALENTE) || null,
    descNoProduto: limpar(row.DESC_NO_PRODUTO) || limpar(row.DESC_EQUIVALENTE) || null,
  }));
}

/**
 * Prévia dos próximos códigos. Usa a MESMA procedure do Linx da gravação, só em
 * modo leitura (`@UPDATE_SEQUENCIAL = 0`), que não consome sequencial nenhum —
 * assim a prévia não pode divergir da regra real por descuido nosso.
 *
 * Ainda é só conferência: o valor que vale é o alocado dentro da transação,
 * porque o Linx pode consumir os mesmos números no meio do caminho.
 */
async function fetchPreviaSequenciais(empresa: number | null): Promise<{
  prefixo: string;
  proximoInterno: string;
  proximoEan: string;
}> {
  return withRequest(async (request) => {
    request.input('psEmpresa', sql.Int, empresa);
    const r = await request.query<{ PREFIXO: string; INTERNO: string; EAN: string }>(`
      SET NOCOUNT ON;
      DECLARE @prefixo VARCHAR(10), @interno VARCHAR(20), @ean VARCHAR(20);
      SELECT @prefixo = LTRIM(RTRIM(VALOR_ATUAL)) FROM PARAMETROS WITH (NOLOCK) WHERE PARAMETRO = 'EAN_13';
      EXEC LX_SEQUENCIAL @TABELA_COLUNA = 'PRODUTOS_BARRA.CODIGO_BARRA',
                         @EMPRESA = @psEmpresa, @SEQUENCIA = @interno OUTPUT, @UPDATE_SEQUENCIAL = 0;
      EXEC LX_SEQUENCIAL @TABELA_COLUNA = 'PRODUTOS_BARRA.CODIGO_EAN',
                         @EMPRESA = @psEmpresa, @SEQUENCIA = @ean OUTPUT, @UPDATE_SEQUENCIAL = 0;
      SELECT @prefixo AS PREFIXO, LTRIM(RTRIM(@interno)) AS INTERNO, LTRIM(RTRIM(@ean)) AS EAN;
    `);
    const row = r.recordset[0];
    const prefixo = limpar(row?.PREFIXO);
    const refEan = limpar(row?.EAN);
    return {
      prefixo,
      proximoInterno: limpar(row?.INTERNO),
      proximoEan: prefixo && refEan ? completarEan13(prefixo + refEan) : '',
    };
  });
}

/**
 * Dígito verificador EAN-13 (pesos 1/3 da esquerda para a direita).
 *
 * Usado só na PRÉVIA da tela — o código que vai para o banco é montado dentro do
 * batch, em T-SQL, para não depender de uma segunda ida ao servidor. As duas
 * contas são a mesma e conferem com os 44.039 EANs '7898586' já gravados.
 */
export function completarEan13(doze: string): string {
  const d = limpar(doze);
  if (!/^\d{12}$/.test(d)) return '';
  let soma = 0;
  for (let i = 0; i < 12; i += 1) {
    soma += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return d + String((10 - (soma % 10)) % 10);
}

/* ═══════════════════════ gravação ═══════════════════════ */

export interface CodigoCriado {
  tamanho: number;
  grade: string;
  interno: string;
  ean: string;
}

export interface ResultadoAdicionarCor {
  lote: string;
  produto: string;
  descProduto: string;
  cor: string;
  descCor: string;
  codigos: CodigoCriado[];
  /** Linhas de preço por cor copiadas da cor irmã (produto com VARIA_PRECO_COR). */
  precoPorCorCopiado: number;
  avisos: string[];
}

interface BarraCriadaRow {
  TAMANHO: number;
  GRADE: string;
  TIPO_COD_BAR: number;
  CODIGO_BARRA: string;
}

/**
 * Batch único, parametrizado — roda igual na conexão direta e via proxy (onde
 * cada requisição é isolada e não existe transação entre statements).
 *
 * `SET NOCOUNT ON` garante um único recordset (o SELECT final), que é o que o
 * proxy/mssql devolve em `.recordset`.
 */
function montarBatch(): string {
  const values = Array.from({ length: MAX_TAMANHOS }, (_, i) => `(${i + 1}, pt.TAMANHO_${i + 1})`).join(', ');

  return `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY

  DECLARE @produtoCh CHAR(12) = @acProduto;
  DECLARE @corCh     CHAR(10) = @acCor;

  IF NOT EXISTS (SELECT 1 FROM PRODUTOS WITH (UPDLOCK, HOLDLOCK) WHERE PRODUTO = @produtoCh)
    BEGIN ;THROW 51001, 'Produto não existe no cadastro do Linx.', 1; END

  -- CORES_BASICAS é FK obrigatória: o trigger LXI_PRODUTO_CORES barraria, mas a
  -- mensagem dele é ilegível. Melhor recusar aqui, com nome.
  IF NOT EXISTS (SELECT 1 FROM CORES_BASICAS WHERE COR = @corCh)
    BEGIN ;THROW 51002, 'Essa cor não existe no cadastro de cores do Linx (CORES_BASICAS).', 1; END

  IF EXISTS (SELECT 1 FROM PRODUTO_CORES WITH (UPDLOCK, HOLDLOCK)
              WHERE PRODUTO = @produtoCh AND COR_PRODUTO = @corCh)
    BEGIN ;THROW 51003, 'O produto já tem essa cor.', 1; END

  -- '06' e '6' são a mesma cor para o resto do sistema. Criar a segunda forma
  -- duplicaria a cor na tela de etiquetas e no estoque.
  IF EXISTS (SELECT 1 FROM PRODUTO_CORES WITH (UPDLOCK, HOLDLOCK)
              WHERE PRODUTO = @produtoCh
                AND TRY_CONVERT(INT, COR_PRODUTO) IS NOT NULL
                AND TRY_CONVERT(INT, COR_PRODUTO) = TRY_CONVERT(INT, @corCh))
    BEGIN ;THROW 51004, 'O produto já tem essa cor com o código escrito de outra forma (ex.: 6 e 06). Use a cor que já existe.', 1; END

  /* ── 1) a cor ──────────────────────────────────────────────────────────
     Campos de cadastro copiados de uma cor irmã (é o que o ERP mostra ao
     duplicar a linha); sem irmã, caem para os valores do próprio produto.
     STATUS_VENDA_ATUAL '1' + 1990-01-01/2099-12-31 é o padrão em 30.893 das
     30.895 linhas da tabela. */
  INSERT INTO PRODUTO_CORES (
    PRODUTO, COR_PRODUTO, COR, DESC_COR_PRODUTO, STATUS_VENDA_ATUAL,
    INICIO_VENDAS, FIM_VENDAS, COR_SORTIDA, TINTURARIA_LAVAGEM, LX_STATUS_REGISTRO, SORTIMENTO_COR,
    CUSTO_REPOSICAO1, PRECO_REPOSICAO_1, PRECO_A_VISTA_REPOSICAO_1, CLASSIF_FISCAL, TRIBUT_ORIGEM
  )
  SELECT @produtoCh, @corCh, @corCh, @acDesc, '1',
         '1990-01-01', '2099-12-31', 0, 0, 0, 0,
         COALESCE(irma.CUSTO_REPOSICAO1,  p.CUSTO_REPOSICAO1,  0),
         COALESCE(irma.PRECO_REPOSICAO_1, p.PRECO_REPOSICAO_1, 0),
         COALESCE(irma.PRECO_A_VISTA_REPOSICAO_1, 0),
         COALESCE(irma.CLASSIF_FISCAL, p.CLASSIF_FISCAL),
         COALESCE(irma.TRIBUT_ORIGEM,  p.TRIBUT_ORIGEM)
  FROM PRODUTOS p
  OUTER APPLY (
    SELECT TOP 1 pc.* FROM PRODUTO_CORES pc
    WHERE pc.PRODUTO = p.PRODUTO ORDER BY pc.COR_PRODUTO
  ) irma
  WHERE p.PRODUTO = @produtoCh;

  IF @@ROWCOUNT <> 1 BEGIN ;THROW 51005, 'A cor não foi criada (nenhuma linha inserida).', 1; END

  /* ── 2) tamanhos ───────────────────────────────────────────────────────
     Espelha o que as cores irmãs já têm; sem irmã, lê a grade; sem grade,
     tamanho único 'U'. Mesma escada de fetchTamanhosParaCriar. */
  DECLARE @tam TABLE (ORDEM INT IDENTITY(1,1), TAMANHO INT, GRADE VARCHAR(8));

  INSERT @tam (TAMANHO, GRADE)
  SELECT DISTINCT pb.TAMANHO, LEFT(LTRIM(RTRIM(pb.GRADE)), 8)
  FROM PRODUTOS_BARRA pb
  WHERE pb.PRODUTO = @produtoCh AND pb.COR_PRODUTO <> @corCh;

  IF NOT EXISTS (SELECT 1 FROM @tam)
    INSERT @tam (TAMANHO, GRADE)
    SELECT v.n, LEFT(LTRIM(RTRIM(CAST(v.t AS VARCHAR(20)))), 8)
    FROM PRODUTOS p
    JOIN PRODUTOS_TAMANHOS pt
      ON LTRIM(RTRIM(CAST(pt.GRADE AS VARCHAR(60)))) = LTRIM(RTRIM(CAST(p.GRADE AS VARCHAR(60))))
    CROSS APPLY (VALUES ${values}) v(n, t)
    WHERE p.PRODUTO = @produtoCh
      AND LTRIM(RTRIM(ISNULL(CAST(v.t AS VARCHAR(20)), ''))) <> '';

  IF NOT EXISTS (SELECT 1 FROM @tam) INSERT @tam (TAMANHO, GRADE) VALUES (1, 'U');

  /* ── 3) um par de códigos por tamanho ──────────────────────────────────
     NADA de constante nossa aqui: o prefixo do EAN é parâmetro do ERP e os
     números vêm da procedure do próprio Linx (LX_SEQUENCIAL), que é quem sabe
     o TAMANHO do sequencial e a regra de sequencial por empresa. */
  DECLARE @prefixo VARCHAR(10);
  SELECT @prefixo = LTRIM(RTRIM(VALOR_ATUAL)) FROM PARAMETROS WHERE PARAMETRO = 'EAN_13';
  IF @prefixo IS NULL OR LEN(@prefixo) = 0
    BEGIN ;THROW 51006, 'PARAMETROS.EAN_13 (prefixo do código de barras) está vazio no Linx.', 1; END

  -- A empresa do produto: LX_SEQUENCIAL usa para achar EMPRESA_SEQUENCIAIS
  -- quando o parâmetro CTRL_MULTI_EMPRESA está ligado (hoje está, e a tabela
  -- está vazia — mas se um dia tiver linha, a procedure resolve sozinha).
  DECLARE @empresa INT = (SELECT TOP 1 EMPRESA FROM PRODUTOS WHERE PRODUTO = @produtoCh);

  DECLARE @idx INT = 0, @total INT = (SELECT COUNT(*) FROM @tam);
  DECLARE @t INT, @g VARCHAR(8), @seqTxt VARCHAR(20), @cod VARCHAR(25), @ean12 VARCHAR(20);
  DECLARE @soma INT, @i INT, @i2 INT, @dv INT;

  WHILE @idx < @total
  BEGIN
    SET @idx += 1;
    SELECT @t = TAMANHO, @g = GRADE FROM @tam WHERE ORDEM = @idx;

    /* interno (TIPO_COD_BAR = 3): sequencial PRODUTOS_BARRA.CODIGO_BARRA.
       O laço existe porque o Linx pode ter gravado à mão um código que a
       sequência ainda vai passar — nesse caso pula para o próximo. */
    SET @cod = NULL; SET @i = 0;
    WHILE @cod IS NULL AND @i < 50
    BEGIN
      SET @i += 1;
      SET @seqTxt = NULL;
      EXEC LX_SEQUENCIAL @TABELA_COLUNA = 'PRODUTOS_BARRA.CODIGO_BARRA',
                         @EMPRESA = @empresa,
                         @SEQUENCIA = @seqTxt OUTPUT,
                         @UPDATE_SEQUENCIAL = 1;
      -- A procedure monta a mensagem de erro mas volta sem levantar quando o
      -- sequencial não existe (@SEQUENCIA fica nulo) — a checagem é nossa.
      IF @seqTxt IS NULL OR TRY_CONVERT(BIGINT, @seqTxt) IS NULL
        BEGIN ;THROW 51007, 'Sequencial PRODUTOS_BARRA.CODIGO_BARRA não encontrado em SEQUENCIAIS.', 1; END
      -- Zero = a sequência estourou o TAMANHO e voltou para o começo.
      IF TRY_CONVERT(BIGINT, @seqTxt) = 0
        BEGIN ;THROW 51008, 'Sequencial de código interno esgotado (voltou a zero) — precisa aumentar o TAMANHO em SEQUENCIAIS.', 1; END
      SET @cod = LTRIM(RTRIM(@seqTxt));
      IF EXISTS (SELECT 1 FROM PRODUTOS_BARRA WHERE CODIGO_BARRA = @cod) SET @cod = NULL;
    END
    IF @cod IS NULL BEGIN ;THROW 51009, 'Não foi possível alocar um código interno livre.', 1; END

    INSERT INTO PRODUTOS_BARRA (CODIGO_BARRA, PRODUTO, COR_PRODUTO, TAMANHO, GRADE,
                                CODIGO_BARRA_PADRAO, INATIVO, TIPO_COD_BAR, LX_STATUS_REGISTRO)
    VALUES (@cod, @produtoCh, @corCh, @t, @g, 0, 0, 3, 0);

    /* EAN-13 (TIPO_COD_BAR = 1): prefixo do ERP + sequencial
       PRODUTOS_BARRA.CODIGO_EAN + dígito verificador.
       O DV é a única conta que fica do nosso lado — o banco não tem rotina para
       isso (nenhum objeto do Linx lê o parâmetro EAN_13). É o algoritmo padrão
       EAN-13, conferido contra os 44.039 EANs já gravados. */
    SET @cod = NULL; SET @i = 0;
    WHILE @cod IS NULL AND @i < 50
    BEGIN
      SET @i += 1;
      SET @seqTxt = NULL;
      EXEC LX_SEQUENCIAL @TABELA_COLUNA = 'PRODUTOS_BARRA.CODIGO_EAN',
                         @EMPRESA = @empresa,
                         @SEQUENCIA = @seqTxt OUTPUT,
                         @UPDATE_SEQUENCIAL = 1;
      IF @seqTxt IS NULL OR TRY_CONVERT(BIGINT, @seqTxt) IS NULL
        BEGIN ;THROW 51010, 'Sequencial PRODUTOS_BARRA.CODIGO_EAN não encontrado em SEQUENCIAIS.', 1; END
      IF TRY_CONVERT(BIGINT, @seqTxt) = 0
        BEGIN ;THROW 51011, 'Sequencial de EAN esgotado (voltou a zero) — precisa de novo prefixo GS1.', 1; END

      SET @ean12 = LTRIM(RTRIM(@prefixo)) + LTRIM(RTRIM(@seqTxt));
      -- Prefixo + sequencial TEM que fechar 12 dígitos: quem define os tamanhos
      -- é o cadastro do ERP (PARAMETROS.EAN_13 e SEQUENCIAIS.TAMANHO), então se
      -- alguém mexer lá é melhor recusar do que gerar EAN inválido.
      IF LEN(@ean12) <> 12
        BEGIN ;THROW 51013, 'Prefixo EAN_13 + sequencial não fecham 12 dígitos — confira PARAMETROS.EAN_13 e o TAMANHO do sequencial PRODUTOS_BARRA.CODIGO_EAN.', 1; END
      SET @soma = 0; SET @i2 = 1;
      WHILE @i2 <= 12
      BEGIN
        SET @soma = @soma + CAST(SUBSTRING(@ean12, @i2, 1) AS INT) * CASE WHEN @i2 % 2 = 0 THEN 3 ELSE 1 END;
        SET @i2 += 1;
      END
      SET @dv = (10 - (@soma % 10)) % 10;
      SET @cod = @ean12 + CAST(@dv AS VARCHAR(1));
      IF EXISTS (SELECT 1 FROM PRODUTOS_BARRA WHERE CODIGO_BARRA = @cod) SET @cod = NULL;
    END
    IF @cod IS NULL BEGIN ;THROW 51012, 'Não foi possível alocar um EAN livre.', 1; END

    INSERT INTO PRODUTOS_BARRA (CODIGO_BARRA, PRODUTO, COR_PRODUTO, TAMANHO, GRADE,
                                CODIGO_BARRA_PADRAO, INATIVO, TIPO_COD_BAR, LX_STATUS_REGISTRO)
    VALUES (@cod, @produtoCh, @corCh, @t, @g, 0, 0, 1, 0);
  END

  /* ── 4) preço por cor ──────────────────────────────────────────────────
     Só para produto com VARIA_PRECO_COR = 1: nele o preço mora em
     PRODUTOS_PRECO_COR (o trigger de PRODUTO_CORES, que replica
     PRODUTOS_PRECO_FILIAL, ignora esse caso de propósito). Sem essas linhas a
     cor nova nasceria sem preço nenhum. Copiamos da cor irmã.

     UMA TABELA DE PREÇO POR STATEMENT, de propósito — não é estilo, é
     obrigatório. O trigger LXI_PRODUTOS_PRECO_COR replica para
     PRODUTOS_PRECO_FILIAL usando SELECT DISTINCT sobre um UNION ALL de
     INSERTED com as tabelas que têm INSERTED como base. Inserindo as 14 tabelas
     de uma vez, a mesma tabela aparece duas vezes com preços diferentes, o
     DISTINCT não colapsa e estoura a PK XPKPRODUTOS_PRECO_FILIAL (confirmado em
     ensaio). Linha a linha — como a tela do ERP faz — o trigger acerta, e o
     próprio guard dele (E.CODIGO_TAB_PRECO IS NULL) evita repetir o que já foi
     criado nas voltas anteriores.

     PRODUTOS_PRECO_FILIAL, portanto, NÃO é tocado aqui: quem cria é o trigger.
     Mexer na mão duplicava — mesma armadilha da exclusão de romaneio. */
  DECLARE @precoCor INT = 0;

  IF EXISTS (SELECT 1 FROM PRODUTOS WHERE PRODUTO = @produtoCh AND ISNULL(VARIA_PRECO_COR, 0) = 1)
  BEGIN
    DECLARE @corBase CHAR(10) = (
      SELECT TOP 1 pp.COR_PRODUTO FROM PRODUTOS_PRECO_COR pp
      WHERE pp.PRODUTO = @produtoCh AND pp.COR_PRODUTO <> @corCh
      ORDER BY pp.COR_PRODUTO
    );

    IF @corBase IS NOT NULL
    BEGIN
      DECLARE @tabs TABLE (ORDEM INT IDENTITY(1,1), TAB VARCHAR(10));
      INSERT @tabs (TAB)
      SELECT LTRIM(RTRIM(b.CODIGO_TAB_PRECO))
      FROM PRODUTOS_PRECO_COR b
      WHERE b.PRODUTO = @produtoCh AND b.COR_PRODUTO = @corBase
        AND NOT EXISTS (
          SELECT 1 FROM PRODUTOS_PRECO_COR e
          WHERE e.CODIGO_TAB_PRECO = b.CODIGO_TAB_PRECO AND e.PRODUTO = @produtoCh AND e.COR_PRODUTO = @corCh
        )
      ORDER BY b.CODIGO_TAB_PRECO;

      DECLARE @tabIdx INT = 0, @tabTotal INT = (SELECT COUNT(*) FROM @tabs), @tab VARCHAR(10);
      WHILE @tabIdx < @tabTotal
      BEGIN
        SET @tabIdx += 1;
        SELECT @tab = TAB FROM @tabs WHERE ORDEM = @tabIdx;

        INSERT INTO PRODUTOS_PRECO_COR (
          CODIGO_TAB_PRECO, PRODUTO, COR_PRODUTO, PRECO1, PRECO2, PRECO3, PRECO4,
          PRECO_LIQUIDO1, PRECO_LIQUIDO2, PRECO_LIQUIDO3, PRECO_LIQUIDO4,
          MARK_UP_PREVISTO, PROMOCAO_DESCONTO, LX_STATUS_REGISTRO
        )
        SELECT b.CODIGO_TAB_PRECO, @produtoCh, @corCh, b.PRECO1, b.PRECO2, b.PRECO3, b.PRECO4,
               b.PRECO_LIQUIDO1, b.PRECO_LIQUIDO2, b.PRECO_LIQUIDO3, b.PRECO_LIQUIDO4,
               b.MARK_UP_PREVISTO, b.PROMOCAO_DESCONTO, 0
        FROM PRODUTOS_PRECO_COR b
        WHERE b.PRODUTO = @produtoCh AND b.COR_PRODUTO = @corBase
          AND LTRIM(RTRIM(b.CODIGO_TAB_PRECO)) = @tab
          -- Recheca A CADA VOLTA, não só na montagem da lista: o próprio
          -- trigger cascateia a tabela base para as tabelas FILHAS
          -- (FX_RETORNA_TABELAS_FILHAS), calculando o preço por
          -- PORCENTAGEM_TABELA_BASE. Essa linha já existe quando chegarmos nela
          -- — e o preço do ERP vale mais que a cópia da cor irmã.
          AND NOT EXISTS (
            SELECT 1 FROM PRODUTOS_PRECO_COR e
            WHERE e.CODIGO_TAB_PRECO = b.CODIGO_TAB_PRECO
              AND e.PRODUTO = @produtoCh AND e.COR_PRODUTO = @corCh
          );

        SET @precoCor = @precoCor + @@ROWCOUNT;
      END
    END
  END

  COMMIT;

  SELECT pb.TAMANHO, LTRIM(RTRIM(pb.GRADE)) AS GRADE, pb.TIPO_COD_BAR,
         LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(25)))) AS CODIGO_BARRA,
         @precoCor AS PRECO_COR
  FROM PRODUTOS_BARRA pb WITH (NOLOCK)
  WHERE pb.PRODUTO = @produtoCh AND pb.COR_PRODUTO = @corCh
  ORDER BY pb.TAMANHO, pb.TIPO_COD_BAR;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  ;THROW;
END CATCH`;
}

/**
 * Cria a cor no produto com os códigos de barra, exatamente como o Linx faria.
 *
 * Fluxo da casa: valida → grava (batch atômico) → RELÊ do banco para confirmar
 * → só então registra no histórico de cadastro. Se a releitura não achar os
 * códigos, nada vai para o histórico e o erro sobe para a tela.
 */
export async function adicionarCorAoProduto(params: {
  company: CorCompany;
  usuario: string;
  produto: string;
  cor: string;
  descCor: string;
  obs?: string | null;
}): Promise<ResultadoAdicionarCor> {
  const produto = limpar(params.produto);
  const cor = limpar(params.cor).toUpperCase();
  const descCor = limpar(params.descCor).toUpperCase();

  if (!produto) throw new Error('Informe o produto.');
  if (!cor) throw new Error('Escolha a cor.');
  if (cor.length > 10) throw new Error(`O código da cor tem ${cor.length} caracteres; o limite do Linx é 10.`);
  if (!descCor) throw new Error('Informe a descrição da cor (é ela que sai na etiqueta).');
  if (descCor.length > 40) {
    throw new Error(`A descrição tem ${descCor.length} caracteres; o limite do Linx é 40.`);
  }

  // Estado ANTES, para o histórico contar a verdade e para a mensagem de erro
  // saber o nome do produto.
  const antes = await fetchPreviaAdicionarCor(params.company, produto);

  const barras = await withRequest(async (request) => {
    request.input('acProduto', sql.VarChar, produto);
    request.input('acCor', sql.VarChar, cor);
    request.input('acDesc', sql.VarChar, descCor);
    try {
      const r = await request.query<BarraCriadaRow & { PRECO_COR: number }>(montarBatch());
      return r.recordset;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/PRIMARY KEY|duplicate key|UNIQUE KEY|XPKPRODUTO/i.test(msg)) {
        throw new Error(
          'Conflito ao gravar no Linx (a cor ou um código de barra já existia). Nada foi criado — recarregue e tente de novo.'
        );
      }
      throw new Error(`Falha ao criar a cor no Linx: ${msg}`);
    }
  });

  // Releitura de confirmação, fora da transação: só acreditamos no que o banco
  // devolve depois do COMMIT.
  const confirmadas = await withRequest(async (request) => {
    request.input('cfProduto', sql.VarChar, produto);
    request.input('cfCor', sql.VarChar, cor);
    const r = await request.query<BarraCriadaRow>(`
      SELECT pb.TAMANHO, LTRIM(RTRIM(pb.GRADE)) AS GRADE, pb.TIPO_COD_BAR,
             LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(25)))) AS CODIGO_BARRA
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      JOIN PRODUTO_CORES pc WITH (NOLOCK)
        ON pc.PRODUTO = pb.PRODUTO AND pc.COR_PRODUTO = pb.COR_PRODUTO
      WHERE LTRIM(RTRIM(pb.PRODUTO)) = @cfProduto AND LTRIM(RTRIM(pb.COR_PRODUTO)) = @cfCor
      ORDER BY pb.TAMANHO, pb.TIPO_COD_BAR
    `);
    return r.recordset;
  });

  if (confirmadas.length === 0) {
    throw new Error(
      'O banco não confirmou a criação da cor. Nada foi registrado no histórico — confira no Linx antes de tentar de novo.'
    );
  }

  const porTamanho = new Map<number, CodigoCriado>();
  for (const row of confirmadas) {
    const tamanho = Number(row.TAMANHO) || 1;
    const atual = porTamanho.get(tamanho) ?? {
      tamanho,
      grade: limpar(row.GRADE),
      interno: '',
      ean: '',
    };
    const codigo = limpar(row.CODIGO_BARRA);
    if (Number(row.TIPO_COD_BAR) === 1 || /^\d{13}$/.test(codigo)) atual.ean = codigo;
    else atual.interno = codigo;
    porTamanho.set(tamanho, atual);
  }
  const codigos = [...porTamanho.values()].sort((a, b) => a.tamanho - b.tamanho);

  const precoPorCorCopiado = Number(barras[0]?.PRECO_COR ?? 0) || 0;

  const avisos: string[] = [];
  const semPar = codigos.filter((c) => !c.interno || !c.ean);
  if (semPar.length > 0) {
    avisos.push(
      `Atenção: ${semPar.length} tamanho(s) ficaram sem o par completo de códigos (interno + EAN). Confira no Linx.`
    );
  }
  if (antes.variaPrecoCor) {
    avisos.push(
      precoPorCorCopiado > 0
        ? `Produto com preço por cor: ${precoPorCorCopiado} linha(s) de preço copiadas da cor irmã.`
        : 'Produto com preço por cor e sem cor irmã para copiar: cadastre o preço da cor nova no Linx.'
    );
  }
  avisos.push(
    'Criar cor não tem desfazer: PRODUTO_CORES não tem campo de inativo. Se foi engano, remova no Linx antes de a cor receber estoque ou venda.'
  );

  const resumoTamanhos = codigos
    .map((c) => `${c.grade || c.tamanho}: ${c.interno}/${c.ean}`)
    .join(' · ')
    .slice(0, 300);

  const lote = await registrarHistoricoCadastro({
    company: params.company,
    usuario: params.usuario,
    obs: params.obs ?? 'Cor adicionada pela tela de Imprimir Etiquetas',
    linhas: [
      {
        escopo: 'PRODUTO',
        acao: 'CRIAR',
        dimensao: null,
        alvo: produto,
        chave: `${produto}|${cor}`,
        pai: null,
        campo: 'Cor do produto',
        anterior: null,
        novo: `${cor} ${descCor} — ${codigos.length} tamanho(s), ${confirmadas.length} código(s): ${resumoTamanhos}`,
        produtos: 1,
      },
    ],
  });

  return {
    lote,
    produto,
    descProduto: antes.descProduto,
    cor,
    descCor,
    codigos,
    precoPorCorCopiado,
    avisos,
  };
}
