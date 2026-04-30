import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import HistoricoSaidasEntradasPage from "@/components/saidas-entradas-produtos/HistoricoSaidasEntradasPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../../page.module.css";

interface PageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return {
    title: company ? `Histórico de Saídas e Entradas | ${company.name}` : "Histórico de Saídas e Entradas",
  };
}

export default async function HistoricoSaidasEntradasRoute({ params }: PageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) notFound();

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <HistoricoSaidasEntradasPage companyKey={company.key} />
        </div>
      </div>
    </PageLayout>
  );
}
