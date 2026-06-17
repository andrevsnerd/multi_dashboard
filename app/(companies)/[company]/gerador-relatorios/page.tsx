import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import GeradorRelatoriosPage from "@/components/relatorios/GeradorRelatoriosPage";
import { resolveCompany } from "@/lib/config/company";

interface GeradorRelatoriosPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({
  params,
}: GeradorRelatoriosPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return { title: "Gerador de Relatórios" };
  }

  return { title: `Gerador de Relatórios | ${company.name}` };
}

export default async function GeradorRelatoriosPageRoute({
  params,
}: GeradorRelatoriosPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <GeradorRelatoriosPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
