const baseUrl = "https://multi-dashboard.vercel.app";
const adminUsername = "andre.sabetta";

const tipoParceria = "SAÍDA PARCERIA";
const tipoSocio = "RETIRADA SÓCIO";

const headers = {
  "x-auth-username": adminUsername,
  "Content-Type": "application/json; charset=utf-8",
};

const usersResp = await fetch(`${baseUrl}/api/admin/users`, { headers });
if (!usersResp.ok) {
  throw new Error(`Falha ao listar usuários: ${usersResp.status}`);
}
const users = await usersResp.json();

const permsResp = await fetch(`${baseUrl}/api/admin/transferencia-permissoes`, { headers });
if (!permsResp.ok) {
  throw new Error(`Falha ao listar permissões: ${permsResp.status}`);
}
const permsJson = await permsResp.json();
const perms = Array.isArray(permsJson?.data) ? permsJson.data : [];

const targets = users.filter((u) => u.role === "gestor" || u.role === "logistica");

for (const u of targets) {
  const atual = perms.find((p) => p.username === u.username);
  if (!atual) continue;

  const tipos = Array.isArray(atual.tiposRomaneioPermitidos) ? [...atual.tiposRomaneioPermitidos] : [];
  if (tipos.length === 0) continue; // vazio = todos permitidos

  const filtrados = tipos.filter(
    (t) => !/^SA.*PARCERIA$/i.test(t || "") && !/^RETIRADA S.*CIO$/i.test(t || "")
  );
  filtrados.push(tipoParceria, tipoSocio);

  const payload = {
    username: u.username,
    filiaisOrigem: Array.isArray(atual.filiaisOrigem) ? atual.filiaisOrigem : [],
    filiaisDestino: Array.isArray(atual.filiaisDestino) ? atual.filiaisDestino : [],
    filiaisDestinoControle: Array.isArray(atual.filiaisDestinoControle) ? atual.filiaisDestinoControle : [],
    tiposRomaneioPermitidos: Array.from(new Set(filtrados)),
    responsavelPadrao: atual.responsavelPadrao ?? null,
    tipoRomaneioPadrao: atual.tipoRomaneioPadrao ?? null,
    responsavelFixo: !!atual.responsavelFixo,
    tipoRomaneioFixo: !!atual.tipoRomaneioFixo,
    podeVerOutrasFiliais: !!atual.podeVerOutrasFiliais,
    filialAtribuida: atual.filialAtribuida ?? null,
  };

  const saveResp = await fetch(`${baseUrl}/api/admin/transferencia-permissoes`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!saveResp.ok) {
    throw new Error(`Falha ao salvar ${u.username}: ${saveResp.status}`);
  }
  console.log(`OK: ${u.username}`);
}

const verifyResp = await fetch(`${baseUrl}/api/admin/transferencia-permissoes`, { headers });
const verifyJson = await verifyResp.json();
const verify = Array.isArray(verifyJson?.data) ? verifyJson.data : [];
const withAccents = verify
  .filter((p) => Array.isArray(p.tiposRomaneioPermitidos))
  .filter(
    (p) =>
      p.tiposRomaneioPermitidos.includes(tipoParceria) &&
      p.tiposRomaneioPermitidos.includes(tipoSocio)
  )
  .map((p) => p.username);

console.log(`Concluído. Usuários com os 2 tipos acentuados: ${withAccents.length}`);
