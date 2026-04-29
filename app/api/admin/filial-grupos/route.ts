import { NextRequest, NextResponse } from 'next/server';
import {
  listFilialGrupos,
  saveFilialGrupo,
  DEFAULT_GRUPOS,
  type FilialGrupo,
} from '@/lib/utils/filial-grupos-store';

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
    let grupos = await listFilialGrupos();

    if (company) {
      const filtered = grupos.filter((g) => g.company === company.toLowerCase());
      // Retorna defaults se o store está vazio para essa empresa
      grupos = filtered.length > 0
        ? filtered
        : DEFAULT_GRUPOS.filter((g) => g.company === company.toLowerCase());
    } else {
      // Se o store está completamente vazio, retorna todos os defaults
      if (grupos.length === 0) grupos = DEFAULT_GRUPOS;
    }

    return NextResponse.json({ data: grupos });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao listar grupos' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<FilialGrupo>;

    const label = (body.label ?? '').trim();
    const company = (body.company ?? '').toLowerCase().trim();
    const members: string[] = (body.members ?? []).map((m: string) => m.trim()).filter(Boolean);
    const active = (body.active ?? '').trim();

    if (!label) return NextResponse.json({ error: 'label obrigatório' }, { status: 400 });
    if (!company) return NextResponse.json({ error: 'company obrigatório' }, { status: 400 });
    if (members.length === 0) return NextResponse.json({ error: 'members não pode ser vazio' }, { status: 400 });
    if (!active) return NextResponse.json({ error: 'active obrigatório' }, { status: 400 });
    if (!members.includes(active)) return NextResponse.json({ error: 'active deve estar em members' }, { status: 400 });

    const id = body.id || `${slugify(company)}-${slugify(label)}`;

    const grupo: FilialGrupo = { id, label, company, members, active };
    await saveFilialGrupo(grupo);

    return NextResponse.json({ data: grupo });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao salvar grupo' },
      { status: 500 }
    );
  }
}
