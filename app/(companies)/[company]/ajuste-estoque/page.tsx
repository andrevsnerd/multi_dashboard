import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import AjusteEstoquePage from "@/components/ajuste-estoque/AjusteEstoquePage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface AjusteEstoquePageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: AjusteEstoquePageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Ajuste de Estoque | ${company.name}` : "Ajuste de Estoque" };
}

export default async function AjusteEstoquePageRoute({ params }: AjusteEstoquePageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <AjusteEstoquePage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
