# Tune Pirate — Azure Container Apps Deployment Script (Azure for Students)
# Uses Azure Container Apps Free Grant (180,000 vCPU-seconds and 2 million requests/month free)

param(
    [string]$ResourceGroup = "TunePirate-RG",
    [string]$Location = "eastus",
    [string]$AppName = "tunepirate-api",
    [string]$AcrName = "tunepiratecr$((Get-Random -Minimum 1000 -Maximum 9999))"
)

$ErrorActionPreference = "Stop"

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "   ⚓ TUNE PIRATE BACKEND AZURE DEPLOYMENT (STUDENT)   " -ForegroundColor Cyan
Write-Host "=======================================================`n" -ForegroundColor Cyan

# 1. Resolve backend directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path (Join-Path $ScriptDir "main.py")) {
    $BackendDir = $ScriptDir
} elseif (Test-Path (Join-Path (Get-Location) "backend\main.py")) {
    $BackendDir = Join-Path (Get-Location) "backend"
} else {
    $BackendDir = Get-Location
}

Write-Host "📂 Source Directory: $BackendDir" -ForegroundColor DarkGray

# 2. Check Azure CLI
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "⚠️ Azure CLI ('az') is not found in PATH." -ForegroundColor Yellow
    Write-Host "If it was recently installed, please restart your terminal so PATH is updated." -ForegroundColor Yellow
    exit 1
}

# 3. Check Azure Login
Write-Host "🔑 Checking Azure authentication..." -ForegroundColor Cyan
$CurrentAccount = az account show --query "user.name" -o tsv 2>$null
if (-not $CurrentAccount) {
    Write-Host "Not logged in. Launching browser for Azure Student login..." -ForegroundColor Yellow
    az login
    $CurrentAccount = az account show --query "user.name" -o tsv
}
Write-Host "✅ Logged in as: $CurrentAccount" -ForegroundColor Green

# 4. Ensure required providers are registered
Write-Host "⚙️ Ensuring Azure resource providers are registered..." -ForegroundColor Cyan
az provider register --namespace Microsoft.App --wait 2>$null
az provider register --namespace Microsoft.OperationalInsights --wait 2>$null

# 5. Create Resource Group
Write-Host "📦 Creating Resource Group: $ResourceGroup in $Location..." -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location --output none

# 6. Create Azure Container Registry (Basic Tier)
Write-Host "🏗️ Creating Container Registry: $AcrName..." -ForegroundColor Cyan
az acr create --resource-group $ResourceGroup --name $AcrName --sku Basic --admin-enabled true --output none

# 7. Build Docker container image in the cloud (no local Docker required!)
Write-Host "☁️ Building Docker container in Azure Cloud (via ACR Build)..." -ForegroundColor Cyan
az acr build --registry $AcrName --image tunepirate-backend:latest $BackendDir

# 8. Create Azure Container Apps Environment
Write-Host "🌐 Creating Container Apps Environment: tunepirate-env..." -ForegroundColor Cyan
az containerapp env create --name tunepirate-env --resource-group $ResourceGroup --location $Location --output none

# 9. Retrieve ACR Credentials
$AcrServer = az acr show --name $AcrName --query "loginServer" -o tsv
$AcrUser = az acr credential show --name $AcrName --query "username" -o tsv
$AcrPass = az acr credential show --name $AcrName --query "passwords[0].value" -o tsv

# 10. Deploy Container App
Write-Host "🚀 Deploying Tune Pirate API to Azure Container Apps..." -ForegroundColor Cyan
az containerapp create `
    --name $AppName `
    --resource-group $ResourceGroup `
    --environment tunepirate-env `
    --image "$AcrServer/tunepirate-backend:latest" `
    --target-port 8000 `
    --ingress external `
    --registry-server $AcrServer `
    --registry-username $AcrUser `
    --registry-password $AcrPass `
    --cpu 0.5 `
    --memory 1.0Gi `
    --output none

# 11. Retrieve public URL
$FQDN = az containerapp show --name $AppName --resource-group $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv

Write-Host "`n=======================================================" -ForegroundColor Green
Write-Host "🎉 SUCCESS! TUNE PIRATE BACKEND IS LIVE ON AZURE!" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "`n🌍 Public API Endpoint: https://$FQDN" -ForegroundColor Cyan
Write-Host "🩺 Health Check:       https://$FQDN/api/health" -ForegroundColor Cyan
Write-Host "📖 Interactive Docs:   https://$FQDN/docs" -ForegroundColor Cyan
Write-Host "`n👉 NEXT STEP: Update the API base URL in frontend-rn/services/api.js to:" -ForegroundColor Yellow
Write-Host "   https://$FQDN" -ForegroundColor White
Write-Host ""
