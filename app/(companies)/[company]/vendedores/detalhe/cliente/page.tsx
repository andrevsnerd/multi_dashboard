import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import PageLayout from '@/components/layout/PageLayout';
import ClienteDetalhePage from '@/components/vendedores/ClienteDetalhePage';
import { resolveCompany } from '@/lib/config/company';
import { getCurrentMonthRange } from '@/lib/utils/date';

import styles from '../../../page.module.css';

interface Props {
  params: Promise<{ company: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  const sp = await searchParams;
  const cliente = typeof sp.cliente === 'string' ? sp.cliente : 'Cliente';
  if (!company) return { title: 'Cliente | Dashboard' };
  return { title: `${cliente} | ${company.name}` };
}

export default async function ClienteDetalhePageRoute({ params, searchParams }: Props) {
  const { company: companySlug } = await params;
  const company = resolveCompany(companySlug);
  const sp = await searchParams;

  if (!company) notFound();

  const vendedor = typeof sp.vendedor === 'string' ? sp.vendedor : '';
  const filial = typeof sp.filial === 'string' ? sp.filial : '';
  const cliente = typeof sp.cliente === 'string' ? sp.cliente : '';
  const cpf = typeof sp.cpf === 'string' ? sp.cpf : undefined;

  if (!vendedor || !filial || !cliente) notFound();

  let start = typeof sp.start === 'string' ? sp.start : '';
  let end = typeof sp.end === 'string' ? sp.end : '';
  if (!start || !end) {
    const range = getCurrentMonthRange();
    start = range.start.toISOString();
    end = range.end.toISOString();
  }

  return (
    <PageLayout companyName={company.name}>
      <div className={styles.page}>
        <div className={styles.content}>
          <ClienteDetalhePage
            companyKey={company.key}
            vendedorNome={vendedor}
            filial={filial}
            clienteNome={cliente}
            cpf={cpf}
            initialStart={start}
            initialEnd={end}
          />
        </div>
      </div>
    </PageLayout>
  );
}
