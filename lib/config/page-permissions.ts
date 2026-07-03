type PagePermissionDefinition = {
  key: string;
  label: string;
  routeSegments?: readonly string[];
  showInAdmin?: boolean;
};

export const PAGE_PERMISSION_DEFINITIONS = [
  { key: "dashboard", label: "Dashboard", routeSegments: ["dashboard"] },
  { key: "produtos", label: "Produtos", routeSegments: ["produtos"] },
  { key: "produto-agrupado", label: "Produto Agrupado", routeSegments: ["produto-agrupado"] },
  { key: "produto-descontinuado", label: "Produto Descontinuado", routeSegments: ["produto-descontinuado"] },
  { key: "produto-detalhado", label: "Produto Detalhado", routeSegments: ["produto-detalhado"] },
  { key: "produto-performance", label: "Produto Performance", routeSegments: ["produto-performance"] },
  { key: "produtos-recentes", label: "Produtos Recentes", routeSegments: ["produtos-recentes"] },
  { key: "produtos-novos", label: "Produtos Novos", routeSegments: ["produtos-novos"] },
  { key: "relatorio-colecao", label: "Relatorio Colecao", routeSegments: ["relatorio-colecao"] },
  { key: "painel-colecoes", label: "Painel de Colecoes", routeSegments: ["painel-colecoes"] },
  { key: "relatorio-claude", label: "Relatorio Claude", routeSegments: ["relatorio-claude"] },
  { key: "vendedores", label: "Vendedores", routeSegments: ["vendedores"] },
  { key: "clientes", label: "Clientes", routeSegments: ["clientes"] },
  { key: "faturamento", label: "Faturamento / NFs", routeSegments: ["faturamento"] },
  { key: "controle-estoque", label: "Controle de Estoque", routeSegments: ["controle-estoque"] },
  { key: "estoque-consulta", label: "Estoque Consulta", routeSegments: ["estoque-consulta"] },
  { key: "controle-giro", label: "Controle de Giro", routeSegments: ["controle-giro"] },
  { key: "produtos-parados", label: "Produtos Parados", routeSegments: ["produtos-parados"] },
  { key: "controle-performance", label: "Controle de Performance", routeSegments: ["controle-performance"] },
  { key: "controle-movimento", label: "Controle de Movimento", routeSegments: ["controle-movimento"] },
  { key: "curva-abc", label: "Curva A, B, C", routeSegments: ["curva-abc"] },
  { key: "curva-por-produto", label: "Curva por Produto", routeSegments: ["curva-por-produto"] },
  { key: "nova-filial", label: "Nova Filial", routeSegments: ["nova-filial"] },
  { key: "estoque-por-filial", label: "Estoque por Filial", routeSegments: ["estoque-por-filial"] },
  { key: "controle-transferencias", label: "Controle de Transferencias", routeSegments: ["controle-transferencias"] },
  { key: "transferencia-produtos", label: "Transferencia de Produtos", routeSegments: ["transferencia-produtos"] },
  { key: "romaneios", label: "Romaneios", routeSegments: ["romaneios"] },
  { key: "saidas-entradas-produtos", label: "Saidas e Entradas de Produtos", routeSegments: ["saidas-entradas-produtos"] },
  { key: "extrato-produto", label: "Extrato de Produto", routeSegments: ["extrato-produto"] },
  { key: "ajuste-estoque", label: "Ajuste de Estoque", routeSegments: ["ajuste-estoque"] },
  { key: "destino-romaneio", label: "Destino Romaneio" },
  { key: "lista-loja", label: "Lista Loja", routeSegments: ["lista-loja"] },
  { key: "compras-transito", label: "Compras em Transito", routeSegments: ["compras-transito"] },
  { key: "compras-salvas", label: "Compras Salvas", routeSegments: ["compras-salvas"] },
  { key: "mapa-clientes", label: "Mapa de Clientes", routeSegments: ["mapa-clientes"] },
  { key: "filial", label: "Filiais", routeSegments: ["filial"] },
  { key: "exportar-relatorios", label: "Exportar Relatorios", routeSegments: ["exportar-relatorios"] },
  { key: "gerador-relatorios", label: "Gerador de Relatorios", routeSegments: ["gerador-relatorios"] },
  { key: "gerador-apresentacoes", label: "Gerador de Apresentacoes", routeSegments: ["gerador-apresentacoes"] },
  { key: "fornecedores", label: "Grupos de Fornecedores", routeSegments: ["fornecedores"] },
  { key: "sincronizacao", label: "Sincronizacao", routeSegments: ["sincronizacao"] },
  { key: "blackfriday", label: "Black Friday", routeSegments: ["blackfriday"] },
] as const satisfies readonly PagePermissionDefinition[];

export type PermissionKey = (typeof PAGE_PERMISSION_DEFINITIONS)[number]["key"];

export const ALL_PERMISSION_KEYS = PAGE_PERMISSION_DEFINITIONS
  .filter((definition) => !("showInAdmin" in definition) || definition.showInAdmin !== false)
  .map(({ key, label }) => ({ key, label })) as { key: PermissionKey; label: string }[];

export const PAGE_ROUTE_PERMISSION_MAP = Object.fromEntries(
  PAGE_PERMISSION_DEFINITIONS.flatMap((definition) => {
    const routeSegments = "routeSegments" in definition ? definition.routeSegments : undefined;
    return (routeSegments ?? []).map((segment: string) => [segment, definition.key]);
  })
) as Record<string, PermissionKey>;

export const LEGACY_PERMISSION_FALLBACKS: Partial<Record<PermissionKey, PermissionKey[]>> = {
  "relatorio-colecao": ["produtos"],
  "painel-colecoes": ["produtos"],
  "produto-agrupado": ["produtos"],
  "produto-descontinuado": ["produtos"],
  "produtos-recentes": ["produtos"],
  "produtos-novos": ["produtos"],
  "produto-performance": ["produto-detalhado", "produtos"],
  "relatorio-claude": ["produtos"],
  "gerador-apresentacoes": ["gerador-relatorios", "produtos"],
  "estoque-consulta": ["controle-estoque"],
  "produtos-parados": ["controle-giro"],
  "curva-por-produto": ["curva-abc"],
  "nova-filial": ["curva-abc"],
  "compras-transito": ["lista-loja"],
  "compras-salvas": ["lista-loja"],
};
