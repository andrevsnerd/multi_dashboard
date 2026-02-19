import { Suspense } from "react";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import EstoqueDetalhado01Page from "@/components/stock/EstoqueDetalhado01Page";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function EstoqueDetalhado01PageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <Suspense fallback={<div style={{ padding: "1rem", textAlign: "center" }}>Carregando...</div>}>
        <EstoqueDetalhado01Page companyKey={company.key} companyName={company.name} />
      </Suspense>
    </PageLayout>
  );
}
