import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProdutoDescontinuadoPage from "@/components/produto-descontinuado/ProdutoDescontinuadoPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ProdutoDescontinuadoRouteProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: ProdutoDescontinuadoRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  return {
    title: company ? `Produto Descontinuado | ${company.name}` : "Produto Descontinuado",
  };
}

export default async function ProdutoDescontinuadoRoute({ params }: ProdutoDescontinuadoRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ProdutoDescontinuadoPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
