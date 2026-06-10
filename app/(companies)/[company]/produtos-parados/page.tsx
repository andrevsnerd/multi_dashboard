import { notFound } from "next/navigation";
import type { Metadata } from "next";

import PageLayout from "@/components/layout/PageLayout";
import ProdutosParadosPage from "@/components/stock/ProdutosParadosPage";
import { resolveCompany } from "@/lib/config/company";

interface PageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Produtos Parados | ${company.name}` : "Produtos Parados" };
}

export default async function ProdutosParadosRoute({ params }: PageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ProdutosParadosPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
