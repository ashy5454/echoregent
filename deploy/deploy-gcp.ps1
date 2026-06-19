# PowerShell Deployment Script for Google Cloud Run (Artifact Registry)
$ErrorActionPreference = "Stop"

Write-Host "Building project locally to ensure no compilation errors..." -ForegroundColor Cyan
npm run build

Write-Host "Submitting build to Google Cloud Build (Artifact Registry)..." -ForegroundColor Cyan
gcloud builds submit --tag us-central1-docker.pkg.dev/yudi-cts-prod/ecoregent/echoregent

$envVars = "ECHOREGENT_HOST=0.0.0.0"

# Check if local firebase-service-account.json exists
$serviceAccountPath = "data/firebase-service-account.json"
if (Test-Path $serviceAccountPath) {
    Write-Host "Firebase Service Account file found. Reading contents..." -ForegroundColor Green
    $svcAccContent = Get-Content $serviceAccountPath -Raw
    # Minify JSON to avoid escaping issues in CLI
    $svcAccMinified = ($svcAccContent | ConvertFrom-Json | ConvertTo-Json -Compress)
    $envVars += ",FIREBASE_SERVICE_ACCOUNT=$svcAccMinified"
    Write-Host "Firebase Service Account set in environment variables." -ForegroundColor Green
} else {
    Write-Host "No local Firebase Service Account found. Deploying without it (local fallback enabled)..." -ForegroundColor Yellow
}

Write-Host "Deploying to Google Cloud Run..." -ForegroundColor Cyan
gcloud run deploy echoregent `
  --image us-central1-docker.pkg.dev/yudi-cts-prod/ecoregent/echoregent `
  --platform managed `
  --region us-central1 `
  --allow-unauthenticated `
  --set-env-vars $envVars

Write-Host "EchoRegent deployed successfully!" -ForegroundColor Green
