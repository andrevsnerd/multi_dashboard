import { getPermissaoByUsername } from '@/lib/utils/transferencia-permissoes-store';

/**
 * Usuário do LINX atrelado a um usuário do dashboard.
 *
 * REGRA (não abrir exceção): todo registro gravado no Linx — RESPONSAVEL de romaneio,
 * de saída/entrada, de contagem de ajuste, de transferência, e a auditoria em
 * NERD_AJUSTE_HISTORICO — leva o login do LINX, nunca o login do dashboard. No Linx
 * o histórico tem que casar com quem o pessoal enxerga lá dentro: "ANDRE.SABETTA",
 * não "andre.sabetta".
 *
 * O vínculo é o `responsavelPadrao` da permissão de transferência (cadastrado no
 * painel admin por login). É a mesma fonte que os romaneios de saída/entrada já
 * usavam — o que faltava era o resto do sistema usar também.
 *
 * Ordem de resolução:
 *   1. responsavelPadrao cadastrado  → é o vínculo de verdade
 *   2. username em MAIÚSCULAS        → palpite para quem ainda não tem vínculo
 *      (logins do Linx são maiúsculos; ao menos não grava minúsculo do dashboard)
 *   3. 'LOGISTICA'                   → operação sem usuário identificado
 *
 * RESPONSAVEL é VARCHAR(25) nas tabelas do Linx, então o retorno já vem cortado.
 */
export const RESPONSAVEL_LINX_FALLBACK = 'LOGISTICA';
const RESPONSAVEL_MAX = 25;

export async function resolveResponsavelLinx(
  username: string | null | undefined
): Promise<string> {
  const login = (username ?? '').trim();
  if (!login) return RESPONSAVEL_LINX_FALLBACK;

  let vinculado: string | undefined;
  try {
    const permissao = await getPermissaoByUsername(login);
    vinculado = permissao?.responsavelPadrao?.trim() || undefined;
  } catch (err) {
    // Sem o store (Neon fora, ambiente sem DATABASE_URL) ainda é melhor gravar o
    // login em maiúsculas do que o do dashboard em minúsculas.
    console.error('[responsavel-linx] Falha ao ler o vínculo do usuário:', err);
  }

  if (!vinculado) {
    console.warn(
      `[responsavel-linx] Usuário "${login}" sem responsavelPadrao cadastrado; ` +
      `gravando "${login.toUpperCase()}" no Linx. Cadastre o usuário do Linx no painel admin.`
    );
  }

  return (vinculado ?? login.toUpperCase()).slice(0, RESPONSAVEL_MAX);
}
