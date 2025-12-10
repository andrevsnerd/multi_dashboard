import { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolveCompany } from "@/lib/config/company";
import PageLayout from "@/components/layout/PageLayout";
import ExportarRelatoriosPage from "@/components/relatorios/ExportarRelatoriosPage";

interface ExportarRelatoriosPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({
  params,
}: ExportarRelatoriosPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Página não encontrada",
    };
  }

  return {
    title: `Exportar Relatórios | ${company.name}`,
  };
}

export default async function ExportarRelatoriosPageRoute({
  params,
}: ExportarRelatoriosPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ExportarRelatoriosPage />
    </PageLayout>
  );
}



