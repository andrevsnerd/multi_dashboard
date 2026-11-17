import "server-only";

import { gunzipSync, gzipSync } from "zlib";

/**
 * Cliente da API Linx Fiscal Flow (MIDe Evo) — a mesma que o Linx desktop usa no
 * "Envia NFe para Sefaz". Contrato extraído do próprio Linx (C:\Linx\Recursos\lx_nfe.app)
 * e do log MIDE_NFE_LOG — ver docs/FATURAMENTO_SHOPIFY_LINX.md §5.
 *
 * - A Fiscal Flow ASSINA o XML (certificado na nuvem da Linx): enviamos XmlAssinado=false.
 * - Credenciais: INTEGRACOES_API (SISTEMA 'Fiscal Flow'), lidas do banco a cada uso; nunca
 *   copiadas para env/log.
 */

export const FF_APPLICATION_ID = "DE02E733-A636-4C41-907F-55C8721FCCDF";
const TIMEOUT_AUTH_MS = 30_000;
const TIMEOUT_ENVIO_MS = 90_000;

export interface FiscalFlowConfig {
  usuario: string;
  senha: string;
  endereco: string;
  ambiente: 1 | 2;
}

export interface FiscalFlowChaves {
  CurrentCompany: string;
  AutorizationToken: string;
  CurrentUser: string;
  AccessGroup: string;
}

/** Retorno da Fiscal Flow (campos usados; o JSON tem muitos outros). */
export interface FiscalFlowRetorno {
  chNFe?: string | null;
  dhRetorno?: string | null;
  nProt?: string | null;
  cStat?: string | null;
  xMotivo?: string | null;
  XmlCompactado?: string | null;
  MensagemErro?: string | null;
  [k: string]: unknown;
}

export class FiscalFlowErro extends Error {
  constructor(
    message: string,
    /** true = não houve resposta (timeout/rede): a NF pode ter sido autorizada mesmo assim. */
    readonly semResposta: boolean,
    readonly corpo?: string
  ) {
    super(message);
  }
}

const base = (u: string) => u.trim().replace(/\/+$/, "");

export function compactar(texto: string): string {
  return gzipSync(Buffer.from(texto, "utf8")).toString("base64");
}

export function descompactar(b64: string | null | undefined): string {
  if (!b64) return "";
  return gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
}

async function chamar(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; texto: string }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new FiscalFlowErro(`Sem resposta da Fiscal Flow: ${(err as Error).message}`, true);
  }
  return { status: res.status, texto: await res.text() };
}

/** AuthenticateJson → as 4 chaves que vão nos cabeçalhos das chamadas seguintes. */
export async function autenticarFiscalFlow(cfg: FiscalFlowConfig): Promise<FiscalFlowChaves> {
  const url =
    `${base(cfg.endereco)}/Linx-TCS0101-BO-TcsAutorizacao-TcsAutorizacaoDomainService.svc/json/AuthenticateJson` +
    `?userName=${encodeURIComponent(cfg.usuario)}&password=${encodeURIComponent(cfg.senha)}&applicationId=${FF_APPLICATION_ID}`;
  // O Linx não deixa explícito o verbo: tenta GET e, se o serviço recusar o método, POST.
  let r = await chamar(url, { method: "GET", headers: { "Content-Type": "application/json" } }, TIMEOUT_AUTH_MS);
  if (r.status === 405) r = await chamar(url, { method: "POST", headers: { "Content-Type": "application/json" } }, TIMEOUT_AUTH_MS);
  if (r.status < 200 || r.status >= 300) {
    const msg = /"ErrorMessage"\s*:\s*"([^"]+)"/.exec(r.texto)?.[1] ?? r.texto.slice(0, 200);
    throw new FiscalFlowErro(`Falha na autenticação da Fiscal Flow (HTTP ${r.status}): ${msg}`, false);
  }
  const j = JSON.parse(r.texto) as { AuthenticateJsonResult?: { Key: number; Value: string }[] };
  const k = Object.fromEntries((j.AuthenticateJsonResult ?? []).map((x) => [x.Key, x.Value]));
  if (!k[1] || !k[2]) throw new FiscalFlowErro("A Fiscal Flow não devolveu as chaves de acesso.", false);
  return { CurrentCompany: k[1], AutorizationToken: k[2], CurrentUser: k[3] ?? "", AccessGroup: k[4] ?? "" };
}

function cabecalhos(chaves: FiscalFlowChaves): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    ApplicationID: FF_APPLICATION_ID,
    CurrentCompany: chaves.CurrentCompany,
    AutorizationToken: chaves.AutorizationToken,
    CurrentUser: chaves.CurrentUser,
    AccessGroup: chaves.AccessGroup,
  };
}

function parseRetorno(status: number, texto: string): FiscalFlowRetorno {
  if (status < 200 || status >= 300) {
    throw new FiscalFlowErro(`A Fiscal Flow respondeu HTTP ${status}: ${texto.slice(0, 300)}`, false, texto);
  }
  try {
    return JSON.parse(texto) as FiscalFlowRetorno;
  } catch {
    throw new FiscalFlowErro(`Resposta inesperada da Fiscal Flow: ${texto.slice(0, 300)}`, false, texto);
  }
}

/** Corpo exatamente como o Linx envia: string JSON com base64(gzip(JSON)). */
export function montarCorpoEnvio(xmlSemAssinatura: string, tpAmb: number): { corpo: string; compactado: string } {
  const json = JSON.stringify({ Xml: xmlSemAssinatura, DevolveXml: true, tpAmb, XmlAssinado: false });
  const compactado = compactar(json);
  return { corpo: JSON.stringify(compactado), compactado };
}

/** POST /api/NFWebApi/EnviaNFeXmlCompactado — envia o XML (sem assinatura) para autorização. */
export async function enviarNfeFiscalFlow(
  cfg: FiscalFlowConfig,
  chaves: FiscalFlowChaves,
  corpo: string
): Promise<{ retorno: FiscalFlowRetorno; bruto: string }> {
  const r = await chamar(
    `${base(cfg.endereco)}/api/NFWebApi/EnviaNFeXmlCompactado`,
    { method: "POST", headers: cabecalhos(chaves), body: corpo },
    TIMEOUT_ENVIO_MS
  );
  return { retorno: parseRetorno(r.status, r.texto), bruto: r.texto };
}

/** POST /api/NFWebApi/ConsultaNFe — situação da NF na SEFAZ (e o XML autorizado, se houver). */
export async function consultarNfeFiscalFlow(
  cfg: FiscalFlowConfig,
  chaves: FiscalFlowChaves,
  params: { nNF: number; serie: string; cnpj: string }
): Promise<{ retorno: FiscalFlowRetorno; bruto: string }> {
  const r = await chamar(
    `${base(cfg.endereco)}/api/NFWebApi/ConsultaNFe`,
    {
      method: "POST",
      headers: cabecalhos(chaves),
      body: JSON.stringify({ nNF: params.nNF, serie: params.serie, CNPJ: params.cnpj, DevolveXml: true }),
    },
    TIMEOUT_AUTH_MS
  );
  return { retorno: parseRetorno(r.status, r.texto), bruto: r.texto };
}

/** cStat de autorização (100 autorizada, 150 fora do prazo). */
export const AUTORIZADA = new Set(["100", "150"]);
/** Uso denegado. */
export const DENEGADA = new Set(["110", "301", "302"]);
