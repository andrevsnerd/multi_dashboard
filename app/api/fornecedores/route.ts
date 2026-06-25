import { NextRequest, NextResponse } from 'next/server';
import {
  listFornecedores,
  saveFornecedor,
  DEFAULT_FORNECEDORES,
  type Fornecedor,
} from '@/lib/utils/fornecedores-store';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const company = searchParams.get('company');

  try {
    const saved = await listFornecedores();

    // Merge defaults com saved: defaults como base, saved substitui por id.
    const savedById = new Map(saved.map((f) => [f.id, f]));
    const merged = DEFAULT_FORNECEDORES.map((d) => savedById.get(d.id) ?? d);
    for (const s of saved) {
      if (!DEFAULT_FORNECEDORES.some((d) => d.id === s.id)) merged.push(s);
    }

    const fornecedores = company
      ? merged.filter((f) => f.company === company.toLowerCase())
      : merged;

    return NextResponse.json({ data: fornecedores });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao listar fornecedores' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<Fornecedor>;

    const nome = (body.nome ?? '').trim();
    const company = (body.company ?? '').toLowerCase().trim();
    const modo = body.modo === 'complemento' ? 'complemento' : 'explicito';

    if (!nome) return NextResponse.json({ error: 'nome obrigatório' }, { status: 400 });
    if (!company) return NextResponse.json({ error: 'company obrigatório' }, { status: 400 });

    const id = body.id || `${slugify(company)}-${slugify(nome)}`;

    const saved = await saveFornecedor({ ...body, id, nome, company, modo });
    return NextResponse.json({ data: saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao salvar fornecedor' },
      { status: 500 }
    );
  }
}
