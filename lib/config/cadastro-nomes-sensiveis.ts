/**
 * Nomes de dimensão que estão FIXOS no código do dashboard.
 *
 * Renomear um grupo/subgrupo/linha no Linx é seguro do lado do ERP: a FK
 * `ON UPDATE CASCADE` e os triggers `LXU_*` propagam o novo nome para PRODUTOS e
 * para todas as tabelas filhas dentro do próprio statement. O que o Linx NÃO
 * conserta é o nosso lado: regras que casam por STRING literal.
 *
 * Se alguém renomear 'ELETRONICOS' ou 'PANNEAUX', essas regras param de casar
 * silenciosamente — o dashboard não quebra, ele passa a devolver número errado.
 * Por isso a tela avisa ANTES de gravar, em vez de deixar descobrir depois.
 *
 * Mantenha esta lista viva: ao fixar um nome novo em código, registre aqui.
 */

export interface NomeSensivel {
  /** Valor exato como está no cadastro (comparação é case-insensitive/trim). */
  nome: string;
  /** Em que dimensão esse nome vive. */
  dimensao: 'grupo' | 'subgrupo' | 'linha' | 'grade' | 'colecao';
  /** Onde o nome está fixo, para o aviso apontar o arquivo. */
  usos: string[];
}

export const NOMES_SENSIVEIS: NomeSensivel[] = [
  {
    nome: 'ELETRONICOS',
    dimensao: 'linha',
    usos: [
      'lib/config/company.ts — escopo de linhas da NERD',
      'lib/config/compra-ciclo.ts — ciclo de compra (cobertura 30d)',
      'lib/performance/outrosCategories.ts — categorização de performance',
      'lib/repositories/stockByFilial.ts — filtro de estoque NERD',
      'lib/repositories/produtosNovos.ts — janela de produtos novos',
      'lib/repositories/controleEstoque.ts — escopo do dashboard NERD',
      'lib/utils/suggestion-rules.ts — cobertura sugerida',
    ],
  },
  {
    nome: 'ELETRONICOS',
    dimensao: 'grupo',
    usos: ['lib/repositories/stockByFilial.ts — filtro casa LINHA ou GRUPO_PRODUTO'],
  },
  {
    nome: 'PANNEAUX',
    dimensao: 'grupo',
    usos: ['lib/config/distribuicao-minimos.ts — mínimo sazonal (verão/inverno) da Distribuição Matriz'],
  },
  {
    nome: 'VISCOSE',
    dimensao: 'subgrupo',
    usos: ['lib/config/distribuicao-minimos.ts — PANNEAU VISCOSE 130X200 (mínimo sazonal)'],
  },
  {
    nome: 'GEORGETE DE POLIESTER',
    dimensao: 'subgrupo',
    usos: ['lib/config/distribuicao-minimos.ts — PANNEAU GEORGETE 130X200 (mínimo sazonal)'],
  },
];

/**
 * Avisos aplicáveis a um nome que está sendo renomeado/inativado. Compara por
 * dimensão + nome normalizado; devolve lista vazia quando o nome é livre.
 */
export function avisosNomeSensivel(
  dimensao: NomeSensivel['dimensao'],
  nome: string
): string[] {
  const alvo = (nome ?? '').trim().toUpperCase();
  if (!alvo) return [];
  return NOMES_SENSIVEIS
    .filter((n) => n.dimensao === dimensao && n.nome.trim().toUpperCase() === alvo)
    .flatMap((n) => n.usos);
}

/**
 * Avisos que valem para QUALQUER rename de grupo/subgrupo, independente do nome:
 * campos que o nosso lado guarda por cópia e que ficam velhos sozinhos.
 */
export const AVISOS_COPIA_LOCAL: Record<string, string[]> = {
  grupo: [
    'Catálogo corporativo: a categoria do produto é um campo SALVO no Neon (não lido ao vivo). ' +
      'Depois de renomear, rode "Sincronizar categorias" em /corporativo/catalogo.',
  ],
  subgrupo: [
    'Catálogo corporativo: a categoria do produto é um campo SALVO no Neon. ' +
      'Rode "Sincronizar categorias" em /corporativo/catalogo depois de renomear.',
  ],
};
