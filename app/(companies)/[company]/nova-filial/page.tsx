import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import NovaFilialPage from "@/components/performance/NovaFilialPage";
import { resolveCompany } from "@/lib/config/company";

interface Props {
  params: Promise<{ company: string }>;
}

export default async function NovaFilialRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <NovaFilialPage key={company.key} companyKey={company.key} />
    </PageLayout>
  );
}
