#!/bin/bash

# Script de instalação automática para VM Google Cloud
# Execute: bash install.sh

set -e

echo "🚀 Iniciando instalação do servidor proxy na VM..."

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 1. Atualizar sistema
echo -e "${YELLOW}📦 Atualizando sistema...${NC}"
sudo apt update && sudo apt upgrade -y

# 2. Instalar Node.js
echo -e "${YELLOW}📦 Instalando Node.js...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo -e "${GREEN}✅ Node.js já instalado: $(node --version)${NC}"
fi

# 3. Instalar Git
echo -e "${YELLOW}📦 Instalando Git...${NC}"
sudo apt install -y git

# 4. Instalar PM2
echo -e "${YELLOW}📦 Instalando PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    echo -e "${GREEN}✅ PM2 já instalado${NC}"
fi

# 5. Verificar se o diretório do projeto existe
PROJECT_DIR="$HOME/projects/multi-dashboard-vm"
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}📁 Criando diretório do projeto...${NC}"
    mkdir -p "$PROJECT_DIR"
    echo -e "${RED}⚠️  ATENÇÃO: Você precisa clonar o projeto ou copiar os arquivos para: $PROJECT_DIR${NC}"
    echo -e "${YELLOW}   Execute: git clone [URL_DO_REPO] $PROJECT_DIR${NC}"
    exit 1
fi

# 6. Instalar dependências do proxy
echo -e "${YELLOW}📦 Instalando dependências do proxy...${NC}"
cd "$PROJECT_DIR/proxy-server"
npm install

# 7. Verificar arquivo .env.local
if [ ! -f "$PROJECT_DIR/.env.local" ]; then
    echo -e "${RED}❌ Arquivo .env.local não encontrado!${NC}"
    echo -e "${YELLOW}📝 Criando arquivo .env.local de exemplo...${NC}"
    cat > "$PROJECT_DIR/.env.local" << EOF
# Configurações do Banco de Dados
DB_SERVER=177.92.78.250
DB_DATABASE=LINX_PRODUCAO
DB_USERNAME=andre.nerd
DB_PASSWORD=nerd123@
DB_PORT=1433

# Configurações do Proxy
PROXY_PORT=3001
PROXY_SECRET=seu-token-super-secreto-mude-isso-123456
EOF
    echo -e "${YELLOW}⚠️  IMPORTANTE: Edite o arquivo .env.local com suas credenciais reais!${NC}"
    echo -e "${YELLOW}   Execute: nano $PROJECT_DIR/.env.local${NC}"
    read -p "Pressione Enter após editar o arquivo..."
fi

# 8. Testar conexão com banco (opcional)
echo -e "${YELLOW}🔍 Testando conexão com banco de dados...${NC}"
cd "$PROJECT_DIR/proxy-server"
timeout 10 npm start || echo -e "${RED}⚠️  Não foi possível testar a conexão. Verifique as credenciais.${NC}"

# 9. Configurar PM2
echo -e "${YELLOW}⚙️  Configurando PM2...${NC}"
cd "$PROJECT_DIR/proxy-server"

# Parar se já estiver rodando
pm2 delete proxy-server 2>/dev/null || true

# Iniciar com PM2
pm2 start server.js --name "proxy-server"

# Configurar para iniciar automaticamente
pm2 startup | tail -1 | bash || echo -e "${YELLOW}⚠️  Execute o comando acima manualmente${NC}"
pm2 save

# 10. Mostrar status
echo -e "${GREEN}✅ Instalação concluída!${NC}"
echo ""
echo -e "${GREEN}📊 Status do servidor:${NC}"
pm2 status

echo ""
echo -e "${GREEN}📝 Próximos passos:${NC}"
echo "1. Configure o firewall do Google Cloud para permitir porta 3001"
echo "2. Obtenha o IP estático da VM"
echo "3. Solicite ao TI para autorizar o IP no banco de dados"
echo "4. Configure no Vercel: PROXY_URL=http://[IP_ESTATICO]:3001"
echo ""
echo -e "${GREEN}🔍 Comandos úteis:${NC}"
echo "  pm2 status          # Ver status"
echo "  pm2 logs proxy-server  # Ver logs"
echo "  pm2 restart proxy-server  # Reiniciar"
echo "  pm2 stop proxy-server    # Parar"






