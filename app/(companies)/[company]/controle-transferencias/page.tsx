import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ControleTransferenciasPage from "@/components/controle-transferencias/ControleTransferenciasPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ControleTransferenciasPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: ControleTransferenciasPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Controle de Transferências",
    };
  }

  return {
    title: `Controle de Transferências | ${company.name}`,
  };
}

export default async function ControleTransferenciasPageRoute({
  params,
}: ControleTransferenciasPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ControleTransferenciasPage
            companyKey={company.key}
            companyName={company.name}
          />
        </div>
      </div>
    </PageLayout>
  );
}
