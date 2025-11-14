"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface SidebarContextType {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  open: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Estado inicial: aberta no desktop, fechada no mobile
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth > 1024;
    }
    return true; // Default para SSR
  });

  const [wasDesktop, setWasDesktop] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth > 1024;
    }
    return true;
  });

  useEffect(() => {
    const handleResize = () => {
      const isDesktop = window.innerWidth > 1024;
      
      // Só ajustar automaticamente quando mudar de mobile para desktop ou vice-versa
      if (isDesktop !== wasDesktop) {
        setIsOpen(isDesktop);
        setWasDesktop(isDesktop);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [wasDesktop]);

  const toggle = () => setIsOpen((prev) => !prev);
  const close = () => setIsOpen(false);
  const open = () => setIsOpen(true);

  return (
    <SidebarContext.Provider value={{ isOpen, toggle, close, open }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error("useSidebar deve ser usado dentro de um SidebarProvider");
  }
  return context;
}

