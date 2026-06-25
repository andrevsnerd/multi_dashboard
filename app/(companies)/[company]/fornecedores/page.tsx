import { notFound } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import FornecedoresPage from "@/components/fornecedores/FornecedoresPage";
import { resolveCompany } from "@/lib/config/company";

interface Props {
  params: Promise<{ company: string }>;
}

export default async function FornecedoresRoute({ params }: Props) {
  const { company: companySlug } = await params;

  const company = resolveCompany(companySlug);
  if (!company) {
    notFound();
  }

  // Escopo inicial: NERD apenas. SCARF ME terá regras próprias no futuro.
  if (company.key !== "nerd") {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <FornecedoresPage companyKey={company.key} />
    </PageLayout>
  );
}
