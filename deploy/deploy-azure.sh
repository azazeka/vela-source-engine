#!/usr/bin/env bash
# ==============================================================================
# Vela Source Engine - Automated Deployment to Azure Container Apps
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-vela}"
LOCATION="${AZURE_LOCATION:-swedencentral}"
APP_NAME="${AZURE_APP_NAME:-vela-source-engine}"
TARGET_PORT=3000

echo "=========================================================="
echo " 🚀 Deploying Vela Source Engine to Azure Container Apps"
echo "=========================================================="
echo " Resource Group: ${RESOURCE_GROUP}"
echo " Location:       ${LOCATION}"
echo " App Name:       ${APP_NAME}"
echo " Directory:      ${BACKEND_DIR}"
echo "=========================================================="

# 1. Verify Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Error: Azure CLI (az) is not installed."
    echo "Install it via: brew install azure-cli"
    exit 1
fi

# 2. Check Azure CLI authentication
echo "🔍 Checking Azure authentication..."
if ! az account show &> /dev/null; then
    echo "⚠️ Not logged in to Azure. Running 'az login'..."
    az login --use-device-code
fi

CURRENT_SUB=$(az account show --query name -o tsv)
echo "✅ Logged in to Azure subscription: '${CURRENT_SUB}'"

# 3. Create Resource Group if it doesn't exist
echo "📦 Ensuring Resource Group '${RESOURCE_GROUP}' in '${LOCATION}'..."
az group create \
    --name "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --output table

# 4. Deploy using Azure Container Apps (Source-to-Cloud build)
echo "☁️ Building and deploying container to Azure Container Apps..."
cd "${BACKEND_DIR}"

DEPLOY_CMD=(
    az containerapp up
    --name "${APP_NAME}"
    --resource-group "${RESOURCE_GROUP}"
    --location "${LOCATION}"
    --source .
    --ingress external
    --target-port "${TARGET_PORT}"
    --env-vars "NODE_ENV=production" "PORT=${TARGET_PORT}" "HOST=0.0.0.0"
)

# Load .env if present
if [ -f "${BACKEND_DIR}/.env" ]; then
    echo "📄 Sourcing environment from .env..."
    set -a
    # shellcheck disable=SC1091
    source "${BACKEND_DIR}/.env"
    set +a
fi

if [ -n "${TORBOX_API_KEY:-}" ]; then
    DEPLOY_CMD+=(--env-vars "TORBOX_API_KEY=${TORBOX_API_KEY}")
fi
if [ -n "${PORNOLAB_COOKIE:-}" ]; then
    DEPLOY_CMD+=(--env-vars "PORNOLAB_COOKIE=${PORNOLAB_COOKIE}")
fi
if [ -n "${GAYTORRENT_COOKIE:-}" ]; then
    DEPLOY_CMD+=(--env-vars "GAYTORRENT_COOKIE=${GAYTORRENT_COOKIE}")
fi
if [ -n "${GTO_COOKIE:-}" ]; then
    DEPLOY_CMD+=(--env-vars "GTO_COOKIE=${GTO_COOKIE}")
fi

"${DEPLOY_CMD[@]}"

# 5. Retrieve FQDN and test /health endpoint
echo "🔎 Retrieving deployment URL..."
FQDN=$(az containerapp show \
    --name "${APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query properties.configuration.ingress.fqdn \
    -o tsv)

URL="https://${FQDN}"
echo "=========================================================="
echo " 🎉 Deployment Succeeded!"
echo " Service URL:    ${URL}"
echo " Health Check:   ${URL}/health"
echo "=========================================================="

echo "🧪 Probing health endpoint..."
if curl -s -f -m 15 "${URL}/health" | grep -q "ok"; then
    echo "✅ Health check PASSED: Service is ready for Apple TV!"
else
    echo "⚠️ Health check returned non-200. Check logs via:"
    echo "az containerapp logs show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --follow"
fi

echo ""
echo "📱 Next step on Apple TV:"
echo "Configure SourceEngine baseURL in Vela to: ${URL}"
