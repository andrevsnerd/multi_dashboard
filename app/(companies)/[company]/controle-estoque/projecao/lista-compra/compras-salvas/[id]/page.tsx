import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import CompraSalvaDetalhePage from "@/components/stock/CompraSalvaDetalhePage";
import { resolveCompany } from "@/lib/config/company";

interface Props {
  params: Promise<{ company: string; id: string }>;
}

export default async function CompraSalvaDetalheRoute({ params }: Props) {
  const { company: companySlug, id } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <CompraSalvaDetalhePage companyKey={company.key} companySlug={companySlug} compraId={id} />
    </PageLayout>
  );
}
