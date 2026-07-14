import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import DistribuicaoMatrizPage from "@/components/distribuicao-matriz/DistribuicaoMatrizPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface DistribuicaoMatrizPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: DistribuicaoMatrizPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Distribuição Matriz | ${company.name}` : "Distribuição Matriz" };
}

export default async function DistribuicaoMatrizRoute({ params }: DistribuicaoMatrizPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) notFound();

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <DistribuicaoMatrizPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
