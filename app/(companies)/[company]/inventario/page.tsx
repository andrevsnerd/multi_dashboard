import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import InventarioBipagemPage from "@/components/inventario/InventarioBipagemPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface InventarioPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: InventarioPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Inventário | ${company.name}` : "Inventário" };
}

export default async function InventarioPageRoute({ params }: InventarioPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <InventarioBipagemPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
