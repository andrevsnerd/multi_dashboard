import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProdutoApostaPage from "@/components/produto-aposta/ProdutoApostaPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ProdutoApostaRouteProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: ProdutoApostaRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  return {
    title: company ? `Produto Aposta | ${company.name}` : "Produto Aposta",
  };
}

export default async function ProdutoApostaRoute({ params }: ProdutoApostaRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ProdutoApostaPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
