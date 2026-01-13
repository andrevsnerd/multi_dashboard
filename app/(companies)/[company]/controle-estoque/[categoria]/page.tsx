import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import CategoriaDetalhesPage from "@/components/stock/CategoriaDetalhesPage";
import { resolveCompany } from "@/lib/config/company";

interface CategoriaDetalhesPageRouteProps {
  params: Promise<{
    company: string;
    categoria: string;
  }>;
}

export default async function CategoriaDetalhesPageRoute({ 
  params 
}: CategoriaDetalhesPageRouteProps) {
  const { company: companySlug, categoria } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <CategoriaDetalhesPage 
        companyKey={company.key} 
        companyName={company.name}
        categoria={decodeURIComponent(categoria)}
      />
    </PageLayout>
  );
}
