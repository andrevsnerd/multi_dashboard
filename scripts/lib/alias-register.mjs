/** Liga o resolvedor de `@/` (ver alias-hooks.mjs). Use com `node --import`. */
import { register } from 'node:module';

register('./alias-hooks.mjs', import.meta.url);
