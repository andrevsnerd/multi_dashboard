import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProductsRecentPage from "@/components/products/ProductsRecentPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ProductsRecentPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: ProductsRecentPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Produtos por Cadastro",
    };
  }

  return {
    title: `Produtos por Cadastro | ${company.name}`,
  };
}

export default async function ProductsRecentPageRoute({
  params,
}: ProductsRecentPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ProductsRecentPage
            companyKey={company.key}
            companyName={company.name}
          />
        </div>
      </div>
    </PageLayout>
  );
}

