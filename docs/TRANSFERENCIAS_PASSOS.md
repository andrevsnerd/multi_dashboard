# Passos - Recuperar Dados de Transferências

## ✅ O QUE JÁ FOI FEITO
- Sistema agora salva no Neon (banco permanente)
- Migração automática do Redis para Neon
- Dados não serão mais perdidos em deploys

## 📋 O QUE VOCÊ PRECISA FAZER

### 1. Verificar se os dados aparecem
- Abra a página de Controle de Transferências
- Se seus dados aparecerem → **PRONTO, nada mais a fazer**

### 2. Se os dados NÃO aparecerem
Execute migração manual:

**Opção A - Via navegador (mais fácil):**
1. Abra o console do navegador (F12)
2. Cole e execute:
```javascript
fetch('/api/transferencias-realizadas/migrate', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({companyKey: 'nerd'})
}).then(r => r.json()).then(console.log)
```

**Opção B - Via terminal:**
```bash
curl -X POST "https://seu-dominio.com/api/transferencias-realizadas/migrate" \
  -H "Content-Type: application/json" \
  -d '{"companyKey": "nerd"}'
```

### 3. Fazer backup (opcional)
Acesse no navegador:
```
https://seu-dominio.com/api/transferencias-realizadas/export?company=nerd
```
O arquivo JSON será baixado automaticamente.

## ⚠️ SE AINDA NÃO FUNCIONAR
- Verifique se `DATABASE_URL` está configurada no Vercel
- Verifique logs do servidor para erros
- Os dados antigos podem ter sido perdidos antes desta atualização
