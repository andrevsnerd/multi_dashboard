import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import BlackFridayPage from "@/components/blackfriday/BlackFridayPage";
import { resolveCompany } from "@/lib/config/company";

interface BlackFridayPageProps {
  params: Promise<{
    company: string;
  }>;
}

export async function generateMetadata({ params }: BlackFridayPageProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    return {
      title: "Black Friday",
    };
  }

  return {
    title: `Black Friday | ${company.name}`,
  };
}

export default async function BlackFridayPageRoute({ params }: BlackFridayPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <BlackFridayPage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}

