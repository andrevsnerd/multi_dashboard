# Configuração de Firewall para Permitir Conexões da Vercel ao SQL Server

## 📋 O que o TI precisa fazer

### 1. **Problema com IPs da Vercel**

⚠️ **IMPORTANTE**: A Vercel usa IPs **dinâmicos** que mudam constantemente. Não há uma lista fixa de IPs que possam ser liberados no firewall.

### 2. **Soluções Possíveis**

#### **Opção A: Usar ngrok (Atual - Recomendado)**
- ✅ **Vantagem**: Funciona imediatamente, sem necessidade de configurar firewall
- ✅ **Vantagem**: ngrok cria um túnel seguro
- ⚠️ **Desvantagem**: URL do ngrok muda no plano gratuito
- ✅ **Solução**: Usar plano pago do ngrok com domínio fixo

#### **Opção B: Permitir IPs da Vercel (Complexo)**
Como os IPs da Vercel são dinâmicos, seria necessário:

1. **Obter lista de IPs da Vercel** (limitada):
   - A Vercel publica alguns ranges de IP, mas não todos
   - Documentação: https://vercel.com/docs/security/deployment-protection#ip-addresses
   - IPs podem mudar a qualquer momento

2. **Configurar Firewall SQL Server**:
   - Abrir porta **1433** (ou a porta configurada) para os ranges de IP da Vercel
   - Configurar regras no Windows Firewall ou firewall corporativo
   - Permitir conexões TCP/IP no SQL Server Configuration Manager

3. **Problemas desta abordagem**:
   - ❌ IPs mudam constantemente
   - ❌ Pode quebrar a conexão sem aviso
   - ❌ Requer manutenção constante
   - ❌ Não é recomendado pela Vercel

#### **Opção C: Vercel Secure Compute (Enterprise - MELHOR para Produção)**
Para produção com plano **Enterprise** da Vercel:
- ✅ **Vercel Secure Compute**: Permite conexões privadas entre funções serverless e infraestrutura backend
- ✅ **IPs conhecidos e fixos**: Com Secure Compute, você obtém um conjunto conhecido de IPs que podem ser liberados no firewall
- ✅ **Conexão segura e estável**: Solução oficial da Vercel para produção
- ⚠️ **Requisito**: Plano Enterprise da Vercel (pago)
- 📖 **Documentação**: https://vercel.com/docs/security/secure-compute

#### **Opção D: VPN ou Conexão Dedicada (Alternativa para Produção)**
Se não tiver plano Enterprise:
- ✅ VPN entre Vercel e rede corporativa
- ✅ Ou conexão dedicada/privada
- ✅ IPs fixos e controlados
- ⚠️ Requer infraestrutura de VPN própria

### 3. **O que o TI precisa configurar para PRODUÇÃO**

#### **CENÁRIO 1: Vercel Secure Compute (Recomendado - Enterprise)**

1. **Obter IPs da Vercel**:
   - Após ativar Vercel Secure Compute no plano Enterprise
   - A Vercel fornecerá uma lista de IPs fixos
   - Esses IPs podem ser liberados no firewall

2. **Configurar Firewall SQL Server**:
   - Abrir porta **1433** (ou a porta configurada) para os IPs específicos fornecidos pela Vercel
   - Configurar regras no Windows Firewall ou firewall corporativo
   - Permitir conexões TCP/IP no SQL Server Configuration Manager

#### **CENÁRIO 2: VPN Corporativa**

1. **Configurar VPN**:
   - Estabelecer conexão VPN entre Vercel e rede corporativa
   - Obter IP fixo do endpoint VPN

2. **Configurar Firewall SQL Server**:
   - Abrir porta **1433** apenas para o IP da VPN
   - Configurar regras no Windows Firewall ou firewall corporativo
   - Permitir conexões TCP/IP no SQL Server Configuration Manager

#### **CENÁRIO 3: ngrok com domínio fixo**

1. **Obter IP do ngrok**:
   - Com plano pago do ngrok, o IP é fixo
   - Consultar IP do domínio ngrok

2. **Configurar Firewall SQL Server**:
   - Abrir porta **1433** apenas para o IP do ngrok
   - Configurar regras no Windows Firewall ou firewall corporativo
   - Permitir conexões TCP/IP no SQL Server Configuration Manager

#### **CENÁRIO 4: IPs dinâmicos da Vercel (NÃO RECOMENDADO - Opção B)**

**Passos comuns para TODOS os cenários:**

#### **No SQL Server Configuration Manager:**
1. Habilitar protocolo **TCP/IP**
2. Configurar porta estática (padrão: 1433)
   - Abrir **SQL Server Configuration Manager**
   - Ir em **Configuração de Rede do SQL Server** → **Protocolos para [instância]**
   - Clicar duas vezes em **TCP/IP**
   - Na aba **Endereços IP**, seção **IPAll**:
     - Limpar campo **Portas TCP Dinâmicas**
     - Definir **Porta TCP** como **1433** (ou outra de preferência)
3. Reiniciar serviço do SQL Server

#### **No Windows Firewall:**
1. Criar regra de entrada (Inbound Rule)
2. Tipo: Porta
3. Protocolo: TCP
4. Porta: 1433 (ou a configurada)
5. Ação: Permitir conexão
6. Perfil: Todos
7. **Escopo - Remoto**: Adicionar IPs específicos:
   - **Cenário 1**: IPs fornecidos pela Vercel Secure Compute
   - **Cenário 2**: IP do endpoint VPN
   - **Cenário 3**: IP fixo do ngrok
   - **Cenário 4**: Ranges de IP da Vercel (não recomendado)

#### **No Firewall Corporativo (se houver):**
1. Permitir conexões TCP na porta 1433
2. Origem: 
   - **Cenário 1**: IPs fornecidos pela Vercel Secure Compute
   - **Cenário 2**: IP do endpoint VPN
   - **Cenário 3**: IP fixo do ngrok
   - **Cenário 4**: Ranges de IP da Vercel (não recomendado)
3. Destino: IP do servidor SQL Server

### 4. **Recomendação para PRODUÇÃO**

🎯 **Para desenvolvimento/testes**: Continue usando ngrok (Opção A)

🎯 **Para PRODUÇÃO - Ordem de Prioridade:**

1. **🥇 MELHOR OPÇÃO: Vercel Secure Compute (Opção C)**
   - Se tiver plano Enterprise da Vercel
   - IPs fixos e conhecidos
   - Solução oficial e recomendada
   - O TI pode liberar os IPs específicos fornecidos pela Vercel
   - **O que o TI precisa**: Lista de IPs fornecida pela Vercel após ativar Secure Compute

2. **🥈 SEGUNDA OPÇÃO: VPN Corporativa (Opção D)**
   - Se não tiver plano Enterprise
   - Requer infraestrutura de VPN
   - IPs fixos e controlados
   - **O que o TI precisa**: Configurar VPN e fornecer endpoint/credenciais

3. **🥉 TERCEIRA OPÇÃO: ngrok com domínio fixo (Opção A - Plano Pago)**
   - Mais simples que VPN
   - Domínio fixo (não muda)
   - **O que o TI precisa**: Liberar apenas o IP do ngrok (fixo no plano pago)

4. **❌ NÃO RECOMENDADO: Liberar IPs dinâmicos da Vercel (Opção B)**
   - IPs mudam constantemente
   - Pode quebrar a qualquer momento
   - Não é viável para produção

### 5. **Informações Técnicas Necessárias para o TI**

**Informações básicas do SQL Server:**
- **IP do servidor SQL Server**: `[IP_DO_SERVIDOR]`
- **Porta SQL Server**: `1433` (ou a configurada)
- **Protocolo**: `TCP`

**Dependendo da solução escolhida:**

**Se usar Vercel Secure Compute:**
- Solicitar lista de IPs à Vercel após ativar Secure Compute
- Documentação: https://vercel.com/docs/security/secure-compute

**Se usar VPN:**
- IP do endpoint VPN
- Credenciais/configuração da VPN

**Se usar ngrok:**
- IP fixo do domínio ngrok (plano pago)
- Consultar no painel do ngrok

**Se tentar IPs dinâmicos (não recomendado):**
- Ranges de IP da Vercel: https://vercel.com/docs/security/deployment-protection#ip-addresses
- ⚠️ **Atenção**: IPs mudam constantemente, não é viável para produção

### 6. **Teste de Conectividade**

Após configuração, testar:
```bash
# De um servidor externo (ou usar ferramenta online)
telnet [IP_SQL_SERVER] 1433
```

---

## 📞 Contato

Se o TI tiver dúvidas, pode entrar em contato ou consultar:
- **Vercel Secure Compute**: https://vercel.com/docs/security/secure-compute
- **Vercel Deployment Protection**: https://vercel.com/docs/security/deployment-protection
- **Documentação SQL Server**: https://docs.microsoft.com/sql/sql-server/
- **SQL Server Remote Connections**: https://docs.microsoft.com/sql/database-engine/configure-windows/configure-a-server-for-remote-access

---

**Última atualização**: 2024

