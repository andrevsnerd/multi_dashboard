import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ExtratoProdutoPage from "@/components/extrato-produto/ExtratoProdutoPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ExtratoProdutoPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: ExtratoProdutoPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Extrato de Produto",
    };
  }

  return {
    title: `Extrato de Produto | ${company.name}`,
  };
}

export default async function ExtratoProdutoPageRoute({ params }: ExtratoProdutoPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ExtratoProdutoPage companyKey={company.key} companyName={company.name} />
        </div>
      </div>
    </PageLayout>
  );
}
