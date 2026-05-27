import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import { resolveCompany } from "@/lib/config/company";

import FilialConsultaClient from "./FilialConsultaClient";

interface FilialPageProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: FilialPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Filiais | ${company.name}` : "Filiais" };
}

export default async function FilialPageRoute({ params }: FilialPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <FilialConsultaClient />
    </PageLayout>
  );
}
