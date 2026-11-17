import "server-only";

import sql from "mssql";
import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { PADROES, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import {
  AUTORIZADA,
  DENEGADA,
  FiscalFlowErro,
  autenticarFiscalFlow,
  consultarNfeFiscalFlow,
  descompactar,
  enviarNfeFiscalFlow,
  montarCorpoEnvio,
  type FiscalFlowChaves,
  type FiscalFlowConfig,
  type FiscalFlowRetorno,
} from "@/lib/faturamento-ecommerce/fiscal-flow";

/**
 * Envio da NF-e à SEFAZ pelo dashboard — reprodução do botão "Envia NFe para Sefaz"
 * do Monitor de NF-e do Linx (form 100135SPK), na mesma ordem e com os mesmos
 * registros que o desktop grava (EDI_ARQUIVO/EDI_ARQUIVO_LOG para o monitor do Linx,
 * MIDE_NFE_LOG para o log da Fiscal Flow). Sequência real conferida na NF 1559:
 *
 *   1. trava: STATUS_NFE 1 (ou 2/3/4 com LOG 99) → 2/0 — só um envio por vez
 *   2. EDI_ARQUIVO da chave (layout 9990)
 *   3. LX_EXECUTE_PROCESS 'LX_GERA_NFE_SEFAZ_4_00' → XML sem assinatura (erro → 2/99)
 *   4. LX_EXECUTE_PROCESS 'LX_VALIDA_NFE_PARA_ENVIO'
 *   5. STATUS 3/0 e POST na Fiscal Flow (ela assina e transmite)
 *   6. autorizada: LX_XML_MIDE_NFE_ENVIADO → LX_DADOS_CADASTRO_XML_NFE → LX_PROCESSAMENTO_RETORNO_MIDe_SEFAZ
 *      (STATUS 5 + protocolo) → LX_CTB_INTEGRAR_FATURAMENTO (contábil/contas a receber)
 *   7. sem resposta / "em processamento": CONSULTA a SEFAZ antes de decidir — nunca reenviar às cegas
 *   8. verificação independente: relê o Linx e consulta a SEFAZ pela Fiscal Flow
 *
 * A mesma NF (mesma chave/número) não pode ser autorizada duas vezes na SEFAZ: um reenvio
 * da mesma nota volta "duplicidade"/"já autorizada", nunca gera uma segunda NF.
 */

type Req = sql.Request;
type Linha = Record<string, unknown>;
const trim = (v: unknown) => String(v ?? "").trim();
const sqlLit = (s: string) => s.replace(/'/g, "''");
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rodar(texto: string, bind?: (req: Req) => void): Promise<Linha[][]> {
  return withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as Req;
    bind?.(req);
    const r = (await req.query(texto)) as unknown as { recordsets?: Linha[][]; recordset?: Linha[] };
    return r.recordsets ?? [r.recordset ?? []];
  });
}

// ── Dados da NF e configuração ──────────────────────────────────────────────

interface NotaEnvio {
  filial: string;
  nf: string;
  serie: string;
  chave: string;
  status: number;
  log: number;
  cancelada: boolean;
  cnpj: string;
  serieSefaz: string;
  ctbLancamento: string;
  protocolo: string;
}

async function carregarNota(empresa: EmpresaFat, filial: string, nf: string, serie: string): Promise<NotaEnvio> {
  if (!PADROES[empresa].nota.filiais.includes(filial)) throw new Error(`A filial ${filial} não é da ${PADROES[empresa].nome}.`);
  const nfNum = trim(nf).replace(/\D/g, "").padStart(9, "0").slice(-9);
  const [rows] = await rodar(
    `SELECT LTRIM(RTRIM(F.FILIAL)) AS filial, LTRIM(RTRIM(F.NF_SAIDA)) AS nf, LTRIM(RTRIM(F.SERIE_NF)) AS serie,
            LTRIM(RTRIM(F.CHAVE_NFE)) AS chave, F.STATUS_NFE AS status, F.LOG_STATUS_NFE AS log, F.NOTA_CANCELADA AS cancelada,
            LTRIM(RTRIM(C.CGC_CPF)) AS cnpj, LTRIM(RTRIM(N.COD_SERIE_SINTEGRA)) AS serieSefaz,
            F.CTB_LANCAMENTO AS ctb, LTRIM(RTRIM(F.PROTOCOLO_AUTORIZACAO_NFE)) AS protocolo
       FROM FATURAMENTO F WITH (NOLOCK)
       JOIN CADASTRO_CLI_FOR C WITH (NOLOCK) ON C.NOME_CLIFOR = F.FILIAL
       LEFT JOIN SERIES_NF N WITH (NOLOCK) ON N.SERIE_NF = F.SERIE_NF
      WHERE F.FILIAL = @f AND F.NF_SAIDA = @n AND F.SERIE_NF = @s`,
    (req) => {
      req.input("f", sql.VarChar(25), filial);
      req.input("n", sql.VarChar(15), nfNum);
      req.input("s", sql.VarChar(6), trim(serie));
    }
  );
  const x = rows?.[0];
  if (!x) throw new Error("NF não encontrada.");
  return {
    filial: trim(x.filial),
    nf: trim(x.nf),
    serie: trim(x.serie),
    chave: trim(x.chave),
    status: Number(x.status ?? 0),
    log: Number(x.log ?? 0),
    cancelada: Boolean(x.cancelada),
    cnpj: trim(x.cnpj).replace(/\D/g, ""),
    serieSefaz: trim(x.serieSefaz) || "1",
    ctbLancamento: trim(x.ctb),
    protocolo: trim(x.protocolo),
  };
}

/** Mesmas regras do botão do Linx: 1, ou 2/3/4 com erro (LOG 99). */
export function podeEnviar(status: number, log: number): boolean {
  return status === 1 || ([2, 3, 4].includes(status) && log === 99);
}

async function lerConfig(): Promise<{ cfg: FiscalFlowConfig; tpAmb: number }> {
  const [rows] = await rodar(
    `SELECT LTRIM(RTRIM(USUARIO)) AS u, LTRIM(RTRIM(PASSW)) AS p, LTRIM(RTRIM(END_PRODUCAO)) AS prod,
            LTRIM(RTRIM(END_HOMOLOGACAO)) AS hml, AMBIENTE AS amb,
            (SELECT TOP 1 LTRIM(RTRIM(VALOR_ATUAL)) FROM PARAMETROS WHERE PARAMETRO = 'IDENTIFICA_AMB_MIDe_NFE') AS tpAmb
       FROM INTEGRACOES_API WITH (NOLOCK) WHERE SISTEMA LIKE '%fiscal flow%'`
  );
  const x = rows?.[0];
  if (!x || !trim(x.u) || !trim(x.p)) throw new Error("Configuração da Fiscal Flow não encontrada no Linx (INTEGRACOES_API).");
  const ambiente = Number(x.amb) === 2 ? 2 : 1;
  const endereco = ambiente === 2 ? trim(x.hml) : trim(x.prod);
  if (!endereco) throw new Error("Endereço da Fiscal Flow não configurado no Linx.");
  return { cfg: { usuario: trim(x.u), senha: trim(x.p), endereco, ambiente }, tpAmb: Number(x.tpAmb) === 2 ? 2 : 1 };
}

// ── Registros que o Linx grava ──────────────────────────────────────────────

async function logMide(usuario: string, chave: string, codigo: string, descricao: string, tipo: string, conteudo: string) {
  try {
    await rodar(
      `INSERT INTO MIDE_NFE_LOG (USUARIO_LOG, CHAVE_NFE, DATA_HORA_LOG, CONTEUDO, CODIGO_LOG, DESCRICAO_LOG, TIPO_LOG)
       VALUES (@u, @c, GETDATE(), @t, @cod, @d, @tp)`,
      (req) => {
        req.input("u", sql.VarChar(25), usuario.slice(0, 25));
        req.input("c", sql.VarChar(44), chave.slice(0, 44));
        req.input("t", sql.NVarChar(sql.MAX), conteudo);
        req.input("cod", sql.VarChar(10), codigo);
        req.input("d", sql.VarChar(60), descricao);
        req.input("tp", sql.VarChar(30), tipo);
      }
    );
  } catch (err) {
    console.error("[sefaz] falha ao gravar MIDE_NFE_LOG", err);
  }
}

async function garantirEdiArquivo(chave: string) {
  await rodar(
    `IF NOT EXISTS (SELECT 1 FROM EDI_ARQUIVO WHERE COD_LAYOUT = 9990 AND EDI_REFERENCIA_ARQUIVO = @c)
       INSERT INTO EDI_ARQUIVO (COD_LAYOUT, ARQUIVO_EDI, DATA_HORA_GERACAO, LX_STATUS, EDI_REFERENCIA_ARQUIVO)
       VALUES (9990, NULL, GETDATE(), 0, @c)`,
    (req) => req.input("c", sql.VarChar(44), chave)
  );
}

/**
 * Roda uma procedure do Linx pelo LX_EXECUTE_PROCESS (como o desktop) e liga a
 * atividade ao EDI_ARQUIVO da NF. Devolve o 1º recordset (o XML, no caso da geração)
 * e o status/mensagem da atividade (1 = ok, 3 = erro).
 * ATENÇÃO: LX_EXECUTE_PROCESS faz COMMIT de qualquer transação aberta — nunca chamar
 * dentro de transação.
 */
async function executarProcesso(nome: string, parametros: string, chave: string, atualizaStatusEdi: boolean) {
  const sets = await rodar(
    `SET NOCOUNT ON;
     DECLARE @r INT, @id INT;
     SELECT TOP 1 @id = ID_EDI_ARQUIVO FROM EDI_ARQUIVO WHERE COD_LAYOUT = 9990 AND EDI_REFERENCIA_ARQUIVO = @c;
     EXEC @r = LX_EXECUTE_PROCESS @proc, @params;
     IF @id IS NOT NULL
       INSERT INTO EDI_ARQUIVO_LOG (ID_EDI_ARQUIVO, ID_PROCESSO, ITEM_PROCESSO)
       SELECT @id, pa.ID_PROCESSO, pa.ITEM_PROCESSO
         FROM PROCESSOS_SISTEMA_ATIVIDADES pa JOIN PROCESSOS_SISTEMA ps ON ps.ID_PROCESSO = pa.ID_PROCESSO
        WHERE pa.ITEM_PROCESSO = @r AND ps.NOME_PROCESSO = @nome;
     ${atualizaStatusEdi ? `UPDATE EDI_ARQUIVO SET LX_STATUS = (SELECT TOP 1 pa.STATUS_PROCESSO FROM PROCESSOS_SISTEMA_ATIVIDADES pa
         JOIN PROCESSOS_SISTEMA ps ON ps.ID_PROCESSO = pa.ID_PROCESSO WHERE pa.ITEM_PROCESSO = @r AND ps.NOME_PROCESSO = @nome)
       WHERE ID_EDI_ARQUIVO = @id;` : ""}`,
    (req) => {
      req.input("c", sql.VarChar(44), chave);
      req.input("proc", sql.VarChar(255), `${nome} `);
      req.input("params", sql.VarChar(8000), parametros);
      req.input("nome", sql.VarChar(255), nome);
    }
  );
  const [st] = await rodar(
    `SELECT TOP 1 pa.STATUS_PROCESSO AS status, pa.MENSAGEM AS msg
       FROM EDI_ARQUIVO e JOIN EDI_ARQUIVO_LOG el ON el.ID_EDI_ARQUIVO = e.ID_EDI_ARQUIVO
       JOIN PROCESSOS_SISTEMA ps ON ps.ID_PROCESSO = el.ID_PROCESSO
       JOIN PROCESSOS_SISTEMA_ATIVIDADES pa ON pa.ID_PROCESSO = el.ID_PROCESSO AND pa.ITEM_PROCESSO = el.ITEM_PROCESSO
      WHERE e.EDI_REFERENCIA_ARQUIVO = @c AND ps.NOME_PROCESSO = @nome
      ORDER BY el.ID_EDI_ARQUIVO_LOG DESC`,
    (req) => {
      req.input("c", sql.VarChar(44), chave);
      req.input("nome", sql.VarChar(255), nome);
    }
  );
  return {
    linhas: sets[0] ?? [],
    status: Number(st?.[0]?.status ?? 0),
    mensagem: trim(st?.[0]?.msg),
  };
}

async function setStatus(chave: string, status: number, log: number, condicao = "") {
  const [r] = await rodar(
    `UPDATE FATURAMENTO SET STATUS_NFE = @st, LOG_STATUS_NFE = @lg WHERE CHAVE_NFE = @c ${condicao};
     SELECT @@ROWCOUNT AS n;`,
    (req) => {
      req.input("c", sql.VarChar(44), chave);
      req.input("st", sql.Int, status);
      req.input("lg", sql.Int, log);
    }
  );
  return Number(r?.[0]?.n ?? 0);
}

/** "2026-11-16T13:04:50-03:00" → "2026-11-16T13:04:50" (o Linx grava sem fuso). */
const semFuso = (dh: string | null | undefined) => trim(dh).slice(0, 19);

/** Grava a autorização (ou denegação) no Linx exatamente como o desktop. */
async function aplicarRetornoAutorizado(nota: NotaEnvio, ret: FiscalFlowRetorno, nfeProc: string, usuario: string) {
  await logMide(usuario, nota.chave, "ERP.002", "RETORNO DESCOMPACTAR", "ERP.DESCOMPACTAR", nfeProc);
  await executarProcesso("LX_XML_MIDE_NFE_ENVIADO", "''", nota.chave, false);
  await rodar(`EXEC LX_DADOS_CADASTRO_XML_NFE @MENSAGEM = @m, @CHAVE_NFE_LINX = @c, @GRAVA_XML = 1`, (req) => {
    req.input("m", sql.NText, nfeProc);
    req.input("c", sql.VarChar(44), nota.chave);
  });
  await rodar(
    `EXEC LX_PROCESSAMENTO_RETORNO_MIDe_SEFAZ @MENSAGEM = @m, @TIPO_MENSAGEM = '2', @CHAVE_NFE_LINX = @c,
          @DTH_RECEBIMENTO = @dh, @STATUS = @st, @MOTIVO = @mot, @NUMERO_PROTOCOLO = @prot`,
    (req) => {
      req.input("m", sql.NText, nfeProc);
      req.input("c", sql.VarChar(44), nota.chave);
      req.input("dh", sql.VarChar(26), semFuso(ret.dhRetorno));
      req.input("st", sql.VarChar(5), trim(ret.cStat));
      req.input("mot", sql.VarChar(255), trim(ret.xMotivo).slice(0, 255));
      req.input("prot", sql.VarChar(15), trim(ret.nProt));
    }
  );
  if (AUTORIZADA.has(trim(ret.cStat))) {
    // Contábil + contas a receber — o desktop chama logo depois do retorno. Só se ainda não houver lançamento.
    const atual = await carregarNota(empresaDaFilial(nota.filial), nota.filial, nota.nf, nota.serie);
    if (!atual.ctbLancamento && atual.status === 5) {
      await executarProcesso(
        "LX_CTB_INTEGRAR_FATURAMENTO",
        `'${sqlLit(nota.filial)}','${sqlLit(nota.nf)}','${sqlLit(nota.serie)}'`,
        nota.chave,
        false
      );
    }
  }
}

function empresaDaFilial(filial: string): EmpresaFat {
  return PADROES.nerd.nota.filiais.includes(filial) ? "nerd" : "scarfme";
}

async function aplicarRejeicao(nota: NotaEnvio, ret: FiscalFlowRetorno, comportamento: string | null) {
  const cStat = trim(ret.cStat);
  if (/^\d+$/.test(cStat)) {
    // Rejeição da SEFAZ: a procedure de retorno do Linx registra o motivo e põe 4/99.
    try {
      await rodar(
        `EXEC LX_PROCESSAMENTO_RETORNO_MIDe_SEFAZ @MENSAGEM = NULL, @TIPO_MENSAGEM = '2', @CHAVE_NFE_LINX = @c,
              @DTH_RECEBIMENTO = @dh, @STATUS = @st, @MOTIVO = @mot, @NUMERO_PROTOCOLO = @prot`,
        (req) => {
          req.input("c", sql.VarChar(44), nota.chave);
          req.input("dh", sql.VarChar(26), semFuso(ret.dhRetorno));
          req.input("st", sql.VarChar(5), cStat);
          req.input("mot", sql.VarChar(255), trim(ret.xMotivo).slice(0, 255));
          req.input("prot", sql.VarChar(15), trim(ret.nProt));
        }
      );
    } catch (err) {
      console.error("[sefaz] retorno de rejeição", err);
    }
  }
  // Garante o estado "Rejeitado" (4/99) mesmo que a procedure não trate o código.
  const atual = await carregarNota(empresaDaFilial(nota.filial), nota.filial, nota.nf, nota.serie);
  if (atual.status !== 4 && atual.status !== 5) await setStatus(nota.chave, 4, 99, "AND STATUS_NFE IN (2,3)");
  void comportamento;
}

async function comportamentoDoCodigo(cStat: string): Promise<string | null> {
  const [rows] = await rodar(
    `SELECT TOP 1 LTRIM(RTRIM(COMPORTAMENTO_AUTORIZACAO)) AS c FROM MIDE_NFE_STATUS_CONFIG WHERE CODIGO_STATUS_RET = @c`,
    (req) => req.input("c", sql.VarChar(10), cStat)
  );
  return rows?.[0]?.c ? trim(rows[0].c) : null;
}

// ── Envio ───────────────────────────────────────────────────────────────────

export interface EtapaEnvio {
  etapa: string;
  ok: boolean;
  detalhe?: string;
}

export interface ResultadoEnvio {
  situacao: "autorizada" | "rejeitada" | "denegada" | "pendente" | "erro";
  mensagem: string;
  cStat: string | null;
  xMotivo: string | null;
  protocolo: string | null;
  etapas: EtapaEnvio[];
  verificacao: Verificacao | null;
}

export interface Verificacao {
  linxStatus: number;
  linxLog: number;
  linxProtocolo: string;
  xmlGuardado: boolean;
  contabilizada: boolean;
  sefazCStat: string | null;
  sefazMotivo: string | null;
  sefazProtocolo: string | null;
  confere: boolean;
  chave: string;
  observacao: string;
}

export async function enviarNotaSefaz(params: {
  empresa: EmpresaFat;
  filial: string;
  nf: string;
  serie: string;
  usuarioLinx: string;
}): Promise<ResultadoEnvio> {
  const etapas: EtapaEnvio[] = [];
  const passo = (etapa: string, ok: boolean, detalhe?: string) => etapas.push({ etapa, ok, detalhe });
  const nota = await carregarNota(params.empresa, params.filial, params.nf, params.serie);
  if (nota.cancelada) throw new Error("NF cancelada não pode ser enviada.");
  if (nota.chave.length !== 44) throw new Error("NF sem chave de acesso.");
  if (!podeEnviar(nota.status, nota.log)) {
    throw new Error(`A situação da NF não permite envio (STATUS ${nota.status}/${nota.log}). Use "Consultar na SEFAZ".`);
  }
  const { cfg, tpAmb } = await lerConfig();
  passo("Configuração da Fiscal Flow lida do Linx", true, cfg.ambiente === 1 ? "produção" : "homologação");

  // 1. Trava (só uma chamada consegue passar daqui)
  const travou = await setStatus(
    nota.chave,
    2,
    0,
    "AND NOTA_CANCELADA = 0 AND (STATUS_NFE = 1 OR (STATUS_NFE IN (2,3,4) AND LOG_STATUS_NFE = 99))"
  );
  if (travou !== 1) throw new Error("Outra pessoa acabou de enviar esta NF (pelo Linx ou pelo dashboard). Atualize o monitor.");
  passo("NF reservada para envio (status 2)", true);

  try {
    // 2–4. XML pela procedure do Linx + validação
    await garantirEdiArquivo(nota.chave);
    const gera = await executarProcesso(
      "LX_GERA_NFE_SEFAZ_4_00",
      `'${sqlLit(nota.nf)}','${sqlLit(nota.serie)}','${sqlLit(nota.filial)}'`,
      nota.chave,
      true
    );
    const xml = gera.linhas.map((l) => l.XML_NFE).find((x) => typeof x === "string") as string | undefined;
    if (gera.status === 3 || !xml) {
      await setStatus(nota.chave, 2, 99);
      passo("XML gerado pelo Linx", false, gera.mensagem || "a procedure não devolveu o XML");
      return { situacao: "erro", mensagem: `Erro ao gerar o XML: ${gera.mensagem || "sem XML"}`, cStat: null, xMotivo: null, protocolo: null, etapas, verificacao: null };
    }
    passo("XML gerado pelo Linx (LX_GERA_NFE_SEFAZ_4_00)", true, `${xml.length} caracteres`);
    const valida = await executarProcesso("LX_VALIDA_NFE_PARA_ENVIO", "''", nota.chave, true);
    if (valida.status === 3) {
      await setStatus(nota.chave, 2, 99);
      passo("Validação do Linx", false, valida.mensagem);
      return { situacao: "erro", mensagem: `Validação do Linx: ${valida.mensagem}`, cStat: null, xMotivo: null, protocolo: null, etapas, verificacao: null };
    }
    await setStatus(nota.chave, 2, 0);
    passo("Validação do Linx (LX_VALIDA_NFE_PARA_ENVIO)", true);

    // 5. Envio
    let chaves: FiscalFlowChaves;
    try {
      chaves = await autenticarFiscalFlow(cfg);
    } catch (err) {
      await setStatus(nota.chave, 1, 0);
      passo("Autenticação na Fiscal Flow", false, (err as Error).message);
      return { situacao: "erro", mensagem: (err as Error).message, cStat: null, xMotivo: null, protocolo: null, etapas, verificacao: null };
    }
    passo("Autenticação na Fiscal Flow", true);
    const { corpo, compactado } = montarCorpoEnvio(xml, tpAmb);
    await setStatus(nota.chave, 3, 0);
    await logMide(params.usuarioLinx, nota.chave, "ERP.001", "COMPACTAR", "ERP.COMPACTAR", JSON.stringify(compactado));

    let ret: FiscalFlowRetorno | null = null;
    try {
      const r = await enviarNfeFiscalFlow(cfg, chaves, corpo);
      ret = r.retorno;
      await logMide(params.usuarioLinx, nota.nf, "ERP.015", "RETORNO DO ENVIAR", "ERP.ENVIAR", r.bruto);
      passo("Enviada à SEFAZ pela Fiscal Flow", true, `cStat ${trim(ret.cStat)} — ${trim(ret.xMotivo)}`);
    } catch (err) {
      const e = err as FiscalFlowErro;
      await logMide(params.usuarioLinx, nota.chave, e.semResposta ? "ERP.401" : "ERP.402", "FALHA AO ENVIAR DOCUMENTO", "ERP.ENVIAR", e.message);
      passo("Enviada à SEFAZ pela Fiscal Flow", false, e.message);
      if (!e.semResposta) {
        await setStatus(nota.chave, 1, 0);
        return { situacao: "erro", mensagem: e.message, cStat: null, xMotivo: null, protocolo: null, etapas, verificacao: null };
      }
      // Sem resposta: a nota pode ter sido autorizada. Decide pela consulta.
    }

    // 6–7. Decisão pelo retorno (ou pela consulta, quando não há certeza)
    let cStat = trim(ret?.cStat);
    let comportamento = cStat && !/^\d+$/.test(cStat) ? await comportamentoDoCodigo(cStat) : null;
    if (!ret || (!/^\d+$/.test(cStat) && comportamento !== "R")) {
      passo("Sem confirmação imediata — consultando a SEFAZ", true, cStat ? `${cStat} ${trim(ret?.xMotivo)}` : "sem resposta");
      for (let i = 0; i < 4; i += 1) {
        await espera(i === 0 ? 3000 : 6000);
        try {
          const c = await consultarNfeFiscalFlow(cfg, chaves, { nNF: Number(nota.nf), serie: nota.serieSefaz, cnpj: nota.cnpj });
          await logMide(params.usuarioLinx, nota.nf, "ERP.015", "RETORNO DA CONSULTA", "ERP.CONSULTA", c.bruto);
          ret = c.retorno;
          cStat = trim(ret.cStat);
          comportamento = !/^\d+$/.test(cStat) ? await comportamentoDoCodigo(cStat) : null;
          if (/^\d+$/.test(cStat) || comportamento === "R") break;
        } catch (err) {
          passo(`Consulta ${i + 1}`, false, (err as Error).message);
        }
      }
    }

    if (ret && (AUTORIZADA.has(cStat) || DENEGADA.has(cStat))) {
      const nfeProc = descompactar(ret.XmlCompactado);
      if (!nfeProc.includes("nfeProc")) {
        passo("XML autorizado devolvido", false, "a Fiscal Flow não devolveu o nfeProc");
      }
      await aplicarRetornoAutorizado(nota, ret, nfeProc, params.usuarioLinx);
      passo("Retorno gravado no Linx (status, protocolo, XML, contábil)", true);
      const verificacao = await verificarNotaSefaz({ ...params, cfgPronta: { cfg, chaves } });
      return {
        situacao: AUTORIZADA.has(cStat) ? "autorizada" : "denegada",
        mensagem: `${cStat} — ${trim(ret.xMotivo)}`,
        cStat,
        xMotivo: trim(ret.xMotivo),
        protocolo: trim(ret.nProt) || null,
        etapas,
        verificacao,
      };
    }
    if (ret && (/^\d+$/.test(cStat) || comportamento === "R")) {
      await aplicarRejeicao(nota, ret, comportamento);
      passo("Rejeição registrada no Linx (status 4)", true, `${cStat} — ${trim(ret.xMotivo)}`);
      return {
        situacao: "rejeitada",
        mensagem: `${cStat} — ${trim(ret.xMotivo)}`,
        cStat,
        xMotivo: trim(ret.xMotivo),
        protocolo: null,
        etapas,
        verificacao: null,
      };
    }
    // Continua sem certeza: volta para "não enviada" (como o desktop) — o reenvio é seguro
    // porque a SEFAZ nunca autoriza a mesma chave duas vezes; mas o certo é consultar antes.
    await setStatus(nota.chave, 1, 0, "AND STATUS_NFE IN (2,3)");
    passo("Situação ainda indefinida", false, "Use 'Consultar na SEFAZ' em alguns minutos antes de reenviar.");
    return {
      situacao: "pendente",
      mensagem: `Sem confirmação da SEFAZ (${cStat || "sem resposta"} ${trim(ret?.xMotivo)}). Consulte em alguns minutos.`,
      cStat: cStat || null,
      xMotivo: trim(ret?.xMotivo) || null,
      protocolo: null,
      etapas,
      verificacao: null,
    };
  } catch (err) {
    // Erro inesperado no meio do caminho: não deixa a NF presa em 2/3.
    await setStatus(nota.chave, 1, 0, "AND STATUS_NFE IN (2,3) AND LOG_STATUS_NFE = 0").catch(() => 0);
    throw err;
  }
}

// ── Consulta / verificação independente ─────────────────────────────────────

/**
 * Confere a NF nos dois lados: o que o Linx gravou (status, protocolo, XML, contábil) e o
 * que a SEFAZ diz agora (consulta pela Fiscal Flow). `aplicar` grava no Linx a autorização
 * encontrada na SEFAZ quando o Linx ainda não sabe (ex.: queda de conexão no envio).
 */
export async function verificarNotaSefaz(params: {
  empresa: EmpresaFat;
  filial: string;
  nf: string;
  serie: string;
  usuarioLinx?: string;
  aplicar?: boolean;
  cfgPronta?: { cfg: FiscalFlowConfig; chaves: FiscalFlowChaves };
}): Promise<Verificacao> {
  let nota = await carregarNota(params.empresa, params.filial, params.nf, params.serie);
  const conexao = params.cfgPronta ?? (await (async () => {
    const { cfg } = await lerConfig();
    return { cfg, chaves: await autenticarFiscalFlow(cfg) };
  })());
  const c = await consultarNfeFiscalFlow(conexao.cfg, conexao.chaves, { nNF: Number(nota.nf), serie: nota.serieSefaz, cnpj: nota.cnpj });
  const sefazCStat = trim(c.retorno.cStat) || null;
  const sefazProt = trim(c.retorno.nProt) || null;

  if (params.aplicar && sefazCStat && (AUTORIZADA.has(sefazCStat) || DENEGADA.has(sefazCStat)) && ![5, 6, 70].includes(nota.status)) {
    const nfeProc = descompactar(c.retorno.XmlCompactado);
    if (nfeProc.includes("nfeProc")) {
      await aplicarRetornoAutorizado(nota, c.retorno, nfeProc, params.usuarioLinx ?? "LOGISTICA");
      nota = await carregarNota(params.empresa, params.filial, params.nf, params.serie);
    }
  }

  const [extra] = await rodar(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM DADOS_CADASTRO_XML_NFE WITH (NOLOCK) WHERE CHAVE_NFE = @c) THEN 1 ELSE 0 END AS xml`,
    (req) => req.input("c", sql.VarChar(44), nota.chave)
  );
  const xmlGuardado = Number(extra?.[0]?.xml) === 1;
  const linxAutorizada = nota.status === 5 || nota.status === 6;
  const sefazAutorizada = !!sefazCStat && AUTORIZADA.has(sefazCStat);
  const confere =
    (linxAutorizada && sefazAutorizada && (!sefazProt || sefazProt === nota.protocolo)) ||
    (!linxAutorizada && !sefazAutorizada);
  let observacao: string;
  if (linxAutorizada && sefazAutorizada) {
    observacao = sefazProt && sefazProt !== nota.protocolo ? "Protocolos diferentes entre Linx e SEFAZ — verificar." : "Autorizada na SEFAZ e no Linx, mesmo protocolo.";
  } else if (sefazAutorizada && !linxAutorizada) {
    observacao = "A SEFAZ autorizou mas o Linx ainda não registrou. Use 'Gravar retorno no Linx' (ou 'Consulta Retorno NF-e' no monitor do Linx).";
  } else if (linxAutorizada && !sefazAutorizada) {
    observacao = "O Linx diz autorizada mas a consulta à SEFAZ não confirmou — verificar no portal da NF-e.";
  } else {
    observacao = "Não autorizada (nem no Linx nem na SEFAZ).";
  }
  return {
    linxStatus: nota.status,
    linxLog: nota.log,
    linxProtocolo: nota.protocolo,
    xmlGuardado,
    contabilizada: !!nota.ctbLancamento,
    sefazCStat,
    sefazMotivo: trim(c.retorno.xMotivo) || null,
    sefazProtocolo: sefazProt,
    confere,
    chave: nota.chave,
    observacao,
  };
}

/** Teste de conexão: autentica e consulta a última NF autorizada da empresa (nada é enviado). */
export async function testarConexaoFiscalFlow(empresa: EmpresaFat): Promise<{ autenticou: boolean; nfConsultada: string; verificacao: Verificacao }> {
  const filiais = PADROES[empresa].nota.filiais;
  const [rows] = await rodar(
    `SELECT TOP 1 LTRIM(RTRIM(FILIAL)) AS filial, LTRIM(RTRIM(NF_SAIDA)) AS nf, LTRIM(RTRIM(SERIE_NF)) AS serie
       FROM FATURAMENTO WITH (NOLOCK)
      WHERE FILIAL IN (${filiais.map((_, i) => `@f${i}`).join(",")}) AND STATUS_NFE = 5 AND NOTA_CANCELADA = 0
      ORDER BY DATA_AUTORIZACAO_NFE DESC`,
    (req) => filiais.forEach((f, i) => req.input(`f${i}`, sql.VarChar(25), f))
  );
  const alvo = rows?.[0];
  if (!alvo) throw new Error("Nenhuma NF autorizada para usar no teste.");
  const verificacao = await verificarNotaSefaz({ empresa, filial: trim(alvo.filial), nf: trim(alvo.nf), serie: trim(alvo.serie) });
  return { autenticou: true, nfConsultada: `${trim(alvo.nf)}/${trim(alvo.serie)} ${trim(alvo.filial)}`, verificacao };
}
