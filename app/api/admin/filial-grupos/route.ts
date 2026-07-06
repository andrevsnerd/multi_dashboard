import { NextRequest, NextResponse } from 'next/server';
import {
  listFilialGrupos,
  saveFilialGrupo,
  DEFAULT_GRUPOS,
  type FilialGrupo,
} from '@/lib/utils/filial-grupos-store';
import { idsForFilialRefs, idForFilialRef } from '@/lib/server/company-live';
import { detectActiveFilialIdsByCompany } from '@/lib/config/company-server';

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
    const saved = await listFilialGrupos();

    // Merge defaults com saved: defaults como base, saved substitui por id.
    const savedById = new Map(saved.map((g) => [g.id, g]));
    const merged = DEFAULT_GRUPOS.map((d) => savedById.get(d.id) ?? d);
    for (const s of saved) {
      if (!DEFAULT_GRUPOS.some((d) => d.id === s.id)) merged.push(s);
    }

    const grupos = company
      ? merged.filter((g) => g.company === company.toLowerCase())
      : merged;

    // Normaliza membros/ativa para COD_FILIAL (tolera grupos legados salvos por nome),
    // para o painel sempre trabalhar por ID.
    const gruposPorId = await Promise.all(
      grupos.map(async (g) => ({
        ...g,
        members: await idsForFilialRefs(g.members),
        active: (await idForFilialRef(g.active)) ?? g.active,
      }))
    );

    // Detecta a canônica VIVA de cada grupo (venda/emissão mais recente entre os membros
    // — mesma regra do dashboard). Assim o painel acompanha o rodízio (ex.: MSC↔AKS do
    // e-commerce) em vez de exibir o `active` estático defasado.
    const empresas = [...new Set(gruposPorId.map((g) => g.company))];
    const detectedPorEmpresa = new Map<string, Map<string, string>>();
    await Promise.all(
      empresas.map(async (c) => {
        try {
          detectedPorEmpresa.set(c, await detectActiveFilialIdsByCompany(c));
        } catch {
          detectedPorEmpresa.set(c, new Map());
        }
      })
    );

    const comCanonica = gruposPorId.map((g) => {
      const detected = detectedPorEmpresa.get(g.company)?.get(g.id);
      const activeAtual = detected ?? g.active; // canônica viva; fallback = configurada
      return {
        ...g,
        active: activeAtual,
        configuredActive: g.active,                              // fallback estático (para o formulário)
        autoDetected: detected != null && g.members.length > 1,  // regra de última venda só escolhe entre 2+ membros
      };
    });

    return NextResponse.json({ data: comCanonica });
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
