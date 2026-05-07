import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ company: string }>;
}

export default async function LegacyComprasTransitoRoute({ params }: Props) {
  const { company: companySlug } = await params;
  redirect(`/${companySlug}/compras-transito`);
}
