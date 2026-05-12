import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CollectionReportPage from "@/components/relatorio-colecao/CollectionReportPage";
import PageLayout from "@/components/layout/PageLayout";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface RelatorioColecaoPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({
  params,
}: RelatorioColecaoPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company || company.key !== "scarfme") {
    return {
      title: "Relatorio Colecao",
    };
  }

  return {
    title: `Relatorio Colecao | ${company.name}`,
  };
}

export default async function RelatorioColecaoRoute({
  params,
}: RelatorioColecaoPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company || company.key !== "scarfme") {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <CollectionReportPage companyKey={company.key} />
        </div>
      </div>
    </PageLayout>
  );
}
