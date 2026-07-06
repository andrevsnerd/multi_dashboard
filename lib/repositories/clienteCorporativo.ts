import "server-only";

import sql from "mssql";
import { query, withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import type {
  ClienteCorporativoCriado,
  ClienteCorporativoDetalhe,
  ClienteCorporativoInput,
  ClienteCorporativoListItem,
  CorporativoLookups,
  EnderecoBloco,
  OptionItem,
} from "@/lib/corporativo/types";

/**
 * Repositório da área CORPORATIVO — cadastro de clientes atacado direto no Linx.
 *
 * Grava em CADASTRO_CLI_FOR (mestre) + CLIENTES_ATACADO (atacado) numa única
 * transação, alocando o código de forma atômica a partir de SEQUENCIAIS
 * (TABELA_COLUNA = 'CLIENTES_ATACADO.CLIFOR'). O NOME_CLIFOR (PK) é resolvido
 * dentro da transação para garantir unicidade sem corrida.
 */

const SEQ_KEY = "CLIENTES_ATACADO.CLIFOR";

// ── Helpers de sanitização ──────────────────────────────────────────────────
const onlyDigits = (s: string | undefined | null): string => String(s ?? "").replace(/\D/g, "");
const up = (s: string | undefined | null): string => String(s ?? "").trim().toUpperCase();
const cut = (s: string | undefined | null, n: number): string => up(s).slice(0, n);
/** Corta preservando caixa (para e-mail, complemento etc.). */
const cutRaw = (s: string | undefined | null, n: number): string => String(s ?? "").trim().slice(0, n);

// ── Lookups ───────────────────────────────────────────────────────────────

export async function fetchCorporativoLookups(): Promise<CorporativoLookups> {
  const [
    condicoesPgto,
    tabelasPreco,
    transportadoras,
    conceitos,
    pontualidades,
    tipos,
    filiais,
    proximoCodigoPreview,
  ] = await Promise.all([
    fetchCondicoesPgto(),
    fetchTabelasPreco(),
    fetchTransportadoras(),
    fetchConceitos(),
    fetchPontualidades(),
    fetchTipos(),
    fetchFiliais(),
    fetchProximoCodigoPreview(),
  ]);

  return {
    condicoesPgto,
    tabelasPreco,
    transportadoras,
    conceitos,
    pontualidades,
    tipos,
    filiais,
    // Regiões e tipos de tributação são estáveis — lista fixa evita varredura.
    regioes: ["CENTRO OESTE", "NORDESTE", "NORTE", "SUDESTE", "SUL"].map((r) => ({ value: r, label: r })),
    tiposTributacao: ["SIMPLES NACIONAL", "PRESUMIDO", "REAL"].map((t) => ({ value: t, label: t })),
    indicadoresFiscais: [
      { value: "8", label: "8 - Não Contribuinte" },
      { value: "1", label: "1 - Empresa (Industrial/Comercial)" },
      { value: "2", label: "2 - Produtor Rural" },
      { value: "6", label: "6 - Consumidor Final" },
      { value: "7", label: "7 - Órgão Público" },
    ],
    proximoCodigoPreview,
  };
}

async function fetchCondicoesPgto(): Promise<OptionItem[]> {
  const rows = await query<{ CONDICAO_PGTO: string; DESC_COND_PGTO: string }>(
    `SELECT LTRIM(RTRIM(CONDICAO_PGTO)) AS CONDICAO_PGTO, LTRIM(RTRIM(DESC_COND_PGTO)) AS DESC_COND_PGTO
     FROM COND_ATAC_PGTOS WITH (NOLOCK) ORDER BY CONDICAO_PGTO`
  );
  return rows
    .filter((r) => r.CONDICAO_PGTO)
    .map((r) => ({ value: r.CONDICAO_PGTO, label: `${r.CONDICAO_PGTO} - ${r.DESC_COND_PGTO || ""}`.trim() }));
}

async function fetchTabelasPreco(): Promise<OptionItem[]> {
  const rows = await query<{ CODIGO_TAB_PRECO: string; TABELA: string }>(
    `SELECT LTRIM(RTRIM(CODIGO_TAB_PRECO)) AS CODIGO_TAB_PRECO, LTRIM(RTRIM(TABELA)) AS TABELA
     FROM TABELAS_PRECO WITH (NOLOCK) WHERE STATUS = 'A' ORDER BY CODIGO_TAB_PRECO`
  );
  return rows
    .filter((r) => r.CODIGO_TAB_PRECO)
    .map((r) => ({ value: r.CODIGO_TAB_PRECO, label: `${r.CODIGO_TAB_PRECO} - ${r.TABELA || ""}`.trim() }));
}

async function fetchTransportadoras(): Promise<OptionItem[]> {
  const rows = await query<{ TRANSPORTADORA: string }>(
    `SELECT DISTINCT LTRIM(RTRIM(TRANSPORTADORA)) AS TRANSPORTADORA
     FROM TRANSPORTADORAS WITH (NOLOCK) WHERE TRANSPORTADORA IS NOT NULL AND LTRIM(RTRIM(TRANSPORTADORA)) <> '' ORDER BY TRANSPORTADORA`
  );
  return rows.map((r) => ({ value: r.TRANSPORTADORA, label: r.TRANSPORTADORA }));
}

async function fetchConceitos(): Promise<OptionItem[]> {
  const rows = await query<{ CONCEITO: string }>(
    `SELECT LTRIM(RTRIM(CONCEITO)) AS CONCEITO FROM CLIENTE_CONCEITOS WITH (NOLOCK) ORDER BY PESO_DO_CONCEITO`
  );
  return rows.filter((r) => r.CONCEITO).map((r) => ({ value: r.CONCEITO, label: r.CONCEITO }));
}

async function fetchPontualidades(): Promise<OptionItem[]> {
  const rows = await query<{ PONTUALIDADE: string }>(
    `SELECT LTRIM(RTRIM(PONTUALIDADE)) AS PONTUALIDADE FROM CLIENTE_ATAC_PONT WITH (NOLOCK) ORDER BY PESO_PONTUALIDADE`
  );
  return rows.filter((r) => r.PONTUALIDADE).map((r) => ({ value: r.PONTUALIDADE, label: r.PONTUALIDADE }));
}

async function fetchTipos(): Promise<OptionItem[]> {
  const rows = await query<{ TIPO: string }>(
    `SELECT LTRIM(RTRIM(TIPO)) AS TIPO FROM CLIENTE_ATAC_TIPOS WITH (NOLOCK) ORDER BY TIPO`
  );
  return rows.filter((r) => r.TIPO).map((r) => ({ value: r.TIPO, label: r.TIPO }));
}

async function fetchFiliais(): Promise<OptionItem[]> {
  const rows = await query<{ FILIAL: string }>(
    `SELECT DISTINCT LTRIM(RTRIM(FILIAL)) AS FILIAL FROM FILIAIS WITH (NOLOCK)
     WHERE FILIAL IS NOT NULL AND LTRIM(RTRIM(FILIAL)) <> '' ORDER BY FILIAL`
  );
  return rows.map((r) => ({ value: r.FILIAL, label: r.FILIAL }));
}

export async function fetchProximoCodigoPreview(): Promise<string> {
  const rows = await query<{ prox: number }>(
    `SELECT CAST(SEQUENCIA AS INT) + 1 AS prox FROM SEQUENCIAIS WITH (NOLOCK) WHERE TABELA_COLUNA = '${SEQ_KEY}'`
  );
  const n = rows[0]?.prox;
  return n ? padCodigo(n) : "";
}

function padCodigo(n: number): string {
  return String(n).padStart(6, "0").slice(-6);
}

// ── Listagem / dedupe ────────────────────────────────────────────────────────

export async function listClientesCorporativos(params: {
  search?: string;
  limit?: number;
}): Promise<ClienteCorporativoListItem[]> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const search = (params.search ?? "").trim();
  const searchDigits = onlyDigits(search);

  return withRequest(async (request: sql.Request | RequestLike) => {
    request.input("limit", sql.Int, limit);
    let where = "";
    if (search) {
      request.input("search", sql.VarChar, `%${search.toUpperCase()}%`);
      request.input("searchDigits", sql.VarChar, `%${searchDigits}%`);
      where = `WHERE (UPPER(cf.NOME_CLIFOR) LIKE @search OR UPPER(cf.RAZAO_SOCIAL) LIKE @search
        OR LTRIM(RTRIM(cf.CLIFOR)) LIKE @search
        ${searchDigits ? "OR cf.CGC_CPF LIKE @searchDigits" : ""})`;
    }
    const text = `
      SELECT TOP (@limit)
        LTRIM(RTRIM(cf.CLIFOR)) AS codigo,
        LTRIM(RTRIM(cf.NOME_CLIFOR)) AS nome,
        LTRIM(RTRIM(cf.RAZAO_SOCIAL)) AS razao,
        LTRIM(RTRIM(cf.CGC_CPF)) AS cpf,
        cf.PJ_PF AS pj,
        ISNULL(LTRIM(RTRIM(cf.CIDADE)), '') AS cidade,
        ISNULL(cf.UF, '') AS uf,
        LTRIM(RTRIM(ISNULL(cf.DDD1,''))) + ' ' + LTRIM(RTRIM(ISNULL(cf.TELEFONE1,''))) AS telefone,
        ISNULL(LTRIM(RTRIM(cf.EMAIL)), '') AS email,
        ISNULL(LTRIM(RTRIM(ca.FILIAL)), '') AS filial,
        ISNULL(LTRIM(RTRIM(ca.TIPO)), '') AS tipo,
        cf.CADASTRAMENTO AS cadastramento,
        ISNULL(ca.INATIVO, 0) AS inativo
      FROM CLIENTES_ATACADO ca WITH (NOLOCK)
      INNER JOIN CADASTRO_CLI_FOR cf WITH (NOLOCK) ON LTRIM(RTRIM(cf.CLIFOR)) = LTRIM(RTRIM(ca.CLIFOR))
      ${where}
      ORDER BY cf.CADASTRAMENTO DESC`;
    const result = await request.query(text);
    return (result.recordset as RawListRow[]).map(mapListRow);
  });
}

interface RawListRow {
  codigo: string;
  nome: string;
  razao: string;
  cpf: string;
  pj: boolean;
  cidade: string;
  uf: string;
  telefone: string;
  email: string;
  filial: string;
  tipo: string;
  cadastramento: Date | string | null;
  inativo: boolean;
}

function mapListRow(r: RawListRow): ClienteCorporativoListItem {
  const cpf = String(r.cpf ?? "");
  return {
    codigo: r.codigo,
    nomeClifor: r.nome,
    razaoSocial: r.razao,
    cpfCnpj: cpf,
    tipoPessoa: r.pj ? "PJ" : "PF",
    cidade: r.cidade ?? "",
    uf: r.uf ?? "",
    telefone: (r.telefone ?? "").trim(),
    email: r.email ?? "",
    filial: r.filial ?? "",
    tipo: r.tipo ?? "",
    cadastramento: r.cadastramento ? new Date(r.cadastramento).toISOString() : null,
    inativo: Boolean(r.inativo),
  };
}

interface RawDetalheRow {
  codigo: string;
  nome: string;
  razao: string;
  cpf: string;
  pj: boolean;
  rgIe: string;
  im: string | null;
  tipoTributacao: string | null;
  indicadorFiscal: number | null;
  suframa: string | null;

  cep: string; endereco: string; numero: string; complemento: string;
  bairro: string; cidade: string; uf: string; ibge: string;

  cobCep: string; cobEndereco: string; cobNumero: string; cobComplemento: string;
  cobBairro: string; cobCidade: string; cobUf: string; cobIbge: string;

  entCep: string; entEndereco: string; entNumero: string; entComplemento: string;
  entBairro: string; entCidade: string; entUf: string; entIbge: string;

  ddd1: string; tel1: string; ddd2: string; tel2: string;
  email: string | null; emailNfe: string | null; aniversario: Date | string | null;

  filial: string; condicaoPgto: string; condicaoPgtoDesc: string | null;
  codigoTabPreco: string; codigoTabPrecoDesc: string | null;
  transportadora: string; regiao: string; conceito: string; tipo: string;
  pontualidade: string; limiteCredito: number; indicadorVenda: string;
  matrizCliente: string; observacao: string | null;

  cadastramento: Date | string | null;
  inativo: boolean;
}

/** Busca o cadastro completo (mestre + comercial) de um cliente pelo código. */
export async function fetchClienteCorporativoDetalhe(
  codigo: string
): Promise<ClienteCorporativoDetalhe | null> {
  const cod = onlyDigits(codigo).padStart(6, "0").slice(-6);
  if (!cod) return null;

  const rows = await withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    req.input("codigo", cod);
    const result = await req.query(`
      SELECT
        LTRIM(RTRIM(cf.CLIFOR)) AS codigo,
        LTRIM(RTRIM(cf.NOME_CLIFOR)) AS nome,
        LTRIM(RTRIM(cf.RAZAO_SOCIAL)) AS razao,
        LTRIM(RTRIM(cf.CGC_CPF)) AS cpf,
        cf.PJ_PF AS pj,
        LTRIM(RTRIM(cf.RG_IE)) AS rgIe,
        LTRIM(RTRIM(cf.IM)) AS im,
        LTRIM(RTRIM(cf.TIPO_TRIBUTACAO)) AS tipoTributacao,
        cf.INDICADOR_FISCAL_TERCEIRO AS indicadorFiscal,
        LTRIM(RTRIM(cf.INSCRICAO_SUFRAMA)) AS suframa,

        LTRIM(RTRIM(cf.CEP)) AS cep, LTRIM(RTRIM(cf.ENDERECO)) AS endereco,
        LTRIM(RTRIM(cf.NUMERO)) AS numero, LTRIM(RTRIM(cf.COMPLEMENTO)) AS complemento,
        LTRIM(RTRIM(cf.BAIRRO)) AS bairro, LTRIM(RTRIM(cf.CIDADE)) AS cidade,
        LTRIM(RTRIM(cf.UF)) AS uf, LTRIM(RTRIM(cf.COD_MUNICIPIO_IBGE)) AS ibge,

        LTRIM(RTRIM(cf.COBRANCA_CEP)) AS cobCep, LTRIM(RTRIM(cf.COBRANCA_ENDERECO)) AS cobEndereco,
        LTRIM(RTRIM(cf.COBRANCA_NUMERO)) AS cobNumero, LTRIM(RTRIM(cf.COBRANCA_COMPLEMENTO)) AS cobComplemento,
        LTRIM(RTRIM(cf.COBRANCA_BAIRRO)) AS cobBairro, LTRIM(RTRIM(cf.COBRANCA_CIDADE)) AS cobCidade,
        LTRIM(RTRIM(cf.COBRANCA_UF)) AS cobUf, LTRIM(RTRIM(cf.COD_MUNICIPIO_IBGE_COBRANCA)) AS cobIbge,

        LTRIM(RTRIM(cf.ENTREGA_CEP)) AS entCep, LTRIM(RTRIM(cf.ENTREGA_ENDERECO)) AS entEndereco,
        LTRIM(RTRIM(cf.ENTREGA_NUMERO)) AS entNumero, LTRIM(RTRIM(cf.ENTREGA_COMPLEMENTO)) AS entComplemento,
        LTRIM(RTRIM(cf.ENTREGA_BAIRRO)) AS entBairro, LTRIM(RTRIM(cf.ENTREGA_CIDADE)) AS entCidade,
        LTRIM(RTRIM(cf.ENTREGA_UF)) AS entUf, LTRIM(RTRIM(cf.COD_MUNICIPIO_IBGE_ENTREGA)) AS entIbge,

        LTRIM(RTRIM(cf.DDD1)) AS ddd1, LTRIM(RTRIM(cf.TELEFONE1)) AS tel1,
        LTRIM(RTRIM(cf.DDD2)) AS ddd2, LTRIM(RTRIM(cf.TELEFONE2)) AS tel2,
        LTRIM(RTRIM(cf.EMAIL)) AS email, LTRIM(RTRIM(cf.EMAIL_NFE)) AS emailNfe, cf.ANIVERSARIO AS aniversario,

        LTRIM(RTRIM(ca.FILIAL)) AS filial,
        LTRIM(RTRIM(ca.CONDICAO_PGTO)) AS condicaoPgto, LTRIM(RTRIM(cp.DESC_COND_PGTO)) AS condicaoPgtoDesc,
        LTRIM(RTRIM(ca.CODIGO_TAB_PRECO)) AS codigoTabPreco, LTRIM(RTRIM(tp.TABELA)) AS codigoTabPrecoDesc,
        LTRIM(RTRIM(ca.TRANSPORTADORA)) AS transportadora, LTRIM(RTRIM(ca.REGIAO)) AS regiao,
        LTRIM(RTRIM(ca.CONCEITO)) AS conceito, LTRIM(RTRIM(ca.TIPO)) AS tipo,
        LTRIM(RTRIM(ca.PONTUALIDADE)) AS pontualidade, ISNULL(ca.LIMITE_CREDITO, 0) AS limiteCredito,
        LTRIM(RTRIM(ca.INDICADOR_VENDA)) AS indicadorVenda, LTRIM(RTRIM(ca.MATRIZ_CLIENTE)) AS matrizCliente,
        ca.OBS AS observacao,

        cf.CADASTRAMENTO AS cadastramento, ISNULL(ca.INATIVO, 0) AS inativo
      FROM CADASTRO_CLI_FOR cf WITH (NOLOCK)
      LEFT JOIN CLIENTES_ATACADO ca WITH (NOLOCK) ON LTRIM(RTRIM(ca.CLIFOR)) = LTRIM(RTRIM(cf.CLIFOR))
      LEFT JOIN COND_ATAC_PGTOS cp WITH (NOLOCK) ON LTRIM(RTRIM(cp.CONDICAO_PGTO)) = LTRIM(RTRIM(ca.CONDICAO_PGTO))
      LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON LTRIM(RTRIM(tp.CODIGO_TAB_PRECO)) = LTRIM(RTRIM(ca.CODIGO_TAB_PRECO))
      WHERE LTRIM(RTRIM(cf.CLIFOR)) = @codigo`);
    return result.recordset as RawDetalheRow[];
  });

  const r = rows[0];
  if (!r) return null;

  const endereco = { cep: r.cep, endereco: r.endereco, numero: r.numero, complemento: r.complemento, bairro: r.bairro, cidade: r.cidade, uf: r.uf, codMunicipioIbge: r.ibge };
  const cobranca = { cep: r.cobCep, endereco: r.cobEndereco, numero: r.cobNumero, complemento: r.cobComplemento, bairro: r.cobBairro, cidade: r.cobCidade, uf: r.cobUf, codMunicipioIbge: r.cobIbge };
  const entrega = { cep: r.entCep, endereco: r.entEndereco, numero: r.entNumero, complemento: r.entComplemento, bairro: r.entBairro, cidade: r.entCidade, uf: r.entUf, codMunicipioIbge: r.entIbge };

  return {
    codigo: r.codigo,
    nomeClifor: r.nome,
    razaoSocial: r.razao,
    cpfCnpj: r.cpf ?? "",
    tipoPessoa: r.pj ? "PJ" : "PF",
    rgIe: r.rgIe ?? "",
    inscricaoMunicipal: r.im ?? "",
    tipoTributacao: r.tipoTributacao ?? "",
    indicadorFiscal: r.indicadorFiscal != null ? String(r.indicadorFiscal) : "",
    suframa: r.suframa ?? "",
    endereco,
    cobranca,
    entrega,
    enderecoCobrancaIgual: enderecoIguais(endereco, cobranca),
    enderecoEntregaIgual: enderecoIguais(endereco, entrega),
    ddd1: r.ddd1 ?? "",
    telefone1: r.tel1 ?? "",
    ddd2: r.ddd2 ?? "",
    telefone2: r.tel2 ?? "",
    email: r.email ?? "",
    emailNfe: r.emailNfe ?? "",
    aniversario: r.aniversario ? new Date(r.aniversario).toISOString() : null,
    filial: r.filial ?? "",
    condicaoPgto: r.condicaoPgto ?? "",
    condicaoPgtoDescricao: r.condicaoPgtoDesc ?? "",
    codigoTabPreco: r.codigoTabPreco ?? "",
    codigoTabPrecoDescricao: r.codigoTabPrecoDesc ?? "",
    transportadora: r.transportadora ?? "",
    regiao: r.regiao ?? "",
    conceito: r.conceito ?? "",
    tipo: r.tipo ?? "",
    pontualidade: r.pontualidade ?? "",
    limiteCredito: Number(r.limiteCredito) || 0,
    indicadorVenda: r.indicadorVenda ?? "",
    matrizCliente: r.matrizCliente ?? "",
    observacao: r.observacao ?? "",
    cadastramento: r.cadastramento ? new Date(r.cadastramento).toISOString() : null,
    inativo: Boolean(r.inativo),
  };
}

function enderecoIguais(a: EnderecoBloco, b: EnderecoBloco): boolean {
  return (
    a.cep === b.cep &&
    a.endereco === b.endereco &&
    a.bairro === b.bairro &&
    a.cidade === b.cidade &&
    a.uf === b.uf
  );
}

/** Busca cliente existente pelo documento (para avisar duplicidade). */
export async function buscarClientePorDocumento(
  cpfCnpj: string
): Promise<{ codigo: string; nome: string; razao: string } | null> {
  const digits = onlyDigits(cpfCnpj);
  if (!digits) return null;
  const rows = await withRequest(async (request: sql.Request | RequestLike) => {
    request.input("doc", sql.VarChar, digits);
    const result = await request.query(
      `SELECT TOP 1 LTRIM(RTRIM(CLIFOR)) AS codigo, LTRIM(RTRIM(NOME_CLIFOR)) AS nome, LTRIM(RTRIM(RAZAO_SOCIAL)) AS razao
       FROM CADASTRO_CLI_FOR WITH (NOLOCK) WHERE CGC_CPF = @doc OR CGC_CPF = LTRIM(RTRIM(@doc))`
    );
    return result.recordset as { codigo: string; nome: string; razao: string }[];
  });
  return rows[0] ?? null;
}

// ── Criação (transacional) ────────────────────────────────────────────────────

/** Normaliza um bloco de endereço para gravação (dígitos/limites do Linx). */
function normEndereco(b: EnderecoBloco): {
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  ibge: string;
  pais: string;
} {
  return {
    cep: onlyDigits(b.cep).slice(0, 9),
    endereco: cut(b.endereco, 90),
    numero: cutRaw(b.numero, 10),
    complemento: cutRaw(b.complemento, 60),
    bairro: cut(b.bairro, 25),
    cidade: cut(b.cidade, 35),
    uf: cut(b.uf, 2),
    ibge: onlyDigits(b.codMunicipioIbge).slice(0, 10),
    pais: cut(b.pais || "BRASIL", 35),
  };
}

export async function criarClienteCorporativo(
  input: ClienteCorporativoInput
): Promise<ClienteCorporativoCriado> {
  const isPJ = input.tipoPessoa === "PJ";
  const digits = onlyDigits(input.cpfCnpj);
  if (isPJ ? digits.length !== 14 : digits.length !== 11) {
    throw new Error(isPJ ? "CNPJ inválido (14 dígitos)." : "CPF inválido (11 dígitos).");
  }
  const razao = cut(input.razaoSocial, 90);
  if (!razao) throw new Error("Razão social / nome é obrigatório.");
  const nomeBase = cut(input.nomeFantasia || input.razaoSocial, 25);
  if (!nomeBase) throw new Error("Nome do cliente é obrigatório.");

  const rgIe = cut(input.rgIe, 19) || "ISENTO";

  const principal = normEndereco({
    cep: input.cep,
    endereco: input.endereco,
    numero: input.numero,
    complemento: input.complemento,
    bairro: input.bairro,
    cidade: input.cidade,
    uf: input.uf,
    codMunicipioIbge: input.codMunicipioIbge,
    pais: input.pais,
  });
  if (!principal.uf) throw new Error("UF é obrigatória.");
  if (!principal.ibge) throw new Error("Código IBGE do município é obrigatório (preencha via CEP).");

  const cobranca = input.mesmoEnderecoCobranca || !input.cobranca ? principal : normEndereco(input.cobranca);
  const entrega = input.mesmoEnderecoEntrega || !input.entrega ? principal : normEndereco(input.entrega);

  const ddd1 = onlyDigits(input.ddd1).slice(0, 5);
  const tel1 = onlyDigits(input.telefone1).slice(0, 10);
  const ddd2 = onlyDigits(input.ddd2).slice(0, 5);
  const tel2 = onlyDigits(input.telefone2).slice(0, 10);
  const email = cutRaw(input.email, 100);
  const emailNfe = cutRaw(input.emailNfe || input.email, 100);
  const indicadorFiscal = Number.isFinite(input.indicadorFiscal as number)
    ? Number(input.indicadorFiscal)
    : isPJ
      ? 1
      : 8;

  // Comercial (CLIENTES_ATACADO)
  const condicaoPgto = cut(input.condicaoPgto, 3) || "01";
  const codigoTabPreco = cut(input.codigoTabPreco, 2) || "01";
  const transportadora = cut(input.transportadora, 25) || "NOSSO CARRO";
  const regiao = cut(input.regiao, 25) || "SUDESTE";
  const conceito = cut(input.conceito, 25) || "BOM";
  const tipo = cut(input.tipo, 25) || "CORPORATIVO";
  const pontualidade = cut(input.pontualidade, 25) || "INDEFINIDO";
  const filial = cut(input.filial, 25);
  if (!filial) throw new Error("Filial é obrigatória.");
  const indicadorVenda = cutRaw(input.indicadorVenda, 1) || " ";
  const matrizCliente = cut(input.matrizCliente, 25) || nomeBase;
  const limiteCredito = Number.isFinite(input.limiteCredito as number) ? Number(input.limiteCredito) : 0;
  const observacao = cutRaw(input.observacao, 4000);

  const aniversario = (input.aniversario ?? "").trim(); // '' ou 'YYYY-MM-DD'
  const tipoTributacao = isPJ ? cut(input.tipoTributacao, 25) : "";
  const suframa = cut(input.suframa, 9);
  const im = cutRaw(input.inscricaoMunicipal, 15);

  return withRequest(async (request: sql.Request | RequestLike) => {
    // sql.Request tem overload de 2 args (infere tipo); ProxyRequest também aceita
    // (name, value). O cast evita o atrito com a assinatura 3-args de RequestLike.
    const req = request as sql.Request;
    const bind = (name: string, value: string | number) => req.input(name, value);

    bind("razao", razao);
    bind("nomeBase", nomeBase);
    bind("cgc", digits);
    bind("pjpf", isPJ ? 1 : 0);
    bind("rgIe", rgIe);
    // principal
    bind("cep", principal.cep);
    bind("endereco", principal.endereco);
    bind("numero", principal.numero);
    bind("complemento", principal.complemento);
    bind("bairro", principal.bairro);
    bind("cidade", principal.cidade);
    bind("uf", principal.uf);
    bind("ibge", principal.ibge);
    bind("pais", principal.pais);
    // cobrança
    bind("cobEndereco", cobranca.endereco);
    bind("cobNumero", cobranca.numero);
    bind("cobComplemento", cobranca.complemento);
    bind("cobBairro", cobranca.bairro);
    bind("cobCidade", cobranca.cidade);
    bind("cobUf", cobranca.uf);
    bind("cobCep", cobranca.cep);
    bind("cobPais", cobranca.pais);
    bind("cobIbge", cobranca.ibge);
    // entrega
    bind("entEndereco", entrega.endereco);
    bind("entNumero", entrega.numero);
    bind("entComplemento", entrega.complemento);
    bind("entBairro", entrega.bairro);
    bind("entCidade", entrega.cidade);
    bind("entUf", entrega.uf);
    bind("entCep", entrega.cep);
    bind("entPais", entrega.pais);
    bind("entIbge", entrega.ibge);
    // contato
    bind("ddd1", ddd1);
    bind("tel1", tel1);
    bind("ddd2", ddd2);
    bind("tel2", tel2);
    bind("email", email);
    bind("emailNfe", emailNfe);
    bind("aniversario", aniversario);
    // fiscais
    bind("indicadorFiscal", indicadorFiscal);
    bind("tipoTributacao", tipoTributacao);
    bind("suframa", suframa);
    bind("im", im);
    bind("agrupItens", isPJ ? 2 : 0);
    // comercial
    bind("condicaoPgto", condicaoPgto);
    bind("codigoTabPreco", codigoTabPreco);
    bind("transportadora", transportadora);
    bind("regiao", regiao);
    bind("conceito", conceito);
    bind("tipo", tipo);
    bind("pontualidade", pontualidade);
    bind("filial", filial);
    bind("indicadorVenda", indicadorVenda);
    bind("matrizCliente", matrizCliente);
    bind("limiteCredito", limiteCredito);
    bind("observacao", observacao);

    const batch = buildInsertBatch();
    let result;
    try {
      result = await request.query(batch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/PRIMARY KEY|duplicate key|UNIQUE KEY|XPKCADASTRO|XAK1|XAK2/i.test(msg)) {
        throw new Error(
          "Conflito ao gravar (nome ou código já existente). Ajuste o nome do cliente e tente novamente."
        );
      }
      throw new Error(`Falha ao cadastrar no Linx: ${msg}`);
    }
    const row = (result.recordset as { codigo: string; nome: string }[])[0];
    if (!row?.codigo) throw new Error("Cadastro não retornou o código gerado.");
    return {
      codigo: String(row.codigo).trim(),
      nomeClifor: String(row.nome).trim(),
      razaoSocial: razao,
      cpfCnpj: digits,
    };
  });
}

/**
 * Batch T-SQL único e parametrizado (roda igual em conexão direta e via proxy).
 * SET NOCOUNT ON garante um ÚNICO recordset (o SELECT final), que é o que o
 * proxy/mssql devolve em .recordset.
 */
function buildInsertBatch(): string {
  return `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
  DECLARE @novoCod INT;
  UPDATE SEQUENCIAIS WITH (UPDLOCK, HOLDLOCK)
     SET @novoCod = CAST(SEQUENCIA AS INT) + 1,
         SEQUENCIA = RIGHT('000000' + CAST(CAST(SEQUENCIA AS INT) + 1 AS VARCHAR(6)), 6)
   WHERE TABELA_COLUNA = '${SEQ_KEY}';

  IF @novoCod IS NULL
  BEGIN
    ;THROW 51000, 'Sequencial de cliente (CLIENTES_ATACADO.CLIFOR) não encontrado em SEQUENCIAIS.', 1;
  END

  DECLARE @codigo CHAR(6) = RIGHT('000000' + CAST(@novoCod AS VARCHAR(6)), 6);

  -- Resolve NOME_CLIFOR único (PK). Linx desambigua nomes iguais; aqui sufixamos.
  DECLARE @nome VARCHAR(25) = @nomeBase;
  DECLARE @i INT = 0;
  WHILE EXISTS (SELECT 1 FROM CADASTRO_CLI_FOR WITH (UPDLOCK, HOLDLOCK) WHERE NOME_CLIFOR = @nome)
     OR EXISTS (SELECT 1 FROM CLIENTES_ATACADO WITH (UPDLOCK, HOLDLOCK) WHERE CLIENTE_ATACADO = @nome)
  BEGIN
    SET @i = @i + 1;
    IF @i > 999 BEGIN ;THROW 51001, 'Não foi possível gerar um nome único para o cliente.', 1; END
    DECLARE @suf VARCHAR(4) = ' ' + CAST(@i AS VARCHAR(3));
    SET @nome = LEFT(@nomeBase, 25 - LEN(@suf)) + @suf;
  END

  DECLARE @aniv DATETIME = CASE WHEN LTRIM(RTRIM(@aniversario)) = '' THEN NULL
                                ELSE TRY_CONVERT(DATETIME, @aniversario, 120) END;

  INSERT INTO CADASTRO_CLI_FOR (
    NOME_CLIFOR, CLIFOR, COD_CLIFOR, CGC_CPF, RAZAO_SOCIAL, PJ_PF, RG_IE,
    CEP, ENDERECO, NUMERO, COMPLEMENTO, BAIRRO, CIDADE, UF, PAIS, COD_MUNICIPIO_IBGE,
    DDD1, TELEFONE1, DDD2, TELEFONE2, EMAIL, EMAIL_NFE, ANIVERSARIO,
    COBRANCA_ENDERECO, COBRANCA_NUMERO, COBRANCA_COMPLEMENTO, COBRANCA_BAIRRO, COBRANCA_CIDADE,
    COBRANCA_UF, COBRANCA_CEP, COBRANCA_DDD, COBRANCA_TELEFONE, COBRANCA_CGC, COBRANCA_IE,
    COBRANCA_PAIS, COBRANCA_RAZAO_SOCIAL, COD_MUNICIPIO_IBGE_COBRANCA,
    ENTREGA_ENDERECO, ENTREGA_NUMERO, ENTREGA_COMPLEMENTO, ENTREGA_BAIRRO, ENTREGA_CIDADE,
    ENTREGA_UF, ENTREGA_CEP, ENTREGA_DDD, ENTREGA_TELEFONE, ENTREGA_CGC, ENTREGA_IE,
    ENTREGA_PAIS, ENTREGA_RAZAO_SOCIAL, COD_MUNICIPIO_IBGE_ENTREGA,
    CADASTRAMENTO, DATA_PARA_TRANSFERENCIA,
    INDICA_FORNECEDOR, INDICA_CLIENTE, IND_REPRESENTANTE, INDICA_FILIAL,
    INATIVO, ISENTO_IPI, ISENTO_ICMS, ACEITA_DIAS_FIXO, INCL_AUTO_GRP_ECON, ENVIADO_SPC,
    LX_STATUS_REGISTRO, INDICA_CPRB, ATIVIDADE_SIMPLES_NACIONAL,
    INDICADOR_FISCAL_TERCEIRO, TIPO_TRIBUTACAO, INSCRICAO_SUFRAMA, IM,
    TIPO_RELACAO_COMERCIAL, AGRUPAMENTO_ITENS
  ) VALUES (
    @nome, @codigo, @codigo, @cgc, @razao, @pjpf, @rgIe,
    @cep, @endereco, @numero, @complemento, @bairro, @cidade, @uf, @pais, @ibge,
    @ddd1, @tel1, @ddd2, @tel2, NULLIF(@email,''), NULLIF(@emailNfe,''), @aniv,
    @cobEndereco, @cobNumero, @cobComplemento, @cobBairro, @cobCidade,
    @cobUf, @cobCep, @ddd1, @tel1, @cgc, @rgIe,
    @cobPais, @razao, @cobIbge,
    @entEndereco, @entNumero, @entComplemento, @entBairro, @entCidade,
    @entUf, @entCep, @ddd1, @tel1, @cgc, @rgIe,
    @entPais, @razao, @entIbge,
    GETDATE(), GETDATE(),
    0, 1, 0, 0,
    0, 0, 0, 0, 0, 0,
    0, 0, 0,
    @indicadorFiscal, NULLIF(@tipoTributacao,''), NULLIF(@suframa,''), NULLIF(@im,''),
    0, @agrupItens
  );

  INSERT INTO CLIENTES_ATACADO (
    CLIENTE_ATACADO, COD_CLIENTE, CLIFOR, CGC_CPF,
    CONDICAO_PGTO, REGIAO, FILIAL, PONTUALIDADE, TRANSPORTADORA, CONCEITO, TIPO, TIPO_BLOQUEIO,
    MATRIZ_CLIENTE, MOEDA, CODIGO_TAB_PRECO, LIMITE_CREDITO, SEM_CREDITO, ACEITA_JUNTAR_PED,
    INATIVO, INDICA_FRANQUIA, INDICADOR_VENDA, DATA_PARA_TRANSFERENCIA,
    EXPEDICAO_COMPLETO_PEDIDO, EXPEDICAO_COMPLETO_PACK, EXPEDICAO_COMPLETO_TAMANHOS,
    EXPEDICAO_COMPLETO_COR, EXPEDICAO_COMPLETO_COORDENADO, EXPEDICAO_COMPLETO_CARTELA,
    EXPEDICAO_COMPLETO_FAIXAS, MULTI_DESCONTO_ACUMULAR, CONTEUDO_XPED_NFE, OBS
  ) VALUES (
    @nome, @codigo, @codigo, @cgc,
    @condicaoPgto, @regiao, @filial, @pontualidade, @transportadora, @conceito, @tipo, 'INDEFINIDO',
    @matrizCliente, 'R$', @codigoTabPreco, @limiteCredito, 0, 0,
    0, 0, @indicadorVenda, GETDATE(),
    0, 0, 0,
    0, 0, 0,
    0, 0, 0, NULLIF(@observacao,'')
  );

  COMMIT;
  SELECT @codigo AS codigo, @nome AS nome;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  ;THROW;
END CATCH`;
}
