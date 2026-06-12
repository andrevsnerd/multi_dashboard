import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProductPerformancePage from "@/components/products/ProductPerformancePage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ProductPerformancePageRouteProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({
  params,
}: ProductPerformancePageRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Produto Performance",
    };
  }

  return {
    title: `Produto Performance | ${company.name}`,
    description:
      "Linha do tempo de cobertura de estoque por filial e sugestão de compra com base na velocidade observada.",
  };
}

export default async function ProductPerformancePageRoute({
  params,
}: ProductPerformancePageRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ProductPerformancePage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
