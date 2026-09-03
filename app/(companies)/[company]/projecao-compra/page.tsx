import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProdutoProjecaoCompraPage from "@/components/stock/ProdutoProjecaoCompraPage";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function ProdutoProjecaoCompraPageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ProdutoProjecaoCompraPage companyKey={company.key} />
    </PageLayout>
  );
}
