import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import StockByFilialPage from "@/components/stock/StockByFilialPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface StockByFilialPageProps {
  params: Promise<{
    company: string;
  }>;
}

export default async function StockByFilialPageRoute({
  params,
}: StockByFilialPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <StockByFilialPage
            companyKey={company.key}
            companyName={company.name}
          />
        </div>
      </div>
    </PageLayout>
  );
}

