import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ImprimirEtiquetasPage from "@/components/etiquetas/ImprimirEtiquetasPage";
import PageLayout from "@/components/layout/PageLayout";
import { resolveCompany } from "@/lib/config/company";

import styles from "../page.module.css";

interface ImprimirEtiquetasRouteProps {
  params: Promise<{ company: string }>;
}

export async function generateMetadata({ params }: ImprimirEtiquetasRouteProps): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  return { title: company ? `Imprimir Etiquetas | ${company.name}` : "Imprimir Etiquetas" };
}

export default async function ImprimirEtiquetasRoute({ params }: ImprimirEtiquetasRouteProps) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);

  // A tela lê o cadastro de PRODUTOS/PRODUTOS_BARRA do Linx — só as operações de
  // varejo têm catálogo. CORPORATIVO fica de fora.
  if (!company || (company.key !== "nerd" && company.key !== "scarfme")) {
    notFound();
  }

  const companyKey: "nerd" | "scarfme" = company.key === "nerd" ? "nerd" : "scarfme";

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ImprimirEtiquetasPage companyKey={companyKey} />
        </div>
      </div>
    </PageLayout>
  );
}
