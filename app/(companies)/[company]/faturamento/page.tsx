import { notFound } from "next/navigation";
import type { Metadata } from "next";

import PageLayout from "@/components/layout/PageLayout";
import FaturamentoPage from "@/components/faturamento/FaturamentoPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface FaturamentoPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: FaturamentoPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return { title: "Faturamento / NFs | Dashboard" };
  }

  return { title: `Faturamento / NFs | ${company.name}` };
}

export default async function FaturamentoPageRoute({ params }: FaturamentoPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <FaturamentoPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
