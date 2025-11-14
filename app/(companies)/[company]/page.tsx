import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
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
    <PageLayout companyName={company.name}>
    <div className={styles.page}>
        <div className={styles.content}>
          <CompanyDashboard companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}


