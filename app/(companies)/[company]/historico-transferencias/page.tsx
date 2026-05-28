import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import HistoricoTransferenciasPage from "@/components/historico-transferencias/HistoricoTransferenciasPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface HistoricoTransferenciasPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({
  params,
}: HistoricoTransferenciasPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  if (!company) return { title: "Histórico de Transferências" };
  return { title: `Histórico de Transferências | ${company.name}` };
}

export default async function HistoricoTransferenciasPageRoute({
  params,
}: HistoricoTransferenciasPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <HistoricoTransferenciasPage
            companyKey={company.key}
            companyName={company.name}
          />
        </div>
      </div>
    </PageLayout>
  );
}
