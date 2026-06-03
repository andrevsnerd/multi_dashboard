// Confirma a ENTRADA (gera romaneio de entrada no ERP) das saídas pendentes com destino Galeão,
// uma de cada vez, com a MESMA lógica do botão "Confirmar Tudo" da tela de romaneios:
//   1) POST /api/saidas-entradas-produtos/executar  (tipoOperacao: "entrada") -> gera 1 romaneio de
//      entrada e soma o estoque no destino (Galeão);
//   2) POST /api/romaneio-confirmar-entrada (acao: "confirmar") por item -> marca como confirmado.
//
// ⚠️ ESCRITA EM PRODUÇÃO E IRREVERSÍVEL: cada saída vira 1 romaneio de entrada real + estoque.
//    NÃO é idempotente no ERP — por isso só processa saídas PENDENTES (qtdConfirmados < qtdProdutos)
//    e PARA no primeiro erro (inclusive se a marcação de confirmação falhar), para não duplicar.
//
// Uso:
//   node scripts/confirmar-entradas-galeao.mjs                 # DRY-RUN: lista o que faria
//   node scripts/confirmar-entradas-galeao.mjs --apply --limit 1   # gera a entrada de 1 (teste)
//   node scripts/confirmar-entradas-galeao.mjs --apply             # gera de TODAS as pendentes
//
// Flags: --apply (grava), --limit N (processa só N), --user <login admin>, --base <url>

const APPLY = process.argv.includes("--apply");
const argVal = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LIMIT = Number(argVal("--limit") || 0) || 0; // 0 = sem limite
const BASE = (argVal("--base") || process.env.BASE_URL || "https://multi-dashboard.vercel.app").replace(/\/$/, "");
const USER = argVal("--user") || process.env.ADMIN_USER || "andre.sabetta";
const COMPANY = "scarfme";

const norm = (s) =>
  (s || "").toString().trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const isGaleao = (s) => norm(s).includes("GALEAO");

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "x-auth-username": USER, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  console.log(`Modo: ${APPLY ? "APPLY (grava no ERP)" : "DRY-RUN (não grava)"}`);
  console.log(`Base: ${BASE} | user: ${USER} | limite: ${LIMIT || "sem limite"}\n`);

  // 1) Lista saídas da empresa e filtra: destino Galeão + pendentes (qtdConfirmados < qtdProdutos)
  const saidasResp = await api(`/api/romaneios/saidas?company=${COMPANY}`);
  if (!saidasResp.ok) {
    console.error("Falha ao listar saídas:", saidasResp.status, saidasResp.json);
    process.exit(1);
  }
  const todas = saidasResp.json.data || [];
  const destinoGaleao = todas.filter((r) => isGaleao(r.destinoCodigo) || isGaleao(r.filialDestino));
  const pendentes = destinoGaleao.filter((r) => (r.qtdConfirmados ?? 0) < (r.qtdProdutos ?? 0));

  console.log(`Saídas (empresa): ${todas.length}`);
  console.log(`  destino Galeão: ${destinoGaleao.length}`);
  console.log(`  pendentes (a processar): ${pendentes.length}`);
  if (destinoGaleao.length && !pendentes.length) {
    console.log("Todas as de Galeão já estão confirmadas. Nada a fazer.");
  }

  const fila = LIMIT > 0 ? pendentes.slice(0, LIMIT) : pendentes;
  let okCount = 0, totalItens = 0, totalQtde = 0;
  const gerados = [];

  for (const [idx, rom] of fila.entries()) {
    const filialDestino = rom.destinoCodigo || rom.filialDestino; // nome real (2 espaços)
    // 2) Busca os itens da saída
    const det = await api(
      `/api/transferencia-produtos/log-detalhes?tipo=saida&romaneio=${encodeURIComponent(rom.romaneio)}` +
      `&filialOrigem=${encodeURIComponent(rom.filialOrigem)}&filialDestino=${encodeURIComponent(filialDestino)}`
    );
    const itens = (det.ok ? det.json.data || [] : [])
      .map((i) => ({ produto: i.produto, corProduto: i.corProduto, quantidade: Number(i.qtde) || 0 }))
      .filter((i) => i.produto && i.quantidade > 0);
    const somaQtde = itens.reduce((s, i) => s + i.quantidade, 0);

    const tag = `[${idx + 1}/${fila.length}] rom ${rom.romaneio} | ${rom.filialOrigem} → ${filialDestino}`;
    if (!itens.length) {
      console.log(`${tag} | SEM ITENS — pulando${det.ok ? "" : ` (erro detalhes: ${det.status})`}`);
      continue;
    }

    if (!APPLY) {
      console.log(`${tag} | ${itens.length} itens, ${somaQtde} un  (dry-run)`);
      totalItens += itens.length; totalQtde += somaQtde;
      continue;
    }

    // 3) Gera a entrada (1 romaneio para todos os itens desta saída)
    const exec = await api(`/api/saidas-entradas-produtos/executar`, {
      method: "POST",
      body: JSON.stringify({
        tipoOperacao: "entrada",
        companyKey: COMPANY,
        filial: filialDestino,
        itens,
        tipoRomaneio: "TRANSFERENCIA ENTRE LOJAS",
        responsavel: "LOGISTICA",
        observacao: null,
      }),
    });
    if (!exec.ok || !exec.json.success) {
      console.error(`${tag} | ERRO ao gerar entrada: ${exec.status} ${JSON.stringify(exec.json)}`);
      console.error("PARANDO para evitar inconsistência. Verifique antes de reexecutar.");
      break;
    }
    const romaneioEntrada = exec.json.romaneio;
    gerados.push({ saida: rom.romaneio, entrada: romaneioEntrada });

    // 4) Marca cada item como confirmado (badge / idempotência)
    let confErro = null;
    for (const it of itens) {
      const c = await api(`/api/romaneio-confirmar-entrada`, {
        method: "POST",
        body: JSON.stringify({
          companyKey: COMPANY,
          romaneioId: rom.romaneio,
          filialDestino,
          produto: it.produto,
          corProduto: it.corProduto ?? "",
          qtdeConfirmada: it.quantidade,
          acao: "confirmar",
        }),
      });
      if (!c.ok) { confErro = `${c.status} ${JSON.stringify(c.json)}`; break; }
    }
    if (confErro) {
      console.error(`${tag} | entrada ${romaneioEntrada} GERADA, mas falhou ao marcar confirmação: ${confErro}`);
      console.error("PARANDO — marque/verifique manualmente antes de continuar (senão reexecução duplica).");
      break;
    }

    okCount++; totalItens += itens.length; totalQtde += somaQtde;
    console.log(`${tag} | OK → entrada gerada ${romaneioEntrada} (${itens.length} itens, ${somaQtde} un)`);
  }

  console.log("\n" + "=".repeat(60));
  if (APPLY) {
    console.log(`Processadas com sucesso: ${okCount}/${fila.length}`);
    console.log(`Itens: ${totalItens} | unidades: ${totalQtde}`);
    if (gerados.length) {
      console.log("Romaneios de entrada gerados (saída → entrada):");
      gerados.forEach((g) => console.log(`  ${g.saida} → ${g.entrada}`));
    }
  } else {
    console.log(`DRY-RUN: ${fila.length} saída(s) seriam processadas | ${totalItens} itens | ${totalQtde} un.`);
    console.log(`Rode com --apply --limit 1 para gerar a entrada de 1 (teste).`);
  }
}

main().catch((e) => { console.error("Falhou:", e); process.exit(1); });
