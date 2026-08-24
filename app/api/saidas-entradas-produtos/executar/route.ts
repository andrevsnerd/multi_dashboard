import { NextResponse } from 'next/server';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { readOnlyBlock } from '@/lib/auth/route-guards';
import { getPermissaoByUsername } from '@/lib/utils/transferencia-permissoes-store';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { setDestinoRomaneio } from '@/lib/utils/destino-romaneio-store';
import {
  insertTransferenciasPendentes,
  type TransferenciaPendenteInsert,
} from '@/lib/utils/transferencia-pendente-store';
import { executeSaidaLote, executeEntradaLote } from '@/lib/saida-entrada-executor';
import {
  buscarDefeitoDoDia,
  isSaidaDeDefeito,
  mensagemTravaDefeito,
  podeIgnorarTravaDefeito,
} from '@/lib/server/trava-defeito';
import { getActiveFilial } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import type { CompanyConfig } from '@/lib/config/company';

interface ItemOperacao {
  produto: string;
  corProduto: string | null;
  quantidade: number;
}

/**
 * Metadados opcionais para registrar a saída no histórico de transferências
 * (tela Controle de Transferências). Quando presente em uma operação `saida` do
 * tipo TRANSFERENCIA ENTRE LOJAS, gravamos uma linha em `transferencia_pendente`
 * por item, ligada ao romaneio gerado. O JOIN com `romaneio_item_confirmado`
 * deriva o status (pendente/confirmada) na leitura.
 */
interface ControleTransferenciaItemMeta {
  produto: string;
  corCodigo: string | null;
  corDescricao: string | null;
  descricao: string | null;
  codigoBarra: string | null;
  origemLabel: string | null;
  destinoLabel: string | null;
  itemKey: string;
  quantidade: number;
}

interface SaidaEntradaRequest {
  tipoOperacao: 'saida' | 'entrada';
  filial: string;
  filialDestino?: string | null;
  itens: ItemOperacao[];
  tipoRomaneio?: string;
  responsavel?: string;
  observacao?: string | null;
  companyKey?: string;
  registrarTransferenciaPendente?: {
    items: ControleTransferenciaItemMeta[];
  };
}

function isTransferenciaEntreLojas(tipoRomaneio: string): boolean {
  const normalized = (tipoRomaneio || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized.includes('TRANSFERENCIA ENTRE LOJAS');
}

function normalizeFilialKey(value: string): string {
  return (value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isDisplayOnlyFilialInput(
  company: CompanyConfig | null,
  filial: string
): boolean {
  if (!company) return false;

  const raw = normalizeFilialKey(filial);
  if (!raw) return false;

  const operationalNames = new Set<string>();
  const addOperational = (value?: string | null) => {
    const normalized = normalizeFilialKey(value || '');
    if (normalized) operationalNames.add(normalized);
  };

  for (const filialName of company.filialFilters.inventory ?? []) {
    addOperational(filialName);
  }

  for (const [canonical, members] of Object.entries(company.filialGroups ?? {})) {
    addOperational(canonical);
    for (const member of members) addOperational(member);
  }

  for (const [from, to] of Object.entries(company.activeFilials ?? {})) {
    addOperational(from);
    addOperational(to);
  }

  if (operationalNames.has(raw)) return false;

  return Object.entries(company.filialDisplayNames ?? {}).some(([erpName, displayLabel]) => {
    return normalizeFilialKey(displayLabel) === raw && normalizeFilialKey(erpName) !== raw;
  });
}

async function getActiveFilialForRequest(companyKey: string | undefined, filial: string): Promise<string> {
  const preferredCompany = await resolveCompanyDynamic(companyKey);
  if (preferredCompany) {
    return getActiveFilial(preferredCompany, filial);
  }

  for (const key of ['nerd', 'scarfme']) {
    const company = await resolveCompanyDynamic(key);
    const active = getActiveFilial(company, filial);
    if (active !== filial.trim()) return active;
  }

  return filial.trim();
}

export async function POST(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    const readOnly = await readOnlyBlock(username);
    if (readOnly) return readOnly;
    const body = (await request.json()) as SaidaEntradaRequest;
    const {
      tipoOperacao,
      filial,
      filialDestino = null,
      itens,
      tipoRomaneio = tipoOperacao === 'saida' ? 'TRANSFERENCIA' : 'ENTRADA AVULSA',
      observacao = null,
      companyKey,
      registrarTransferenciaPendente = null,
    } = body;

    // Validar dados
    if (!filial || !tipoOperacao || !itens || itens.length === 0) {
      return NextResponse.json(
        { error: 'Dados inválidos para operação' },
        { status: 400 }
      );
    }

    for (const item of itens) {
      if (!item.produto || item.quantidade <= 0) {
        return NextResponse.json(
          { error: 'Dados inválidos: cada item precisa de produto e quantidade > 0' },
          { status: 400 }
        );
      }
    }

    if (tipoOperacao !== 'saida' && tipoOperacao !== 'entrada') {
      return NextResponse.json(
        { error: 'tipoOperacao deve ser "saida" ou "entrada"' },
        { status: 400 }
      );
    }

    const preferredCompany = await resolveCompanyDynamic(companyKey);

    if (isDisplayOnlyFilialInput(preferredCompany, filial.trim())) {
      return NextResponse.json(
        { error: 'A filial enviada é um rótulo visual do grupo. A operação exige a filial operacional real.' },
        { status: 400 }
      );
    }

    if (filialDestino && isDisplayOnlyFilialInput(preferredCompany, filialDestino.trim())) {
      return NextResponse.json(
        { error: 'A filial destino enviada é um rótulo visual do grupo. A operação exige a filial operacional real.' },
        { status: 400 }
      );
    }

    const filialTrim = await getActiveFilialForRequest(companyKey, filial.trim());
    const filialDestinoTrim = filialDestino
      ? await getActiveFilialForRequest(companyKey, filialDestino.trim())
      : filialDestino;

    if (tipoOperacao === 'saida' && isTransferenciaEntreLojas(tipoRomaneio) && !filialDestinoTrim) {
      return NextResponse.json(
        { error: 'Filial destino é obrigatória para romaneio do tipo TRANSFERENCIA ENTRE LOJAS.' },
        { status: 400 }
      );
    }

    if (!username) {
      return NextResponse.json(
        { error: 'Usuário não identificado. Faça login novamente.' },
        { status: 401 }
      );
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json(
        { error: 'Usuário não encontrado' },
        { status: 403 }
      );
    }

    const permissao = await getPermissaoByUsername(user.username);

    if (user.role !== 'admin') {
      if (!permissao) {
        return NextResponse.json(
          { error: 'Sem permissão para realizar esta operação. Configure o perfil em Admin.' },
          { status: 403 }
        );
      }
      const listaDaOperacao = tipoOperacao === 'saida'
        ? permissao.filiaisOrigem
        : permissao.filiaisDestino;
      // Filiais adicionais valem para saída E entrada: são filiais onde o usuário opera
      // (ex.: logística da NERD que também dá entrada/saída em NERD DEFEITOS).
      const adicionaisAtivas = await Promise.all(
        (permissao.filiaisAdicionais ?? []).map((p) =>
          getActiveFilialForRequest(companyKey, (p || '').trim())
        )
      );
      const filialOk =
        listaDaOperacao.length === 0 ||
        (await Promise.all(
          listaDaOperacao.map((p) => getActiveFilialForRequest(companyKey, (p || '').trim()))
        )).some((a) => a === filialTrim) ||
        adicionaisAtivas.some((a) => a === filialTrim);
      if (!filialOk) {
        return NextResponse.json(
          { error: 'Sem permissão para esta filial.' },
          { status: 403 }
        );
      }
    }

    /**
     * TRAVA DE DEFEITO — UM romaneio de saída de defeito por filial por dia.
     * Ver `lib/server/trava-defeito.ts`. Fica DEPOIS da checagem de permissão e
     * ANTES de gerar o romaneio; a tela só espelha o aviso, o bloqueio é aqui.
     * Se a consulta falhar, deixamos passar (fail-open): trava não pode derrubar
     * a operação de defeito por indisponibilidade do banco.
     */
    if (
      tipoOperacao === 'saida' &&
      !podeIgnorarTravaDefeito(user.role) &&
      isSaidaDeDefeito({ companyKey, tipoRomaneio, filialDestino: filialDestinoTrim })
    ) {
      let defeitoDoDia = null;
      try {
        defeitoDoDia = await buscarDefeitoDoDia(companyKey, filialTrim);
      } catch (travaError) {
        console.error('Erro ao verificar trava de romaneio de defeito do dia', travaError);
      }
      if (defeitoDoDia) {
        return NextResponse.json(
          {
            error: mensagemTravaDefeito(defeitoDoDia),
            travaDefeito: true,
            romaneioExistente: defeitoDoDia,
          },
          { status: 409 }
        );
      }
    }

    // Responsável: sempre o usuário do LINX atrelado ao login (resolveResponsavelLinx).
    // O valor enviado pelo cliente é completamente ignorado.
    const responsavelFinal = await resolveResponsavelLinx(username);

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    const result = tipoOperacao === 'saida'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await executeSaidaLote(pool, { itens, filial: filialTrim, filialDestino: filialDestinoTrim, tipoRomaneio, responsavel: responsavelFinal, observacao } as any)
      : await executeEntradaLote(pool, { itens, filial: filialTrim, tipoRomaneio, responsavel: responsavelFinal, observacao });

    if (tipoOperacao === 'saida' && companyKey && filialDestinoTrim && result.romaneio) {
      try {
        await setDestinoRomaneio(companyKey, result.romaneio, filialTrim, filialDestinoTrim);
      } catch (destinoError) {
        console.error('Erro ao salvar destino auxiliar do romaneio', destinoError);
      }

      // Histórico para a tela "Controle de Transferências". Falha aqui é logada
      // mas não desfaz a saída — o romaneio já foi gerado no ERP.
      if (registrarTransferenciaPendente?.items?.length) {
        try {
          const itemsToInsert: TransferenciaPendenteInsert[] =
            registrarTransferenciaPendente.items.map((meta) => ({
              itemKey: meta.itemKey,
              produto: meta.produto,
              corDescricao: meta.corDescricao,
              corCodigo: meta.corCodigo,
              descricao: meta.descricao,
              codigoBarra: meta.codigoBarra,
              origemCanonico: filialTrim,
              destinoCanonico: filialDestinoTrim,
              origemLabel: meta.origemLabel,
              destinoLabel: meta.destinoLabel,
              romaneioSaida: result.romaneio,
              quantidade: Math.max(1, Math.floor(meta.quantidade)),
            }));
          await insertTransferenciasPendentes(
            companyKey,
            result.romaneio,
            username,
            itemsToInsert
          );
        } catch (registerError) {
          console.error('Erro ao registrar transferência pendente', registerError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      romaneio: result.romaneio,
      message: result.message,
    });
  } catch (error: unknown) {
    console.error('Erro ao executar operação', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao executar operação' },
      { status: 500 }
    );
  }
}
