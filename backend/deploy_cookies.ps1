# Deploy YouTube Cookies to Azure Container App (tunepirate-live)
param(
    [string]$CookieFile = "cookies.txt",
    [string]$AppName = "tunepirate-live",
    [string]$ResourceGroup = "TunePirate-RG"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$resolvedPath = if (Test-Path $CookieFile) { $CookieFile } else { Join-Path $scriptDir $CookieFile }

if (-not (Test-Path $resolvedPath)) {
    Write-Error "Cookie file not found at: $resolvedPath"
    Write-Host "Please place your exported Netscape cookies file as 'backend\cookies.txt' and rerun this script." -ForegroundColor Yellow
    exit 1
}

$fileBytes = [IO.File]::ReadAllBytes($resolvedPath)
if ($fileBytes.Length -lt 20) {
    Write-Error "Cookie file appears empty ($($fileBytes.Length) bytes)."
    exit 1
}

$b64 = [Convert]::ToBase64String($fileBytes)
Write-Host "Encoding $resolvedPath ($($fileBytes.Length) bytes) to Base64..." -ForegroundColor Cyan

Write-Host "Setting secret 'youtube-cookies' on $AppName..." -ForegroundColor Cyan
az containerapp secret set --name $AppName --resource-group $ResourceGroup --secrets "youtube-cookies=$b64"

Write-Host "Updating environment variable YOUTUBE_COOKIES_B64..." -ForegroundColor Cyan
az containerapp update --name $AppName --resource-group $ResourceGroup --set-env-vars "YOUTUBE_COOKIES_B64=secretref:youtube-cookies"

Write-Host "Verifying audio extraction on live Azure API..." -ForegroundColor Green
Start-Sleep -Seconds 5

try {
    $res = Invoke-RestMethod -Uri "https://tunepirate-live.happyflower-25695355.polandcentral.azurecontainerapps.io/api/audio-url/CmThpha4Hoo?title=Last%20Last&artist=Burna%20Boy"
    Write-Host "SUCCESS! Live audio URL response:" -ForegroundColor Green
    $res | ConvertTo-Json
} catch {
    Write-Warning "First attempt: $($_.Exception.Message). Container may still be reloading revision."
}
