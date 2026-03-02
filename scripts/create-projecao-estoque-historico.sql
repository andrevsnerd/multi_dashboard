-- Tabela para histórico de projeção de estoque (snapshots) em Postgres/Neon
-- Rode este script diretamente no Neon ou em qualquer banco PostgreSQL.

CREATE TABLE IF NOT EXISTS projecao_estoque_historico (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  company TEXT NOT NULL,
  filial TEXT NULL,
  categoria TEXT NOT NULL,
  linha TEXT NULL,
  subgrupo TEXT NULL,
  grade TEXT NULL,
  colecao TEXT NULL,
  ano INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  vendas_projetada INTEGER NOT NULL,
  vendas_real INTEGER NULL,
  estoque_projetado INTEGER NOT NULL,
  estoque_real INTEGER NULL,
  duracao_projetada INTEGER NOT NULL,
  duracao_real INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projecao_estoque_hist_snapshot_company
  ON projecao_estoque_historico (snapshot_date, company, filial);

CREATE INDEX IF NOT EXISTS idx_projecao_estoque_hist_company_categoria
  ON projecao_estoque_historico (company, categoria, snapshot_date);
