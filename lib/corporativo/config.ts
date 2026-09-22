/**
 * Configurações da área CORPORATIVO que o dono pode ajustar num lugar só
 * (loja corporativa + padrões do cadastro de cliente no Linx).
 *
 * ⚙️ FRETE: valor fixo cobrado em todo pedido corporativo (igual para todos os
 * clientes). Para mudar o frete de TODA a rede, altere APENAS a constante abaixo
 * — ela é a fonte única, usada tanto na exibição (carrinho/checkout) quanto na
 * gravação do pedido no servidor. O R$ 90 atual é provisório.
 */
export const FRETE_FIXO = 90;

/**
 * 🧾 CONTA CONTÁBIL padrão do cliente (CLIENTES_ATACADO.CTB_CONTA_CONTABIL,
 * FK para CTB_CONTA_PLANO). 1120101 = "DUPLICATAS A RECEBER - CLIENTE NACIONAL",
 * a conta de recebível usada nos cadastros PJ feitos direto no Linx.
 */
export const CONTA_CONTABIL_PADRAO = "1120101";

/**
 * 👤 REPRESENTANTE padrão do cliente (CLIENTE_REPRE.REPRESENTANTE, FK para
 * REPRESENTANTES). "SEM REPRESENTANTE" é um representante de verdade no Linx
 * (código 0001) — é assim que o ERP marca venda direta, sem comissão.
 */
export const REPRESENTANTE_PADRAO = "SEM REPRESENTANTE";
