import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProductsPage from "@/components/products/ProductsPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ProductsPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: ProductsPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Produtos",
    };
  }

  return {
    title: `Produtos | ${company.name}`,
  };
}

export default async function ProductsPageRoute({
  params,
}: ProductsPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ProductsPage
            companyKey={company.key}
            companyName={company.name}
          />
        </div>
      </div>
    </PageLayout>
  );
}

