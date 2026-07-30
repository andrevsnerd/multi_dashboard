"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthContext";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import styles from "./UserHeaderBar.module.css";

export function UserHeaderBar() {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user || pathname === "/login") {
    return null;
  }

  return (
    <header className={styles.bar}>
      <div className={styles.content}>
        {user.role === "admin" && (
          <Link href="/admin" className={styles.adminLink} title="Painel Admin">
            <span>Admin</span>
          </Link>
        )}
        <ThemeToggle />
        <span className={styles.userName}>{user.username}</span>
        <UserMenu />
      </div>
    </header>
  );
}
