/**
 * Aproveitamentos da Matriz — a lista inicial da tela "Aproveitamentos Matriz" (Scarf Me).
 *
 * São lenços 50x50 e twillys 8x130 feitos de sobra de tecido que JÁ EXISTEM fisicamente na
 * matriz mas ainda não entraram no estoque do Linx. O estoque deles é contado à mão e fica
 * no Neon ([aproveitamentos-matriz-store.ts](@/lib/utils/aproveitamentos-matriz-store)) —
 * nunca em ESTOQUE_PRODUTOS. Não confundir com o estoque oficial da matriz.
 *
 * Do Linx vem só o cadastro: cada item aponta para um PRODUTO (+ cor) e de lá saem a
 * descrição, o custo (CUSTO_REPOSICAO1) e o preço sugerido (PRECO_REPOSICAO_1).
 *
 * Esta lista é só a SEMENTE (planilha do dono, 28/10/2026), usada enquanto nada foi salvo.
 * Depois do primeiro "Salvar" quem manda é o que está no Neon, e os vínculos se corrigem
 * pela própria tela.
 *
 * Mapeamento feito pelo cadastro (GRADE 50X50 / 8X130, quase todos na LINHA
 * "APROVEITAMENTO LENÇO"). **Todo aproveitamento desta tela é de POLIÉSTER** (confirmado pelo
 * dono em 28/10/2026): quando o mesmo desenho existe em cetim de seda (preço 238) e em cetim
 * de poliéster (158), o vínculo é sempre o de poliéster. A tela marca para conferir qualquer
 * item vinculado a produto de outro tecido (`TECIDO_APROVEITAMENTO`).
 */

export type FormatoAproveitamento = "50x50" | "8x130";

export interface AproveitamentoItem {
  /** Estável: é a chave da linha na tela e no que se salva. */
  id: string;
  formato: FormatoAproveitamento;
  /** Nome como a matriz chama o item (não precisa bater com o Linx). */
  nome: string;
  /** Código do produto no Linx. null = ainda sem vínculo (sem custo/preço). */
  produto: string | null;
  /** COR_PRODUTO do cadastro do produto. null = não especificada. */
  cor: string | null;
  /** Peças na matriz — contagem manual, fora do Linx. */
  estoque: number;
  /** Ponto a conferir no vínculo (aparece na tela). */
  nota?: string | null;
}

export const FORMATOS_APROVEITAMENTO: { key: FormatoAproveitamento; label: string; grade: string }[] = [
  { key: "50x50", label: "Aproveitamento 50x50cm", grade: "50X50" },
  { key: "8x130", label: "Aproveitamento 8x130cm", grade: "8X130" },
];

/** O único tecido dos aproveitamentos desta tela (casa com SUBGRUPO_PRODUTO do Linx). */
export const TECIDO_APROVEITAMENTO = "POLIESTER";

export const APROVEITAMENTOS_SEMENTE: AproveitamentoItem[] = [
  // ── 50x50 ──
  { id: "50-neiva", formato: "50x50", nome: "Neiva", produto: "13.46.263", cor: "10", estoque: 100 },
  { id: "50-julie", formato: "50x50", nome: "Julie", produto: "13.71.150", cor: "05", estoque: 100 },
  { id: "50-cocar", formato: "50x50", nome: "Cocar", produto: "13.46.96", cor: "10", estoque: 100 },
  { id: "50-modern-dubai-azul", formato: "50x50", nome: "Modern Dubai azul", produto: "13.46.0132", cor: "03", estoque: 100 },
  { id: "50-sucuri", formato: "50x50", nome: "Sucuri", produto: "13.71.0581", cor: "09", estoque: 100 },
  { id: "50-marble-flower-off", formato: "50x50", nome: "Marble flower - off", produto: "13.46.0130", cor: "13", estoque: 100 },
  { id: "50-marble-flower-bordeaux", formato: "50x50", nome: "Marble flower - bordeaux", produto: "13.46.0130", cor: "35", estoque: 100 },
  { id: "50-flor-do-poder-roxo", formato: "50x50", nome: "Flor do poder roxo", produto: "13.46.0341", cor: "18", estoque: 20 },
  { id: "50-empodere-se", formato: "50x50", nome: "Empodere-se", produto: "13.46.0123", cor: "107", estoque: 100 },
  { id: "50-fervo", formato: "50x50", nome: "Fervo", produto: "13.46.0346", cor: "05", estoque: 100 },
  { id: "50-verde-louro", formato: "50x50", nome: "Verde louro", produto: "13.46.0285", cor: "02", estoque: 100 },
  { id: "50-grand-mosque", formato: "50x50", nome: "Grand mosque", produto: "13.46.0129", cor: "10", estoque: 100 },
  { id: "50-flor-flamingo-magenta", formato: "50x50", nome: "Flor flamingo magenta", produto: "13.46.0119", cor: "90", estoque: 100 },
  { id: "50-bandana-azul", formato: "50x50", nome: "Bandana azul", produto: "13.46.229", cor: "03", estoque: 100 },
  // "Acqua" e "Marine" da planilha são o mesmo produto: MARINE ACQUA 02/24 (dono, 28/10/2026).
  { id: "50-acqua", formato: "50x50", nome: "Acqua", produto: "13.46.0224", cor: "40", estoque: 50 },
  { id: "50-marine", formato: "50x50", nome: "Marine", produto: "13.46.0224", cor: "40", estoque: 50 },

  // ── 8x130 ──
  { id: "8-tramado-twilly", formato: "8x130", nome: "Tramado twilly", produto: "85.03.0239", cor: "20", estoque: 100 },
  { id: "8-vitral-pucci-twilly", formato: "8x130", nome: "Vitral Pucci twilly", produto: "85.03.120", cor: "03", estoque: 100 },
  { id: "8-fervo-twilly", formato: "8x130", nome: "Fervo - twilly", produto: "85.03.0234", cor: "05", estoque: 50 },
  { id: "8-manaca", formato: "8x130", nome: "Manaca", produto: "85.03.0236", cor: "03", estoque: 40 },
  { id: "8-julie", formato: "8x130", nome: "Julie", produto: "85.03.60", cor: "05", estoque: 45 },
  { id: "8-xadrez-color", formato: "8x130", nome: "Xadrez color", produto: "85.03.156", cor: "10", estoque: 9 },
  { id: "8-gravataria-cavalos", formato: "8x130", nome: "Gravataria cavalos", produto: "85.03.0223", cor: "09", estoque: 150 },
  { id: "8-encontro-carioca", formato: "8x130", nome: "Encanto carioca", produto: "85.03.0233", cor: "03", estoque: 20 },
  { id: "8-ritos-do-mar", formato: "8x130", nome: "Ritos do mar", produto: "85.03.0243", cor: "03", estoque: 80 },
  { id: "8-modern-dubai", formato: "8x130", nome: "Modern Dubai", produto: "85.03.0208", cor: "116", estoque: 23 },
  { id: "8-flor-negra", formato: "8x130", nome: "Flor Negra", produto: "85.03.137", cor: "09", estoque: 40 },
  { id: "8-aguia", formato: "8x130", nome: "Aguia", produto: "85.03.20", cor: "08", estoque: 40 },
  { id: "8-sundar", formato: "8x130", nome: "Sundar", produto: "85.03.140", cor: "112", estoque: 40 },
  // Código 85.04 (série de seda), mas o cadastro é CETIM DE POLIESTER — é o certo.
  { id: "8-leopardo", formato: "8x130", nome: "Leopardo", produto: "85.04.0125", cor: "09", estoque: 108 },
  { id: "8-jaguatirica-rosa", formato: "8x130", nome: "Jaguatirica do cerrado - rosa", produto: "85.03.0222", cor: "08", estoque: 10 },
  { id: "8-jaguatirica-roxo", formato: "8x130", nome: "Jaguatirica do cerrado - roxo", produto: "85.03.0222", cor: "18", estoque: 20 },
  { id: "8-jaguatirica-caramelo", formato: "8x130", nome: "Jaguatirica do cerrado - caramelo", produto: "85.03.0222", cor: "41", estoque: 100 },
  { id: "8-empodere-se", formato: "8x130", nome: "Empodere-se", produto: "85.03.0200", cor: "107", estoque: 30 },
  // Na planilha estava na coluna 50x50 por engano: é o twilly (dono, 28/10/2026).
  { id: "8-tracos-de-coragem", formato: "8x130", nome: "Traços de coragem", produto: "85.03.0232", cor: "08", estoque: 20 },
];
