import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import TransferenciaProdutosPage from "@/components/transferencia-produtos/TransferenciaProdutosPage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface TransferenciaProdutosPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: TransferenciaProdutosPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Transferência de Produtos",
    };
  }

  return {
    title: `Transferência de Produtos | ${company.name}`,
  };
}

export default async function TransferenciaProdutosPageRoute({
  params,
}: TransferenciaProdutosPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <TransferenciaProdutosPage
            companyKey={company.key}
            companyName={company.name}
          />
        </div>
      </div>
    </PageLayout>
  );
}
