import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import ListaCompraSugeridaPage from "@/components/stock/ListaCompraSugeridaPage";
import { resolveCompany } from "@/lib/config/company";

interface Props {
  params: Promise<{ company: string }>;
}

export default async function ListaCompraSugeridaRoute({ params }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  if (!company) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <ListaCompraSugeridaPage companyKey={company.key} companySlug={companySlug} />
    </PageLayout>
  );
}
