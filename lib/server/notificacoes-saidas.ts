/**
 * Fonte canônica das pendências de "saída destinada à filial".
 *
 * Espelha EXATAMENTE a lógica de filtro de app/api/romaneios/saidas/route.ts
 * (destino salvo + getActiveFilial + filialAtribuida do usuário), mas é um
 * módulo isolado para não tocar/alterar a rota existente.
 *
 * Reutilizável de propósito: hoje alimenta o sino de notificações; no futuro a
 * "trava" de lojas que não confirmaram entradas em X dias pode consumir a
 * mesma lista de pendências (cada item já traz qtdConfirmados e dataEmissao).
 *
 * Regra de pendência: uma saída só vira pendência enquanto a entrada NÃO foi
 * totalmente confirmada (qtdConfirmados < qtdProdutos). Ao confirmar tudo, ela
 * deixa de aparecer.
 *
 * Importante: notificações são EXCLUSIVAS de filial. Usuários que "veem tudo"
 * (admin, logística, ou sem filialAtribuida) não recebem pendências — evita
 * flood e respeita a ideia de notificação por filial atribuída.
 */

import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { getAllDestinosByCompany } from "@/lib/utils/destino-romaneio-store";
import { fetchLogSaidas } from "@/lib/repositories/logSaidas";
import { findUserByUsername } from "@/lib/auth/users-store";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { getContadorConfirmadosByCompany } from "@/lib/utils/romaneio-confirmacao-store";
import type { SaidaPendente } from "@/lib/types/notificacao";

/** Janela padrão (dias) para considerar uma saída "nova". */
export const NOTIF_JANELA_DIAS = 30;

function cleanDestino(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return null;
  return trimmed;
}

function getDestinoSalvo(
  destinosMap: Map<string, string>,
  romaneio: string,
  filialOrigem: string,
  filialOrigemCodigo?: string
): string | null {
  const origem = cleanDestino(filialOrigem);
  const origemCodigo = cleanDestino(filialOrigemCodigo);
  const keys = [
    origem ? `${romaneio}|${origem}` : null,
    origemCodigo ? `${romaneio}|${origemCodigo}` : null,
  ].filter(Boolean) as string[];

  for (const key of keys) {
    if (destinosMap.has(key)) {
      return cleanDestino(destinosMap.get(key)) ?? "";
    }
  }
  return null;
}

function dentroDaJanela(dataEmissao: string, dias: number): boolean {
  const t = new Date(dataEmissao).getTime();
  if (Number.isNaN(t)) return true; // sem data válida: não descarta
  const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
  return t >= limite;
}

/**
 * Retorna as saídas pendentes (não confirmadas) destinadas à filial atribuída
 * do usuário, dentro da janela de `dias`. Lista vazia se o usuário vê tudo.
 */
export async function getSaidasPendentesParaUsuario(
  companyKey: string,
  username: string,
  dias: number = NOTIF_JANELA_DIAS
): Promise<SaidaPendente[]> {
  if (!companyKey || !username) return [];

  const companyConfig = await resolveCompanyDynamic(companyKey);
  if (!companyConfig) return [];

  // Notificações só fazem sentido para usuário preso a UMA filial.
  const userRecord = await findUserByUsername(username);
  if (userRecord?.role === "logistica") return [];

  const permissao = await getPermissaoByUsername(username);
  const filialAtribuida = getActiveFilial(companyConfig, permissao?.filialAtribuida ?? "")
    .trim()
    .toUpperCase();
  const verTodas = !filialAtribuida || filialAtribuida === "TODAS";
  if (verTodas) return [];

  const filiaisInventory = companyConfig.filialFilters.inventory ?? [];
  const filiaisEmpresa = new Set(filiaisInventory.map((f) => f.toUpperCase()));

  const [saidas, destinosMap, confirmadosCounter] = await Promise.all([
    fetchLogSaidas(1000, 90, "", filiaisInventory),
    getAllDestinosByCompany(companyKey),
    getContadorConfirmadosByCompany(companyKey),
  ]);

  const pendentes: SaidaPendente[] = [];

  for (const s of saidas) {
    // Só saídas originadas em filiais desta empresa.
    if (filiaisEmpresa.size > 0 && !filiaisEmpresa.has((s.filialOrigem ?? "").toUpperCase())) {
      continue;
    }

    const destinoSalvo = getDestinoSalvo(destinosMap, s.romaneio, s.filialOrigem, s.filialOrigemCodigo);
    const destinoOriginal =
      destinoSalvo !== null
        ? destinoSalvo
        : cleanDestino(s.filialDestino) || cleanDestino(s.filialDestinoCodigo);
    const destinoCodigo = destinoOriginal ? getActiveFilial(companyConfig, destinoOriginal) : null;

    // Filtro por filial atribuída — mesma regra da rota de saídas.
    const destinoNorm = getActiveFilial(companyConfig, destinoCodigo ?? "").trim().toUpperCase();
    if (!destinoCodigo || destinoNorm !== filialAtribuida) continue;

    const dataEmissao = s.dataDigitacao || s.dataEmissao;
    if (!dentroDaJanela(dataEmissao, dias)) continue;

    const qtdConfirmados =
      (confirmadosCounter.get(`${s.romaneio}|${destinoCodigo}`) ?? 0) ||
      (destinoOriginal ? (confirmadosCounter.get(`${s.romaneio}|${destinoOriginal}`) ?? 0) : 0);

    // Pendência só enquanto a entrada não foi totalmente confirmada.
    const totalmenteConfirmado = s.qtdProdutos > 0 && qtdConfirmados >= s.qtdProdutos;
    if (totalmenteConfirmado) continue;

    pendentes.push({
      key: `saida:${companyKey}:${s.romaneio}:${destinoCodigo}`,
      tipo: "saida_destinada",
      company: companyKey,
      romaneio: s.romaneio,
      filialOrigem: s.filialOrigem,
      filialDestino: destinoSalvo !== null ? (destinoOriginal ?? "") : s.filialDestino,
      destinoCodigo,
      dataEmissao,
      responsavel: s.responsavel || "",
      tipoRomaneio: s.tipoRomaneio || "",
      qtdProdutos: s.qtdProdutos,
      qtdItens: s.qtdItens,
      qtdConfirmados,
    });
  }

  // Mais recentes primeiro.
  pendentes.sort((a, b) => new Date(b.dataEmissao).getTime() - new Date(a.dataEmissao).getTime());
  return pendentes;
}
