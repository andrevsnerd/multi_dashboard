import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import BlackFridayPage from "@/components/blackfriday/BlackFridayPage";
import { resolveCompany } from "@/lib/config/company";

interface Props {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { company: slug } = await params;
  const company = resolveCompany(slug);
  return { title: company ? `Black Friday | ${company.name}` : "Black Friday" };
}

/** Painel da Black Friday: itens que entraram na Black (Programar Preços) × venda × estoque. */
export default async function BlackFridayRoute({ params }: Props) {
  const { company: slug } = await params;
  const company = resolveCompany(slug);
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) notFound();

  return (
    <PageLayout companyName={company.name}>
      <BlackFridayPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
