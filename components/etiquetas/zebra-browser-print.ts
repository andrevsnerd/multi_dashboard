"use client";

/**
 * Ponte com o Zebra Browser Print (o serviço local gratuito da Zebra).
 *
 * Ele escuta em 127.0.0.1:9100 (http) e 127.0.0.1:9101 (https, com certificado
 * próprio para 127.0.0.1). Quando o dashboard é servido por HTTPS — pelo túnel —
 * o navegador bloqueia chamada http (conteúdo misto), então tentamos o https
 * primeiro e caímos para o http só quando a página é http.
 *
 * Sem o serviço instalado nada aqui funciona: a tela cai no download do .zpl ou
 * na impressão pelo navegador.
 */

export interface ZebraDevice {
  name: string;
  uid: string;
  connection: string;
  deviceType: string;
  version?: number;
  provider?: string;
  manufacturer?: string;
}

const BASES_HTTPS = ["https://127.0.0.1:9101", "https://localhost:9101"];
const BASES_HTTP = ["http://127.0.0.1:9100", "http://localhost:9100"];

function basesCandidatas(): string[] {
  if (typeof window === "undefined") return BASES_HTTP;
  const paginaSegura = window.location.protocol === "https:";
  return paginaSegura ? BASES_HTTPS : [...BASES_HTTP, ...BASES_HTTPS];
}

let baseDetectada: string | null = null;

/** Um dispositivo só serve se tiver identidade — `{}` vira 500 no /write. */
function dispositivoValido(d: ZebraDevice | null | undefined): d is ZebraDevice {
  return Boolean(d && typeof d.uid === "string" && d.uid.trim() && d.name);
}

async function tentar(base: string, caminho: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    return await fetch(`${base}${caminho}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Descobre em qual porta o Browser Print está atendendo. `null` = não achou. */
export async function detectarBrowserPrint(): Promise<string | null> {
  if (baseDetectada) return baseDetectada;
  for (const base of basesCandidatas()) {
    try {
      const resp = await tentar(base, "/available");
      if (resp.ok) {
        baseDetectada = base;
        return base;
      }
    } catch {
      // porta fechada ou bloqueada — tenta a próxima
    }
  }
  return null;
}

export interface StatusBrowserPrint {
  disponivel: boolean;
  impressoras: ZebraDevice[];
  padrao: ZebraDevice | null;
  /** Motivo quando não está disponível (para explicar na tela). */
  motivo?: string;
}

/** Lista as impressoras que o Browser Print enxerga na máquina do usuário. */
export async function listarImpressoras(): Promise<StatusBrowserPrint> {
  const base = await detectarBrowserPrint();
  if (!base) {
    const paginaSegura = typeof window !== "undefined" && window.location.protocol === "https:";
    return {
      disponivel: false,
      impressoras: [],
      padrao: null,
      motivo: paginaSegura
        ? "Zebra Browser Print não respondeu em https://127.0.0.1:9101. Instale o serviço (ou abra https://127.0.0.1:9101 uma vez para aceitar o certificado)."
        : "Zebra Browser Print não respondeu em 127.0.0.1:9100. Instale o serviço da Zebra nesta máquina.",
    };
  }

  try {
    const resp = await tentar(base, "/available");
    const dados = (await resp.json()) as { printer?: ZebraDevice[]; device?: ZebraDevice[] };
    const impressoras = (dados.printer ?? dados.device ?? []).filter(dispositivoValido);

    let padrao: ZebraDevice | null = null;
    try {
      const respPadrao = await tentar(base, "/default?type=printer");
      const texto = await respPadrao.text();
      if (texto.trim().startsWith("{")) {
        const candidato = JSON.parse(texto) as ZebraDevice;
        // O serviço devolve `{}` quando não há padrão. Mandar isso para /write
        // dá 500 — por isso só aceitamos um dispositivo de verdade.
        if (dispositivoValido(candidato)) padrao = candidato;
      }
    } catch {
      // sem padrão configurado — usamos a primeira da lista
    }

    return {
      disponivel: true,
      impressoras,
      padrao: padrao ?? impressoras[0] ?? null,
      motivo:
        impressoras.length === 0
          ? "O serviço está rodando, mas não encontrou nenhuma impressora. Abra o Zebra Browser Print (bandeja do Windows) → Settings e marque \"Driver Search\" para ele enxergar a ZDesigner ZD230 instalada no Windows; depois clique em verificar."
          : undefined,
    };
  } catch (error) {
    return {
      disponivel: false,
      impressoras: [],
      padrao: null,
      motivo: error instanceof Error ? error.message : "Falha ao falar com o Browser Print.",
    };
  }
}

/**
 * Manda a impressora recalibrar o sensor de mídia (`~JC`).
 *
 * Ela avança algumas etiquetas medindo o vão entre elas e guarda o passo. Sem
 * isso, `^MNY` não tem referência e a impressão volta a andar de lugar. É uma
 * ação de uma vez só — só precisa repetir ao trocar o tipo de rolo.
 */
export async function calibrarMidia(device: ZebraDevice): Promise<void> {
  await enviarZpl(device, '~JC');
}

/** Manda o ZPL cru para a impressora escolhida. */
export async function enviarZpl(device: ZebraDevice, zpl: string): Promise<void> {
  const base = await detectarBrowserPrint();
  if (!base) throw new Error("Zebra Browser Print não está rodando nesta máquina.");
  if (!dispositivoValido(device)) {
    throw new Error(
      'Nenhuma impressora selecionada. No Zebra Browser Print → Settings, marque "Driver Search" (ou adicione a ZD230 em Added Devices) e clique em verificar.'
    );
  }

  const resp = await tentar(base, "/write", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ device, data: zpl }),
  });

  if (!resp.ok) {
    const detalhe = (await resp.text().catch(() => "")).trim();
    throw new Error(
      `Browser Print respondeu ${resp.status} ao enviar o trabalho${detalhe ? `: ${detalhe}` : ""}. ` +
        'Costuma ser impressora não reconhecida — em Settings, marque "Driver Search" e confirme que a ZD230 aparece em Default/Added Devices.'
    );
  }
  const texto = (await resp.text()).trim();
  if (!texto) return;
  // Corpo vazio, "ok" e "{}" são SUCESSO — as versões do Browser Print variam, e
  // algumas devolvem um JSON vazio. Tratar tudo que não fosse "ok" como erro era
  // o que fazia aparecer um "{}" vermelho na tela mesmo com o envio dando certo.
  if (/^ok$/i.test(texto)) return;

  if (texto.startsWith("{") || texto.startsWith("[")) {
    let dados: unknown = null;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new Error(`Resposta não reconhecida do Browser Print: ${texto}`);
    }
    // Só é erro se o JSON realmente trouxer uma mensagem de erro.
    const obj = (dados ?? {}) as Record<string, unknown>;
    const motivo = [obj.error, obj.message, obj.errorMessage]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find(Boolean);
    if (motivo) throw new Error(motivo);
    return;
  }

  throw new Error(texto);
}
