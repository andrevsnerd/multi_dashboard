import { NextRequest, NextResponse } from 'next/server';
import { deleteFornecedor, saveFornecedor, type Fornecedor } from '@/lib/utils/fornecedores-store';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = (await req.json()) as Partial<Fornecedor>;
    const { id } = await params;

    const nome = (body.nome ?? '').trim();
    const company = (body.company ?? '').toLowerCase().trim();
    const modo = body.modo === 'complemento' ? 'complemento' : 'explicito';

    if (!nome) return NextResponse.json({ error: 'nome obrigatório' }, { status: 400 });
    if (!company) return NextResponse.json({ error: 'company obrigatório' }, { status: 400 });

    const saved = await saveFornecedor({ ...body, id, nome, company, modo });
    return NextResponse.json({ data: saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao atualizar fornecedor' },
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
    await deleteFornecedor(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao deletar fornecedor' },
      { status: 500 }
    );
  }
}
