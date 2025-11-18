# 📝 Variáveis de Ambiente para Deploy

**⚠️ IMPORTANTE**: Este arquivo contém apenas exemplos. As senhas reais devem ser configuradas no Vercel!

## Variáveis de Ambiente Necessárias

Use estas informações ao configurar no Vercel:

```
DB_SERVER=189.126.197.82
DB_DATABASE=LINX_PRODUCAO
DB_USERNAME=andre.nerd
DB_PASSWORD=nerd123@
DB_PORT=1433
```

## Como Configurar no Vercel

1. Acesse seu projeto no Vercel
2. Vá em **Settings** → **Environment Variables**
3. Adicione cada variável acima
4. Marque todos os ambientes: **Production**, **Preview**, **Development**
5. Clique em **Save**
6. Faça um novo deploy para aplicar as mudanças

## Segurança

⚠️ **NUNCA** commite arquivos `.env` ou `.env.local` com senhas reais no Git!

O arquivo `.gitignore` já está configurado para ignorar arquivos `.env*`.

