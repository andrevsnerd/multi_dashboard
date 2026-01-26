import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import TransfersPage from "@/components/transfers/TransfersPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface TransfersPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: TransfersPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Transferências",
    };
  }

  return {
    title: `Transferências | ${company.name}`,
  };
}

export default async function TransfersPageRoute({
  params,
}: TransfersPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <TransfersPage
            companyKey={company.key}
            companyName={company.name}
          />
        </div>
      </div>
    </PageLayout>
  );
}
