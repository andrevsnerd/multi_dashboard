import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ControleEstoquePage from "@/components/stock/ControleEstoquePage";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function ControleEstoquePageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ControleEstoquePage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
