"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "./SidebarContext";
import { useAuth } from "@/components/auth/AuthContext";
import { userHasPagePermission, roleAllowsPermission, hasFullPageAccess } from "@/lib/auth/permissions";
import type { PermissionKey } from "@/types/auth";

import styles from "./Sidebar.module.css";

interface SidebarProps {
  companyName: string;
}

type NavSubItem = {
  key: string;
  label: string;
  href: string;
  permission?: PermissionKey;
  isActive: (pathname: string | null) => boolean;
};

type NavItemBase = {
  key: string;
  label: string;
  permission?: PermissionKey | "admin";
  href?: string;
  subItems?: NavSubItem[];
  isActive?: (pathname: string | null) => boolean;
};

type NavSection = {
  key: string;
  label: string;
  items: NavItemBase[];
};

export default function Sidebar({ companyName }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { isOpen, toggle, close } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [produtosExpanded, setProdutosExpanded] = useState(false);
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 1024);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Empresa "dona" desta sidebar, derivada do nome que a PageLayout injeta.
  // Serve de fallback quando a URL atual não tem um segmento de empresa válido
  // (ex.: navegação com pathname transitório/nulo): sem isso, getBasePath cairia
  // para "/" e TODOS os links do menu perderiam o prefixo /nerd ou /scarfme,
  // prendendo o usuário em rotas sem empresa (404).
  const companyKeyFromName =
    companyName === "SCARF ME" ? "scarfme" : companyName === "NERD" ? "nerd" : null;

  const getBasePath = () => {
    const parts = (pathname || "").split("/").filter(Boolean);
    const company = parts[0];
    if (company === "nerd" || company === "scarfme") return `/${company}`;

    if (companyKeyFromName) return `/${companyKeyFromName}`;

    return "/";
  };

  const basePath = getBasePath();

  const produtosHref = basePath && basePath !== "/" ? `${basePath}/produtos` : "/produtos";
  const produtoDetalhadoHref =
    basePath && basePath !== "/" ? `${basePath}/produto-detalhado` : "/produto-detalhado";
  const produtoPerformanceHref =
    basePath && basePath !== "/" ? `${basePath}/produto-performance` : "/produto-performance";
  const produtoAgrupadoHref =
    basePath && basePath !== "/" ? `${basePath}/produto-agrupado` : "/produto-agrupado";
  const produtoDescontinuadoHref =
    basePath && basePath !== "/" ? `${basePath}/produto-descontinuado` : "/produto-descontinuado";
  const produtosNovosHref =
    basePath && basePath !== "/" ? `${basePath}/produtos-novos` : "/produtos-novos";
  const relatorioColecaoHref =
    basePath && basePath !== "/" ? `${basePath}/relatorio-colecao` : "/relatorio-colecao";
  const painelColecoesHref =
    basePath && basePath !== "/" ? `${basePath}/painel-colecoes` : "/painel-colecoes";
  const relatorioClaudeHref =
    basePath && basePath !== "/" ? `${basePath}/relatorio-claude` : "/relatorio-claude";
  const vendedoresHref =
    basePath && basePath !== "/" ? `${basePath}/vendedores` : "/vendedores";
  const clientesHref = basePath && basePath !== "/" ? `${basePath}/clientes` : "/clientes";
  const faturamentoHref =
    basePath && basePath !== "/" ? `${basePath}/faturamento` : "/faturamento";
  const filialHref =
    basePath && basePath !== "/" ? `${basePath}/filial` : "/filial";
  const exportarRelatoriosHref =
    basePath && basePath !== "/" ? `${basePath}/exportar-relatorios` : "/exportar-relatorios";
  const geradorRelatoriosHref =
    basePath && basePath !== "/" ? `${basePath}/gerador-relatorios` : "/gerador-relatorios";
  const aumentosDescontosHref =
    basePath && basePath !== "/" ? `${basePath}/aumentos-descontos` : "/aumentos-descontos";
  const geradorApresentacoesHref =
    basePath && basePath !== "/" ? `${basePath}/gerador-apresentacoes` : "/gerador-apresentacoes";
  const fornecedoresHref =
    basePath && basePath !== "/" ? `${basePath}/fornecedores` : "/fornecedores";
  const controleEstoqueHref =
    basePath && basePath !== "/" ? `${basePath}/controle-estoque` : "/controle-estoque";
  const estoqueConsultaHref =
    basePath && basePath !== "/" ? `${basePath}/estoque-consulta` : "/estoque-consulta";
  const controleGiroHref =
    basePath && basePath !== "/" ? `${basePath}/controle-giro` : "/controle-giro";
  const produtosParadosHref =
    basePath && basePath !== "/" ? `${basePath}/produtos-parados` : "/produtos-parados";
  const controlePerformanceHref =
    basePath && basePath !== "/" ? `${basePath}/controle-performance` : "/controle-performance";
  const lojaRaioXHref =
    basePath && basePath !== "/" ? `${basePath}/loja-raio-x` : "/loja-raio-x";
  const curvaAbcHref = basePath && basePath !== "/" ? `${basePath}/curva-abc` : "/curva-abc";
  const curvaPorProdutoHref =
    basePath && basePath !== "/" ? `${basePath}/curva-por-produto` : "/curva-por-produto";
  const novaFilialHref =
    basePath && basePath !== "/" ? `${basePath}/nova-filial` : "/nova-filial";
  const controleTransferenciasHref =
    basePath && basePath !== "/"
      ? `${basePath}/controle-transferencias`
      : "/controle-transferencias";
  const transferenciaProdutosHref =
    basePath && basePath !== "/"
      ? `${basePath}/transferencia-produtos`
      : "/transferencia-produtos";
  const distribuicaoMatrizHref =
    basePath && basePath !== "/"
      ? `${basePath}/distribuicao-matriz`
      : "/distribuicao-matriz";
  const romaneiosHref =
    basePath && basePath !== "/" ? `${basePath}/romaneios` : "/romaneios";
  const saidasEntradasProdutosHref =
    basePath && basePath !== "/"
      ? `${basePath}/saidas-entradas-produtos`
      : "/saidas-entradas-produtos";
  const extratoProdutoHref =
    basePath && basePath !== "/" ? `${basePath}/extrato-produto` : "/extrato-produto";
  const ajusteEstoqueHref =
    basePath && basePath !== "/" ? `${basePath}/ajuste-estoque` : "/ajuste-estoque";
  const listaLojaHref =
    basePath && basePath !== "/" ? `${basePath}/lista-loja` : "/lista-loja";
  const comprasTransitoHref =
    basePath && basePath !== "/" ? `${basePath}/compras-transito` : "/compras-transito";
  const comprasSalvasHref =
    basePath && basePath !== "/" ? `${basePath}/compras-salvas` : "/compras-salvas";
  const mapaClientesHref =
    basePath && basePath !== "/" ? `${basePath}/mapa-clientes` : "/mapa-clientes";
  const sincronizacaoHref =
    basePath && basePath !== "/" ? `${basePath}/sincronizacao` : "/sincronizacao";

  const isScarfme = basePath === "/scarfme";
  const isNerd = basePath === "/nerd";

  const matchesSegment = (currentPathname: string | null, segment: string, href?: string) =>
    currentPathname?.includes(segment) || currentPathname === href;

  const produtosSubItems: NavSubItem[] = [
    {
      key: "produtos-venda",
      label: "Produtos por Venda",
      href: produtosHref,
      permission: "produtos",
      isActive: (currentPathname) =>
        !!currentPathname &&
        currentPathname.includes("/produtos") &&
        !currentPathname.includes("/produtos-recentes") &&
        !currentPathname.includes("/produto-detalhado") &&
        !currentPathname.includes("/produtos-novos"),
    },
    {
      key: "produto-agrupado",
      label: "Produto Agrupado",
      href: produtoAgrupadoHref,
      permission: "produto-agrupado",
      isActive: (currentPathname) => !!currentPathname && currentPathname.includes("/produto-agrupado"),
    },
    {
      key: "produto-descontinuado",
      label: "Produto Descontinuado",
      href: produtoDescontinuadoHref,
      permission: "produto-descontinuado",
      isActive: (currentPathname) => !!currentPathname && currentPathname.includes("/produto-descontinuado"),
    },
    {
      key: "produto-detalhado",
      label: "Produto Detalhado",
      href: produtoDetalhadoHref,
      permission: "produto-detalhado",
      isActive: (currentPathname) => !!currentPathname && currentPathname.includes("/produto-detalhado"),
    },
    {
      key: "produto-performance",
      label: "Produto Performance",
      href: produtoPerformanceHref,
      permission: "produto-performance",
      isActive: (currentPathname) => !!currentPathname && currentPathname.includes("/produto-performance"),
    },
    {
      key: "produtos-novos",
      label: "Produtos Novos",
      href: produtosNovosHref,
      permission: "produtos-novos",
      isActive: (currentPathname) => !!currentPathname && currentPathname.includes("/produtos-novos"),
    },
  ];

  const dashboardBlockedSegments = [
    "/estoque-por-filial",
    "/controle-estoque",
    "/estoque-consulta",
    "/controle-giro",
    "/produtos-parados",
    "/controle-performance",
    "/loja-raio-x",
    "/curva-abc",
    "/curva-por-produto",
    "/controle-transferencias",
    "/transferencia-produtos",
    "/distribuicao-matriz",
    "/romaneios",
    "/saidas-entradas-produtos",
    "/extrato-produto",
    "/ajuste-estoque",
    "/lista-loja",
    "/compras-transito",
    "/compras-salvas",
    "/produtos",
    "/produtos-recentes",
    "/produto-agrupado",
    "/produto-descontinuado",
    "/produtos-novos",
    "/relatorio-colecao",
    "/painel-colecoes",
    "/relatorio-claude",
    "/produto-detalhado",
    "/produto-performance",
    "/vendedores",
    "/clientes",
    "/faturamento",
    "/exportar-relatorios",
    "/gerador-relatorios",
    "/aumentos-descontos",
    "/gerador-apresentacoes",
    "/mapa-clientes",
    "/sincronizacao",
    "/admin",
  ];

  const navSections: NavSection[] = [
    {
      key: "overview",
      label: "Visão geral",
      items: [
        {
          key: "dashboard",
          label: "Dashboard",
          href: basePath,
          permission: "dashboard",
          isActive: (currentPathname) =>
            currentPathname === basePath &&
            !dashboardBlockedSegments.some((segment) => currentPathname.includes(segment)),
        },
      ],
    },
    {
      key: "comercial",
      label: "Comercial",
      items: [
        {
          key: "produtos",
          label: "Produtos",
          permission: "produtos",
          subItems: produtosSubItems,
        },
        {
          key: "vendedores",
          label: "Vendedores",
          href: vendedoresHref,
          permission: "vendedores",
          isActive: (currentPathname) => matchesSegment(currentPathname, "/vendedores", vendedoresHref),
        },
        {
          key: "clientes",
          label: "Clientes",
          href: clientesHref,
          permission: "clientes",
          isActive: (currentPathname) => matchesSegment(currentPathname, "/clientes", clientesHref),
        },
        {
          key: "faturamento",
          label: "Faturamento / NFs",
          href: faturamentoHref,
          permission: "faturamento",
          isActive: (currentPathname) => matchesSegment(currentPathname, "/faturamento", faturamentoHref),
        },
        ...(isScarfme
          ? [
              {
                key: "painel-colecoes",
                label: "Painel de Coleções",
                href: painelColecoesHref,
                permission: "painel-colecoes" as const,
                isActive: (currentPathname: string | null) =>
                  matchesSegment(currentPathname, "/painel-colecoes", painelColecoesHref),
              },
              {
                key: "relatorio-colecao",
                label: "Relatório Coleção",
                href: relatorioColecaoHref,
                permission: "relatorio-colecao" as const,
                isActive: (currentPathname: string | null) =>
                  matchesSegment(currentPathname, "/relatorio-colecao", relatorioColecaoHref),
              },
              {
                key: "relatorio-claude",
                label: "Relatório Claude",
                href: relatorioClaudeHref,
                permission: "relatorio-claude" as const,
                isActive: (currentPathname: string | null) =>
                  matchesSegment(currentPathname, "/relatorio-claude", relatorioClaudeHref),
              },
              {
                key: "mapa-clientes",
                label: "Mapa de Clientes",
                href: mapaClientesHref,
                permission: "mapa-clientes" as const,
                isActive: (currentPathname: string | null) =>
                  matchesSegment(currentPathname, "/mapa-clientes", mapaClientesHref),
              },
            ]
          : []),
      ],
    },
    {
      key: "estoque-performance",
      label: "Estoque e performance",
      items: [
        {
          key: "controle-estoque",
          label: "Controle de Estoque",
          href: controleEstoqueHref,
          permission: "controle-estoque",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/controle-estoque", controleEstoqueHref),
        },
        {
          key: "estoque-consulta",
          label: "Estoque Consulta",
          href: estoqueConsultaHref,
          permission: "estoque-consulta",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/estoque-consulta", estoqueConsultaHref),
        },
        {
          key: "controle-giro",
          label: "Controle de Giro",
          href: controleGiroHref,
          permission: "controle-giro",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/controle-giro", controleGiroHref),
        },
        {
          key: "produtos-parados",
          label: "Produtos Parados",
          href: produtosParadosHref,
          permission: "produtos-parados",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/produtos-parados", produtosParadosHref),
        },
        {
          key: "controle-performance",
          label: "Controle de Performance",
          href: controlePerformanceHref,
          permission: "controle-performance",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/controle-performance", controlePerformanceHref),
        },
        {
          key: "loja-raio-x",
          label: "Loja Raio X",
          href: lojaRaioXHref,
          permission: "loja-raio-x",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/loja-raio-x", lojaRaioXHref),
        },
        {
          key: "curva-abc",
          label: "Curva A, B, C",
          href: curvaAbcHref,
          permission: "curva-abc",
          isActive: (currentPathname) => matchesSegment(currentPathname, "/curva-abc", curvaAbcHref),
        },
        {
          key: "curva-por-produto",
          label: "Curva por Produto",
          href: curvaPorProdutoHref,
          permission: "curva-por-produto",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/curva-por-produto", curvaPorProdutoHref),
        },
        {
          key: "nova-filial",
          label: "Nova Filial",
          href: novaFilialHref,
          permission: "nova-filial",
          isActive: (currentPathname) => matchesSegment(currentPathname, "/nova-filial", novaFilialHref),
        },
      ],
    },
    {
      key: "operacoes",
      label: "Operações",
      items: [
        {
          key: "controle-transferencias",
          label: "Controle de Transferências",
          href: controleTransferenciasHref,
          permission: "controle-transferencias",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/controle-transferencias", controleTransferenciasHref),
        },
        {
          key: "transferencia-produtos",
          label: "Transferência de Produtos",
          href: transferenciaProdutosHref,
          permission: "transferencia-produtos",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/transferencia-produtos", transferenciaProdutosHref),
        },
        {
          key: "distribuicao-matriz",
          label: "Distribuição Matriz",
          href: distribuicaoMatrizHref,
          permission: "distribuicao-matriz",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/distribuicao-matriz", distribuicaoMatrizHref),
        },
        {
          key: "romaneios",
          label: "Romaneios",
          href: romaneiosHref,
          permission: "romaneios",
          isActive: (currentPathname) => matchesSegment(currentPathname, "/romaneios", romaneiosHref),
        },
        {
          key: "saidas-entradas-produtos",
          label: "Saídas e Entradas de Produtos",
          href: saidasEntradasProdutosHref,
          permission: "saidas-entradas-produtos",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/saidas-entradas-produtos", saidasEntradasProdutosHref),
        },
        {
          key: "extrato-produto",
          label: "Extrato de Produto",
          href: extratoProdutoHref,
          permission: "extrato-produto",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/extrato-produto", extratoProdutoHref),
        },
        {
          key: "ajuste-estoque",
          label: "Ajuste de Estoque",
          href: ajusteEstoqueHref,
          permission: "ajuste-estoque",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/ajuste-estoque", ajusteEstoqueHref),
        },
        {
          key: "lista-loja",
          label: "Lista Loja",
          href: listaLojaHref,
          permission: "lista-loja",
          isActive: (currentPathname) => matchesSegment(currentPathname, "/lista-loja", listaLojaHref),
        },
        {
          key: "compras-transito",
          label: "Compras em Trânsito",
          href: comprasTransitoHref,
          permission: "compras-transito",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/compras-transito", comprasTransitoHref),
        },
        {
          key: "compras-salvas",
          label: "Compras Salvas",
          href: comprasSalvasHref,
          permission: "compras-salvas",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/compras-salvas", comprasSalvasHref),
        },
      ],
    },
    {
      key: "ferramentas",
      label: "Ferramentas",
      items: [
        {
          key: "filial",
          label: "Filiais",
          href: filialHref,
          permission: "filial",
          isActive: (currentPathname) => matchesSegment(currentPathname, "/filial", filialHref),
        },
        {
          key: "exportar-relatorios",
          label: "Exportar Relatórios",
          href: exportarRelatoriosHref,
          permission: "exportar-relatorios",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/exportar-relatorios", exportarRelatoriosHref),
        },
        {
          key: "gerador-relatorios",
          label: "Gerador de Relatórios",
          href: geradorRelatoriosHref,
          permission: "gerador-relatorios",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/gerador-relatorios", geradorRelatoriosHref),
        },
        {
          key: "aumentos-descontos",
          label: "Aumentos e Descontos",
          href: aumentosDescontosHref,
          permission: "aumentos-descontos",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/aumentos-descontos", aumentosDescontosHref),
        },
        ...(isScarfme
          ? [
              {
                key: "gerador-apresentacoes",
                label: "Gerador de Apresentações",
                href: geradorApresentacoesHref,
                permission: "gerador-apresentacoes" as const,
                isActive: (currentPathname: string | null) =>
                  matchesSegment(currentPathname, "/gerador-apresentacoes", geradorApresentacoesHref),
              },
            ]
          : []),
        ...(isNerd
          ? [
              {
                key: "fornecedores",
                label: "Grupos de Fornecedores",
                href: fornecedoresHref,
                permission: "fornecedores" as const,
                isActive: (currentPathname: string | null) =>
                  matchesSegment(currentPathname, "/fornecedores", fornecedoresHref),
              },
            ]
          : []),
        {
          key: "sincronizacao",
          label: "Sincronização",
          href: sincronizacaoHref,
          permission: "sincronizacao",
          isActive: (currentPathname) =>
            matchesSegment(currentPathname, "/sincronizacao", sincronizacaoHref),
        },
      ],
    },
    ...(user?.role === "admin"
      ? [
          {
            key: "administracao",
            label: "Administração",
            items: [
              {
                key: "admin",
                label: "Admin",
                href: "/admin",
                permission: "admin" as const,
                isActive: (currentPathname: string | null) =>
                  !!currentPathname && currentPathname.startsWith("/admin"),
              },
            ],
          },
        ]
      : []),
  ];

  const canSeePermission = (permission?: PermissionKey | "admin") => {
    if (!user) return permission !== "admin";

    if (permission === "admin") return user.role === "admin";

    // admin e diretor veem tudo (menos o item Admin, tratado acima).
    if (hasFullPageAccess(user.role)) return true;

    // Permissoes restritas por funcao (ex: extrato-produto so para logistica/admin/diretor).
    if (permission && !roleAllowsPermission(user.role, permission)) return false;

    if (!permission) return false;

    return userHasPagePermission(user, permission);
  };

  const canSeeItem = (item: NavItemBase) => {
    if (canSeePermission(item.permission)) return true;
    if (!item.subItems?.length) return false;

    return item.subItems.some((subItem) => canSeePermission(subItem.permission));
  };

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter(canSeeItem),
    }))
    .filter((section) => section.items.length > 0);

  const normalizedSearch = searchTerm.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const isSearching = normalizedSearch.length > 0;
  const normalizeForSearch = (value: string) =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const filteredSections = visibleSections
    .map((section) => {
      if (!isSearching) {
        return section;
      }

      const sectionMatches = normalizeForSearch(section.label).includes(normalizedSearch);
      const filteredItems = section.items
        .map((item) => {
          if (!item.subItems?.length) {
            return normalizeForSearch(item.label).includes(normalizedSearch) || sectionMatches ? item : null;
          }

          const visibleSubItems = item.subItems.filter((subItem) => canSeePermission(subItem.permission));
          const itemMatches = normalizeForSearch(item.label).includes(normalizedSearch) || sectionMatches;
          const matchingSubItems = visibleSubItems.filter((subItem) =>
            normalizeForSearch(subItem.label).includes(normalizedSearch)
          );

          if (!itemMatches && matchingSubItems.length === 0) {
            return null;
          }

          return {
            ...item,
            subItems: itemMatches ? visibleSubItems : matchingSubItems,
          };
        })
        .filter((item): item is NavItemBase => item !== null);

      return {
        ...section,
        items: filteredItems,
      };
    })
    .filter((section) => section.items.length > 0);

  const sectionHasActiveItem = (section: NavSection) =>
    section.items.some((item) => {
      if (item.subItems?.length) {
        return item.subItems
          .filter((subItem) => canSeePermission(subItem.permission))
          .some((subItem) => subItem.isActive(pathname));
      }

      return item.isActive?.(pathname) ?? false;
    });

  const isSectionExpanded = (section: NavSection) => {
    if (isSearching) {
      return true;
    }

    if (section.key in sectionOverrides) {
      return sectionOverrides[section.key];
    }

    return filteredSections[0]?.key === section.key || sectionHasActiveItem(section);
  };

  const handleLinkClick = () => {
    if (isMobile) {
      close();
    }
  };

  const produtosExpandedEffective =
    isSearching || produtosExpanded || produtosSubItems.some((subItem) => subItem.isActive(pathname));

  return (
    <>
      {isOpen && isMobile && (
        <div
          className={styles.overlay}
          onClick={close}
          aria-hidden="true"
          role="button"
          tabIndex={-1}
        />
      )}

      <button
        type="button"
        className={`${styles.toggleButton} ${!isOpen ? styles.toggleButtonFloating : styles.toggleButtonInside}`}
        onClick={toggle}
        aria-label={isOpen ? "Ocultar menu" : "Mostrar menu"}
        aria-expanded={isOpen}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${styles.icon} ${!isOpen ? styles.iconRotated : ""}`}
        >
          <path
            d="M10 12L6 8L10 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : styles.sidebarClosed}`}>
        <div className={styles.logo}>
          <Link href="/" className={styles.logoLink} onClick={handleLinkClick}>
            <strong
              className={`${styles.logoText} ${companyName === "SCARF ME" ? styles.logoTextScarfme : ""}`}
            >
              {companyName}
            </strong>
          </Link>
        </div>

        <div className={styles.navScroll}>
          <div className={styles.searchBox}>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className={styles.searchInput}
              placeholder="Buscar menu..."
              aria-label="Buscar menu"
            />
          </div>

          {filteredSections.length === 0 && (
            <div className={styles.emptyState}>Nenhum menu encontrado.</div>
          )}

          {filteredSections.map((section) => {
            const sectionExpanded = isSectionExpanded(section);

            return (
              <section
                key={section.key}
                className={`${styles.section} ${sectionHasActiveItem(section) ? styles.sectionActive : ""}`}
              >
                <button
                  type="button"
                  className={styles.sectionHeader}
                  onClick={() =>
                    setSectionOverrides((currentState) => ({
                      ...currentState,
                      [section.key]: !sectionExpanded,
                    }))
                  }
                  aria-expanded={sectionExpanded}
                >
                  <span className={styles.sectionHeaderText}>
                    <span className={styles.sectionLabel}>{section.label}</span>
                    <span className={styles.sectionMeta}>
                      {section.items.length} {section.items.length === 1 ? "item" : "itens"}
                    </span>
                  </span>

                  <svg
                    className={`${styles.sectionIcon} ${sectionExpanded ? styles.sectionIconExpanded : ""}`}
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M4 6L8 10L12 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                {sectionExpanded && (
                  <div className={styles.sectionContent}>
                    <div className={styles.nav}>
                      {section.items.map((item) => {
                        const visibleSubItems =
                          item.subItems?.filter((subItem) => canSeePermission(subItem.permission)) ?? [];
                        const hasActiveSubItem = visibleSubItems.some((subItem) =>
                          subItem.isActive(pathname)
                        );
                        const isExpanded = item.key === "produtos" && produtosExpandedEffective;
                        const isActive = item.subItems?.length
                          ? hasActiveSubItem
                          : item.isActive?.(pathname) ?? false;

                        if (item.subItems?.length) {
                          return (
                            <div key={item.key} className={styles.navGroup}>
                              <div
                                className={`${styles.navItem} ${styles.navItemWithSubmenu} ${isActive ? styles.navItemActive : ""}`}
                              >
                                <button
                                  type="button"
                                  className={styles.navLabel}
                                  onClick={() => setProdutosExpanded((currentValue) => !currentValue)}
                                >
                                  {item.label}
                                </button>

                                <button
                                  type="button"
                                  className={styles.submenuToggle}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    setProdutosExpanded((currentValue) => !currentValue);
                                  }}
                                  aria-label={isExpanded ? "Recolher submenu" : "Expandir submenu"}
                                >
                                  <svg
                                    className={`${styles.submenuIcon} ${isExpanded ? styles.submenuIconExpanded : ""}`}
                                    width="16"
                                    height="16"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <path
                                      d="M6 12L10 8L6 4"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </div>

                              {isExpanded && (
                                <div className={styles.submenu}>
                                  {visibleSubItems.map((subItem) => {
                                    const isSubItemActive = subItem.isActive(pathname);

                                    return (
                                      <Link
                                        key={subItem.key}
                                        href={subItem.href}
                                        className={`${styles.submenuItem} ${isSubItemActive ? styles.submenuItemActive : ""}`}
                                        onClick={handleLinkClick}
                                      >
                                        <span className={styles.submenuLabel}>{subItem.label}</span>
                                      </Link>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        }

                        return (
                          <Link
                            key={item.key}
                            href={item.href!}
                            className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                            onClick={handleLinkClick}
                            replace={
                              item.key === "controle-estoque" &&
                              pathname?.includes("/controle-estoque")
                            }
                          >
                            <span className={styles.navLabel}>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
    </>
  );
}
