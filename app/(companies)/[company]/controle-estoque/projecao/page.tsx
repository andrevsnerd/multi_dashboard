import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProjecaoEstoquePage from "@/components/stock/ProjecaoEstoquePage";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function ProjecaoEstoquePageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ProjecaoEstoquePage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
