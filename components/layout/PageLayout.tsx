"use client";

import { SidebarProvider } from "./SidebarContext";
import Sidebar from "./Sidebar";
import MainContent from "./MainContent";

interface PageLayoutProps {
  companyName: string;
  children: React.ReactNode;
}

export default function PageLayout({ companyName, children }: PageLayoutProps) {
  return (
    <SidebarProvider>
      <Sidebar companyName={companyName} />
      <MainContent>{children}</MainContent>
    </SidebarProvider>
  );
}

