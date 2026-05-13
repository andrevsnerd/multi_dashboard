import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ClaudeReportPage from "@/components/relatorio-claude/ClaudeReportPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface RelatorioClaudePageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({
  params,
}: RelatorioClaudePageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company || company.key !== "scarfme") {
    return {
      title: "Relatorio Claude",
    };
  }

  return {
    title: `Relatorio Claude | ${company.name}`,
  };
}

export default async function RelatorioClaudeRoute({
  params,
}: RelatorioClaudePageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company || company.key !== "scarfme") {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ClaudeReportPage companyKey={company.key} />
        </div>
      </div>
    </PageLayout>
  );
}
