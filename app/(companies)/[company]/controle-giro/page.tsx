import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ControleGiroPage from "@/components/stock/ControleGiroPage";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function ControleGiroPageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ControleGiroPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
