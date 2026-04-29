import { NextRequest, NextResponse } from 'next/server';
import { deleteFilialGrupo, saveFilialGrupo, type FilialGrupo } from '@/lib/utils/filial-grupos-store';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await req.json() as Partial<FilialGrupo>;
    const { id } = await params;

    const label = (body.label ?? '').trim();
    const company = (body.company ?? '').toLowerCase().trim();
    const members: string[] = (body.members ?? []).map((m: string) => m.trim()).filter(Boolean);
    const active = (body.active ?? '').trim();

    if (!label) return NextResponse.json({ error: 'label obrigatório' }, { status: 400 });
    if (!company) return NextResponse.json({ error: 'company obrigatório' }, { status: 400 });
    if (members.length === 0) return NextResponse.json({ error: 'members não pode ser vazio' }, { status: 400 });
    if (!active) return NextResponse.json({ error: 'active obrigatório' }, { status: 400 });
    if (!members.includes(active)) return NextResponse.json({ error: 'active deve estar em members' }, { status: 400 });

    const grupo: FilialGrupo = { id, label, company, members, active };
    await saveFilialGrupo(grupo);

    return NextResponse.json({ data: grupo });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao atualizar grupo' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteFilialGrupo(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao deletar grupo' },
      { status: 500 }
    );
  }
}
