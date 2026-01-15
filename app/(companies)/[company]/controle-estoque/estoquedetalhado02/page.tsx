import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import EstoqueDetalhado02Page from "@/components/stock/EstoqueDetalhado02Page";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function EstoqueDetalhado02PageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <EstoqueDetalhado02Page companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
