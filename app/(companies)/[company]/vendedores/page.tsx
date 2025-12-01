import { notFound } from "next/navigation";
import type { Metadata } from "next";

import PageLayout from "@/components/layout/PageLayout";
import VendedoresPage from "@/components/vendedores/VendedoresPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface VendedoresPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: VendedoresPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Vendedores | Dashboard",
    };
  }

  return {
    title: `Vendedores | ${company.name}`,
  };
}

export default async function VendedoresPageRoute({ params }: VendedoresPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <VendedoresPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}




