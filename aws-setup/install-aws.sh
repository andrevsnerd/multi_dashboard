#!/bin/bash
#
# Instalação do servidor proxy na instância AWS EC2
# Execute na EC2 (Linux): bash install-aws.sh
#
# Pré-requisitos:
# - Security Group da EC2 com porta 3001 liberada (entrada TCP)
# - Acesso SSH à instância (chave multi_key)
#

set -e

# Carregar NVM se existir (para ter node/npm no PATH em sessões não-interativas)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Se o script for executado de dentro do repo (ex: ~/multi-dashboard/aws-setup/install-aws.sh), usa o diretório raiz do repo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$SCRIPT_DIR/../proxy-server" ] && [ -f "$SCRIPT_DIR/../lib/transfer-executor.js" ]; then
  PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  PROJECT_DIR="${PROJECT_DIR:-$HOME/multi-dashboard}"
fi

echo "🚀 Instalação do Proxy Multi-Dashboard na AWS EC2"
echo "   Diretório: $PROJECT_DIR"
echo ""

# Detectar gerenciador de pacotes (Debian/Ubuntu vs Amazon Linux/RHEL)
if command -v apt-get &> /dev/null; then
  PKG_UPDATE="sudo apt-get update -qq"
  PKG_INSTALL="sudo apt-get install -y"
  PKG_UPGRADE="sudo apt-get upgrade -y -qq"
elif command -v dnf &> /dev/null; then
  PKG_UPDATE="sudo dnf check-update -q || true"
  PKG_INSTALL="sudo dnf install -y"
  PKG_UPGRADE="sudo dnf upgrade -y -q"
elif command -v yum &> /dev/null; then
  PKG_UPDATE="true"
  PKG_INSTALL="sudo yum install -y"
  PKG_UPGRADE="sudo yum upgrade -y -q"
else
  echo -e "${RED}❌ Sistema não suportado (sem apt-get, dnf ou yum)${NC}"
  exit 1
fi

# 1. Atualizar sistema
echo -e "${YELLOW}📦 Atualizando sistema...${NC}"
$PKG_UPDATE
$PKG_UPGRADE 2>/dev/null || true

# 2. Instalar Node.js 18
echo -e "${YELLOW}📦 Instalando Node.js 18...${NC}"
if ! command -v node &> /dev/null; then
  if command -v apt-get &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    # Amazon Linux / RHEL: instalar via NVM (funciona em qualquer distro)
    export NVM_DIR="$HOME/.nvm"
    if [ ! -d "$NVM_DIR" ]; then
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    fi
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install 18
    nvm use 18
    nvm alias default 18
    # Garantir que node/npm estejam no PATH para o restante do script
    export PATH="$NVM_DIR/versions/node/$(ls $NVM_DIR/versions/node | tail -1)/bin:$PATH"
  fi
fi
if command -v node &> /dev/null; then
  echo -e "${GREEN}✅ Node.js: $(node --version)${NC}"
else
  echo -e "${RED}❌ Node.js não encontrado após instalação${NC}"
  exit 1
fi

# 3. Instalar Git (se não tiver)
echo -e "${YELLOW}📦 Verificando Git...${NC}"
$PKG_INSTALL git 2>/dev/null || true

# 4. Instalar PM2 globalmente (sem sudo se Node veio do NVM - instala no usuário)
echo -e "${YELLOW}📦 Instalando PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
  if command -v npm &> /dev/null; then
    npm install -g pm2
  else
    sudo npm install -g pm2
  fi
else
  echo -e "${GREEN}✅ PM2 já instalado${NC}"
fi

# 5. Clonar ou atualizar o projeto
if [ ! -d "$PROJECT_DIR" ]; then
  echo -e "${YELLOW}📁 Diretório do projeto não encontrado.${NC}"
  echo "   Você precisa colocar o código do multi-dashboard em: $PROJECT_DIR"
  echo ""
  echo "   Opção A - Clonar via Git (se o repositório for público ou tiver deploy key):"
  echo "     mkdir -p $(dirname $PROJECT_DIR)"
  echo "     git clone <URL_DO_SEU_REPO> $PROJECT_DIR"
  echo ""
  echo "   Opção B - Copiar via SCP do seu PC (na sua máquina):"
  echo "     scp -i multi_key.pem -r ./multi-dashboard ubuntu@54.207.0.241:\$HOME/"
  echo ""
  read -p "   Já copiou/clonou o projeto? Digite 's' para continuar ou Enter para sair: " resp
  if [[ ! "$resp" =~ ^[Ss]$ ]]; then
    echo "   Saindo. Após clonar/copiar, execute novamente: bash install-aws.sh"
    exit 1
  fi
fi

if [ ! -d "$PROJECT_DIR/proxy-server" ] || [ ! -f "$PROJECT_DIR/proxy-server/server.js" ]; then
  echo -e "${RED}❌ Não encontrado: $PROJECT_DIR/proxy-server/server.js${NC}"
  echo "   Certifique-se de que a pasta proxy-server e o arquivo server.js existem."
  exit 1
fi

if [ ! -f "$PROJECT_DIR/lib/transfer-executor.js" ]; then
  echo -e "${RED}❌ Não encontrado: $PROJECT_DIR/lib/transfer-executor.js${NC}"
  echo "   O proxy precisa da pasta lib do projeto (transfer-executor.js)."
  exit 1
fi

# 6. Instalar dependências do proxy
echo -e "${YELLOW}📦 Instalando dependências do proxy...${NC}"
cd "$PROJECT_DIR/proxy-server"
npm install --production

# 7. Arquivo .env.local
if [ ! -f "$PROJECT_DIR/.env.local" ]; then
  echo -e "${YELLOW}📝 Criando .env.local de exemplo...${NC}"
  cat > "$PROJECT_DIR/.env.local" << 'ENVEXAMPLE'
# Banco de Dados SQL Server (acessível a partir desta EC2)
DB_SERVER=SEU_SERVIDOR_SQL
DB_DATABASE=SEU_BANCO
DB_USERNAME=seu_usuario
DB_PASSWORD=sua_senha
DB_PORT=1433

# Proxy (rodando nesta EC2)
PROXY_PORT=3001
PROXY_SECRET=gere-um-token-secreto-forte-aqui
ENVEXAMPLE
  echo -e "${RED}⚠️  EDITE o arquivo com suas credenciais reais:${NC}"
  echo "   nano $PROJECT_DIR/.env.local"
  echo ""
  read -p "   Pressione Enter após editar o .env.local (ou Ctrl+C para sair)..."
fi

# 8. Parar instância anterior (se existir)
cd "$PROJECT_DIR/proxy-server"
pm2 delete proxy-server 2>/dev/null || true

# 9. Iniciar proxy com PM2
echo -e "${YELLOW}⚙️  Iniciando proxy com PM2...${NC}"
pm2 start server.js --name "proxy-server"

# 10. Persistir PM2 no boot
pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || true
pm2 save

# 11. Status
echo ""
echo -e "${GREEN}✅ Instalação concluída!${NC}"
echo ""
pm2 status
echo ""
echo -e "${GREEN}📝 Configure no Vercel:${NC}"
echo "   PROXY_URL=http://54.207.0.241:3001"
echo "   PROXY_SECRET=<mesmo valor de PROXY_SECRET do .env.local>"
echo ""
echo -e "${GREEN}🔍 Comandos úteis:${NC}"
echo "   pm2 logs proxy-server    # Ver logs"
echo "   pm2 restart proxy-server"
echo "   pm2 stop proxy-server"
echo ""
echo -e "${YELLOW}⚠️  Lembrete: Security Group da EC2 deve permitir entrada TCP na porta 3001.${NC}"
