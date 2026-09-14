/**
 * Resolve o alias `@/` do tsconfig para scripts de linha de comando.
 *
 * Existe para que um script possa importar o MESMO módulo que a tela usa, em vez de
 * reimplementar a conta. Um backtest que roda uma cópia da regra não testa nada: ele
 * concorda consigo mesmo enquanto o produto segue diferente.
 *
 * O Node 24 já remove os tipos de `.ts` sozinho; o que falta é só o alias, que é do
 * tsconfig e o runtime não conhece. Uso:
 *
 *     node --import ./scripts/lib/alias-register.mjs scripts/<seu-script>.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Como o código-fonte importa sem extensão, tenta as do projeto na ordem do tsconfig. */
const EXTENSOES = ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = path.join(RAIZ, specifier.slice(2));
    for (const ext of ['', ...EXTENSOES]) {
      const candidato = base + ext;
      if (ext !== '' && fs.existsSync(candidato) && fs.statSync(candidato).isFile()) {
        return nextResolve(pathToFileURL(candidato).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
