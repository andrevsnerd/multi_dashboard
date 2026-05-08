import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import CurvaPorProdutoPage from "@/components/performance/CurvaPorProdutoPage";
import { resolveCompany } from "@/lib/config/company";

interface Props {
  params: Promise<{ company: string }>;
  searchParams: Promise<{ month?: string; year?: string; compare?: string }>;
}

export default async function CurvaPorProdutoRoute({ params, searchParams }: Props) {
  const { company: companySlug } = await params;
  const { month, year, compare } = await searchParams;

  const company = resolveCompany(companySlug);
  if (!company) notFound();

  const monthNum = month !== undefined ? parseInt(month, 10) : new Date().getMonth();
  const yearNum = year !== undefined ? parseInt(year, 10) : new Date().getFullYear();
  const compareMode = compare === "year" ? "year" : "month";

  return (
    <PageLayout companyName={company.name}>
      <CurvaPorProdutoPage
        companyKey={company.key}
        month={monthNum}
        year={yearNum}
        compare={compareMode}
      />
    </PageLayout>
  );
}
