"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "./SidebarContext";
import { useAuth } from "@/components/auth/AuthContext";
import { canAccessPath } from "@/lib/auth/permissions";
import styles from "./Sidebar.module.css";

type Item = {
  key: string;
  label: string;
  href: string;
  isActive: (p: string | null) => boolean;
  adminOnly?: boolean;
};
type Section = { key: string; label: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    key: "loja",
    label: "Loja Corporativa",
    items: [
      {
        key: "loja",
        label: "Loja",
        href: "/corporativo/loja",
        isActive: (p) => !!p && p.startsWith("/corporativo/loja"),
      },
      {
        key: "catalogo",
        label: "Catálogo da Loja",
        href: "/corporativo/catalogo",
        isActive: (p) => !!p && p.startsWith("/corporativo/catalogo"),
      },
      {
        key: "pedidos",
        label: "Pedidos",
        href: "/corporativo/pedidos",
        isActive: (p) => !!p && p.startsWith("/corporativo/pedidos"),
      },
    ],
  },
  {
    key: "clientes",
    label: "Clientes Corporativos",
    items: [
      {
        key: "clientes",
        label: "Gestão de Clientes",
        href: "/corporativo",
        isActive: (p) =>
          p === "/corporativo" ||
          p === "/corporativo/novo" ||
          (!!p && /^\/corporativo\/\d+/.test(p)),
      },
      {
        key: "aprovacoes",
        label: "Aprovação de Cadastros",
        href: "/corporativo/aprovacoes",
        isActive: (p) => !!p && p.startsWith("/corporativo/aprovacoes"),
      },
    ],
  },
  {
    key: "admin",
    label: "Administração",
    items: [
      {
        key: "admin",
        label: "Painel Admin",
        href: "/admin",
        isActive: (p) => !!p && p.startsWith("/admin"),
        adminOnly: true,
      },
    ],
  },
];

export default function CorporativoSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { isOpen, toggle, close } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleLinkClick = () => {
    if (isMobile) close();
  };

  const sections = SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => {
      if (i.adminOnly) return user?.role === "admin";
      // Mostra só o que a função pode realmente acessar (ex: supervisor vê apenas
      // Catálogo e Aprovação de Cadastros).
      return canAccessPath(user, i.href);
    }),
  })).filter((s) => s.items.length > 0);

  return (
    <>
      {isOpen && isMobile && (
        <div className={styles.overlay} onClick={close} aria-hidden="true" role="button" tabIndex={-1} />
      )}

      <button
        type="button"
        className={`${styles.toggleButton} ${!isOpen ? styles.toggleButtonFloating : styles.toggleButtonInside}`}
        onClick={toggle}
        aria-label={isOpen ? "Ocultar menu" : "Mostrar menu"}
        aria-expanded={isOpen}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={`${styles.icon} ${!isOpen ? styles.iconRotated : ""}`}>
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : styles.sidebarClosed}`}>
        <div className={styles.logo}>
          <Link href="/" className={styles.logoLink} onClick={handleLinkClick}>
            <strong className={styles.logoText}>CORPORATIVO</strong>
          </Link>
        </div>

        <div className={styles.navScroll}>
          {sections.map((section) => (
            <section
              key={section.key}
              className={`${styles.section} ${section.items.some((i) => i.isActive(pathname)) ? styles.sectionActive : ""}`}
            >
              <div className={styles.sectionHeader}>
                <span className={styles.sectionHeaderText}>
                  <span className={styles.sectionLabel}>{section.label}</span>
                </span>
              </div>
              <div className={styles.sectionContent}>
                <div className={styles.nav}>
                  {section.items.map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={`${styles.navItem} ${item.isActive(pathname) ? styles.navItemActive : ""}`}
                      onClick={handleLinkClick}
                    >
                      <span className={styles.navLabel}>{item.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}
