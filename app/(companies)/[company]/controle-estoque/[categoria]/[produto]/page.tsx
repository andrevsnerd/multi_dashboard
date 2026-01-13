import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ProdutoDetalhesPage from "@/components/stock/ProdutoDetalhesPage";
import { resolveCompany } from "@/lib/config/company";

interface ProdutoDetalhesPageRouteProps {
  params: Promise<{
    company: string;
    categoria: string;
    produto: string;
  }>;
}

export default async function ProdutoDetalhesPageRoute({ 
  params 
}: ProdutoDetalhesPageRouteProps) {
  const { company: companySlug, categoria, produto } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ProdutoDetalhesPage 
        companyKey={company.key} 
        companyName={company.name}
        categoria={decodeURIComponent(categoria)}
        produto={decodeURIComponent(produto)}
      />
    </PageLayout>
  );
}
