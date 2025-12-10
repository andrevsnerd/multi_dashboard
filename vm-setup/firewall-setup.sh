#!/bin/bash

# Script para configurar firewall do Google Cloud
# Execute este script no Google Cloud Shell ou localmente com gcloud CLI instalado

set -e

echo "🔥 Configurando regra de firewall para o servidor proxy..."

# Nome da regra
RULE_NAME="allow-proxy-server"
PORT=3001

# Verificar se a regra já existe
if gcloud compute firewall-rules describe "$RULE_NAME" &>/dev/null; then
    echo "⚠️  Regra '$RULE_NAME' já existe. Deseja recriar? (s/N)"
    read -r response
    if [[ "$response" =~ ^[Ss]$ ]]; then
        echo "🗑️  Removendo regra existente..."
        gcloud compute firewall-rules delete "$RULE_NAME" --quiet
    else
        echo "✅ Usando regra existente."
        exit 0
    fi
fi

# Criar regra de firewall
echo "📝 Criando regra de firewall..."
gcloud compute firewall-rules create "$RULE_NAME" \
    --allow tcp:$PORT \
    --source-ranges 0.0.0.0/0 \
    --description "Allow proxy server on port $PORT" \
    --direction INGRESS

echo "✅ Regra de firewall criada com sucesso!"
echo ""
echo "📋 Detalhes da regra:"
gcloud compute firewall-rules describe "$RULE_NAME"

echo ""
echo "⚠️  NOTA: A regra permite conexões de qualquer IP (0.0.0.0/0)"
echo "   Para maior segurança, você pode restringir apenas aos IPs do Vercel"
echo "   Editando a regra e mudando source-ranges"





