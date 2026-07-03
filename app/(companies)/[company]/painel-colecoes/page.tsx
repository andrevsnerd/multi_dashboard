import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ColecoesPanelPage from "@/components/painel-colecoes/ColecoesPanelPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

export const dynamic = "force-dynamic";

interface PainelColecoesPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({
  params,
}: PainelColecoesPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return { title: "Painel de Coleções" };
  }

  return { title: `Painel de Coleções | ${company.name}` };
}

export default async function PainelColecoesPageRoute({
  params,
}: PainelColecoesPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  // Coleções são um conceito exclusivo da SCARF ME.
  if (company.key !== "scarfme") {
    redirect(`/${company.key}`);
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ColecoesPanelPage companyKey={company.key} />
        </div>
      </div>
    </PageLayout>
  );
}
