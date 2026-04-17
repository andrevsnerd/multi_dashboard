import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import SincronizacaoPage from "@/components/sincronizacao/SincronizacaoPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface SincronizacaoRouteProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({
  params,
}: SincronizacaoRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Sincronizacao | ${company.name}` : "Sincronizacao" };
}

export default async function SincronizacaoRoute({ params }: SincronizacaoRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) notFound();

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <SincronizacaoPage />
        </div>
      </div>
    </PageLayout>
  );
}
