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

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 1024);
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const navItems = [
    { label: "Home", href: "/" },
    { label: "Dashboard", href: pathname },
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
      {isOpen && isMobile && (
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
            const isActive = pathname === item.href || (item.href === "/" && pathname === "/");
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

