import { notFound } from "next/navigation";

import AppHeader from "@/components/layout/AppHeader";
import CompanyDashboard from "@/components/dashboard/CompanyDashboard";
import { resolveCompany } from "@/lib/config/company";

import styles from "./page.module.css";

interface CompanyPageProps {
  params: Promise<{
    company: string;
  }>;
}

export default async function CompanyDashboardPage({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <div className={styles.page}>
      <AppHeader companyName={company.name} />

      <div className={styles.content}>
        <CompanyDashboard companyKey={company.key} companyName={company.name} />
      </div>
    </div>
  );
}


