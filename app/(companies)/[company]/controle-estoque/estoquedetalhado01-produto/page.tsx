import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import EstoqueDetalhado01ProdutoPage from "@/components/stock/EstoqueDetalhado01ProdutoPage";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function EstoqueDetalhado01ProdutoPageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <EstoqueDetalhado01ProdutoPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
