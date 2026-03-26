import { notFound } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import ControlePerformancePage from "@/components/performance/ControlePerformancePage";
import { resolveCompany } from "@/lib/config/company";

interface CompanyPageProps {
  params: Promise<{ company: string }>;
}

export default async function ControlePerformancePageRoute({ params }: CompanyPageProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ControlePerformancePage companyKey={company.key} companyName={company.name} />
    </PageLayout>
  );
}
