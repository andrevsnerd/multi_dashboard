# Produção: função Gestor e usuários

## O que é a função Gestor

- **Gestor** = mesmas visualizações que Administrador, **exceto** o painel Admin de usuários.
- Quem é **admin** continua vendo o menu "Admin" e gerenciando usuários.
- Quem é **gestor** vê Dashboard, Produtos, Vendedores, Clientes, Controle de Estoque/Giro/Transferências, Exportar Relatórios — sem o link "Admin".

## 1. Deploy do código

Faça o deploy normalmente (push para o repositório / Vercel). O código já inclui o role `gestor`.

## 2. Banco Neon (PostgreSQL)

Se a tabela `dashboard_users` **já existia** antes desta alteração, o `CHECK` da coluna `role` só permite `'admin'` e `'logistica'`. É preciso permitir `'gestor'`.

### 2.1 Descobrir o nome da constraint (se precisar)

No Neon SQL Editor ou em qualquer cliente PostgreSQL:

```sql
SELECT conname
FROM pg_constraint
WHERE conrelid = 'dashboard_users'::regclass
  AND contype = 'c';
```

Anote o nome da constraint da coluna `role` (costuma ser `dashboard_users_role_check`).

### 2.2 Atualizar a constraint

Substitua `dashboard_users_role_check` pelo nome correto, se for diferente:

```sql
ALTER TABLE dashboard_users
  DROP CONSTRAINT dashboard_users_role_check;

ALTER TABLE dashboard_users
  ADD CONSTRAINT dashboard_users_role_check
  CHECK (role IN ('admin', 'gestor', 'logistica'));
```

Se a tabela foi criada **depois** do deploy com o novo código, ela já nasce com esse `CHECK` e este passo não é necessário.

## 3. Atribuir a função Gestor aos usuários

Usuários que passam a ser **Gestor** (mesmas telas do admin, sem painel de usuários):

- ed  
- karina  
- matheus  
- cilton  
- nayara  

No Neon SQL Editor (ou cliente PostgreSQL conectado ao banco de produção):

```sql
UPDATE dashboard_users
SET role = 'gestor',
    permissions = '[]'::jsonb
WHERE LOWER(username) IN ('ed', 'karina', 'matheus', 'cilton', 'nayara');
```

Confirme a quantidade de linhas afetadas (deve ser 5). Para conferir:

```sql
SELECT id, username, role, permissions
FROM dashboard_users
WHERE LOWER(username) IN ('ed', 'karina', 'matheus', 'cilton', 'nayara');
```

Todos devem aparecer com `role = 'gestor'` e `permissions = []`.

## Resumo

1. Deploy do código (Vercel/repo).  
2. No Neon: atualizar o `CHECK` da coluna `role` para incluir `'gestor'` (se a tabela já existia).  
3. No Neon: `UPDATE dashboard_users SET role = 'gestor', permissions = '[]'::jsonb WHERE LOWER(username) IN ('ed', 'karina', 'matheus', 'cilton', 'nayara');`  
4. Usuários ed, karina, matheus, cilton e nayara passam a ter a nova função e não verão mais o menu "Admin".
