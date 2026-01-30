"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "./AuthContext";
import styles from "./UserHeaderBar.module.css";

export function UserHeaderBar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  if (!user || pathname === "/login") {
    return null;
  }

  return (
    <header className={styles.bar}>
      <div className={styles.content}>
        <span className={styles.userName}>{user.username}</span>
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={() => logout()}
        >
          Sair
        </button>
      </div>
    </header>
  );
}
