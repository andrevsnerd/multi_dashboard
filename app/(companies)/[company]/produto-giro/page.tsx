import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProdutoGiroPage from "@/components/stock/ProdutoGiroPage";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function ProdutoGiroPageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ProdutoGiroPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
