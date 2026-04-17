import { Metadata } from "next";

import PageLayout from "@/components/layout/PageLayout";
import ExportarRelatoriosPage from "@/components/relatorios/ExportarRelatoriosPage";

export const metadata: Metadata = {
  title: "Exportar Relatorios",
};

export default function ExportarRelatoriosRootPage() {
  return (
    <PageLayout companyName="Exportador">
      <ExportarRelatoriosPage />
    </PageLayout>
  );
}
