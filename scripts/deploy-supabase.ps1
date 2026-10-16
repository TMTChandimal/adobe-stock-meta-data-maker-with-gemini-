# ASMP Supabase Edge Function Deployment Helper
$ErrorActionPreference = "Stop"

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "  ASMP — Deploy License Functions to Supabase" -ForegroundColor Cyan
Write-Host "=======================================================`n" -ForegroundColor Cyan

$projectRef = "ttrrilnouedeifqjttai"
$publicKey = "h1YOzrW4J+0ZhLp/MeEAlb5EbWYqEBxjrgKmTCfX4dc="
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path (Split-Path -Parent $scriptDir) "backend"

# 1. Check Login / Access Token
Write-Host "[1/4] Checking Supabase authentication..." -ForegroundColor Yellow
$token = $env:SUPABASE_ACCESS_TOKEN

if (-not $token) {
    Write-Host "Logging into Supabase CLI..." -ForegroundColor Gray
    Write-Host "A browser window will open. Click 'Generate Token' and authorize.`n" -ForegroundColor Gray
    npx supabase login
}

# 2. Deploy license-activate
Write-Host "`n[2/4] Deploying 'license-activate' Edge Function to project $projectRef..." -ForegroundColor Yellow
Set-Location -Path $backendDir
npx supabase functions deploy license-activate --project-ref $projectRef --no-verify-jwt

# 3. Deploy license-validate
Write-Host "`n[3/4] Deploying 'license-validate' Edge Function to project $projectRef..." -ForegroundColor Yellow
npx supabase functions deploy license-validate --project-ref $projectRef --no-verify-jwt

# 4. Set Secrets
Write-Host "`n[4/4] Setting LICENSE_PUBLIC_KEY secret on Supabase..." -ForegroundColor Yellow
npx supabase secrets set "LICENSE_PUBLIC_KEY=$publicKey" --project-ref $projectRef

Write-Host "`n=======================================================" -ForegroundColor Green
Write-Host "  SUCCESS: All License Functions Deployed to Supabase!" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "You can now open the Chrome extension popup, enter your license code, and click Activate.`n" -ForegroundColor White
