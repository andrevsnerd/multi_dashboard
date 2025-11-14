"use client";

import { useSidebar } from "./SidebarContext";
import styles from "./MainContent.module.css";

interface MainContentProps {
  children: React.ReactNode;
}

export default function MainContent({ children }: MainContentProps) {
  const { isOpen } = useSidebar();

  return (
    <div className={`${styles.mainContent} ${isOpen ? styles.sidebarOpen : styles.sidebarClosed}`}>
      {children}
    </div>
  );
}

