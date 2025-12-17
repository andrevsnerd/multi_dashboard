import { notFound } from "next/navigation";
import type { Metadata } from "next";

import PageLayout from "@/components/layout/PageLayout";
import ClientesPage from "@/components/clientes/ClientesPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ClientesPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: ClientesPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Clientes | Dashboard",
    };
  }

  return {
    title: `Clientes | ${company.name}`,
  };
}

export default async function ClientesPageRoute({ params }: ClientesPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ClientesPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}









