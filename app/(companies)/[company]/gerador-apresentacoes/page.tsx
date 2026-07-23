import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import GeradorApresentacoesPage from "@/components/gerador-apresentacoes/GeradorApresentacoesPage";
import { resolveCompany } from "@/lib/config/company";

// Coleção segue ScarfMe-only; o tipo "Giro de Produtos" também vale para NERD.
const ALLOWED_COMPANIES = new Set(["scarfme", "nerd"]);

interface GeradorApresentacoesPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({
  params,
}: GeradorApresentacoesPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company || !ALLOWED_COMPANIES.has(company.key)) {
    return { title: "Gerador de Apresentações" };
  }

  return { title: `Gerador de Apresentações | ${company.name}` };
}

export default async function GeradorApresentacoesPageRoute({
  params,
}: GeradorApresentacoesPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company || !ALLOWED_COMPANIES.has(company.key)) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <GeradorApresentacoesPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
