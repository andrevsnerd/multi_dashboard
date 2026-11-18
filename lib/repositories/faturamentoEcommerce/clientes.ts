import "server-only";

import sql from "mssql";
import { query, withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { PADROES, REGIOES, INFO_PGTO_OPCOES, regiaoDaUf, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import { filiaisExtrasDaEmpresa, filiaisNotaDaEmpresa, sqlUltimaNfEcommerce } from "./filiais-nota";
import type {
  ClienteAtualizacaoInput,
  ClienteFatDetalhe,
  ClienteFatInput,
  ClienteFatListItem,
  EnderecoFat,
  FatLookups,
  FilialNotaOpcao,
  Opcao,
} from "@/lib/faturamento-ecommerce/types";

/**
 * Faturamento E-commerce — cadastro de cliente final (pessoa física do site) no Linx.
 *
 * Mesmo mecanismo do cadastro corporativo (CADASTRO_CLI_FOR + CLIENTES_ATACADO +
 * CLIENTE_REPRE numa transação, código de SEQUENCIAIS), com o padrão medido no
 * cadastro manual de e-commerce (docs/FATURAMENTO_SHOPIFY_LINX.md §3):
 *  - endereço igual nas 3 vias, CIDADE sem acento (vem de LCF_LX_MUNICIPIO pelo IBGE —
 *    o trigger do Linx casa CIDADE+UF por igualdade e recusa a gravação se não casar);
 *  - tudo em maiúsculas, DDD com zero ('067'), RG_IE 19 noves, indicador fiscal 8;
 *  - NOME_CLIFOR = 25 primeiros caracteres da razão social;
 *  - vínculo 'SEM REPRESENTANTE' sempre gravado.
 */

const SEQ_KEY = "CLIENTES_ATACADO.CLIFOR";

const onlyDigits = (s: unknown): string => String(s ?? "").replace(/\D/g, "");
const up = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const cut = (s: unknown, n: number): string => up(s).slice(0, n);
const trimStr = (s: unknown): string => String(s ?? "").trim();
const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

// ── Lookups ─────────────────────────────────────────────────────────────────

async function opcoes(sqlText: string, map: (r: Record<string, string>) => Opcao): Promise<Opcao[]> {
  const rows = await query<Record<string, string>>(sqlText);
  return rows.map(map).filter((o) => o.value);
}

/**
 * Filiais emissoras da empresa, com a série e o último número usado.
 *
 * Regra do rodízio: a PRINCIPAL é a perna do e-commerce que emitiu NF de e-commerce por
 * último. Ela vem primeiro na lista e já vem selecionada; se o operador faturar por outra
 * perna, na próxima carga essa outra passa a ser a principal — sem configurar nada.
 * A série de cada filial é a da última NF de e-commerce dela (ver serie.ts).
 *
 * As filiais EXTRAS (Matriz da Scarf Me) vêm por último e nunca são a principal: não
 * entram no rodízio, e cada uma traz as naturezas que usa de fato e o regime tributário.
 */
export async function fetchFiliaisNota(empresa: EmpresaFat): Promise<{ filiais: FilialNotaOpcao[]; padrao: string }> {
  const padrao = PADROES[empresa].nota;
  const filiais = await filiaisNotaDaEmpresa(empresa);
  const extras = await filiaisExtrasDaEmpresa(empresa);
  const extraDe = (f: string) => extras.find((x) => x.filial === f) ?? null;
  return withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    const nomes = filiais.map((f, i) => {
      req.input(`f${i}`, sql.VarChar(25), f);
      return `@f${i}`;
    });
    req.input("serie", sql.VarChar(6), padrao.serie);
    const r = await req.query(`
      SELECT LTRIM(RTRIM(FI.FILIAL)) AS filial, LTRIM(RTRIM(S.SERIE_NF)) AS serie,
             LTRIM(RTRIM(S.SEQUENCIAL)) AS ultimo, LTRIM(RTRIM(C.UF)) AS uf,
             U.EMISSAO AS ultimaEmissao, U.DATA_PARA_TRANSFERENCIA AS ultimaGravacao
        FROM FILIAIS FI WITH (NOLOCK)
        JOIN CADASTRO_CLI_FOR C WITH (NOLOCK) ON C.NOME_CLIFOR = FI.FILIAL
        OUTER APPLY (${sqlUltimaNfEcommerce("FI.FILIAL")}) U
        JOIN FATURAMENTO_SEQUENCIAIS S WITH (NOLOCK) ON S.FILIAL = FI.FILIAL AND S.SERIE_NF = ISNULL(U.SERIE_NF, @serie)
       WHERE FI.FILIAL IN (${nomes.join(",")})`);
    const rows = r.recordset as {
      filial: string;
      serie: string;
      ultimo: string;
      uf: string;
      ultimaEmissao: Date | null;
      ultimaGravacao: Date | null;
    }[];
    const t = (d: Date | null) => (d ? new Date(d).getTime() : 0);
    // Pernas do rodízio primeiro (mais recente primeiro: emissão e, no mesmo dia, hora da
    // gravação; sem NF nenhuma, vale a ordem do config); extras sempre no fim.
    const ordem = (f: string) => filiais.indexOf(f);
    const ordenadas = [...rows].sort(
      (a, b) =>
        Number(extraDe(a.filial) !== null) - Number(extraDe(b.filial) !== null) ||
        t(b.ultimaEmissao) - t(a.ultimaEmissao) ||
        t(b.ultimaGravacao) - t(a.ultimaGravacao) ||
        ordem(a.filial) - ordem(b.filial)
    );
    const rodizio = ordenadas.filter((r) => extraDe(r.filial) === null);
    return {
      filiais: ordenadas.map((r): FilialNotaOpcao => {
        const x = extraDe(r.filial);
        return {
          filial: r.filial,
          serie: r.serie,
          ultimoNumero: r.ultimo,
          uf: r.uf,
          ultimaEmissao: iso(r.ultimaEmissao),
          extra: x !== null,
          rotulo: x?.rotulo ?? null,
          simples: x ? x.simplesNacional : true,
          naturezaDentroUf: x?.naturezaDentroUf ?? padrao.naturezaDentroUf,
          naturezaForaUf: x?.naturezaForaUf ?? padrao.naturezaForaUf,
          naturezaRevenda: x?.naturezaRevenda ?? null,
        };
      }),
      padrao: rodizio[0]?.filial ?? filiais[0],
    };
  });
}

export async function fetchFatLookups(empresa: EmpresaFat): Promise<FatLookups> {
  // Sequencial: cada consulta numa chamada própria (um sql.Request roda 1 query por vez).
  const filiaisNota = await fetchFiliaisNota(empresa);
  const naturezas = await opcoes(
    `SELECT LTRIM(RTRIM(NATUREZA_SAIDA)) AS v, LTRIM(RTRIM(DESC_NATUREZA)) AS d
       FROM NATUREZAS_SAIDAS WITH (NOLOCK)
      WHERE ISNULL(INATIVO,0) = 0 AND (NATUREZA_SAIDA LIKE '100.%')
      ORDER BY NATUREZA_SAIDA`,
    (r) => ({ value: r.v, label: `${r.v} - ${r.d ?? ""}`.trim() })
  );
  const condicoesPgto = await opcoes(
    `SELECT LTRIM(RTRIM(CONDICAO_PGTO)) AS v, LTRIM(RTRIM(DESC_COND_PGTO)) AS d FROM COND_ATAC_PGTOS WITH (NOLOCK) ORDER BY CONDICAO_PGTO`,
    (r) => ({ value: r.v, label: `${r.v} - ${r.d ?? ""}`.trim() })
  );
  const tabelasPreco = await opcoes(
    `SELECT LTRIM(RTRIM(CODIGO_TAB_PRECO)) AS v, LTRIM(RTRIM(TABELA)) AS d FROM TABELAS_PRECO WITH (NOLOCK) WHERE STATUS = 'A' ORDER BY CODIGO_TAB_PRECO`,
    (r) => ({ value: r.v, label: `${r.v} - ${r.d ?? ""}`.trim() })
  );
  const transportadoras = await opcoes(
    `SELECT DISTINCT LTRIM(RTRIM(TRANSPORTADORA)) AS v FROM TRANSPORTADORAS WITH (NOLOCK)
      WHERE TRANSPORTADORA IS NOT NULL AND LTRIM(RTRIM(TRANSPORTADORA)) <> '' ORDER BY 1`,
    (r) => ({ value: r.v, label: r.v })
  );
  const tiposFrete = await opcoes(
    `SELECT LTRIM(RTRIM(TIPO_FRETE)) AS v, LTRIM(RTRIM(DESCRICAO_TIPO)) AS d FROM TIPO_FRETE WITH (NOLOCK) ORDER BY TIPO_FRETE`,
    (r) => ({ value: r.v, label: `${r.v} - ${r.d ?? ""}`.trim() })
  );
  const conceitos = await opcoes(
    `SELECT LTRIM(RTRIM(CONCEITO)) AS v FROM CLIENTE_CONCEITOS WITH (NOLOCK) ORDER BY PESO_DO_CONCEITO`,
    (r) => ({ value: r.v, label: r.v })
  );
  const pontualidades = await opcoes(
    `SELECT LTRIM(RTRIM(PONTUALIDADE)) AS v FROM CLIENTE_ATAC_PONT WITH (NOLOCK) ORDER BY PESO_PONTUALIDADE`,
    (r) => ({ value: r.v, label: r.v })
  );
  const tiposCliente = await opcoes(
    `SELECT LTRIM(RTRIM(TIPO)) AS v FROM CLIENTE_ATAC_TIPOS WITH (NOLOCK) ORDER BY TIPO`,
    (r) => ({ value: r.v, label: r.v })
  );
  const filiaisCliente = await opcoes(
    `SELECT DISTINCT LTRIM(RTRIM(FILIAL)) AS v FROM FILIAIS WITH (NOLOCK)
      WHERE FILIAL IS NOT NULL AND LTRIM(RTRIM(FILIAL)) <> '' ORDER BY 1`,
    (r) => ({ value: r.v, label: r.v })
  );
  const representantes = await opcoes(
    `SELECT LTRIM(RTRIM(REPRESENTANTE)) AS v FROM REPRESENTANTES WITH (NOLOCK) WHERE ISNULL(INATIVO,0) = 0
      ORDER BY CASE WHEN UPPER(LTRIM(RTRIM(REPRESENTANTE))) = 'SEM REPRESENTANTE' THEN 0 ELSE 1 END, REPRESENTANTE`,
    (r) => ({ value: r.v, label: r.v })
  );
  const prox = await query<{ prox: number }>(
    `SELECT CAST(SEQUENCIA AS INT) + 1 AS prox FROM SEQUENCIAIS WITH (NOLOCK) WHERE TABELA_COLUNA = '${SEQ_KEY}'`
  );

  return {
    empresa,
    filiaisNota: filiaisNota.filiais,
    filialNotaPadrao: filiaisNota.padrao,
    naturezas,
    condicoesPgto,
    tabelasPreco,
    transportadoras,
    tiposFrete,
    conceitos,
    pontualidades,
    tiposCliente,
    filiaisCliente,
    representantes,
    regioes: REGIOES.map((r) => ({ value: r, label: r })),
    infoPgto: INFO_PGTO_OPCOES,
    proximoCodigoCliente: prox[0]?.prox ? String(prox[0].prox).padStart(6, "0") : "",
  };
}

// ── Busca ───────────────────────────────────────────────────────────────────

/**
 * Busca clientes por CPF/CNPJ (exato), código (até 6 dígitos) ou nome (sem
 * diferenciar acento). `somenteEmpresa` restringe aos clientes da empresa: cadastro
 * na filial padrão dela ou com NF emitida por uma filial dela.
 */
export async function buscarClientesFat(params: {
  empresa: EmpresaFat;
  termo: string;
  somenteEmpresa: boolean;
  limit?: number;
}): Promise<ClienteFatListItem[]> {
  const termo = trimStr(params.termo);
  if (!termo) return [];
  const digits = onlyDigits(termo);
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const padrao = PADROES[params.empresa];
  const filiaisNota = params.somenteEmpresa ? await filiaisNotaDaEmpresa(params.empresa) : [];

  return withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    req.input("limit", sql.Int, limit);
    let where: string;
    if (digits.length === 11 || digits.length === 14) {
      req.input("doc", sql.VarChar(19), digits);
      where = "cf.CGC_CPF = @doc";
    } else if (digits.length > 0 && digits.length <= 6 && digits === termo.replace(/\s/g, "")) {
      req.input("cod", sql.VarChar(15), digits.padStart(6, "0"));
      where = "cf.CLIFOR = @cod";
    } else {
      req.input("nome", sql.VarChar(100), `%${up(termo)}%`);
      where = `(cf.RAZAO_SOCIAL COLLATE Latin1_General_CI_AI LIKE @nome
             OR cf.NOME_CLIFOR COLLATE Latin1_General_CI_AI LIKE @nome)`;
    }

    let escopo = "";
    if (params.somenteEmpresa) {
      req.input("filialCli", sql.VarChar(25), padrao.cliente.filial);
      const fs = filiaisNota.map((f, i) => {
        req.input(`fn${i}`, sql.VarChar(25), f);
        return `@fn${i}`;
      });
      escopo = `AND (ca.FILIAL = @filialCli OR EXISTS (SELECT 1 FROM FATURAMENTO fx WITH (NOLOCK)
                       WHERE fx.NOME_CLIFOR = cf.NOME_CLIFOR AND fx.FILIAL IN (${fs.join(",")})))`;
    }

    const r = await req.query(`
      SELECT TOP (@limit)
        LTRIM(RTRIM(cf.CLIFOR)) AS codigo, RTRIM(cf.NOME_CLIFOR) AS nome, LTRIM(RTRIM(cf.RAZAO_SOCIAL)) AS razao,
        LTRIM(RTRIM(cf.CGC_CPF)) AS cpf, LTRIM(RTRIM(ISNULL(cf.CIDADE,''))) AS cidade, LTRIM(RTRIM(ISNULL(cf.UF,''))) AS uf,
        LTRIM(RTRIM(ISNULL(ca.FILIAL,''))) AS filial, LTRIM(RTRIM(ISNULL(ca.TIPO,''))) AS tipo, cf.CADASTRAMENTO AS cadastramento,
        LTRIM(RTRIM(nf.NF_SAIDA)) AS ultimaNf, LTRIM(RTRIM(nf.FILIAL)) AS ultimaNfFilial, nf.EMISSAO AS ultimaNfEmissao
      FROM CADASTRO_CLI_FOR cf WITH (NOLOCK)
      JOIN CLIENTES_ATACADO ca WITH (NOLOCK) ON ca.CLIENTE_ATACADO = cf.NOME_CLIFOR
      OUTER APPLY (SELECT TOP 1 F.NF_SAIDA, F.FILIAL, F.EMISSAO FROM FATURAMENTO F WITH (NOLOCK)
                    WHERE F.NOME_CLIFOR = cf.NOME_CLIFOR AND F.NOTA_CANCELADA = 0
                    ORDER BY F.EMISSAO DESC, F.NF_SAIDA DESC) nf
      WHERE ${where} ${escopo}
      ORDER BY cf.CADASTRAMENTO DESC, cf.CLIFOR DESC`);

    return (r.recordset as Record<string, unknown>[]).map((x) => ({
      codigo: String(x.codigo ?? ""),
      nomeClifor: String(x.nome ?? ""),
      razaoSocial: String(x.razao ?? ""),
      cpfCnpj: String(x.cpf ?? ""),
      cidade: String(x.cidade ?? ""),
      uf: String(x.uf ?? ""),
      filial: String(x.filial ?? ""),
      tipo: String(x.tipo ?? ""),
      cadastramento: iso(x.cadastramento as Date | null),
      ultimaNf: (x.ultimaNf as string) || null,
      ultimaNfFilial: (x.ultimaNfFilial as string) || null,
      ultimaNfEmissao: iso(x.ultimaNfEmissao as Date | null),
    }));
  });
}

// ── Detalhe ─────────────────────────────────────────────────────────────────

export async function fetchClienteFat(codigo: string): Promise<ClienteFatDetalhe | null> {
  const cod = onlyDigits(codigo).padStart(6, "0").slice(-6);
  if (!onlyDigits(codigo)) return null;
  const rows = await withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    req.input("cod", sql.VarChar(15), cod);
    const r = await req.query(`
      SELECT TOP 1
        LTRIM(RTRIM(cf.CLIFOR)) AS codigo, RTRIM(cf.NOME_CLIFOR) AS nome, LTRIM(RTRIM(cf.RAZAO_SOCIAL)) AS razao,
        LTRIM(RTRIM(cf.CGC_CPF)) AS cpf, cf.PJ_PF AS pj, LTRIM(RTRIM(cf.RG_IE)) AS rgIe,
        cf.INDICADOR_FISCAL_TERCEIRO AS indicadorFiscal,
        LTRIM(RTRIM(cf.CEP)) AS cep, LTRIM(RTRIM(cf.ENDERECO)) AS endereco, LTRIM(RTRIM(cf.NUMERO)) AS numero,
        LTRIM(RTRIM(cf.COMPLEMENTO)) AS complemento, LTRIM(RTRIM(cf.BAIRRO)) AS bairro, LTRIM(RTRIM(cf.CIDADE)) AS cidade,
        LTRIM(RTRIM(cf.UF)) AS uf, LTRIM(RTRIM(cf.COD_MUNICIPIO_IBGE)) AS ibge,
        CASE WHEN ISNULL(cf.ENTREGA_ENDERECO,'') <> ISNULL(cf.ENDERECO,'') OR ISNULL(cf.ENTREGA_CEP,'') <> ISNULL(cf.CEP,'')
             THEN 1 ELSE 0 END AS entregaDif,
        LTRIM(RTRIM(cf.DDD1)) AS ddd, LTRIM(RTRIM(cf.TELEFONE1)) AS tel,
        LTRIM(RTRIM(cf.EMAIL)) AS email, LTRIM(RTRIM(cf.EMAIL_NFE)) AS emailNfe,
        LTRIM(RTRIM(ca.FILIAL)) AS filial, LTRIM(RTRIM(ca.TIPO)) AS tipo, LTRIM(RTRIM(ca.CONCEITO)) AS conceito,
        LTRIM(RTRIM(ca.PONTUALIDADE)) AS pontualidade, LTRIM(RTRIM(ca.TRANSPORTADORA)) AS transportadora,
        LTRIM(RTRIM(ca.CONDICAO_PGTO)) AS condicaoPgto, LTRIM(RTRIM(ca.CODIGO_TAB_PRECO)) AS tab,
        LTRIM(RTRIM(ca.CTB_CONTA_CONTABIL)) AS conta, LTRIM(RTRIM(ca.REGIAO)) AS regiao,
        (SELECT TOP 1 LTRIM(RTRIM(cr.REPRESENTANTE)) FROM CLIENTE_REPRE cr WITH (NOLOCK)
          WHERE cr.CLIENTE_ATACADO = ca.CLIENTE_ATACADO ORDER BY cr.REPRESENTANTE_PRINCIPAL DESC) AS representante,
        cf.CADASTRAMENTO AS cadastramento
      FROM CADASTRO_CLI_FOR cf WITH (NOLOCK)
      LEFT JOIN CLIENTES_ATACADO ca WITH (NOLOCK) ON ca.CLIENTE_ATACADO = cf.NOME_CLIFOR
      WHERE cf.CLIFOR = @cod`);
    return r.recordset as Record<string, unknown>[];
  });
  const x = rows[0];
  if (!x) return null;
  const s = (k: string) => String(x[k] ?? "");
  return {
    codigo: s("codigo"),
    nomeClifor: s("nome"),
    razaoSocial: s("razao"),
    cpfCnpj: s("cpf"),
    pessoaJuridica: Boolean(x.pj),
    rgIe: s("rgIe"),
    indicadorFiscal: x.indicadorFiscal != null ? String(x.indicadorFiscal) : "",
    endereco: {
      cep: s("cep"),
      endereco: s("endereco"),
      numero: s("numero"),
      complemento: s("complemento"),
      bairro: s("bairro"),
      cidade: s("cidade"),
      uf: s("uf"),
      codMunicipioIbge: s("ibge"),
    },
    enderecoEntregaDiferente: Number(x.entregaDif) === 1,
    ddd: s("ddd"),
    telefone: s("tel"),
    email: s("email"),
    emailNfe: s("emailNfe"),
    filial: s("filial"),
    tipo: s("tipo"),
    conceito: s("conceito"),
    pontualidade: s("pontualidade"),
    transportadora: s("transportadora"),
    condicaoPgto: s("condicaoPgto"),
    codigoTabPreco: s("tab"),
    contaContabil: s("conta"),
    regiao: s("regiao"),
    representante: s("representante"),
    cadastramento: iso(x.cadastramento as Date | null),
  };
}

/** Todos os cadastros com o mesmo CPF/CNPJ (o Linx tem CPF repetido). */
export async function clientesPorDocumento(doc: string): Promise<{ codigo: string; nome: string; filial: string }[]> {
  const digits = onlyDigits(doc);
  if (!digits) return [];
  return withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    req.input("doc", sql.VarChar(19), digits);
    const r = await req.query(`
      SELECT LTRIM(RTRIM(cf.CLIFOR)) AS codigo, RTRIM(cf.NOME_CLIFOR) AS nome, LTRIM(RTRIM(ISNULL(ca.FILIAL,''))) AS filial
        FROM CADASTRO_CLI_FOR cf WITH (NOLOCK)
        LEFT JOIN CLIENTES_ATACADO ca WITH (NOLOCK) ON ca.CLIENTE_ATACADO = cf.NOME_CLIFOR
       WHERE cf.CGC_CPF = @doc ORDER BY cf.CADASTRAMENTO DESC`);
    return r.recordset as { codigo: string; nome: string; filial: string }[];
  });
}

// ── Normalização ────────────────────────────────────────────────────────────

function normEndereco(e: EnderecoFat) {
  return {
    cep: onlyDigits(e.cep).slice(0, 8),
    endereco: cut(e.endereco, 90),
    numero: cut(e.numero, 10),
    complemento: cut(e.complemento, 60),
    bairro: cut(e.bairro, 25),
    ibge: onlyDigits(e.codMunicipioIbge).slice(0, 7),
    uf: cut(e.uf, 2),
  };
}

function normContato(input: { ddd?: string; telefone?: string; email?: string; emailNfe?: string }) {
  const dddDigits = onlyDigits(input.ddd).replace(/^0+/, "").slice(0, 2);
  const email = cut(input.email, 100);
  return {
    // O Linx guarda o DDD com zero à esquerda ('011').
    ddd: dddDigits ? `0${dddDigits}` : "",
    telefone: onlyDigits(input.telefone).slice(-9).slice(0, 10),
    email,
    emailNfe: cut(input.emailNfe, 100) || email,
  };
}

/**
 * Trecho T-SQL que resolve a cidade (sem acento, como o Linx guarda) e a UF pelo
 * código IBGE. Falha com mensagem clara se o município não existir na tabela do Linx.
 */
const SQL_RESOLVE_MUNICIPIO = `
  DECLARE @cidade VARCHAR(35), @ufMun CHAR(2);
  SELECT TOP 1 @cidade = LEFT(LTRIM(RTRIM(M.DESC_MUNICIPIO)), 35), @ufMun = U.UF
    FROM LCF_LX_MUNICIPIO M JOIN LCF_LX_UF U ON U.ID_UF = M.ID_UF
   WHERE LTRIM(RTRIM(M.COD_MUNICIPIO_IBGE)) = @ibge;
  IF @cidade IS NULL BEGIN ;THROW 51010, 'Código IBGE do município não encontrado no Linx. Confira o CEP.', 1; END
  IF @ufMun <> @uf BEGIN ;THROW 51011, 'A UF não corresponde ao município do CEP. Confira o CEP/UF.', 1; END`;

// ── Criação ─────────────────────────────────────────────────────────────────

export async function criarClienteFat(
  empresa: EmpresaFat,
  input: ClienteFatInput,
  opts: { simular?: boolean } = {}
): Promise<{ codigo: string; nomeClifor: string }> {
  const padrao = PADROES[empresa].cliente;
  const doc = onlyDigits(input.cpfCnpj);
  // CNPJ tem cadastro próprio (clientesPj.ts): IE, indicador fiscal e padrões do corporativo.
  if (doc.length === 14) throw new Error("CNPJ não se cadastra aqui — use “Cadastrar PJ (CNPJ)”.");
  if (doc.length !== 11) throw new Error("CPF inválido (11 dígitos).");
  // Pessoa física aqui é o cliente do site (padrão WEB). CORPORATIVO tem outro conjunto
  // (conta, tabela, agrupamento…) — 1 único PF corporativo no Linx; se precisar, área Corporativo.
  if (up(input.tipo) === "CORPORATIVO") {
    throw new Error("Pessoa física não se cadastra como CORPORATIVO aqui — use a área Corporativo.");
  }
  const razao = cut(input.razaoSocial, 90);
  if (!razao) throw new Error("Nome / razão social é obrigatório.");
  const nomeBase = cut(input.nomeClifor || razao, 25);

  const end = normEndereco(input.endereco);
  if (end.cep.length !== 8) throw new Error("CEP inválido.");
  if (!end.endereco || !end.numero) throw new Error("Endereço e número são obrigatórios.");
  if (!end.bairro) throw new Error("Bairro é obrigatório.");
  if (!end.uf) throw new Error("UF é obrigatória.");
  if (!end.ibge) throw new Error("Código IBGE do município é obrigatório (busque pelo CEP).");
  const contato = normContato(input);

  return withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    const bind = (n: string, t: sql.ISqlType | (() => sql.ISqlType), v: unknown) => req.input(n, t, v);
    bind("razao", sql.VarChar(90), razao);
    bind("nomeBase", sql.VarChar(25), nomeBase);
    bind("doc", sql.VarChar(19), doc);
    bind("pjpf", sql.Bit, 0);
    bind("rgIe", sql.VarChar(19), cut(input.rgIe, 19) || padrao.rgIe);
    bind("indicadorFiscal", sql.Int, padrao.indicadorFiscal);
    bind("cep", sql.VarChar(9), end.cep);
    bind("endereco", sql.VarChar(90), end.endereco);
    bind("numero", sql.VarChar(10), end.numero);
    bind("complemento", sql.VarChar(60), end.complemento);
    bind("bairro", sql.VarChar(25), end.bairro);
    bind("uf", sql.Char(2), end.uf);
    bind("ibge", sql.VarChar(7), end.ibge);
    bind("ddd", sql.VarChar(4), contato.ddd);
    bind("tel", sql.VarChar(10), contato.telefone);
    bind("email", sql.VarChar(100), contato.email);
    bind("emailNfe", sql.VarChar(100), contato.emailNfe);
    bind("filial", sql.VarChar(25), cut(input.filial, 25) || padrao.filial);
    bind("tipo", sql.VarChar(25), cut(input.tipo, 25) || padrao.tipo);
    bind("conceito", sql.VarChar(25), cut(input.conceito, 25) || padrao.conceito);
    bind("pontualidade", sql.VarChar(25), cut(input.pontualidade, 25) || padrao.pontualidade);
    bind("transportadora", sql.VarChar(25), cut(input.transportadora, 25) || padrao.transportadora);
    bind("condicaoPgto", sql.VarChar(3), cut(input.condicaoPgto, 3) || padrao.condicaoPgto);
    bind("tab", sql.VarChar(2), cut(input.codigoTabPreco, 2) || padrao.codigoTabPreco);
    bind("conta", sql.VarChar(20), cut(input.contaContabil, 20) || padrao.contaContabil);
    bind("regiao", sql.VarChar(25), cut(input.regiao, 25) || regiaoDaUf(end.uf));
    bind("representante", sql.VarChar(25), cut(input.representante, 25) || padrao.representante);

    const batch = `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
  ${SQL_RESOLVE_MUNICIPIO}

  DECLARE @repNome VARCHAR(25), @repComissao NUMERIC(18,4);
  SELECT TOP 1 @repNome = REPRESENTANTE, @repComissao = ISNULL(COMISSAO, 0)
    FROM REPRESENTANTES WHERE LTRIM(RTRIM(REPRESENTANTE)) = @representante;
  IF @repNome IS NULL BEGIN ;THROW 51003, 'Representante informado não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM CTB_CONTA_PLANO WHERE LTRIM(RTRIM(CONTA_CONTABIL)) = @conta)
  BEGIN ;THROW 51002, 'Conta contábil informada não existe no plano de contas do Linx.', 1; END

  DECLARE @novoCod INT;
  UPDATE SEQUENCIAIS WITH (UPDLOCK, HOLDLOCK)
     SET @novoCod = CAST(SEQUENCIA AS INT) + 1,
         SEQUENCIA = RIGHT('000000' + CAST(CAST(SEQUENCIA AS INT) + 1 AS VARCHAR(6)), 6)
   WHERE TABELA_COLUNA = '${SEQ_KEY}';
  IF @novoCod IS NULL BEGIN ;THROW 51000, 'Sequencial de cliente não encontrado em SEQUENCIAIS.', 1; END
  DECLARE @codigo CHAR(6) = RIGHT('000000' + CAST(@novoCod AS VARCHAR(6)), 6);

  -- NOME_CLIFOR é a PK (25): nome repetido de outra pessoa ganha sufixo numérico.
  DECLARE @nome VARCHAR(25) = @nomeBase, @i INT = 0;
  WHILE EXISTS (SELECT 1 FROM CADASTRO_CLI_FOR WITH (UPDLOCK, HOLDLOCK) WHERE NOME_CLIFOR = @nome)
     OR EXISTS (SELECT 1 FROM CLIENTES_ATACADO WITH (UPDLOCK, HOLDLOCK) WHERE CLIENTE_ATACADO = @nome)
  BEGIN
    SET @i = @i + 1;
    IF @i > 99 BEGIN ;THROW 51001, 'Não foi possível gerar um nome único para o cliente.', 1; END
    DECLARE @suf VARCHAR(4) = ' ' + CAST(@i + 1 AS VARCHAR(3));
    SET @nome = RTRIM(LEFT(@nomeBase, 25 - LEN(@suf))) + @suf;
  END

  DECLARE @hoje DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

  INSERT INTO CADASTRO_CLI_FOR (
    NOME_CLIFOR, CLIFOR, COD_CLIFOR, CGC_CPF, RAZAO_SOCIAL, PJ_PF, RG_IE,
    CEP, ENDERECO, NUMERO, COMPLEMENTO, BAIRRO, CIDADE, UF, PAIS, COD_MUNICIPIO_IBGE,
    DDD1, TELEFONE1, DDD2, DDDFAX, EMAIL, EMAIL_NFE,
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
    INDICADOR_FISCAL_TERCEIRO, TIPO_RELACAO_COMERCIAL, AGRUPAMENTO_ITENS
  ) VALUES (
    @nome, @codigo, @codigo, @doc, @razao, @pjpf, @rgIe,
    @cep, @endereco, @numero, NULLIF(@complemento,''), @bairro, @cidade, @uf, 'BRASIL', @ibge,
    NULLIF(@ddd,''), NULLIF(@tel,''), NULLIF(@ddd,''), NULLIF(@ddd,''), NULLIF(@email,''), NULLIF(@emailNfe,''),
    @endereco, @numero, NULLIF(@complemento,''), @bairro, @cidade,
    @uf, @cep, NULLIF(@ddd,''), NULLIF(@tel,''), @doc, @rgIe,
    'BRASIL', @razao, @ibge,
    @endereco, @numero, NULLIF(@complemento,''), @bairro, @cidade,
    @uf, @cep, NULLIF(@ddd,''), NULLIF(@tel,''), @doc, @rgIe,
    'BRASIL', @razao, @ibge,
    @hoje, GETDATE(),
    0, 1, 0, 0,
    0, 0, 0, 0, 0, 0,
    0, 0, 0,
    @indicadorFiscal, 0, 0
  );

  INSERT INTO CLIENTES_ATACADO (
    CLIENTE_ATACADO, COD_CLIENTE, CLIFOR, CGC_CPF,
    CONDICAO_PGTO, REGIAO, FILIAL, PONTUALIDADE, TRANSPORTADORA, CONCEITO, TIPO, TIPO_BLOQUEIO,
    MATRIZ_CLIENTE, MOEDA, CODIGO_TAB_PRECO, LIMITE_CREDITO, SEM_CREDITO, ACEITA_JUNTAR_PED,
    INATIVO, INDICA_FRANQUIA, INDICADOR_VENDA, DATA_PARA_TRANSFERENCIA, CTB_CONTA_CONTABIL
  ) VALUES (
    @nome, @codigo, @codigo, @doc,
    @condicaoPgto, @regiao, @filial, @pontualidade, @transportadora, @conceito, @tipo, 'INDEFINIDO',
    @nome, 'R$', @tab, 0, 0, 0,
    0, 0, 'V', GETDATE(), @conta
  );

  INSERT INTO CLIENTE_REPRE (REPRESENTANTE, CLIENTE_ATACADO, DATA_PARA_TRANSFERENCIA, COMISSAO, REPRESENTANTE_PRINCIPAL)
  VALUES (@repNome, @nome, GETDATE(), ISNULL(@repComissao, 0), 1);

  SELECT @codigo AS codigo, @nome AS nome;
  ${opts.simular ? "ROLLBACK;" : "COMMIT;"}
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  ;THROW;
END CATCH`;

    let result;
    try {
      result = await req.query(batch);
    } catch (err) {
      throw new Error(`Falha ao cadastrar no Linx: ${err instanceof Error ? err.message : String(err)}`);
    }
    const row = (result.recordset as { codigo: string; nome: string }[])[0];
    if (!row?.codigo) throw new Error("O cadastro não retornou o código gerado.");
    return { codigo: String(row.codigo).trim(), nomeClifor: String(row.nome).trimEnd() };
  });
}

// ── Atualização de endereço/contato (reaproveitar cliente) ───────────────────

/**
 * Atualiza endereço (principal, cobrança e entrega iguais), contato e região.
 * O trigger do Linx registra a alteração em CADASTRO_CLI_FOR_LOG e confere o IBGE.
 */
export async function atualizarClienteFat(
  codigo: string,
  input: ClienteAtualizacaoInput,
  opts: { simular?: boolean } = {}
): Promise<void> {
  const cod = onlyDigits(codigo).padStart(6, "0").slice(-6);
  const end = normEndereco(input.endereco);
  if (end.cep.length !== 8) throw new Error("CEP inválido.");
  if (!end.endereco || !end.numero || !end.bairro || !end.uf || !end.ibge) {
    throw new Error("Endereço incompleto (CEP, endereço, número, bairro, UF e IBGE).");
  }
  const contato = normContato(input);

  await withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    req.input("cod", sql.VarChar(15), cod);
    req.input("cep", sql.VarChar(9), end.cep);
    req.input("endereco", sql.VarChar(90), end.endereco);
    req.input("numero", sql.VarChar(10), end.numero);
    req.input("complemento", sql.VarChar(60), end.complemento);
    req.input("bairro", sql.VarChar(25), end.bairro);
    req.input("uf", sql.Char(2), end.uf);
    req.input("ibge", sql.VarChar(7), end.ibge);
    req.input("ddd", sql.VarChar(4), contato.ddd);
    req.input("tel", sql.VarChar(10), contato.telefone);
    req.input("email", sql.VarChar(100), contato.email);
    req.input("emailNfe", sql.VarChar(100), contato.emailNfe);
    req.input("regiao", sql.VarChar(25), cut(input.regiao, 25) || regiaoDaUf(end.uf));

    const batch = `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
  ${SQL_RESOLVE_MUNICIPIO}
  DECLARE @nome VARCHAR(25);
  SELECT @nome = NOME_CLIFOR FROM CADASTRO_CLI_FOR WITH (UPDLOCK) WHERE CLIFOR = @cod;
  IF @nome IS NULL BEGIN ;THROW 51020, 'Cliente não encontrado.', 1; END

  UPDATE CADASTRO_CLI_FOR SET
    CEP = @cep, ENDERECO = @endereco, NUMERO = @numero, COMPLEMENTO = NULLIF(@complemento,''),
    BAIRRO = @bairro, CIDADE = @cidade, UF = @uf, COD_MUNICIPIO_IBGE = @ibge,
    COBRANCA_CEP = @cep, COBRANCA_ENDERECO = @endereco, COBRANCA_NUMERO = @numero,
    COBRANCA_COMPLEMENTO = NULLIF(@complemento,''), COBRANCA_BAIRRO = @bairro, COBRANCA_CIDADE = @cidade,
    COBRANCA_UF = @uf, COD_MUNICIPIO_IBGE_COBRANCA = @ibge,
    ENTREGA_CEP = @cep, ENTREGA_ENDERECO = @endereco, ENTREGA_NUMERO = @numero,
    ENTREGA_COMPLEMENTO = NULLIF(@complemento,''), ENTREGA_BAIRRO = @bairro, ENTREGA_CIDADE = @cidade,
    ENTREGA_UF = @uf, COD_MUNICIPIO_IBGE_ENTREGA = @ibge,
    DDD1 = COALESCE(NULLIF(@ddd,''), DDD1), TELEFONE1 = COALESCE(NULLIF(@tel,''), TELEFONE1),
    COBRANCA_DDD = COALESCE(NULLIF(@ddd,''), COBRANCA_DDD), COBRANCA_TELEFONE = COALESCE(NULLIF(@tel,''), COBRANCA_TELEFONE),
    ENTREGA_DDD = COALESCE(NULLIF(@ddd,''), ENTREGA_DDD), ENTREGA_TELEFONE = COALESCE(NULLIF(@tel,''), ENTREGA_TELEFONE),
    EMAIL = COALESCE(NULLIF(@email,''), EMAIL), EMAIL_NFE = COALESCE(NULLIF(@emailNfe,''), EMAIL_NFE),
    DATA_PARA_TRANSFERENCIA = GETDATE()
  WHERE NOME_CLIFOR = @nome;

  UPDATE CLIENTES_ATACADO SET REGIAO = @regiao, DATA_PARA_TRANSFERENCIA = GETDATE() WHERE CLIENTE_ATACADO = @nome;
  ${opts.simular ? "ROLLBACK;" : "COMMIT;"}
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  ;THROW;
END CATCH`;
    try {
      await req.query(batch);
    } catch (err) {
      throw new Error(`Falha ao atualizar o cliente no Linx: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
