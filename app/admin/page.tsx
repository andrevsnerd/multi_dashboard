"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthContext";
import {
  ALL_PERMISSION_KEYS,
  ROLE_LABELS,
  type CompanyKey,
  type RoleKey,
  type PermissionKey,
} from "@/types/auth";
import { roleAllowsPermission } from "@/lib/auth/permissions";
import styles from "./page.module.css";
const _filialLabelOverrides: Record<string, string> = {
  'NERD MORUMBI RDRRRJ': 'NERD MORUMBI RDRRRJ',
  'NERD MORUMBI RDRX': 'NERD MORUMBI RDRRRJ',
  'NERD MORUMBI RDRRX': 'NERD MORUMBI 2 (RRX)',
};
function getFilialLabel(filial: string): string {
  return _filialLabelOverrides[filial] ?? filial;
}

/* Agrupamento visual das páginas (espelha as seções da Sidebar). Não altera
 * permissões — só organiza os checkboxes. Chaves fora dos grupos caem em "Outros". */
const PERMISSION_GROUPS: { label: string; keys: PermissionKey[] }[] = [
  {
    label: "Visão geral",
    keys: [
      "dashboard", "produtos", "produto-agrupado", "produto-detalhado", "produto-performance",
      "produtos-recentes", "produtos-novos", "relatorio-colecao", "relatorio-claude",
      "vendedores", "clientes", "mapa-clientes",
    ],
  },
  {
    label: "Estoque",
    keys: [
      "controle-estoque", "estoque-consulta", "controle-giro", "controle-performance",
      "controle-movimento", "curva-abc", "curva-por-produto", "nova-filial", "estoque-por-filial",
    ],
  },
  {
    label: "Operações",
    keys: [
      "controle-transferencias", "transferencia-produtos", "romaneios",
      "saidas-entradas-produtos", "extrato-produto", "lista-loja", "compras-transito", "compras-salvas", "destino-romaneio",
    ],
  },
  {
    label: "Ferramentas",
    keys: ["filial", "exportar-relatorios", "gerador-relatorios", "fornecedores", "sincronizacao", "blackfriday"],
  },
];

/** Organiza ALL_PERMISSION_KEYS nos grupos acima, preservando os labels oficiais. */
function buildGroupedPermissions() {
  const labelByKey = new Map(ALL_PERMISSION_KEYS.map((p) => [p.key, p.label] as const));
  const grouped = new Set<PermissionKey>();
  const groups = PERMISSION_GROUPS.map((g) => {
    const items = g.keys
      .filter((k) => labelByKey.has(k))
      .map((k) => {
        grouped.add(k);
        return { key: k, label: labelByKey.get(k)! };
      });
    return { label: g.label, items };
  }).filter((g) => g.items.length > 0);

  const outros = ALL_PERMISSION_KEYS.filter((p) => !grouped.has(p.key));
  if (outros.length > 0) groups.push({ label: "Outros", items: outros });
  return groups;
}

/* ── Tipos ── */
interface UserRow {
  id: string;
  username: string;
  nomeExibicao?: string;
  role: RoleKey;
  permissions: PermissionKey[];
  allowedCompanies?: CompanyKey[];
  somenteVarejo?: boolean;
  clienteCodigo?: string;
}

interface ClienteBusca {
  codigo: string;
  nomeClifor: string;
  razaoSocial: string;
  cpfCnpj: string;
  cidade: string;
  uf: string;
}

interface TransfPerm {
  username: string;
  filiaisOrigem: string[];
  filiaisDestino: string[];
  filiaisDestinoControle?: string[];
  tiposRomaneioPermitidos: string[];
  responsavelPadrao?: string;
  tipoRomaneioPadrao?: string;
  responsavelFixo: boolean;
  tipoRomaneioFixo: boolean;
  podeVerOutrasFiliais?: boolean;
  filialAtribuida?: string | null;
}

interface Filial {
  codFilial: string;
  filial: string;
  /** Nome curto de exibição (ex.: "E-COMMERCE", "PAULISTA"). */
  displayName?: string;
  /** Membros do grupo (>1 = grupo com canônica rotativa, ex.: E-COMMERCE MSC↔AKS). */
  members?: string[];
}

/**
 * Rótulo da opção de filial. Para GRUPOS (mais de um membro — ex.: E-COMMERCE do rodízio
 * MSC↔AKS, ou PAULISTA), mostra o nome do grupo + a CANÔNICA ATIVA atual, deixando claro
 * qual filial está operacional agora. Filial simples usa o override/nome de sempre.
 */
function filialOptionLabel(f: Filial): string {
  if (f.members && f.members.length > 1) {
    const base = f.displayName?.trim() || getFilialLabel(f.filial);
    return `${base} — canônica atual: ${f.filial}`;
  }
  return getFilialLabel(f.filial);
}

/* ── Página ── */
export default function AdminPage() {
  const { user: currentUser } = useAuth();

  // Dados
  const [users, setUsers] = useState<UserRow[]>([]);
  const [transfPerms, setTransfPerms] = useState<TransfPerm[]>([]);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [filiaisNerd, setFiliaisNerd] = useState<Filial[]>([]);
  const [filiaisScarf, setFiliaisScarf] = useState<Filial[]>([]);
  const [tiposRomaneio, setTiposRomaneio] = useState<string[]>([]);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal
  const [modal, setModal] = useState<"none" | "add" | "edit">("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Campos — dados básicos
  const [formNome, setFormNome] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<RoleKey>("gerente");
  const [formEmpresa, setFormEmpresa] = useState<"" | CompanyKey>("");

  // Campos — páginas
  const [formPermissions, setFormPermissions] = useState<PermissionKey[]>([]);

  // Campos — filial e transferências
  const [formFilialPrincipal, setFormFilialPrincipal] = useState("");
  const [formAdvancedFiliais, setFormAdvancedFiliais] = useState(false);
  const [formFiliaisOrigem, setFormFiliaisOrigem] = useState<string[]>([]);
  const [formFiliaisDestino, setFormFiliaisDestino] = useState<string[]>([]);
  const [formFiliaisDestinoControle, setFormFiliaisDestinoControle] = useState<string[]>([]);
  const [formTiposRomaneio, setFormTiposRomaneio] = useState<string[]>([]);
  const [formResponsavel, setFormResponsavel] = useState("");
  const [formTipoRomaneio, setFormTipoRomaneio] = useState("");
  const [formResponsavelFixo, setFormResponsavelFixo] = useState(false);
  const [formTipoRomaneioFixo, setFormTipoRomaneioFixo] = useState(false);
  const [formPodeVerOutras, setFormPodeVerOutras] = useState(false);

  // Dashboard
  const [formSomenteVarejo, setFormSomenteVarejo] = useState(false);

  // Cliente corporativo — vínculo com cliente atacado do Linx
  const [formClienteCodigo, setFormClienteCodigo] = useState("");
  const [formClienteNome, setFormClienteNome] = useState("");
  const [clienteSearch, setClienteSearch] = useState("");
  const [clienteResults, setClienteResults] = useState<ClienteBusca[]>([]);
  const [clienteSearching, setClienteSearching] = useState(false);

  // Grupos de páginas recolhidos (vazio = todos expandidos)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Widget "copiar de outro usuário": null = fechado; "full" = novo usuário (copia tudo);
  // "pages" = editar (copia só as páginas).
  const [userPicker, setUserPicker] = useState<null | "full" | "pages">(null);
  const [pickerSearch, setPickerSearch] = useState("");

  const authHeader = useCallback(
    (): Record<string, string> =>
      currentUser ? { "X-Auth-Username": currentUser.username } : {},
    [currentUser]
  );

  /* ── Carregamento ── */
  const loadAll = useCallback(async () => {
    if (!currentUser?.username) return;
    setLoading(true);
    setError("");
    try {
      const [usersRes, permsRes, filiaisNerdRes, filiaisScarfRes, tiposRes, responsRes] = await Promise.all([
        fetch("/api/admin/users", { headers: authHeader() }),
        fetch("/api/admin/transferencia-permissoes", { headers: authHeader(), cache: "no-store" }),
        fetch("/api/transferencia-produtos/filiais?company=nerd", { cache: "no-store" }),
        fetch("/api/transferencia-produtos/filiais?company=scarfme", { cache: "no-store" }),
        fetch("/api/transferencia-produtos/tipos-romaneio", { cache: "no-store" }),
        fetch("/api/transferencia-produtos/responsaveis", { cache: "no-store" }),
      ]);

      if (!usersRes.ok) throw new Error("Erro ao carregar usuários");
      setUsers(await usersRes.json());

      if (permsRes.ok) {
        const p = await permsRes.json();
        setTransfPerms(p.data || []);
      }
      const nerdList: Filial[] = filiaisNerdRes.ok ? (await filiaisNerdRes.json()).data || [] : [];
      const scarfList: Filial[] = filiaisScarfRes.ok ? (await filiaisScarfRes.json()).data || [] : [];
      setFiliaisNerd(nerdList);
      setFiliaisScarf(scarfList);
      // União (dedup por codFilial) — usada para resolver nomes na tabela de usuários.
      const seenCod = new Set(nerdList.map((f) => f.codFilial));
      const union = [...nerdList];
      for (const f of scarfList) {
        if (!seenCod.has(f.codFilial)) {
          seenCod.add(f.codFilial);
          union.push(f);
        }
      }
      setFiliais(union);
      if (tiposRes.ok) {
        const t = await tiposRes.json();
        setTiposRomaneio(t.data || []);
      }
      if (responsRes.ok) {
        const r = await responsRes.json();
        setResponsaveis((r.data || []).map((x: { responsavel: string }) => x.responsavel));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.username, authHeader]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* ── Helpers modal ── */
  function resetForm() {
    setFormNome("");
    setFormUsername("");
    setFormPassword("");
    setFormRole("gerente");
    setFormEmpresa("");
    setFormPermissions([]);
    setFormFilialPrincipal("");
    setFormAdvancedFiliais(false);
    setFormFiliaisOrigem([]);
    setFormFiliaisDestino([]);
    setFormFiliaisDestinoControle([]);
    setFormTiposRomaneio([]);
    setFormResponsavel("");
    setFormTipoRomaneio("");
    setFormResponsavelFixo(false);
    setFormTipoRomaneioFixo(false);
    setFormPodeVerOutras(false);
    setFormSomenteVarejo(false);
    setFormClienteCodigo("");
    setFormClienteNome("");
    setClienteSearch("");
    setClienteResults([]);
    setFormError("");
  }

  /** Busca clientes atacado do Linx para vincular a um usuário cliente_corporativo. */
  async function buscarClientesLinx() {
    const term = clienteSearch.trim();
    if (term.length < 2) return;
    setClienteSearching(true);
    try {
      const res = await fetch(`/api/corporativo/clientes?limit=20&search=${encodeURIComponent(term)}`);
      const json = await res.json();
      if (res.ok) setClienteResults((json.data as ClienteBusca[]) ?? []);
    } finally {
      setClienteSearching(false);
    }
  }

  function vincularCliente(c: ClienteBusca) {
    setFormClienteCodigo(c.codigo);
    setFormClienteNome(c.razaoSocial || c.nomeClifor);
    setClienteResults([]);
    setClienteSearch("");
  }

  /** Ao escolher cliente_corporativo, a empresa é sempre CORPORATIVO. */
  function handleRoleChange(role: RoleKey) {
    setFormRole(role);
    if (role === "cliente_corporativo") setFormEmpresa("corporativo");
  }

  function openAdd() {
    setEditingId(null);
    resetForm();
    setFormPermissions(["controle-transferencias"]);
    setUserPicker(null);
    setPickerSearch("");
    setModal("add");
  }

  function openEdit(u: UserRow) {
    setEditingId(u.id);
    setUserPicker(null);
    setPickerSearch("");
    setFormNome(u.nomeExibicao ?? "");
    setFormUsername(u.username);
    setFormPassword("");
    setFormRole(u.role);
    const ac = u.allowedCompanies;
    setFormEmpresa(!ac?.length || ac.length === 2 ? "" : (ac[0] as "" | CompanyKey));
    setFormPermissions(u.permissions ?? []);
    setFormSomenteVarejo(u.somenteVarejo ?? false);
    setFormClienteCodigo(u.clienteCodigo ?? "");
    setFormClienteNome("");
    setClienteSearch("");
    setClienteResults([]);
    // Resolve o nome do cliente vinculado (só exibição).
    if (u.clienteCodigo) {
      fetch(`/api/corporativo/clientes?limit=1&search=${encodeURIComponent(u.clienteCodigo)}`)
        .then((r) => r.json())
        .then((j) => {
          const c = (j.data as ClienteBusca[])?.find((x) => x.codigo === u.clienteCodigo) ?? (j.data as ClienteBusca[])?.[0];
          if (c) setFormClienteNome(c.razaoSocial || c.nomeClifor);
        })
        .catch(() => {});
    }

    // Preencher dados de transferência a partir do próprio usuário.
    applyTransfConfigFromUser(u.username);

    setFormError("");
    setModal("edit");
  }

  /** Carrega no form a config de transferência de um username (ou limpa, se não houver). */
  function applyTransfConfigFromUser(username: string) {
    const tp = transfPerms.find((p) => p.username === username);
    if (tp) {
      setFormFilialPrincipal(tp.filialAtribuida ?? "");
      setFormFiliaisOrigem(tp.filiaisOrigem ?? []);
      setFormFiliaisDestino(tp.filiaisDestino ?? []);
      setFormFiliaisDestinoControle(tp.filiaisDestinoControle ?? []);
      setFormTiposRomaneio(tp.tiposRomaneioPermitidos ?? []);
      setFormResponsavel(tp.responsavelPadrao ?? "");
      setFormTipoRomaneio(tp.tipoRomaneioPadrao ?? "");
      setFormResponsavelFixo(tp.responsavelFixo ?? false);
      setFormTipoRomaneioFixo(tp.tipoRomaneioFixo ?? false);
      setFormPodeVerOutras(tp.podeVerOutrasFiliais ?? false);
      // Mostrar modo avançado se origem/destino difere da filial principal
      const mesmaOrigem =
        tp.filiaisOrigem.length === 1 && tp.filiaisOrigem[0] === tp.filialAtribuida;
      const mesmaDestino =
        tp.filiaisDestino.length === 1 && tp.filiaisDestino[0] === tp.filialAtribuida;
      setFormAdvancedFiliais(tp.filiaisOrigem.length > 0 && !(mesmaOrigem && mesmaDestino));
    } else {
      setFormFilialPrincipal("");
      setFormFiliaisOrigem([]);
      setFormFiliaisDestino([]);
      setFormFiliaisDestinoControle([]);
      setFormTiposRomaneio([]);
      setFormResponsavel("");
      setFormTipoRomaneio("");
      setFormResponsavelFixo(false);
      setFormTipoRomaneioFixo(false);
      setFormPodeVerOutras(false);
      setFormAdvancedFiliais(false);
    }
  }

  /**
   * Copia a configuração de um usuário de referência para o form atual.
   * - mode "full" (novo usuário): copia páginas, função, empresa, varejo e toda
   *   a config de filial/transferência. NÃO copia login, senha nem nome de exibição.
   * - mode "pages" (editar): copia SOMENTE as páginas liberadas, ignorando o resto.
   * Para usuário admin de origem, "páginas" = todas as páginas disponíveis.
   */
  function applyUserConfig(u: UserRow, mode: "full" | "pages") {
    const pages: PermissionKey[] =
      u.role === "admin" ? ALL_PERMISSION_KEYS.map((p) => p.key) : (u.permissions ?? []);
    setFormPermissions(pages);
    if (mode === "pages") return;

    setFormRole(u.role);
    const ac = u.allowedCompanies;
    setFormEmpresa(!ac?.length || ac.length === 2 ? "" : (ac[0] as "" | CompanyKey));
    setFormSomenteVarejo(u.somenteVarejo ?? false);
    applyTransfConfigFromUser(u.username);
  }

  function closeModal() {
    setModal("none");
    setEditingId(null);
    setUserPicker(null);
    setPickerSearch("");
  }

  /** Aplica a config do usuário escolhido no picker e fecha o widget. */
  function pickReferenceUser(u: UserRow) {
    if (userPicker) applyUserConfig(u, userPicker);
    setUserPicker(null);
    setPickerSearch("");
  }

  function togglePermission(key: PermissionKey) {
    setFormPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }

  function handleFilialPrincipalChange(cod: string) {
    setFormFilialPrincipal(cod);
    if (!formAdvancedFiliais) {
      // Em modo simples: sincroniza origem e destino
      setFormFiliaisOrigem(cod ? [cod] : []);
      setFormFiliaisDestino(cod ? [cod] : []);
    }
    if (!cod) setFormPodeVerOutras(false);
  }

  /** Filiais disponíveis no form conforme a empresa escolhida (Ambas = união). */
  function filiaisForEmpresa(emp: "" | CompanyKey): Filial[] {
    if (emp === "nerd") return filiaisNerd;
    if (emp === "scarfme") return filiaisScarf;
    return filiais;
  }

  function handleEmpresaChange(emp: "" | CompanyKey) {
    setFormEmpresa(emp);
    // Se a filial atribuída não pertence à nova empresa, limpa para não ficar oculta.
    if (formFilialPrincipal && !filiaisForEmpresa(emp).some((f) => f.codFilial === formFilialPrincipal)) {
      handleFilialPrincipalChange("");
    }
  }

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleGroupAll(keys: PermissionKey[], allSelected: boolean) {
    setFormPermissions((prev) => {
      if (allSelected) return prev.filter((k) => !keys.includes(k));
      const set = new Set(prev);
      keys.forEach((k) => set.add(k));
      return Array.from(set);
    });
  }

  /* ── Submit ── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);

    try {
      // 1) Salvar dados do usuário
      const userPayload = {
        username: formUsername,
        role: formRole,
        // Remove permissoes restritas que nao se aplicam a funcao (ex: extrato-produto em gestor).
        permissions:
          formRole === "admin"
            ? []
            : formPermissions.filter((k) => roleAllowsPermission(formRole, k)),
        allowedCompanies: formEmpresa ? [formEmpresa] : [],
        nomeExibicao: formNome || null,
        somenteVarejo: formSomenteVarejo || null,
        clienteCodigo: formRole === "cliente_corporativo" ? formClienteCodigo || null : null,
        ...(formPassword ? { password: formPassword } : {}),
      };

      let savedUsername = formUsername;

      if (modal === "add") {
        if (!formPassword) {
          setFormError("Senha é obrigatória para novos usuários");
          setSaving(false);
          return;
        }
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(userPayload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro ao criar usuário");
        savedUsername = data.username;
      } else {
        const res = await fetch(`/api/admin/users/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(userPayload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar usuário");
        savedUsername = data.username;
      }

      // 2) Permissões de transferência.
      //    - Com filial atribuída ou config avançada → cria/atualiza a linha.
      //    - Sem nada (Nenhuma) → SOMENTE LEITURA: remove a linha se existir
      //      (sem linha, o gate de execução bloqueia saídas/entradas, mas o
      //       usuário continua vendo o quadro completo).
      const temConfigTransf =
        formFilialPrincipal ||
        formFiliaisOrigem.length > 0 ||
        formFiliaisDestino.length > 0 ||
        formFiliaisDestinoControle.length > 0 ||
        formTiposRomaneio.length > 0 ||
        formResponsavel ||
        formTipoRomaneio;

      const jaTinhaPermissao = transfPerms.some((p) => p.username === savedUsername);

      if (temConfigTransf) {
        const filiaisOrigem = formAdvancedFiliais
          ? formFiliaisOrigem
          : formFilialPrincipal
            ? [formFilialPrincipal]
            : [];
        const filiaisDestino = formAdvancedFiliais
          ? formFiliaisDestino
          : formFilialPrincipal
            ? [formFilialPrincipal]
            : [];

        const transfPayload: TransfPerm = {
          username: savedUsername,
          filiaisOrigem,
          filiaisDestino,
          filiaisDestinoControle: formFiliaisDestinoControle,
          tiposRomaneioPermitidos: formTiposRomaneio,
          responsavelPadrao: formResponsavel || undefined,
          tipoRomaneioPadrao: formTipoRomaneio || undefined,
          responsavelFixo: formResponsavelFixo,
          tipoRomaneioFixo: formTipoRomaneioFixo,
          podeVerOutrasFiliais: formPodeVerOutras,
          filialAtribuida: formFilialPrincipal || null,
        };

        const transfRes = await fetch("/api/admin/transferencia-permissoes", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(transfPayload),
        });
        if (!transfRes.ok) {
          const d = await transfRes.json().catch(() => ({}));
          throw new Error(d.error ?? "Erro ao salvar permissões de filial");
        }
      } else if (jaTinhaPermissao) {
        const delRes = await fetch(
          `/api/admin/transferencia-permissoes?username=${encodeURIComponent(savedUsername)}`,
          { method: "DELETE", headers: authHeader() }
        );
        if (!delRes.ok) {
          const d = await delRes.json().catch(() => ({}));
          throw new Error(d.error ?? "Erro ao limpar permissões de filial");
        }
      }

      await loadAll();
      closeModal();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, username: string) {
    if (!confirm(`Remover o usuário "${username}"?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
        headers: authHeader(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao remover");
      await loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao remover");
    }
  }

  /* ── Helpers de exibição ── */
  function getFilialNome(cod: string) {
    const f = filiais.find((f) => f.codFilial === cod);
    return f ? filialOptionLabel(f) : cod;
  }

  function getUserFilial(u: UserRow) {
    const tp = transfPerms.find((p) => p.username === u.username);
    if (!tp?.filialAtribuida) return "—";
    return getFilialNome(tp.filialAtribuida);
  }

  /** Dropdown que lista usuários para copiar config. Renderizado sob o botão-gatilho. */
  function renderUserPicker(mode: "full" | "pages") {
    const term = pickerSearch.trim().toLowerCase();
    const candidatos = users
      .filter((u) => u.id !== editingId)
      .filter(
        (u) =>
          !term ||
          u.username.toLowerCase().includes(term) ||
          (u.nomeExibicao ?? "").toLowerCase().includes(term)
      );
    return (
      <div
        style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          zIndex: 50,
          width: 280,
          maxHeight: 320,
          display: "flex",
          flexDirection: "column",
          background: "var(--surface, #0f172a)",
          border: "1px solid var(--border, #334155)",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,.4)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 8, borderBottom: "1px solid var(--border, #334155)" }}>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--text-muted, #94a3b8)" }}>
            {mode === "full"
              ? "Copiar tudo (páginas, função, empresa e filial) — login e senha ficam em branco."
              : "Copiar somente as páginas liberadas deste usuário."}
          </p>
          <input
            type="text"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            placeholder="Buscar usuário..."
            autoFocus
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: 13,
              background: "var(--surface-2, #1e293b)",
              border: "1px solid var(--border, #334155)",
              borderRadius: 6,
              color: "var(--text, #e2e8f0)",
            }}
          />
        </div>
        <div style={{ overflowY: "auto" }}>
          {candidatos.length === 0 ? (
            <p style={{ padding: 12, margin: 0, fontSize: 13, color: "var(--text-muted, #94a3b8)" }}>
              Nenhum usuário encontrado.
            </p>
          ) : (
            candidatos.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => pickReferenceUser(u)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  width: "100%",
                  padding: "8px 10px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--border, #1e293b)",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--text, #e2e8f0)",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>{u.nomeExibicao || u.username}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)" }}>
                  @{u.username} · {ROLE_LABELS[u.role]} ·{" "}
                  {u.role === "admin"
                    ? "todas as páginas"
                    : `${u.permissions.length} página${u.permissions.length !== 1 ? "s" : ""}`}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  const pickerTriggerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    fontSize: 12,
    background: "var(--surface-2, #1e293b)",
    border: "1px solid var(--border, #334155)",
    borderRadius: 6,
    color: "var(--text-muted, #94a3b8)",
    cursor: "pointer",
  };

  if (!currentUser) return null;

  const groupedPermissions = buildGroupedPermissions();
  const formFiliais = filiaisForEmpresa(formEmpresa);

  return (
    <main className={styles.container}>
      {/* ── Cabeçalho ── */}
      <header className={styles.header}>
        <div>
          <Link href="/" className={styles.backLink}>
            ← Voltar à seleção
          </Link>
          <h1 className={styles.title}>Painel Admin</h1>
          <p className={styles.subtitle}>
            Gerencie usuários, permissões de páginas e filiais em um só lugar.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link
            href="/admin/filial-grupos"
            style={{
              padding: "8px 14px",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              color: "#94a3b8",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Grupos de Filiais
          </Link>
          <Link
            href="/admin/prazo-bloqueio"
            style={{
              padding: "8px 14px",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              color: "#94a3b8",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Prazo de Bloqueio
          </Link>
          <button type="button" className={styles.addButton} onClick={openAdd}>
            + Adicionar usuário
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p className={styles.loading}>Carregando...</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Função</th>
                <th>Empresa</th>
                <th>Filial Atribuída</th>
                <th>Páginas</th>
                <th className={styles.actionsCol}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className={styles.userPrimary}>
                      {u.nomeExibicao || u.username}
                    </div>
                    {u.nomeExibicao && (
                      <div className={styles.userSecondary}>@{u.username}</div>
                    )}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${u.role === "admin" ? styles.badgeAdmin : styles.badgeGestor}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td>
                    {!u.allowedCompanies?.length
                      ? "Todas"
                      : u.allowedCompanies
                          .map((c) =>
                            c === "nerd" ? "NERD" : c === "scarfme" ? "SCARF ME" : "CORPORATIVO"
                          )
                          .join(", ")}
                  </td>
                  <td>{getUserFilial(u)}</td>
                  <td className={styles.permCount}>
                    {u.role === "admin"
                      ? "Todas"
                      : u.permissions.length === 0
                        ? "Nenhuma"
                        : `${u.permissions.length} página${u.permissions.length !== 1 ? "s" : ""}`}
                  </td>
                  <td className={styles.actionsCol}>
                    <button
                      type="button"
                      className={styles.editBtn}
                      onClick={() => openEdit(u)}
                    >
                      Editar
                    </button>
                    {u.username !== currentUser.username && (
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(u.id, u.username)}
                      >
                        Remover
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal ── */}
      {modal !== "none" && (
        <div className={styles.overlay} onClick={closeModal}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className={styles.modalTitle}>
              {modal === "add" ? "Adicionar usuário" : "Editar usuário"}
            </h2>
            <form onSubmit={handleSubmit} className={styles.form}>

              {/* ── Copiar de outro usuário (só ao criar) ── */}
              {modal === "add" && (
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: -4,
                  }}
                >
                  <button
                    type="button"
                    style={pickerTriggerStyle}
                    onClick={() => setUserPicker(userPicker === "full" ? null : "full")}
                  >
                    ⧉ Usar outro usuário como referência
                  </button>
                  {userPicker === "full" && renderUserPicker("full")}
                </div>
              )}

              {/* ── Seção: Dados básicos ── */}
              <div className={styles.section}>
                <p className={styles.sectionTitle}>Dados básicos</p>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>
                    Nome de exibição
                    <input
                      type="text"
                      value={formNome}
                      onChange={(e) => setFormNome(e.target.value)}
                      className={styles.input}
                      placeholder="Ex: Maria Logística (opcional)"
                      disabled={saving}
                    />
                    <span className={styles.hint}>
                      Aparece na tabela. Se vazio, usa o login.
                    </span>
                  </label>

                  <div className={styles.row2}>
                    <label className={styles.label}>
                      Login (username)
                      <input
                        type="text"
                        value={formUsername}
                        onChange={(e) => setFormUsername(e.target.value)}
                        className={styles.input}
                        required
                        disabled={saving}
                        autoComplete="off"
                      />
                    </label>
                    <label className={styles.label}>
                      Senha {modal === "edit" && <span className={styles.hint}>(vazio = não altera)</span>}
                      <input
                        type="password"
                        value={formPassword}
                        onChange={(e) => setFormPassword(e.target.value)}
                        className={styles.input}
                        required={modal === "add"}
                        disabled={saving}
                        autoComplete="new-password"
                      />
                    </label>
                  </div>

                  <div className={styles.row2}>
                    <label className={styles.label}>
                      Função
                      <select
                        value={formRole}
                        onChange={(e) => handleRoleChange(e.target.value as RoleKey)}
                        className={styles.select}
                        disabled={saving}
                      >
                        {(Object.keys(ROLE_LABELS) as RoleKey[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.label}>
                      Empresa
                      <select
                        value={formEmpresa}
                        onChange={(e) => handleEmpresaChange(e.target.value as "" | CompanyKey)}
                        className={styles.select}
                        disabled={saving}
                      >
                        <option value="">Ambas (NERD e SCARF ME)</option>
                        <option value="nerd">Só NERD</option>
                        <option value="scarfme">Só SCARF ME</option>
                        <option value="corporativo">Só CORPORATIVO</option>
                      </select>
                    </label>
                  </div>

                  {formEmpresa === "scarfme" && (
                    <label className={styles.checkboxLabel} style={{ marginTop: 4 }}>
                      <input
                        type="checkbox"
                        checked={formSomenteVarejo}
                        onChange={(e) => setFormSomenteVarejo(e.target.checked)}
                        disabled={saving}
                      />
                      Dashboard: mostrar somente Varejo (ignora e-commerce)
                    </label>
                  )}
                </div>
              </div>

              {/* ── Seção: Cliente atacado vinculado (cliente_corporativo) ── */}
              {formRole === "cliente_corporativo" && (
                <div className={styles.section}>
                  <p className={styles.sectionTitle}>Cliente atacado vinculado (Linx)</p>
                  <p className={styles.hint} style={{ marginTop: -4, marginBottom: 8 }}>
                    Vincule este login a uma empresa já cadastrada no Linx — assim a loja reconhece o
                    endereço e a tabela de preço automaticamente. Se a empresa ainda não existe,{" "}
                    <a href="/corporativo/novo" target="_blank" rel="noreferrer" style={{ color: "var(--brand-scarfme)" }}>
                      cadastre-a primeiro
                    </a>{" "}
                    e depois volte para vincular.
                  </p>

                  {formClienteCodigo ? (
                    <div className={styles.infoNote} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <span>
                        Vinculado: <strong>{formClienteNome || "(cliente)"}</strong> · código {formClienteCodigo}
                      </span>
                      <button
                        type="button"
                        className={styles.editBtn}
                        onClick={() => { setFormClienteCodigo(""); setFormClienteNome(""); }}
                      >
                        Trocar
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="Buscar por nome, CNPJ/CPF ou código…"
                          value={clienteSearch}
                          onChange={(e) => setClienteSearch(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarClientesLinx(); } }}
                          disabled={saving}
                        />
                        <button type="button" className={styles.editBtn} onClick={buscarClientesLinx} disabled={clienteSearching}>
                          {clienteSearching ? "Buscando…" : "Buscar"}
                        </button>
                      </div>
                      {clienteResults.length > 0 && (
                        <div style={{ marginTop: 8, border: "1px solid var(--border, #334155)", borderRadius: 8, overflow: "hidden" }}>
                          {clienteResults.map((c) => (
                            <button
                              key={c.codigo}
                              type="button"
                              onClick={() => vincularCliente(c)}
                              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "8px 10px", background: "transparent", border: "none", borderBottom: "1px solid var(--border, #1e293b)", cursor: "pointer", textAlign: "left", color: "var(--text, #e2e8f0)" }}
                            >
                              <span style={{ fontSize: 13, fontWeight: 600 }}>{c.razaoSocial || c.nomeClifor}</span>
                              <span style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)" }}>
                                cód {c.codigo} · {c.cpfCnpj} · {[c.cidade, c.uf].filter(Boolean).join("/")}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Seção: Páginas (agrupadas e recolhíveis) ── */}
              {formRole !== "admin" && formRole !== "cliente_corporativo" && (
                <div className={styles.section}>
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <p className={styles.sectionTitle} style={{ margin: 0 }}>
                      Páginas que pode acessar
                    </p>
                    <button
                      type="button"
                      style={pickerTriggerStyle}
                      onClick={() => setUserPicker(userPicker === "pages" ? null : "pages")}
                      title="Copiar as páginas liberadas de outro usuário"
                    >
                      ⧉ Importar de outro usuário
                    </button>
                    {userPicker === "pages" && renderUserPicker("pages")}
                  </div>
                  <div className={styles.permGroups}>
                    {groupedPermissions.map((group) => {
                      // Esconde permissoes restritas por funcao que nao se aplicam
                      // a funcao selecionada (ex: extrato-produto some para gestor).
                      const items = group.items.filter((i) => roleAllowsPermission(formRole, i.key));
                      if (items.length === 0) return null;
                      const groupKeys = items.map((i) => i.key);
                      const selectedCount = groupKeys.filter((k) => formPermissions.includes(k)).length;
                      const allSelected = selectedCount === groupKeys.length;
                      const collapsed = collapsedGroups.has(group.label);
                      return (
                        <div key={group.label} className={styles.permGroup}>
                          <button
                            type="button"
                            className={styles.permGroupHeader}
                            onClick={() => toggleGroup(group.label)}
                          >
                            <span className={styles.permGroupChevron}>{collapsed ? "▸" : "▾"}</span>
                            <span className={styles.permGroupTitle}>{group.label}</span>
                            <span className={styles.permGroupCount}>
                              {selectedCount}/{groupKeys.length}
                            </span>
                          </button>
                          {!collapsed && (
                            <div className={styles.permGroupBody}>
                              <button
                                type="button"
                                className={styles.selectAll}
                                onClick={() => toggleGroupAll(groupKeys, allSelected)}
                              >
                                {allSelected ? "Desmarcar todos" : "Marcar todos"}
                              </button>
                              <div className={styles.permGroupGrid}>
                                {items.map(({ key, label }) => (
                                  <label key={key} className={styles.checkboxLabel}>
                                    <input
                                      type="checkbox"
                                      checked={formPermissions.includes(key)}
                                      onChange={() => togglePermission(key)}
                                      disabled={saving}
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Seção: Filial e operações ── */}
              {formRole !== "cliente_corporativo" && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>Filial e operações</p>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>
                    Filial atribuída
                    <select
                      value={formFilialPrincipal}
                      onChange={(e) => handleFilialPrincipalChange(e.target.value)}
                      className={styles.select}
                      disabled={saving}
                    >
                      <option value="">Nenhuma — somente visualização</option>
                      {formFiliais.map((f) => (
                        <option key={f.codFilial} value={f.codFilial}>
                          {filialOptionLabel(f)}
                        </option>
                      ))}
                    </select>
                    <span className={styles.hint}>
                      {formEmpresa === ""
                        ? "Mostrando filiais das duas empresas — selecione a empresa acima para filtrar."
                        : "Filial onde o usuário executa saídas/entradas e que filtra os romaneios."}
                    </span>
                  </label>

                  {formFilialPrincipal ? (
                    <div className={styles.radioGroup}>
                      <label className={styles.radioLabel}>
                        <input
                          type="radio"
                          name="verFiliais"
                          checked={!formPodeVerOutras}
                          onChange={() => setFormPodeVerOutras(false)}
                          disabled={saving}
                        />
                        <span>Vê e opera <strong>somente nesta filial</strong></span>
                      </label>
                      <label className={styles.radioLabel}>
                        <input
                          type="radio"
                          name="verFiliais"
                          checked={formPodeVerOutras}
                          onChange={() => setFormPodeVerOutras(true)}
                          disabled={saving}
                        />
                        <span>Vê <strong>todas as filiais</strong> da empresa, mas opera só nesta</span>
                      </label>
                    </div>
                  ) : (
                    <div className={styles.infoNote}>
                      Sem filial atribuída o usuário <strong>vê o quadro completo</strong> de
                      transferências, mas <strong>não executa</strong> saídas nem entradas (somente leitura).
                    </div>
                  )}

                  {/* Toggle avançado */}
                  <button
                    type="button"
                    className={styles.advancedToggle}
                    onClick={() => {
                      setFormAdvancedFiliais(!formAdvancedFiliais);
                      if (!formAdvancedFiliais) {
                        // Ao abrir avançado: pré-preenche com a filial principal
                        if (formFilialPrincipal && formFiliaisOrigem.length === 0) {
                          setFormFiliaisOrigem([formFilialPrincipal]);
                          setFormFiliaisDestino([formFilialPrincipal]);
                        }
                      }
                    }}
                  >
                    {formAdvancedFiliais ? "▲" : "▼"}{" "}
                    Configuração avançada de filiais e romaneio
                  </button>

                  {formAdvancedFiliais && (
                    <>
                      {/* ── Bloco: Saídas e Entradas diretas ── */}
                      <p className={styles.subSectionTitle}>Saídas / Entradas diretas</p>

                      <label className={styles.label}>
                        Filiais de saída permitidas
                        <span className={styles.hint}>
                          Vazio = todas. O usuário só pode lançar saída dessas filiais.
                        </span>
                        <button
                          type="button"
                          className={styles.selectAll}
                          onClick={() => {
                            const all = formFiliais.length > 0 && formFiliaisOrigem.length === formFiliais.length;
                            setFormFiliaisOrigem(all ? [] : formFiliais.map((f) => f.codFilial));
                          }}
                        >
                          {formFiliais.length > 0 && formFiliaisOrigem.length === formFiliais.length
                            ? "Desmarcar tudo"
                            : "Selecionar tudo"}
                        </button>
                        <div className={styles.checkboxList}>
                          {formFiliais.map((f) => (
                            <label key={f.codFilial} className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={formFiliaisOrigem.includes(f.codFilial)}
                                onChange={() =>
                                  setFormFiliaisOrigem((prev) =>
                                    prev.includes(f.codFilial)
                                      ? prev.filter((x) => x !== f.codFilial)
                                      : [...prev, f.codFilial]
                                  )
                                }
                                disabled={saving}
                              />
                              {filialOptionLabel(f)}
                            </label>
                          ))}
                        </div>
                      </label>

                      <label className={styles.label}>
                        Filiais de entrada permitidas
                        <span className={styles.hint}>
                          Vazio = todas. O usuário só pode lançar entrada nessas filiais.
                        </span>
                        <div className={styles.checkboxList}>
                          {formFiliais.map((f) => (
                            <label key={f.codFilial} className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={formFiliaisDestino.includes(f.codFilial)}
                                onChange={() =>
                                  setFormFiliaisDestino((prev) =>
                                    prev.includes(f.codFilial)
                                      ? prev.filter((x) => x !== f.codFilial)
                                      : [...prev, f.codFilial]
                                  )
                                }
                                disabled={saving}
                              />
                              {filialOptionLabel(f)}
                            </label>
                          ))}
                        </div>
                      </label>

                      {/* ── Bloco: Controle de Transferências ── */}
                      <p className={styles.subSectionTitle}>Controle de Transferências</p>

                      <label className={styles.label}>
                        Filiais destino visíveis
                        <span className={styles.hint}>
                          Quais outras filiais da mesma empresa aparecem como destino sugerido.
                          Vazio = todas. Ex: Guarulhos vê todas as outras SCARF ME como destino possível.
                        </span>
                        <button
                          type="button"
                          className={styles.selectAll}
                          onClick={() => {
                            const all = formFiliais.length > 0 && formFiliaisDestinoControle.length === formFiliais.length;
                            setFormFiliaisDestinoControle(all ? [] : formFiliais.map((f) => f.codFilial));
                          }}
                        >
                          {formFiliais.length > 0 && formFiliaisDestinoControle.length === formFiliais.length
                            ? "Desmarcar tudo"
                            : "Selecionar tudo"}
                        </button>
                        <div className={styles.checkboxList}>
                          {formFiliais.map((f) => (
                            <label key={f.codFilial} className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={formFiliaisDestinoControle.includes(f.codFilial)}
                                onChange={() =>
                                  setFormFiliaisDestinoControle((prev) =>
                                    prev.includes(f.codFilial)
                                      ? prev.filter((x) => x !== f.codFilial)
                                      : [...prev, f.codFilial]
                                  )
                                }
                                disabled={saving}
                              />
                              {getFilialLabel(f.filial)}
                            </label>
                          ))}
                        </div>
                      </label>

                      <label className={styles.checkboxLabel} style={{ marginBottom: 8 }}>
                        <input
                          type="checkbox"
                          checked={formPodeVerOutras}
                          onChange={(e) => setFormPodeVerOutras(e.target.checked)}
                          disabled={saving}
                        />
                        Pode ver todas as filiais da empresa (ignora os filtros de visualização acima)
                      </label>

                      {/* ── Bloco: Romaneio ── */}
                      <p className={styles.subSectionTitle}>Romaneio</p>

                      <label className={styles.label}>
                        Tipos de romaneio permitidos
                        <span className={styles.hint}>Vazio = todos os tipos.</span>
                        <div className={styles.checkboxList}>
                          {tiposRomaneio.map((tipo) => (
                            <label key={tipo} className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={formTiposRomaneio.includes(tipo)}
                                onChange={() =>
                                  setFormTiposRomaneio((prev) =>
                                    prev.includes(tipo)
                                      ? prev.filter((t) => t !== tipo)
                                      : [...prev, tipo]
                                  )
                                }
                                disabled={saving}
                              />
                              {tipo}
                            </label>
                          ))}
                        </div>
                      </label>

                      <div className={styles.row2}>
                        <label className={styles.label}>
                          Responsável padrão
                          <input
                            type="text"
                            list="responsaveis-list"
                            className={styles.input}
                            value={formResponsavel}
                            onChange={(e) => setFormResponsavel(e.target.value.toUpperCase())}
                            placeholder="Ex: LOGISTICA"
                            disabled={saving}
                          />
                          <datalist id="responsaveis-list">
                            {responsaveis.map((r) => (
                              <option key={r} value={r} />
                            ))}
                          </datalist>
                        </label>
                        <label className={styles.label}>
                          Tipo de romaneio padrão
                          <input
                            type="text"
                            list="tipos-list"
                            className={styles.input}
                            value={formTipoRomaneio}
                            onChange={(e) => setFormTipoRomaneio(e.target.value.toUpperCase())}
                            placeholder="Ex: TRANSFERENCIA"
                            disabled={saving}
                          />
                          <datalist id="tipos-list">
                            {tiposRomaneio.map((t) => (
                              <option key={t} value={t} />
                            ))}
                          </datalist>
                        </label>
                      </div>

                      <div className={styles.fieldGroup} style={{ gap: 8 }}>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={formResponsavelFixo}
                            onChange={(e) => setFormResponsavelFixo(e.target.checked)}
                            disabled={saving}
                          />
                          Responsável fixo (não pode alterar)
                        </label>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={formTipoRomaneioFixo}
                            onChange={(e) => setFormTipoRomaneioFixo(e.target.checked)}
                            disabled={saving}
                          />
                          Tipo de romaneio fixo (não pode alterar)
                        </label>
                      </div>
                    </>
                  )}
                </div>
              </div>
              )}

              {formError && <p className={styles.formError}>{formError}</p>}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={styles.saveBtn}
                  disabled={saving}
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
