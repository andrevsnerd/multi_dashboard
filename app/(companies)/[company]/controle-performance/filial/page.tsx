import { notFound } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import FilialPerformancePage from "@/components/performance/FilialPerformancePage";
import { resolveCompany } from "@/lib/config/company";

interface Props {
  params: Promise<{ company: string }>;
  searchParams: Promise<{
    filial?: string;
    month?: string;
    year?: string;
    compare?: string;
    start?: string;
    end?: string;
  }>;
}

export default async function FilialPerformanceRoute({ params, searchParams }: Props) {
  const { company: companySlug } = await params;
  const { filial, month, year, compare, start, end } = await searchParams;

  const company = resolveCompany(companySlug);
  if (!company || !filial) {
    notFound();
  }

  const monthNum = month !== undefined ? parseInt(month, 10) : new Date().getMonth();
  const yearNum = year !== undefined ? parseInt(year, 10) : new Date().getFullYear();
  const compareMode = compare === "year" ? "year" : "month";

  return (
    <PageLayout companyName={company.name}>
      <FilialPerformancePage
        companyKey={company.key}
        filial={filial}
        month={monthNum}
        year={yearNum}
        compare={compareMode}
        initialStart={start}
        initialEnd={end}
      />
    </PageLayout>
  );
}
