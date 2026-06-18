import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Apenas os arquivos que o exportador realmente gera podem ser baixados.
const BASES_PERMITIDAS = new Set([
  'produtos_tratados',
  'estoque_tratados',
  'vendas_tratadas',
  'ecommerce',
  'entradas',
  'saidas',
]);

const TIPOS: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

function getDataDir(): string {
  const scriptDir = (process.env.RELATORIOS_SCRIPT_DIR || 'C:\\NERD\\AUTOMACOES').trim();
  return path.join(scriptDir, 'data');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = (searchParams.get('arquivo') || '').trim();
  const fmt = (searchParams.get('fmt') || '').trim().toLowerCase();

  if (!BASES_PERMITIDAS.has(base) || !(fmt in TIPOS)) {
    return NextResponse.json({ error: 'Arquivo inválido' }, { status: 400 });
  }

  const nomeArquivo = `${base}.${fmt}`;
  const dataDir = getDataDir();
  const caminho = path.join(dataDir, nomeArquivo);

  // Defesa extra contra path traversal: o resolvido tem que ficar dentro de dataDir.
  const resolvido = path.resolve(caminho);
  if (!resolvido.startsWith(path.resolve(dataDir) + path.sep)) {
    return NextResponse.json({ error: 'Caminho inválido' }, { status: 400 });
  }

  if (!fs.existsSync(resolvido)) {
    return NextResponse.json(
      { error: `Arquivo ${nomeArquivo} ainda não foi gerado` },
      { status: 404 }
    );
  }

  const tamanho = fs.statSync(resolvido).size;
  const nodeStream = fs.createReadStream(resolvido);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new Response(webStream, {
    headers: {
      'Content-Type': TIPOS[fmt],
      'Content-Length': String(tamanho),
      'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      'Cache-Control': 'no-store',
    },
  });
}
