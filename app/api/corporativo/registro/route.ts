import { NextResponse } from "next/server";

import { createUser, deleteUser, findUserByUsername } from "@/lib/auth/users-store";
import { buscarClientePorDocumento, fetchCorporativoLookups } from "@/lib/repositories/clienteCorporativo";
import {
  criarRegistroPendente,
  existePorDocumento,
  listRegistros,
} from "@/lib/repositories/corporativoCadastros";
import { resolveRegistroComercial } from "@/lib/corporativo/registroDefaults";
import { canApproveCadastro, normalizeRole } from "@/lib/auth/permissions";
import type {
  ClienteCorporativoInput,
  RegistroPublicoInput,
  RegistroStatus,
} from "@/lib/corporativo/types";

export const maxDuration = 120;

const onlyDigits = (s: unknown): string => String(s ?? "").replace(/\D/g, "");

/**
 * GET — lista os autocadastros (fila de aprovação).
 * Restrito a quem pode aprovar: admin, diretor, supervisor.
 */
export async function GET(request: Request) {
  const username = request.headers.get("x-auth-username");
  const user = username ? await findUserByUsername(username) : null;
  if (!user || !canApproveCadastro(normalizeRole(user.role))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") ?? undefined) as RegistroStatus | undefined;
  try {
    const data = await listRegistros({ status, limit: 500 });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao listar autocadastros", error);
    return NextResponse.json({ error: "Erro ao listar cadastros." }, { status: 500 });
  }
}

/**
 * POST — AUTOCADASTRO PÚBLICO (sem autenticação).
 *
 * Cria o usuário do sistema na hora (role cliente_corporativo, SEM clienteCodigo →
 * pode navegar a loja mas não comprar) e enfileira o cadastro para aprovação. O
 * cliente no Linx só é criado quando um aprovador efetivar. Todos os dados
 * comerciais/fiscais são padronizados aqui no servidor (não vêm do cliente).
 */
export async function POST(request: Request) {
  let body: RegistroPublicoInput;
  try {
    body = (await request.json()) as RegistroPublicoInput;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const isPJ = body.tipoPessoa === "PJ";
  const digits = onlyDigits(body.cpfCnpj);
  const razao = String(body.razaoSocial ?? "").trim();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  // ── Validações ─────────────────────────────────────────────────────────────
  if (!razao) return bad(isPJ ? "Informe a razão social." : "Informe o nome completo.");
  if (isPJ ? digits.length !== 14 : digits.length !== 11)
    return bad(isPJ ? "CNPJ deve ter 14 dígitos." : "CPF deve ter 11 dígitos.");
  if (isPJ && !String(body.inscricaoEstadual ?? "").trim())
    return bad("Informe a Inscrição Estadual (obrigatória para empresas). Se a empresa for isenta, digite ISENTO.");
  if (!onlyDigits(body.cep)) return bad("Informe o CEP.");
  if (!String(body.endereco ?? "").trim()) return bad("Informe o endereço.");
  if (!String(body.cidade ?? "").trim()) return bad("Informe a cidade.");
  if (!String(body.uf ?? "").trim()) return bad("Informe a UF.");
  if (!onlyDigits(body.codMunicipioIbge)) return bad("Código do município ausente — confirme o CEP para preencher.");
  if (!onlyDigits(body.ddd1) || !onlyDigits(body.telefone1)) return bad("Informe DDD e telefone.");
  if (username.length < 3) return bad("Usuário deve ter ao menos 3 caracteres.");
  if (password.length < 6) return bad("Senha deve ter ao menos 6 caracteres.");

  try {
    // Usuário já existe? (evita órfão: checa ANTES de criar qualquer coisa)
    const existingUser = await findUserByUsername(username);
    if (existingUser) return conflict("Este nome de usuário já está em uso. Escolha outro.");

    // Documento já cadastrado (Linx ou fila de aprovação)?
    const jaNoLinx = await buscarClientePorDocumento(digits);
    if (jaNoLinx) return conflict("Já existe um cliente com este CPF/CNPJ. Fale com o time comercial.");
    const jaNaFila = await existePorDocumento(digits);
    if (jaNaFila)
      return conflict(
        jaNaFila.status === "aprovado"
          ? "Este CPF/CNPJ já possui cadastro aprovado."
          : "Já existe um cadastro em análise para este CPF/CNPJ."
      );

    // Padronização server-side dos dados comerciais/fiscais.
    const lookups = await fetchCorporativoLookups();
    const { padrao, avisos } = resolveRegistroComercial(lookups, body.tipoPessoa, String(body.uf));

    const ie = isPJ ? String(body.inscricaoEstadual ?? "").trim() : "";
    const payload: ClienteCorporativoInput = {
      tipoPessoa: body.tipoPessoa,
      razaoSocial: razao,
      nomeFantasia: "", // deriva de razaoSocial no Linx (NOME_CLIFOR)
      cpfCnpj: digits,
      rgIe: isPJ ? ie || "ISENTO" : "ISENTO",
      inscricaoMunicipal: "",
      tipoTributacao: "",
      indicadorFiscal: padrao.indicadorFiscal,
      suframa: "",
      cep: onlyDigits(body.cep),
      endereco: String(body.endereco ?? "").trim(),
      numero: String(body.numero ?? "").trim(),
      complemento: String(body.complemento ?? "").trim(),
      bairro: String(body.bairro ?? "").trim(),
      cidade: String(body.cidade ?? "").trim(),
      uf: String(body.uf ?? "").trim().toUpperCase(),
      codMunicipioIbge: onlyDigits(body.codMunicipioIbge),
      pais: "BRASIL",
      ddd1: onlyDigits(body.ddd1),
      telefone1: onlyDigits(body.telefone1),
      ddd2: "",
      telefone2: "",
      email: String(body.email ?? "").trim(),
      emailNfe: String(body.email ?? "").trim(),
      aniversario: "",
      mesmoEnderecoCobranca: true,
      mesmoEnderecoEntrega: true,
      filial: padrao.filial,
      condicaoPgto: padrao.condicaoPgto,
      codigoTabPreco: padrao.codigoTabPreco,
      transportadora: padrao.transportadora,
      regiao: padrao.regiao,
      conceito: padrao.conceito,
      tipo: padrao.tipo,
      pontualidade: padrao.pontualidade,
      limiteCredito: padrao.limiteCredito,
      indicadorVenda: "",
      matrizCliente: "",
      observacao: "Autocadastro (loja corporativa) — pendente de aprovação.",
    };

    // Cria o usuário do sistema (pronto para login; SEM clienteCodigo até aprovar).
    const novoUser = await createUser(
      username,
      password,
      "cliente_corporativo",
      ["clientes-corporativos"],
      ["corporativo"],
      razao.slice(0, 60),
      false,
      undefined
    );

    // Enfileira para aprovação. Se falhar, desfaz o usuário para não deixar órfão.
    try {
      await criarRegistroPendente({
        userId: novoUser.id,
        username: novoUser.username,
        tipoPessoa: body.tipoPessoa,
        razaoSocial: razao,
        cpfCnpj: digits,
        payload,
        avisos,
      });
    } catch (e) {
      await deleteUser(novoUser.id).catch(() => {});
      throw e;
    }

    return NextResponse.json({
      data: { username: novoUser.username, userId: novoUser.id, status: "pendente" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao cadastrar.";
    console.error("Erro no autocadastro corporativo", error);
    // "Usuário já existe" pode escapar de uma corrida — devolve como conflito amigável.
    if (/já existe|already exists/i.test(message)) return conflict("Este nome de usuário já está em uso.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}
