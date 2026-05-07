import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProductsNewPage from "@/components/products-new/ProductsNewPage";
import { resolveCompany } from "@/lib/config/company";
import { fetchProdutosNovosPageData } from "@/lib/repositories/produtosNovos";

import styles from "../page.module.css";

export const dynamic = "force-dynamic";

interface ProdutosNovosPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: ProdutosNovosPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Produtos Novos",
    };
  }

  return {
    title: `Produtos Novos | ${company.name}`,
  };
}

export default async function ProdutosNovosPageRoute({
  params,
}: ProdutosNovosPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  const items = await fetchProdutosNovosPageData(company.key);

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ProductsNewPage items={items} />
        </div>
      </div>
    </PageLayout>
  );
}
