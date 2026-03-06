# Instalação do Proxy na AWS EC2

Scripts para rodar o servidor proxy do Multi-Dashboard **diretamente na instância AWS**, sem túnel Cloudflare.

## Uso rápido

1. **Libere a porta 3001** no Security Group da EC2 (entrada TCP 3001).
2. Conecte na EC2 por SSH e coloque o código do projeto em `~/multi-dashboard` (clone ou SCP).
3. Na pasta do projeto, execute:
   ```bash
   chmod +x aws-setup/install-aws.sh
   bash aws-setup/install-aws.sh
   ```
4. Edite `~/multi-dashboard/.env.local` com as credenciais do banco e do proxy.
5. No Vercel, defina:
   - `PROXY_URL=http://54.207.0.241:3001` (use o IP público da sua EC2)
   - `PROXY_SECRET` = mesmo valor do `.env.local`

Guia completo: **[docs/AWS_PROXY_SETUP.md](../docs/AWS_PROXY_SETUP.md)**
