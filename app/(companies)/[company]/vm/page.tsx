import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import VmPage from "@/components/vm/VmPage";
import { resolveCompany } from "@/lib/config/company";
import { isVmCompany } from "@/lib/utils/vm";

import styles from "../page.module.css";

interface VmRouteProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: VmRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  return {
    title: company ? `VM | ${company.name}` : "VM",
  };
}

export default async function VmRoute({ params }: VmRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // VM move estoque com ajuste tipo VM — habilitado só para NERD por enquanto.
  if (!company || !isVmCompany(company.key)) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <VmPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
