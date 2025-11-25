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
  // Estado inicial: sempre false para evitar erro de hidratação
  // Será sincronizado no useEffect após a hidratação
  const [isOpen, setIsOpen] = useState(false);
  const [wasDesktop, setWasDesktop] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Sincronizar estado após hidratação
  useEffect(() => {
    setIsMounted(true);
    const isDesktop = window.innerWidth > 1024;
    setIsOpen(isDesktop);
    setWasDesktop(isDesktop);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

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
  }, [wasDesktop, isMounted]);

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

