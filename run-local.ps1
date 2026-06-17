# NetSentry Local Windows Test Bootstrapper
# Run this script to test the dashboard and DNS server on your local machine.

$ErrorActionPreference = "Stop"

# 1. Install and Build Frontend
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Step 1: Installing and Building Frontend..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
cd frontend
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
}
Write-Host "Building React production assets..." -ForegroundColor Yellow
npm run build
cd ..

# 2. Install Backend Dependencies
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Step 2: Checking Backend Dependencies..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
cd backend
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
    npm install
}
cd ..

# 3. Choose Port 53 or 5553
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Step 3: Configuring Port Settings..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$dnsPort = "5553" # Default safe non-admin port
Write-Host "Checking terminal privileges..." -ForegroundColor Yellow
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
    Write-Host "[v] Terminal is running with Administrator privileges." -ForegroundColor Green
    Write-Host "NetSentry will run DNS on privileged Port 53." -ForegroundColor Green
    $dnsPort = "53"
} else {
    Write-Host "[!] Terminal is NOT running as Administrator." -ForegroundColor Yellow
    Write-Host "To protect Windows services, NetSentry will bind DNS to Port 5553." -ForegroundColor Yellow
    Write-Host "To test Port 53, re-run this script in an Administrator Windows PowerShell window." -ForegroundColor Yellow
}

# 4. Boot Backend
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Step 4: Starting NetSentry Web Dashboard and DNS Server..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Web Dashboard: http://localhost:8080" -ForegroundColor Green
Write-Host "  DNS Server:    127.0.0.1:$dnsPort" -ForegroundColor Green
Write-Host "  Stop Server:   Press Ctrl+C in this terminal" -ForegroundColor Yellow
Write-Host "------------------------------------------"

$env:DNS_PORT = $dnsPort
$env:API_PORT = "8080"
$env:DB_DIR = "./data"
$env:FRONTEND_PATH = "./frontend/dist"

node backend/src/index.js
