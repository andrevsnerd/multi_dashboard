"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./Sidebar.module.css";

interface SidebarProps {
  companyName: string;
}

export default function Sidebar({ companyName }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { label: "Home", href: "/" },
    { label: "Dashboard", href: pathname },
  ];

  return (
    <aside className={styles.sidebar}>
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
            >
              <span className={styles.navLabel}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

