import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import DefeitosPage from "@/components/defeitos/DefeitosPage";
import { resolveCompany } from "@/lib/config/company";
import { getDefeitoFilial } from "@/lib/config/filiais-especiais";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: CompanyPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Defeitos | ${company.name}` : "Defeitos" };
}

export default async function DefeitosRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  // Empresa sem filial de defeito não tem o que mostrar aqui (a tela inteira é
  // sobre os romaneios que vão para ela).
  if (!getDefeitoFilial(company.key)) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <DefeitosPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
