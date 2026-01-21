import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ControleMovimentoPage from "@/components/movimento/ControleMovimentoPage";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function ControleMovimentoPageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ControleMovimentoPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
