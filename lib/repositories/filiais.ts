import { query } from '@/lib/db/connection';

/**
 * Cadastro detalhado de filiais (espelha a tela 001013SPK do Linx).
 * Junta FILIAIS (dados operacionais/fiscais da unidade), EMPRESA (o "grupo"/entidade jurídica)
 * e CADASTRO_CLI_FOR (razão social, endereço e contato, ligados por CLIFOR).
 */

export interface FilialDetalhada {
  codFilial: string;
  filial: string;
  empresaCod: number | null;
  empresaNome: string;
  // Identificação fiscal
  cnpj: string;
  razaoSocial: string;
  inscricaoEstadual: string;
  inscricaoMunicipal: string;
  cnae: string;
  codigoSpc: string;
  cadastro: string | null; // ISO date
  tipoTributacao: string;
  matrizFiscal: string;
  matriz: string;
  // Endereço
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  ibge: string;
  cep: string;
  uf: string;
  pais: string;
  // Contato
  email: string;
  emailNfe: string;
  ddi: string;
  ddd1: string;
  telefone1: string;
  ddd2: string;
  telefone2: string;
  dddFax: string;
  fax: string;
  // Operacional
  tipoFilial: string;
  filialPropria: boolean;
  regiao: string;
  filialEspelho: string;
  fatorFilialEspelho: number | null;
  nomeResponsavel: string;
  dataAbertura: string | null;
  dataFechamento: string | null;
  inativo: boolean;
}

type Row = Record<string, unknown>;

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

function isoDate(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function fetchFiliaisDetalhadas(): Promise<FilialDetalhada[]> {
  const queryText = `
    SELECT
      RTRIM(fl.COD_FILIAL)        AS COD_FILIAL,
      RTRIM(fl.FILIAL)            AS FILIAL,
      fl.EMPRESA                  AS EMPRESA_COD,
      RTRIM(e.DESC_EMPRESA)       AS EMPRESA_NOME,
      RTRIM(fl.CGC_CPF)           AS CNPJ,
      RTRIM(c.RAZAO_SOCIAL)       AS RAZAO_SOCIAL,
      RTRIM(c.RG_IE)              AS IE,
      RTRIM(c.IM)                 AS IM,
      RTRIM(c.CNAE)               AS CNAE,
      RTRIM(c.CODIGO_SPC)         AS CODIGO_SPC,
      c.CADASTRAMENTO             AS CADASTRAMENTO,
      RTRIM(fl.TIPO_TRIBUTACAO)   AS TIPO_TRIB_FL,
      RTRIM(c.TIPO_TRIBUTACAO)    AS TIPO_TRIB_C,
      RTRIM(fl.MATRIZ_FISCAL)     AS MATRIZ_FISCAL,
      RTRIM(fl.MATRIZ)            AS MATRIZ,
      RTRIM(c.ENDERECO)           AS ENDERECO,
      RTRIM(c.NUMERO)             AS NUMERO,
      RTRIM(c.COMPLEMENTO)        AS COMPLEMENTO,
      RTRIM(c.BAIRRO)             AS BAIRRO,
      RTRIM(c.CIDADE)             AS CIDADE,
      RTRIM(c.COD_MUNICIPIO_IBGE) AS IBGE,
      RTRIM(c.CEP)                AS CEP,
      RTRIM(c.UF)                 AS UF,
      RTRIM(c.PAIS)               AS PAIS,
      RTRIM(c.EMAIL)              AS EMAIL,
      RTRIM(c.EMAIL_NFE)          AS EMAIL_NFE,
      RTRIM(c.DDI)                AS DDI,
      RTRIM(c.DDD1)               AS DDD1,
      RTRIM(c.TELEFONE1)          AS TELEFONE1,
      RTRIM(c.DDD2)               AS DDD2,
      RTRIM(c.TELEFONE2)          AS TELEFONE2,
      RTRIM(c.DDDFAX)             AS DDDFAX,
      RTRIM(c.FAX)                AS FAX,
      RTRIM(fl.TIPO_FILIAL)       AS TIPO_FILIAL,
      fl.FILIAL_PROPRIA           AS FILIAL_PROPRIA,
      RTRIM(fl.REGIAO)            AS REGIAO,
      RTRIM(fl.FILIAL_ESPELHO)    AS FILIAL_ESPELHO,
      fl.FATOR_FILIAL_ESPELHO     AS FATOR_FILIAL_ESPELHO,
      RTRIM(fl.NOME_RESPONSAVEL)  AS NOME_RESPONSAVEL,
      fl.DATA_ABERTURA            AS DATA_ABERTURA,
      fl.DATA_FECHAMENTO          AS DATA_FECHAMENTO,
      c.INATIVO                   AS INATIVO
    FROM FILIAIS fl WITH (NOLOCK)
    LEFT JOIN EMPRESA e WITH (NOLOCK) ON fl.EMPRESA = e.EMPRESA
    LEFT JOIN CADASTRO_CLI_FOR c WITH (NOLOCK) ON fl.CLIFOR = c.CLIFOR
    ORDER BY fl.EMPRESA, fl.COD_FILIAL
  `;

  const rows = await query<Row>(queryText);

  return rows.map((r): FilialDetalhada => ({
    codFilial: str(r.COD_FILIAL),
    filial: str(r.FILIAL),
    empresaCod: num(r.EMPRESA_COD),
    empresaNome: str(r.EMPRESA_NOME),
    cnpj: str(r.CNPJ),
    razaoSocial: str(r.RAZAO_SOCIAL),
    inscricaoEstadual: str(r.IE),
    inscricaoMunicipal: str(r.IM),
    cnae: str(r.CNAE),
    codigoSpc: str(r.CODIGO_SPC),
    cadastro: isoDate(r.CADASTRAMENTO),
    tipoTributacao: str(r.TIPO_TRIB_FL) || str(r.TIPO_TRIB_C),
    matrizFiscal: str(r.MATRIZ_FISCAL),
    matriz: str(r.MATRIZ),
    endereco: str(r.ENDERECO),
    numero: str(r.NUMERO),
    complemento: str(r.COMPLEMENTO),
    bairro: str(r.BAIRRO),
    cidade: str(r.CIDADE),
    ibge: str(r.IBGE),
    cep: str(r.CEP),
    uf: str(r.UF),
    pais: str(r.PAIS),
    email: str(r.EMAIL),
    emailNfe: str(r.EMAIL_NFE),
    ddi: str(r.DDI),
    ddd1: str(r.DDD1),
    telefone1: str(r.TELEFONE1),
    ddd2: str(r.DDD2),
    telefone2: str(r.TELEFONE2),
    dddFax: str(r.DDDFAX),
    fax: str(r.FAX),
    tipoFilial: str(r.TIPO_FILIAL),
    filialPropria: bool(r.FILIAL_PROPRIA),
    regiao: str(r.REGIAO),
    filialEspelho: str(r.FILIAL_ESPELHO),
    fatorFilialEspelho: num(r.FATOR_FILIAL_ESPELHO),
    nomeResponsavel: str(r.NOME_RESPONSAVEL),
    dataAbertura: isoDate(r.DATA_ABERTURA),
    dataFechamento: isoDate(r.DATA_FECHAMENTO),
    inativo: bool(r.INATIVO),
  }));
}
