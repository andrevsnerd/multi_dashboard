import "server-only";

import { NextResponse } from "next/server";

import { query } from "@/lib/db/connection";
import { findUserByUsername } from "@/lib/auth/users-store";
import { isReadOnlyRole, seesAllFiliais, userHasPagePermission } from "@/lib/auth/permissions";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { listarFiliaisParaAjuste, type FilialAjuste } from "@/lib/repositories/ajusteEstoque";
import type { CompanyKey } from "@/lib/config/company";
import type { RoleKey } from "@/types/auth";

/**
 * Escopo de filiais do VM.
 *
 * Regra de acesso pedida: logística pra cima enxerga TODAS as filiais; gerente só a sua
 * filial atribuída. Diretor e supervisor são somente-leitura (veem tudo, não mexem).
 *
 * A filial atribuída NÃO está na sessão — vive em `transferencia_permissoes`
 * (mesma fonte que a Lista Loja usa) e é um COD_FILIAL.
 */
export interface VmEscopo {
  username: string;
  role: RoleKey;
  /** true = enxerga todas as filiais da empresa. */
  todasFiliais: boolean;
  /** Códigos de filial permitidos. Vazio + todasFiliais=false ⇒ sem acesso a nada. */
  filiaisPermitidas: string[];
  /** false para diretor/supervisor (somente leitura). */
  podeMutar: boolean;
}

function normalizeCod(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * `filialAtribuida` pode vir gravada como COD_FILIAL ou como o nome da filial (o campo é
 * livre e histórico). Resolve as duas formas para o COD, para que TODA comparação daqui
 * pra frente seja cod × cod — senão o gerente veria a filial no seletor (que também casa
 * por nome) e tomaria 403 ao salvar (que só casava por código).
 */
async function resolverCodFilial(valor: string): Promise<string | null> {
  const alvo = valor.trim();
  if (!alvo) return null;
  const esc = alvo.replace(/'/g, "''");
  const rows = await query<{ COD: string }>(`
    SELECT TOP 1 LTRIM(RTRIM(COD_FILIAL)) AS COD
    FROM FILIAIS WITH (NOLOCK)
    WHERE LTRIM(RTRIM(COD_FILIAL)) = '${esc}'
       OR UPPER(LTRIM(RTRIM(FILIAL))) = UPPER('${esc}')
    ORDER BY CASE WHEN LTRIM(RTRIM(COD_FILIAL)) = '${esc}' THEN 0 ELSE 1 END
  `);
  return rows[0]?.COD?.trim() || null;
}

/**
 * Resolve o escopo do usuário a partir do header `x-auth-username`. Devolve `{ error }`
 * com o NextResponse pronto quando o acesso deve ser negado — mesmo padrão das rotas de
 * ajuste de estoque.
 */
export async function resolveVmEscopo(
  username: string | null | undefined
): Promise<{ escopo: VmEscopo; error?: undefined } | { escopo?: undefined; error: NextResponse }> {
  const normalized = username?.trim();
  if (!normalized) {
    return {
      error: NextResponse.json(
        { error: "Usuário não identificado. Faça login novamente." },
        { status: 401 }
      ),
    };
  }

  const user = await findUserByUsername(normalized);
  if (!user) {
    return { error: NextResponse.json({ error: "Usuário não encontrado." }, { status: 403 }) };
  }

  if (!userHasPagePermission({ ...user, permissions: user.permissions ?? [] }, "vm")) {
    return {
      error: NextResponse.json(
        { error: "Sem permissão para acessar a lista de VM." },
        { status: 403 }
      ),
    };
  }

  const podeMutar = !isReadOnlyRole(user.role);

  if (seesAllFiliais(user.role)) {
    return {
      escopo: {
        username: user.username,
        role: user.role,
        todasFiliais: true,
        filiaisPermitidas: [],
        podeMutar,
      },
    };
  }

  // Gerente (e qualquer função futura fora de ALL_FILIAIS_ROLES): só a filial atribuída.
  const permissao = await getPermissaoByUsername(user.username);
  const atribuida = normalizeCod(permissao?.filialAtribuida);
  let filiaisPermitidas: string[] = [];
  if (atribuida && atribuida !== "TODAS") {
    const cod = await resolverCodFilial(atribuida).catch(() => null);
    filiaisPermitidas = [normalizeCod(cod ?? atribuida)];
  }

  return {
    escopo: {
      username: user.username,
      role: user.role,
      todasFiliais: false,
      filiaisPermitidas,
      podeMutar,
    },
  };
}

/** True se o escopo permite operar/ver essa filial (por COD ou pelo nome exato). */
export function escopoPermiteFilial(
  escopo: VmEscopo,
  filialCod: string,
  filialNome?: string | null
): boolean {
  if (escopo.todasFiliais) return true;
  const cod = normalizeCod(filialCod);
  const nome = normalizeCod(filialNome);
  return escopo.filiaisPermitidas.some((permitida) => permitida === cod || (!!nome && permitida === nome));
}

/**
 * Filiais que o usuário pode escolher na página, já filtradas pelo escopo.
 *
 * Só as ATIVAS da empresa — filiais em uso (venda recente ou depósito operacional). As
 * "inativas" de `listarFiliaisParaAjuste` são as que NINGUÉM usa mais, de qualquer
 * empresa: fazem sentido no Ajuste de Estoque (zerar saldo de loja morta), não aqui.
 * Não existe peça em exposição numa loja que não opera.
 */
export async function listarFiliaisDoEscopo(
  company: CompanyKey,
  escopo: VmEscopo
): Promise<FilialAjuste[]> {
  const { ativas } = await listarFiliaisParaAjuste(company);
  if (escopo.todasFiliais) return ativas;
  return ativas.filter((f) => escopoPermiteFilial(escopo, f.cod, f.nome));
}
