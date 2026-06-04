import { resolveCompany, type CompanyKey } from '../lib/config/company';
import { buildDerivedFilialConfig, staticNameOf } from '../lib/config/filial-config-builder';

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

let failures = 0;

for (const company of ['nerd', 'scarfme'] as CompanyKey[]) {
  const legacy = resolveCompany(company)!;
  const derived = buildDerivedFilialConfig(company, staticNameOf);

  const fields: Array<[string, unknown, unknown]> = [
    ['filialFilters.sales', legacy.filialFilters.sales, derived.filialFilters.sales],
    ['filialFilters.inventory', legacy.filialFilters.inventory, derived.filialFilters.inventory],
    ['filialDisplayNames', legacy.filialDisplayNames, derived.filialDisplayNames],
    ['estoqueFilialOrder', legacy.estoqueFilialOrder, derived.estoqueFilialOrder],
    ['ecommerceFilials', legacy.ecommerceFilials ?? [], derived.ecommerceFilials ?? []],
    ['filialGroups', legacy.filialGroups ?? {}, derived.filialGroups],
    ['activeFilials', legacy.activeFilials ?? {}, derived.activeFilials],
    ['leadTimeDays', legacy.leadTimeDays ?? {}, derived.leadTimeDays],
  ];

  console.log(`\n=== ${company.toUpperCase()} ===`);
  for (const [name, a, b] of fields) {
    const ok = canon(a) === canon(b);
    console.log(`  ${ok ? 'OK  ' : 'DIFF'}  ${name}`);
    if (!ok) {
      failures++;
      console.log(`        legado : ${canon(a)}`);
      console.log(`        derivado: ${canon(b)}`);
    }
  }
}

console.log(`\n${failures === 0 ? '✅ TUDO IDÊNTICO' : `❌ ${failures} divergência(s)`}`);
process.exit(failures === 0 ? 0 : 1);
