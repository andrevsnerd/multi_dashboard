"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "./SidebarContext";

import styles from "./Sidebar.module.css";

interface SidebarProps {
  companyName: string;
}

export default function Sidebar({ companyName }: SidebarProps) {
  const pathname = usePathname();
  const { isOpen, toggle, close } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 1024);
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Extrair o caminho base da empresa (remover /estoque-por-filial, /produtos, /produto-detalhado, /vendedores e /clientes se estiver presente)
  const getBasePath = () => {
    if (!pathname || pathname === "/") {
      return "/";
    }
    // Remove /estoque-por-filial, /produtos, /produto-detalhado, /vendedores e /clientes do final do pathname se existir
    return pathname
      .replace(/\/estoque-por-filial$/, "")
      .replace(/\/produto-detalhado$/, "")
      .replace(/\/produtos$/, "")
      .replace(/\/vendedores$/, "")
      .replace(/\/clientes$/, "");
  };

  const basePath = getBasePath();
  
  // Construir o link para estoque por filial baseado no caminho base
  // TODO: Descomentar quando estoque por filial estiver pronto
  // const stockByFilialHref = basePath && basePath !== "/" 
  //   ? `${basePath}/estoque-por-filial`
  //   : "/estoque-por-filial";

  // Construir o link para produtos baseado no caminho base
  const produtosHref = basePath && basePath !== "/" 
    ? `${basePath}/produtos`
    : "/produtos";

  // Construir o link para produto detalhado baseado no caminho base
  const produtoDetalhadoHref = basePath && basePath !== "/" 
    ? `${basePath}/produto-detalhado`
    : "/produto-detalhado";

  // Construir o link para vendedores baseado no caminho base
  const vendedoresHref = basePath && basePath !== "/" 
    ? `${basePath}/vendedores`
    : "/vendedores";

  // Construir o link para clientes baseado no caminho base
  const clientesHref = basePath && basePath !== "/" 
    ? `${basePath}/clientes`
    : "/clientes";

  const navItems = [
    { label: "Home", href: "/" },
    { label: "Dashboard", href: basePath },
    { label: "Produtos", href: produtosHref },
    { label: "Produto Detalhado", href: produtoDetalhadoHref },
    { label: "Vendedores", href: vendedoresHref },
    { label: "Clientes", href: clientesHref },
    // TODO: Descomentar quando estoque por filial estiver pronto
    // { label: "Estoque por Filial", href: stockByFilialHref },
  ];

  const handleLinkClick = () => {
    // Fechar sidebar no mobile ao clicar em um link
    if (isMobile) {
      close();
    }
  };

  return (
    <>
      {/* Overlay para mobile - só aparece quando sidebar está aberta no mobile */}
      {isMounted && isOpen && isMobile && (
        <div 
          className={styles.overlay} 
          onClick={close} 
          aria-hidden="true"
          role="button"
          tabIndex={-1}
        />
      )}
      
      {/* Botão toggle - sempre visível, fora do aside */}
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
          <strong className={styles.logoText}>{companyName}</strong>
        </div>
        <nav className={styles.nav}>
          {navItems.map((item) => {
            let isActive = false;
            
            if (item.label === "Home") {
              // Home só está ativo na raiz
              isActive = pathname === "/";
            } else if (item.label === "Dashboard") {
              // Dashboard está ativo quando está no caminho base (não em estoque-por-filial, produtos, produto-detalhado, vendedores ou clientes)
              isActive = pathname === item.href && 
                !pathname.includes("/estoque-por-filial") && 
                !pathname.includes("/produtos") &&
                !pathname.includes("/produto-detalhado") &&
                !pathname.includes("/vendedores") &&
                !pathname.includes("/clientes");
            } else if (item.label === "Produtos") {
              // Produtos está ativo quando o pathname inclui /produtos mas não /produto-detalhado
              isActive = (pathname?.includes("/produtos") || pathname === item.href) && 
                !pathname?.includes("/produto-detalhado");
            } else if (item.label === "Produto Detalhado") {
              // Produto Detalhado está ativo quando o pathname inclui /produto-detalhado
              isActive = pathname?.includes("/produto-detalhado") || pathname === item.href;
            } else if (item.label === "Vendedores") {
              // Vendedores está ativo quando o pathname inclui /vendedores
              isActive = pathname?.includes("/vendedores") || pathname === item.href;
            } else if (item.label === "Clientes") {
              // Clientes está ativo quando o pathname inclui /clientes
              isActive = pathname?.includes("/clientes") || pathname === item.href;
            }
            // TODO: Descomentar quando estoque por filial estiver pronto
            // else if (item.label === "Estoque por Filial") {
            //   // Estoque por Filial está ativo quando o pathname inclui /estoque-por-filial
            //   isActive = pathname?.includes("/estoque-por-filial") || pathname === item.href;
            // }
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                onClick={handleLinkClick}
              >
                <span className={styles.navLabel}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

