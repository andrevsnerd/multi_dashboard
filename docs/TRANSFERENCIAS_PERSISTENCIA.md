# Persistência de Dados - Controle de Transferências

> **📋 RESUMO RÁPIDO:** Veja `TRANSFERENCIAS_PASSOS.md` para passos diretos ao ponto.

## 🔒 Garantia de Persistência

Os dados de **transferências realizadas** (marcadas como feitas) agora são salvos de forma segura e persistente, mesmo após novos deploys.

## 📊 Como Funciona

### Estratégia de Armazenamento

1. **Neon (PostgreSQL)** - Fonte principal
   - Dados permanentes e seguros
   - Criado automaticamente na primeira execução
   - Tabela: `transferencias_realizadas`

2. **Redis/KV** - Redundância e fallback
   - Mantido como backup
   - Migração automática do Redis para Neon na primeira leitura

### Fluxo de Dados

#### Ao Ler:
1. Tenta ler do Neon primeiro
2. Se não encontrar, tenta Redis
3. Se encontrar no Redis, migra automaticamente para Neon
4. Retorna todos os dados encontrados

#### Ao Escrever:
1. Salva no Neon (fonte principal)
2. Também salva no Redis (redundância)
3. Faz **merge** - adiciona novos itens sem perder os existentes

## ✅ Proteções Implementadas

### 1. Não Perde Dados ao Trocar de Filial
- Antes: Ao trocar de filial, apenas itens visíveis eram salvos, perdendo os outros
- Agora: Todos os dados são preservados, mesmo itens que não estão mais visíveis

### 2. Não Perde Dados em Novos Deploys
- Dados estão no Neon (banco permanente)
- Redis é apenas redundância
- Migração automática garante que dados antigos não sejam perdidos

### 3. Merge Inteligente
- Ao marcar/desmarcar um item, apenas esse item é alterado
- Outros dados permanecem intactos
- Não há risco de sobrescrever dados acidentalmente

## 🔧 APIs Disponíveis

### GET `/api/transferencias-realizadas?company={companyKey}`
Lê todas as transferências realizadas para uma empresa.

**Resposta:**
```json
{
  "markedKeys": ["produto1|cor1|origem1|destino1", "produto2|cor2|origem2|destino2"]
}
```

### POST `/api/transferencias-realizadas`
Salva transferências realizadas (faz merge).

**Body:**
```json
{
  "companyKey": "nerd",
  "markedKeys": ["item1", "item2"],  // Itens a adicionar
  "removeKeys": ["item3"]            // Itens a remover (opcional)
}
```

### GET `/api/transferencias-realizadas/export?company={companyKey}`
Exporta todos os dados salvos em formato JSON (backup).

**Resposta:**
```json
{
  "companyKey": "nerd",
  "exportDate": "2026-02-05T10:30:00.000Z",
  "totalItems": 15,
  "markedKeys": ["item1", "item2", ...]
}
```

### POST `/api/transferencias-realizadas/migrate`
Migra dados do Redis para Neon (útil para migração manual).

**Body:**
```json
{
  "companyKey": "nerd",
  "force": false  // Se true, migra mesmo que já existam dados no Neon
}
```

## 📥 Como Fazer Backup

### Opção 1: Via API (Recomendado)
```bash
curl "https://seu-dominio.com/api/transferencias-realizadas/export?company=nerd" > backup.json
```

### Opção 2: Via Navegador
Acesse: `https://seu-dominio.com/api/transferencias-realizadas/export?company=nerd`
O arquivo JSON será baixado automaticamente.

## 🔄 Migração de Dados Antigos

Se você tinha dados salvos antes desta atualização e eles não aparecem:

1. **Verificar se ainda estão no Redis:**
   - Os dados antigos podem estar apenas no Redis
   - A migração automática deve funcionar na próxima leitura

2. **Migração Manual (se necessário):**
   ```bash
   curl -X POST "https://seu-dominio.com/api/transferencias-realizadas/migrate" \
     -H "Content-Type: application/json" \
     -d '{"companyKey": "nerd", "force": false}'
   ```

## 🗄️ Estrutura do Banco de Dados

### Tabela: `transferencias_realizadas`

```sql
CREATE TABLE transferencias_realizadas (
  company_key TEXT NOT NULL,
  item_key TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (company_key, item_key)
);
```

- `company_key`: Chave da empresa (ex: "nerd", "scarfme")
- `item_key`: Chave do item no formato `produto|cor|origem|destino`
- `created_at`: Data de criação do registro

## ⚠️ Troubleshooting

### Dados não aparecem após deploy

1. Verifique se o Neon está configurado:
   - Variável `DATABASE_URL` ou `POSTGRES_URL` deve estar definida
   - Verifique os logs do servidor

2. Execute migração manual:
   ```bash
   POST /api/transferencias-realizadas/migrate
   ```

3. Verifique se há dados no Redis:
   - Se houver, a migração automática deve funcionar

### Erro ao salvar

- Verifique logs do servidor
- Confirme que Neon está configurado corretamente
- Redis é opcional (apenas redundância)

## 📝 Notas Importantes

- **Dados são preservados permanentemente** no Neon
- **Redis é redundância** - se falhar, dados ainda estão seguros
- **Migração automática** garante que dados antigos não sejam perdidos
- **Merge inteligente** evita sobrescrever dados acidentalmente
- **Exportação** permite backup manual quando necessário
