import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProjecaoCompraPage from "@/components/stock/ProjecaoCompraPage";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function ProjecaoCompraPageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ProjecaoCompraPage companyKey={company.key} />
    </PageLayout>
  );
}
