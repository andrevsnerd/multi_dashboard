import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProdutoAgrupadoPage from "@/components/produto-agrupado/ProdutoAgrupadoPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ProdutoAgrupadoRouteProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: ProdutoAgrupadoRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  return {
    title: company ? `Produto Agrupado | ${company.name}` : "Produto Agrupado",
  };
}

export default async function ProdutoAgrupadoRoute({ params }: ProdutoAgrupadoRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ProdutoAgrupadoPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
