import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PageLayout from "@/components/layout/PageLayout";
import RomaneioDetalhePage from "@/components/romaneios/RomaneioDetalhePage";
import { resolveCompany } from "@/lib/config/company";

import styles from "../../page.module.css";

interface RomaneioDetalheRouteProps {
  params: Promise<{ company: string; romaneio: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  params,
}: RomaneioDetalheRouteProps): Promise<Metadata> {
  const { company: companySlug, romaneio } = await params;
  const company = resolveCompany(companySlug);
  if (!company) return { title: "Romaneio" };
  return { title: `Romaneio #${romaneio} | ${company.name}` };
}

export default async function RomaneioDetalheRoute({
  params,
  searchParams,
}: RomaneioDetalheRouteProps) {
  const { company: companySlug, romaneio: romaneioId } = await params;
  const company = resolveCompany(companySlug);
  const sp = await searchParams;

  if (!company) {
    notFound();
  }

  const tipo = (typeof sp.tipo === "string" ? sp.tipo : "") as "saida" | "entrada" | "transito";
  const filialOrigem = typeof sp.filialOrigem === "string" ? sp.filialOrigem : "";
  const filialDestino = typeof sp.filialDestino === "string" ? sp.filialDestino : "";
  const dataEmissao = typeof sp.dataEmissao === "string" ? sp.dataEmissao : "";
  const responsavel = typeof sp.responsavel === "string" ? sp.responsavel : "";
  const tipoRomaneio = typeof sp.tipoRomaneio === "string" ? sp.tipoRomaneio : "";

  if (!tipo || (tipo === "saida" && !filialOrigem) || ((tipo === "entrada" || tipo === "transito") && !filialDestino)) {
    notFound();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <RomaneioDetalhePage
            companySlug={companySlug}
            companyName={company.name}
            romaneioId={romaneioId}
            tipo={tipo}
            filialOrigem={filialOrigem}
            filialDestino={filialDestino}
            dataEmissao={dataEmissao}
            responsavel={responsavel}
            tipoRomaneio={tipoRomaneio}
          />
        </div>
      </div>
    </PageLayout>
  );
}
