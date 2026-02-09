import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import SaidasEntradasProdutosPage from "@/components/saidas-entradas-produtos/SaidasEntradasProdutosPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface SaidasEntradasProdutosPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: SaidasEntradasProdutosPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Saídas e Entradas de Produtos",
    };
  }

  return {
    title: `Saídas e Entradas de Produtos | ${company.name}`,
  };
}

export default async function SaidasEntradasProdutosPageRoute({
  params,
}: SaidasEntradasProdutosPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <SaidasEntradasProdutosPage
            companyKey={company.key}
            companyName={company.name}
          />
        </div>
      </div>
    </PageLayout>
  );
}
