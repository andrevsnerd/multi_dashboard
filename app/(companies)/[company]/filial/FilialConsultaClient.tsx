"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./FilialPage.module.css";
import type { FilialDetalhada } from "@/lib/repositories/filiais";

const TODAS = "__todas__";

function digits(v: string): string {
  return (v || "").replace(/\D/g, "");
}

function formatCnpj(v: string): string {
  const d = digits(v);
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return v || "—";
}

function formatCep(v: string): string {
  const d = digits(v);
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return v || "—";
}

function formatPhone(ddd: string, num: string): string {
  const d = digits(ddd);
  const n = digits(num);
  if (!n) return "";
  const numFmt =
    n.length === 9 ? `${n.slice(0, 5)}-${n.slice(5)}`
      : n.length === 8 ? `${n.slice(0, 4)}-${n.slice(4)}`
        : n;
  return d ? `(${d}) ${numFmt}` : numFmt;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function val(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return t.length ? t : "—";
}

interface EmpresaGroup {
  key: string;
  cod: number | null;
  nome: string;
  label: string;
  filiais: FilialDetalhada[];
}

export default function FilialConsultaClient() {
  const [filiais, setFiliais] = useState<FilialDetalhada[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [empresaFilter, setEmpresaFilter] = useState<string>(TODAS);
  const [regiaoFilter, setRegiaoFilter] = useState<string>(TODAS);
  const [ufFilter, setUfFilter] = useState<string>(TODAS);
  const [tipoFilter, setTipoFilter] = useState<string>(TODAS);

  const [selectedCod, setSelectedCod] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/filiais");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro ao carregar filiais");
        if (!cancelled) setFiliais(data.data ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Opções de filtros
  const empresaOptions = useMemo(() => {
    const map = new Map<string, { cod: number | null; nome: string; count: number }>();
    for (const f of filiais) {
      const key = String(f.empresaCod ?? f.empresaNome);
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else map.set(key, { cod: f.empresaCod, nome: f.empresaNome, count: 1 });
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => (a.cod ?? 9999) - (b.cod ?? 9999));
  }, [filiais]);

  const regiaoOptions = useMemo(
    () => Array.from(new Set(filiais.map((f) => f.regiao).filter(Boolean))).sort(),
    [filiais]
  );
  const ufOptions = useMemo(
    () => Array.from(new Set(filiais.map((f) => f.uf).filter(Boolean))).sort(),
    [filiais]
  );
  const tipoOptions = useMemo(
    () => Array.from(new Set(filiais.map((f) => f.tipoFilial).filter(Boolean))).sort(),
    [filiais]
  );

  // Filtragem
  const filtered = useMemo(() => {
    const term = search
      .trim()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    const termDigits = digits(search);

    return filiais.filter((f) => {
      if (empresaFilter !== TODAS && String(f.empresaCod ?? f.empresaNome) !== empresaFilter) return false;
      if (regiaoFilter !== TODAS && f.regiao !== regiaoFilter) return false;
      if (ufFilter !== TODAS && f.uf !== ufFilter) return false;
      if (tipoFilter !== TODAS && f.tipoFilial !== tipoFilter) return false;

      if (term) {
        const haystack = `${f.filial} ${f.razaoSocial} ${f.empresaNome} ${f.cidade}`
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase();
        const matchText = haystack.includes(term);
        const matchCnpj = termDigits.length >= 3 && digits(f.cnpj).includes(termDigits);
        if (!matchText && !matchCnpj) return false;
      }
      return true;
    });
  }, [filiais, search, empresaFilter, regiaoFilter, ufFilter, tipoFilter]);

  // Agrupamento por empresa
  const groups = useMemo<EmpresaGroup[]>(() => {
    const map = new Map<string, EmpresaGroup>();
    for (const f of filtered) {
      const key = String(f.empresaCod ?? f.empresaNome);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          cod: f.empresaCod,
          nome: f.empresaNome,
          label: `${f.empresaCod != null ? `${f.empresaCod} - ` : ""}${f.empresaNome || "Sem empresa"}`,
          filiais: [],
        };
        map.set(key, g);
      }
      g.filiais.push(f);
    }
    return Array.from(map.values()).sort((a, b) => (a.cod ?? 9999) - (b.cod ?? 9999));
  }, [filtered]);

  const selected = useMemo(
    () => filiais.find((f) => f.codFilial === selectedCod) ?? null,
    [filiais, selectedCod]
  );

  const hasFilters =
    search.trim() !== "" ||
    empresaFilter !== TODAS ||
    regiaoFilter !== TODAS ||
    ufFilter !== TODAS ||
    tipoFilter !== TODAS;

  // Expande automaticamente quando há busca/filtro ativo ou poucos grupos
  const isExpanded = (key: string) => {
    if (key in expanded) return expanded[key];
    if (hasFilters) return true;
    return groups.length <= 1;
  };

  function toggleGroup(key: string) {
    setExpanded((s) => ({ ...s, [key]: !isExpanded(key) }));
  }

  function clearFilters() {
    setSearch("");
    setEmpresaFilter(TODAS);
    setRegiaoFilter(TODAS);
    setUfFilter(TODAS);
    setTipoFilter(TODAS);
  }

  async function copyCnpj() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(formatCnpj(selected.cnpj));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }

  const telefone1 = selected ? formatPhone(selected.ddd1, selected.telefone1) : "";
  const telefone2 = selected ? formatPhone(selected.ddd2, selected.telefone2) : "";
  const faxFmt = selected ? formatPhone(selected.dddFax, selected.fax) : "";

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Filiais</h1>
          <p className={styles.subtitle}>
            Consulte filiais por grupo (empresa), veja a que grupo cada uma pertence e todos os dados
            fiscais, de endereço e contato.
          </p>
        </div>
        {!loading && !error && (
          <div className={styles.headerStats}>
            <span className={styles.statPill}>{filiais.length} filiais</span>
            <span className={styles.statPill}>{empresaOptions.length} grupos</span>
          </div>
        )}
      </header>

      {/* Filtros */}
      <section className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <input
            type="search"
            className={styles.search}
            placeholder="Buscar por nome, razão social, cidade ou CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className={styles.select}
          value={empresaFilter}
          onChange={(e) => setEmpresaFilter(e.target.value)}
          aria-label="Filtrar por grupo (empresa)"
        >
          <option value={TODAS}>Todos os grupos</option>
          {empresaOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.cod != null ? `${o.cod} - ` : ""}
              {o.nome} ({o.count})
            </option>
          ))}
        </select>

        <select className={styles.select} value={regiaoFilter} onChange={(e) => setRegiaoFilter(e.target.value)} aria-label="Filtrar por região">
          <option value={TODAS}>Todas as regiões</option>
          {regiaoOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        <select className={styles.select} value={ufFilter} onChange={(e) => setUfFilter(e.target.value)} aria-label="Filtrar por UF">
          <option value={TODAS}>Todas as UFs</option>
          {ufOptions.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>

        <select className={styles.select} value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)} aria-label="Filtrar por tipo de filial">
          <option value={TODAS}>Todos os tipos</option>
          {tipoOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {hasFilters && (
          <button type="button" className={styles.clearBtn} onClick={clearFilters}>
            Limpar
          </button>
        )}
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>Carregando filiais...</div>
      ) : (
        <div className={styles.layout}>
          {/* Lista mestre */}
          <aside className={styles.listPanel}>
            <div className={styles.listMeta}>
              {filtered.length} {filtered.length === 1 ? "filial" : "filiais"}
              {hasFilters ? " (filtradas)" : ""}
            </div>

            {groups.length === 0 ? (
              <div className={styles.empty}>Nenhuma filial encontrada.</div>
            ) : (
              groups.map((g) => {
                const open = isExpanded(g.key);
                return (
                  <div key={g.key} className={styles.group}>
                    <button type="button" className={styles.groupHeader} onClick={() => toggleGroup(g.key)} aria-expanded={open}>
                      <span className={styles.groupTitle}>
                        {g.cod != null && <span className={styles.groupCod}>{g.cod}</span>}
                        {g.nome || "Sem empresa"}
                      </span>
                      <span className={styles.groupCount}>{g.filiais.length}</span>
                    </button>
                    {open && (
                      <div className={styles.groupItems}>
                        {g.filiais.map((f) => (
                          <button
                            key={f.codFilial}
                            type="button"
                            className={`${styles.filialItem} ${selectedCod === f.codFilial ? styles.filialItemActive : ""}`}
                            onClick={() => setSelectedCod(f.codFilial)}
                          >
                            <span className={styles.filialName}>{f.filial}</span>
                            <span className={styles.filialMeta}>
                              {f.codFilial}
                              {f.cidade ? ` · ${f.cidade}/${f.uf}` : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </aside>

          {/* Detalhe */}
          <section className={styles.detailPanel}>
            {!selected ? (
              <div className={styles.detailEmpty}>
                <p>Selecione uma filial na lista para ver os detalhes.</p>
              </div>
            ) : (
              <div className={styles.detail}>
                <div className={styles.detailHead}>
                  <div>
                    <div className={styles.detailGroupBadge}>
                      {selected.empresaCod != null ? `${selected.empresaCod} · ` : ""}
                      {selected.empresaNome || "Sem grupo"}
                    </div>
                    <h2 className={styles.detailTitle}>{selected.filial}</h2>
                    <div className={styles.detailSub}>
                      Código {selected.codFilial}
                      {selected.tipoFilial ? ` · ${selected.tipoFilial}` : ""}
                    </div>
                  </div>
                  <span className={`${styles.statusBadge} ${selected.dataFechamento || selected.inativo ? styles.statusClosed : styles.statusOpen}`}>
                    {selected.dataFechamento || selected.inativo ? "Inativa" : "Ativa"}
                  </span>
                </div>

                <div className={styles.cards}>
                  <Card title="Identificação">
                    <Field label="Razão Social" value={val(selected.razaoSocial)} wide />
                    <div className={styles.cnpjField}>
                      <Field label="CNPJ" value={formatCnpj(selected.cnpj)} />
                      {digits(selected.cnpj).length >= 11 && (
                        <button type="button" className={styles.copyBtn} onClick={copyCnpj}>
                          {copied ? "Copiado!" : "Copiar"}
                        </button>
                      )}
                    </div>
                    <Field label="Grupo / Empresa" value={`${selected.empresaCod != null ? `${selected.empresaCod} - ` : ""}${val(selected.empresaNome)}`} />
                    <Field label="Matriz Fiscal" value={val(selected.matrizFiscal)} />
                    <Field label="Matriz" value={val(selected.matriz)} />
                  </Card>

                  <Card title="Fiscal">
                    <Field label="Inscrição Estadual" value={val(selected.inscricaoEstadual)} />
                    <Field label="Inscrição Municipal" value={val(selected.inscricaoMunicipal)} />
                    <Field label="CNAE" value={val(selected.cnae)} />
                    <Field label="Tipo de Tributação" value={val(selected.tipoTributacao)} />
                    <Field label="Código SPC" value={val(selected.codigoSpc)} />
                    <Field label="Data de Cadastro" value={formatDate(selected.cadastro)} />
                  </Card>

                  <Card title="Endereço">
                    <Field label="Logradouro" value={val(selected.endereco)} wide />
                    <Field label="Número" value={val(selected.numero)} />
                    <Field label="Complemento" value={val(selected.complemento)} />
                    <Field label="Bairro" value={val(selected.bairro)} />
                    <Field label="Cidade" value={selected.cidade ? `${selected.cidade}${selected.uf ? `/${selected.uf}` : ""}` : "—"} />
                    <Field label="CEP" value={formatCep(selected.cep)} />
                    <Field label="Cód. IBGE" value={val(selected.ibge)} />
                    <Field label="País" value={val(selected.pais)} />
                  </Card>

                  <Card title="Contato">
                    <Field label="E-mail" value={val(selected.email)} wide />
                    <Field label="E-mail NFe" value={val(selected.emailNfe)} wide />
                    <Field label="Telefone" value={telefone1 || "—"} />
                    <Field label="Telefone 2" value={telefone2 || "—"} />
                    <Field label="Fax" value={faxFmt || "—"} />
                    <Field label="DDI" value={val(selected.ddi)} />
                    <Field label="Responsável" value={val(selected.nomeResponsavel)} />
                  </Card>

                  <Card title="Operacional">
                    <Field label="Tipo de Filial" value={val(selected.tipoFilial)} />
                    <Field label="Filial Própria" value={selected.filialPropria ? "Sim" : "Não"} />
                    <Field label="Região" value={val(selected.regiao)} />
                    <Field label="Filial Espelho" value={val(selected.filialEspelho)} />
                    <Field label="Fator Espelho" value={selected.fatorFilialEspelho != null ? String(selected.fatorFilialEspelho) : "—"} />
                    <Field label="Data de Abertura" value={formatDate(selected.dataAbertura)} />
                    <Field label="Data de Fechamento" value={formatDate(selected.dataFechamento)} />
                  </Card>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{title}</div>
      <div className={styles.cardBody}>{children}</div>
    </div>
  );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`${styles.field} ${wide ? styles.fieldWide : ""}`}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value}</span>
    </div>
  );
}
