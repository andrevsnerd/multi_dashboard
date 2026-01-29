# Túnel fixo no Cloudflare (remotely managed)

Este guia é para o **novo túnel fixo** gerenciado pelo dashboard do Cloudflare (connector). O túnel temporário ou nomeado existente não é alterado.

## Pré-requisitos

- **cloudflared** instalado (versão 2022.03.04 ou superior).
- No seu PC o cloudflared está em: `C:\Program Files (x86)\cloudflared\cloudflared.exe`  
  (O MSI do Windows às vezes não adiciona ao PATH; o script usa esse caminho.)

## Instalação do túnel fixo (como serviço)

1. **Coloque o token em um arquivo** (já feito se você seguiu o passo do dashboard):
   - Arquivo: `cloudflare-tunnel-token.txt` na raiz do projeto.
   - Conteúdo: uma única linha com o token que o Cloudflare mostrou ao criar o connector.
   - Esse arquivo está no `.gitignore` e **não deve ser commitado**.

2. **Execute o script como Administrador**:
   - Clique com o botão direito em `install-tunnel-fixo-admin.bat`.
   - Escolha **"Executar como administrador"**.
   - O script instala o serviço do Windows e inicia o túnel.

3. **Verificar**:
   - Abra **services.msc** e procure por **Cloudflare Tunnel** (ou **cloudflared**).
   - Status deve estar **Em execução**.
   - No dashboard do Cloudflare (Zero Trust / Tunnels), o connector deve aparecer como **Conectado**.

## Comando manual (alternativa)

Se preferir instalar direto no terminal (Prompt de Comando **como Administrador**):

```cmd
"C:\Program Files (x86)\cloudflared\cloudflared.exe" service install SEU_TOKEN_AQUI
```

Depois inicie o serviço:

```cmd
sc start cloudflared
```

## Parar / desinstalar o serviço

- **Parar**: `sc stop cloudflared`
- **Desinstalar**: `"C:\Program Files (x86)\cloudflared\cloudflared.exe" service uninstall`

## Observações

- O túnel fixo (connector) é configurado **no dashboard do Cloudflare** (hostnames, rotas, etc.). Não é necessário arquivo `config.yml` local para esse modo.
- O token é **sensível**: quem tiver o token pode rodar o túnel. Mantenha `cloudflare-tunnel-token.txt` apenas local e nunca no Git.
