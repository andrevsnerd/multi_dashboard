/**
 * Cálculo puro da divergência de UM item na conferência (sem banco), usado por
 * lib/server/conferencia-divergencias.ts. Separado para dar para testar a conta
 * sozinha.
 *
 * Tudo por posição da grade (índice 0..47 = tamanho 1..48):
 *  - falta  = saiu − chegou, por tamanho (só o positivo) → volta para a origem;
 *  - troca  = chegou a mais num tamanho, limitado ao total que faltou nos outros
 *             (é troca de tamanho, não excesso) → sai da origem nesse tamanho.
 * Chegou a mais sem faltar nada = excesso → nem falta nem troca.
 */
export interface DivergenciaItem {
  chegou: number[];
  falta: number[];
  troca: number[];
  totalSaiu: number;
  totalChegou: number;
  totalFalta: number;
  totalTroca: number;
}

export function calcularDivergenciaItem(
  saiu: number[],
  qtdeConfirmada: number,
  tamanhosConfirmados?: Record<number, number> | null
): DivergenciaItem {
  const n = saiu.length;
  const chegou = Array<number>(n).fill(0);
  if (tamanhosConfirmados && Object.keys(tamanhosConfirmados).length > 0) {
    for (const [k, v] of Object.entries(tamanhosConfirmados)) {
      const t = Number(k);
      if (t >= 1 && t <= n) chegou[t - 1] = Math.max(0, Math.floor(Number(v) || 0));
    }
  } else {
    // Sem a quebra por tamanho (tamanho único): o conferido ocupa as colunas da saída, na ordem.
    let resto = Math.max(0, Math.floor(qtdeConfirmada));
    saiu.forEach((q, i) => {
      const usa = Math.min(q, resto);
      chegou[i] = usa;
      resto -= usa;
    });
  }

  const falta = saiu.map((q, i) => Math.max(0, q - chegou[i]));
  const sobra = saiu.map((q, i) => Math.max(0, chegou[i] - q));
  const totalFalta = falta.reduce((s, x) => s + x, 0);
  const troca = Array<number>(n).fill(0);
  let restante = Math.min(totalFalta, sobra.reduce((s, x) => s + x, 0));
  sobra.forEach((q, i) => {
    const usa = Math.min(q, restante);
    troca[i] = usa;
    restante -= usa;
  });

  return {
    chegou,
    falta,
    troca,
    totalSaiu: saiu.reduce((s, x) => s + x, 0),
    totalChegou: chegou.reduce((s, x) => s + x, 0),
    totalFalta,
    totalTroca: troca.reduce((s, x) => s + x, 0),
  };
}
