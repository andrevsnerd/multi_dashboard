import "server-only";

import sql from "mssql";
import { query, withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import {
  PADROES,
  PERFIL_PJ_PADRAO,
  PERFIS_CLIENTE_PJ,
  isPerfilClientePj,
  perfilDoTipo,
  regiaoDaUf,
  type EmpresaFat,
} from "@/lib/faturamento-ecommerce/config";
import { cnpjValido } from "@/lib/faturamento-ecommerce/cnpj";
import type { ClientePjFatInput, EnderecoFat, Opcao } from "@/lib/faturamento-ecommerce/types";

/**
 * Faturamento E-commerce — cadastro de cliente PJ (CNPJ) no Linx.
 *
 * Fluxo SEPARADO do cadastro de pessoa física do site (clientes.ts, que não muda).
 * Estrutura do cadastro do CORPORATIVO (lib/repositories/clienteCorporativo.ts): mesmas
 * tabelas (CADASTRO_CLI_FOR + CLIENTES_ATACADO + CLIENTE_REPRE numa transação, código
 * de SEQUENCIAIS), mesmos campos fiscais (IE, indicador, tributação, IM, SUFRAMA) e
 * cobrança/entrega próprias. O PERFIL (WEB ou CORPORATIVO, PERFIS_CLIENTE_PJ) decide
 * INDICADOR_VENDA e AGRUPAMENTO_ITENS, que a tela não mostra (WEB 'V'/0, CORPORATIVO ' '/2),
 * e o padrão de tipo, conta, tabela e transportadora. A CIDADE de cada endereço vem de
 * LCF_LX_MUNICIPIO pelo IBGE (sem acento) — o trigger do Linx casa CIDADE+UF por
 * igualdade e uma cidade com acento quebra a edição posterior no Linx.
 */

const SEQ_KEY = "CLIENTES_ATACADO.CLIFOR";

const onlyDigits = (s: unknown): string => String(s ?? "").replace(/\D/g, "");
const up = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const cut = (s: unknown, n: number): string => up(s).slice(0, n);

/** Plano de contas ativo (FK de CLIENTES_ATACADO.CTB_CONTA_CONTABIL) — mesma consulta do corporativo. */
export async function fetchContasContabeisFat(): Promise<Opcao[]> {
  const rows = await query<{ v: string; d: string }>(
    `SELECT LTRIM(RTRIM(CONTA_CONTABIL)) AS v, LTRIM(RTRIM(DESC_CONTA)) AS d
       FROM CTB_CONTA_PLANO WITH (NOLOCK) WHERE ISNULL(INATIVA, 0) = 0 ORDER BY CONTA_CONTABIL`
  );
  return rows.filter((r) => r.v).map((r) => ({ value: r.v, label: `${r.v} - ${r.d ?? ""}`.trim() }));
}

function normEndereco(e: EnderecoFat, nome: string) {
  const n = {
    cep: onlyDigits(e.cep).slice(0, 8),
    endereco: cut(e.endereco, 90),
    numero: cut(e.numero, 10),
    complemento: cut(e.complemento, 60),
    bairro: cut(e.bairro, 25),
    ibge: onlyDigits(e.codMunicipioIbge).slice(0, 7),
    uf: cut(e.uf, 2),
  };
  if (n.cep.length !== 8) throw new Error(`${nome}: CEP inválido.`);
  if (!n.endereco || !n.numero) throw new Error(`${nome}: endereço e número são obrigatórios.`);
  if (!n.bairro) throw new Error(`${nome}: bairro é obrigatório.`);
  if (!n.uf) throw new Error(`${nome}: UF é obrigatória.`);
  if (!n.ibge) throw new Error(`${nome}: código IBGE do município é obrigatório (busque pelo CEP).`);
  return n;
}

/** Resolve CIDADE (sem acento, como o Linx guarda) pelo IBGE e confere a UF. */
function sqlMunicipio(p: string, nome: string): string {
  return `
  DECLARE @${p}Cidade VARCHAR(35), @${p}UfMun CHAR(2);
  SELECT TOP 1 @${p}Cidade = LEFT(LTRIM(RTRIM(M.DESC_MUNICIPIO)), 35), @${p}UfMun = U.UF
    FROM LCF_LX_MUNICIPIO M JOIN LCF_LX_UF U ON U.ID_UF = M.ID_UF
   WHERE LTRIM(RTRIM(M.COD_MUNICIPIO_IBGE)) = @${p}Ibge;
  IF @${p}Cidade IS NULL BEGIN ;THROW 51010, '${nome}: código IBGE do município não encontrado no Linx. Confira o CEP.', 1; END
  IF @${p}UfMun <> @${p}Uf BEGIN ;THROW 51011, '${nome}: a UF não corresponde ao município do CEP.', 1; END`;
}

export async function criarClientePjFat(
  empresa: EmpresaFat,
  input: ClientePjFatInput,
  opts: { simular?: boolean } = {}
): Promise<{ codigo: string; nomeClifor: string }> {
  const padrao = PADROES[empresa].clientePj;
  const perfilInformado = up(input.perfil);
  if (perfilInformado && !isPerfilClientePj(perfilInformado)) throw new Error("Perfil do cliente inválido.");
  const perfilId = isPerfilClientePj(perfilInformado) ? perfilInformado : PERFIL_PJ_PADRAO;
  const perfil = PERFIS_CLIENTE_PJ[perfilId];
  const tipo = cut(input.tipo, 25) || perfil.tipo;
  // Nunca metade WEB, metade corporativo: o tipo gravado tem que ser o do perfil.
  const perfilTipo = perfilDoTipo(tipo);
  if (perfilTipo && perfilTipo !== perfilId) {
    throw new Error(`Tipo ${tipo} não combina com o perfil ${perfilId}. Escolha o perfil ${perfilTipo}.`);
  }
  const cnpj = onlyDigits(input.cnpj);
  if (cnpj.length !== 14) throw new Error("CNPJ precisa ter 14 dígitos. Para CPF use o cadastro de pessoa física.");
  if (!cnpjValido(cnpj)) throw new Error("CNPJ inválido (dígito verificador não confere).");
  const razao = cut(input.razaoSocial, 90);
  if (!razao) throw new Error("Razão social é obrigatória.");
  const nomeBase = cut(input.nomeFantasia || razao, 25);
  // IE só com dígitos (é como vai no XML da NF-e); vazio ou "ISENTO" = ISENTO.
  const ie = onlyDigits(input.inscricaoEstadual).slice(0, 19) || "ISENTO";
  const indicador = Number(input.indicadorFiscal);
  const indicadorFiscal = Number.isInteger(indicador) && indicador > 0 ? indicador : perfil.indicadorFiscal;

  const principal = normEndereco(input.endereco, "Endereço principal");
  const cobranca = input.cobranca ? normEndereco(input.cobranca, "Endereço de cobrança") : principal;
  const entrega = input.entrega ? normEndereco(input.entrega, "Endereço de entrega") : principal;

  const ddd = onlyDigits(input.ddd).replace(/^0+/, "").slice(0, 2);
  const ddd2 = onlyDigits(input.ddd2).replace(/^0+/, "").slice(0, 2);
  const email = cut(input.email, 100);
  const limite = Number(input.limiteCredito);

  return withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as sql.Request;
    const bind = (n: string, t: sql.ISqlType | (() => sql.ISqlType), v: unknown) => req.input(n, t, v);
    bind("razao", sql.VarChar(90), razao);
    bind("nomeBase", sql.VarChar(25), nomeBase);
    bind("doc", sql.VarChar(19), cnpj);
    bind("rgIe", sql.VarChar(19), ie);
    bind("indicadorFiscal", sql.Int, indicadorFiscal);
    bind("tipoTributacao", sql.VarChar(25), cut(input.tipoTributacao, 25));
    bind("im", sql.VarChar(15), cut(input.inscricaoMunicipal, 15));
    bind("suframa", sql.VarChar(9), onlyDigits(input.suframa).slice(0, 9));
    for (const [p, e] of [
      ["p", principal],
      ["c", cobranca],
      ["e", entrega],
    ] as const) {
      bind(`${p}Cep`, sql.VarChar(9), e.cep);
      bind(`${p}Endereco`, sql.VarChar(90), e.endereco);
      bind(`${p}Numero`, sql.VarChar(10), e.numero);
      bind(`${p}Complemento`, sql.VarChar(60), e.complemento);
      bind(`${p}Bairro`, sql.VarChar(25), e.bairro);
      bind(`${p}Uf`, sql.Char(2), e.uf);
      bind(`${p}Ibge`, sql.VarChar(7), e.ibge);
    }
    // O Linx guarda o DDD com zero à esquerda ('011'), como o cadastro modelo do dono (850797);
    // sem 2º telefone, DDD2 repete o DDD1 (também como o modelo e o cadastro de pessoa física).
    bind("ddd", sql.VarChar(4), ddd ? `0${ddd}` : "");
    bind("tel", sql.VarChar(10), onlyDigits(input.telefone).slice(-9));
    bind("ddd2", sql.VarChar(4), ddd2 ? `0${ddd2}` : ddd ? `0${ddd}` : "");
    bind("tel2", sql.VarChar(10), onlyDigits(input.telefone2).slice(-9));
    bind("email", sql.VarChar(100), email);
    bind("emailNfe", sql.VarChar(100), cut(input.emailNfe, 100) || email);
    bind("filial", sql.VarChar(25), cut(input.filial, 25) || padrao.filial);
    bind("tipo", sql.VarChar(25), tipo);
    bind("indicadorVenda", sql.VarChar(1), perfil.indicadorVenda || " ");
    bind("agrupamento", sql.Int, perfil.agrupamentoItens);
    bind("conceito", sql.VarChar(25), cut(input.conceito, 25) || padrao.conceito);
    bind("pontualidade", sql.VarChar(25), cut(input.pontualidade, 25) || padrao.pontualidade);
    bind("transportadora", sql.VarChar(25), cut(input.transportadora, 25) || perfil.transportadora);
    bind("condicaoPgto", sql.VarChar(3), cut(input.condicaoPgto, 3) || padrao.condicaoPgto);
    bind("tab", sql.VarChar(2), cut(input.codigoTabPreco, 2) || perfil.codigoTabPreco);
    bind("conta", sql.VarChar(20), cut(input.contaContabil, 20) || perfil.contaContabil);
    bind("regiao", sql.VarChar(25), cut(input.regiao, 25) || regiaoDaUf(principal.uf));
    bind("representante", sql.VarChar(25), cut(input.representante, 25) || padrao.representante);
    bind("limite", sql.Decimal(18, 2), Number.isFinite(limite) && limite > 0 ? limite : 0);
    bind("obs", sql.VarChar(4000), String(input.observacao ?? "").trim().slice(0, 4000));

    const batch = `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
  ${sqlMunicipio("p", "Endereço principal")}
  ${sqlMunicipio("c", "Endereço de cobrança")}
  ${sqlMunicipio("e", "Endereço de entrega")}

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

  -- NOME_CLIFOR é a PK (25): nome repetido de outro cliente ganha sufixo numérico.
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
    DDD1, TELEFONE1, DDD2, TELEFONE2, DDDFAX, EMAIL, EMAIL_NFE,
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
    @nome, @codigo, @codigo, @doc, @razao, 1, @rgIe,
    @pCep, @pEndereco, @pNumero, NULLIF(@pComplemento,''), @pBairro, @pCidade, @pUf, 'BRASIL', @pIbge,
    NULLIF(@ddd,''), NULLIF(@tel,''), NULLIF(@ddd2,''), NULLIF(@tel2,''), NULLIF(@ddd,''), NULLIF(@email,''), NULLIF(@emailNfe,''),
    @cEndereco, @cNumero, NULLIF(@cComplemento,''), @cBairro, @cCidade,
    @cUf, @cCep, NULLIF(@ddd,''), NULLIF(@tel,''), @doc, @rgIe,
    'BRASIL', @razao, @cIbge,
    @eEndereco, @eNumero, NULLIF(@eComplemento,''), @eBairro, @eCidade,
    @eUf, @eCep, NULLIF(@ddd,''), NULLIF(@tel,''), @doc, @rgIe,
    'BRASIL', @razao, @eIbge,
    @hoje, GETDATE(),
    0, 1, 0, 0,
    0, 0, 0, 0, 0, 0,
    0, 0, 0,
    @indicadorFiscal, NULLIF(@tipoTributacao,''), NULLIF(@suframa,''), NULLIF(@im,''),
    0, @agrupamento
  );

  INSERT INTO CLIENTES_ATACADO (
    CLIENTE_ATACADO, COD_CLIENTE, CLIFOR, CGC_CPF,
    CONDICAO_PGTO, REGIAO, FILIAL, PONTUALIDADE, TRANSPORTADORA, CONCEITO, TIPO, TIPO_BLOQUEIO,
    MATRIZ_CLIENTE, MOEDA, CODIGO_TAB_PRECO, LIMITE_CREDITO, SEM_CREDITO, ACEITA_JUNTAR_PED,
    INATIVO, INDICA_FRANQUIA, INDICADOR_VENDA, DATA_PARA_TRANSFERENCIA,
    EXPEDICAO_COMPLETO_PEDIDO, EXPEDICAO_COMPLETO_PACK, EXPEDICAO_COMPLETO_TAMANHOS,
    EXPEDICAO_COMPLETO_COR, EXPEDICAO_COMPLETO_COORDENADO, EXPEDICAO_COMPLETO_CARTELA,
    EXPEDICAO_COMPLETO_FAIXAS, MULTI_DESCONTO_ACUMULAR, CONTEUDO_XPED_NFE, OBS, CTB_CONTA_CONTABIL
  ) VALUES (
    @nome, @codigo, @codigo, @doc,
    @condicaoPgto, @regiao, @filial, @pontualidade, @transportadora, @conceito, @tipo, 'INDEFINIDO',
    @nome, 'R$', @tab, @limite, 0, 0,
    0, 0, @indicadorVenda, GETDATE(),
    0, 0, 0,
    0, 0, 0,
    0, 0, 0, NULLIF(@obs,''), @conta
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
