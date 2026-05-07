import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import EstoqueItemPage from "@/components/stock/EstoqueItemPage";
import { resolveCompany } from "@/lib/config/company";

interface Props {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  if (!company) {
    return { title: "Estoque consulta" };
  }
  return { title: `Estoque consulta | ${company.name}` };
}

export default async function EstoqueConsultaRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <EstoqueItemPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
