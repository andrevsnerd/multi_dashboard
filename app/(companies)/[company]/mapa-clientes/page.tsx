import { notFound } from "next/navigation";
import type { Metadata } from "next";

import PageLayout from "@/components/layout/PageLayout";
import MapaClientesPage from "@/components/mapa-clientes/MapaClientesPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface MapaClientesPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: MapaClientesPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  return {
    title: company ? `Mapa de Clientes | ${company.name}` : "Mapa de Clientes",
  };
}

export default async function MapaClientesPageRoute({ params }: MapaClientesPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company || !company.ecommerceFilials?.length) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <MapaClientesPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
