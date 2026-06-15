import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import NotificacoesPage from "@/components/notificacoes/NotificacoesPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface NotificacoesPageRouteProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: NotificacoesPageRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  if (!company) return { title: "Notificações" };
  return { title: `Notificações | ${company.name}` };
}

export default async function NotificacoesRoute({ params }: NotificacoesPageRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <NotificacoesPage />
        </div>
      </div>
    </PageLayout>
  );
}
