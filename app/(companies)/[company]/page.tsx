import { notFound } from "next/navigation";

import SummaryCards from "@/components/dashboard/SummaryCards";
import AppHeader from "@/components/layout/AppHeader";
import { resolveCompany } from "@/lib/config/company";
import { fetchSalesSummary } from "@/lib/repositories/sales";

import styles from "./page.module.css";

interface CompanyPageProps {
  params: Promise<{
    company: string;
  }>;
}

export default async function CompanyDashboard({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  const summary = await fetchSalesSummary({
    company: company.key,
    period: "current-month",
  });

  return (
    <div className={styles.page}>
      <AppHeader companyName={company.name} />

      <div className={styles.content}>
        <section className={styles.section}>
          <div>
            <h3 className={styles.sectionTitle}>Indicadores-chave</h3>
            <p className={styles.sectionSubtitle}>
              Faturamento total, volume vendido e ticket médio considerando o mês corrente.
            </p>
          </div>
          <SummaryCards summary={summary} companyName={company.name} />
        </section>
      </div>
    </div>
  );
}


