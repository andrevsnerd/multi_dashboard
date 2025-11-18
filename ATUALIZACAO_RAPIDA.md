# ⚡ Guia Rápido de Atualização

## 🎯 Para quando você já está acostumado

### **1. Testar Build** ✅
```bash
npm run build
```

### **2. Commit e Push** 📤
```bash
git add .
git commit -m "Sua descrição aqui"
git push
```

### **3. Verificar Proxy e Ngrok** 🔄
- ✅ Proxy rodando na porta 3001?
- ✅ Ngrok rodando e expondo porta 3001?

### **4. Atualizar Vercel (se necessário)** 🔧
- Se ngrok reiniciou → Atualizar `PROXY_URL` no Vercel
- Acesse: https://vercel.com → Settings → Environment Variables

### **5. Aguardar Deploy** ⏳
- Vercel faz deploy automaticamente após o push
- Verifique em: https://vercel.com → Deployments

### **6. Testar** ✅
- Acesse a URL do app no Vercel
- Verifique se está funcionando

---

## ⚠️ Se algo der errado:

- **Erro 401**: Verificar `PROXY_SECRET` no Vercel
- **Erro de conexão**: Verificar se proxy e ngrok estão rodando
- **Build falhou**: Corrigir erros localmente primeiro (`npm run build`)

---

**Veja o guia completo em `GUIA_ATUALIZACAO.md` para mais detalhes!** 📖

