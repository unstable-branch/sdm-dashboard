# WSL2 Network Setup for SDM Dashboard
# Run this ONCE from Windows PowerShell (as Administrator) to enable
# Windows browser access to the app running inside WSL2.
#
# Usage:
#   1. Open PowerShell as Administrator
#   2. cd to this project folder
#   3. .\scripts\wsl_setup.ps1
#
# What it does:
#   - Finds the current WSL2 VM IP address
#   - Configures a netsh port proxy: 127.0.0.1:3838 -> WSL2:3838
#   - Adds Windows Firewall rule to allow the connection
#
# The app must be running in WSL2 (Rscript app.R) before opening
# the browser. Access the app at http://127.0.0.1:3838 in your
# Windows browser.

param(
    [int]$AppPort = 3838,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

function Get-WslIp {
    $wslIp = $null
    try {
        $wslIp = wsl hostname -I 2>$null
        if ($wslIp) {
            $wslIp = ($wslIp.Trim() -split '\s+')[0]
        }
    } catch {
        Write-Warning "Could not get WSL IP via hostname command: $_"
    }

    if (-not $wslIp) {
        try {
            $adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*WSL*" -or $_.Name -like "*WSL*" } | Select-Object -First 1
            if ($adapter) {
                $ipConfig = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
                $wslIp = $ipConfig.IPAddress | Select-Object -First 1
            }
        } catch {
        }
    }

    if (-not $wslIp) {
        Write-Error "Could not detect WSL2 IP address. Is WSL2 running? Try: wsl -d Ubuntu"
    }

    return $wslIp
}

function Remove-PortProxy {
    Write-Host "Removing port proxy for port $AppPort..." -ForegroundColor Yellow
    try {
        netsh interface portproxy delete v4tov4 listenport=$AppPort 2>$null
        Write-Host "Port proxy removed." -ForegroundColor Green
    } catch {
        Write-Warning "Could not remove port proxy (may not exist): $_"
    }
}

function Add-FirewallRule {
    param([int]$Port)
    $ruleName = "SDM Dashboard WSL2 Port $Port"
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existing) {
        try {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -ErrorAction SilentlyContinue | Out-Null
            Write-Host "Firewall rule '$ruleName' added." -ForegroundColor Green
        } catch {
            Write-Warning "Could not add firewall rule (may need admin): $_"
        }
    } else {
        Write-Host "Firewall rule '$ruleName' already exists." -ForegroundColor Gray
    }
}

if ($Remove) {
    Remove-PortProxy
    Write-Host "WSL2 network setup removed." -ForegroundColor Green
    exit 0
}

Write-Host "=== SDM Dashboard WSL2 Network Setup ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Detect WSL2 IP
Write-Host "Detecting WSL2 IP address..." -ForegroundColor Yellow
$wslIp = Get-WslIp
Write-Host "  WSL2 IP: $wslIp" -ForegroundColor Cyan

# Step 2: Check if app is running in WSL2 (optional check)
Write-Host ""
Write-Host "Checking if app is listening on WSL2 port $AppPort..." -ForegroundColor Yellow
$tcpTest = Test-NetConnection -ComputerName $wslIp -Port $AppPort -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
if ($tcpTest.TcpTestSucceeded) {
    Write-Host "  Port $AppPort is OPEN on WSL2. App may be running." -ForegroundColor Green
} else {
    Write-Host "  Port $AppPort appears closed on WSL2." -ForegroundColor Red
    Write-Host "  Make sure to run 'Rscript app.R' in WSL2 BEFORE opening the browser." -ForegroundColor Yellow
}

# Step 3: Remove any existing proxy
Remove-PortProxy

# Step 4: Configure port proxy
Write-Host ""
Write-Host "Configuring port proxy: 127.0.0.1:$AppPort -> $wslIp`:$AppPort" -ForegroundColor Yellow
try {
    netsh interface portproxy add v4tov4 listenport=$AppPort connectaddress=$wslIp connectport=$AppPort | Out-Null
    Write-Host "Port proxy configured." -ForegroundColor Green
} catch {
    Write-Error "Failed to configure port proxy: $_"
}

# Step 5: Add firewall rule
Write-Host ""
Write-Host "Adding firewall rule..." -ForegroundColor Yellow
Add-FirewallRule -Port $AppPort

# Step 6: Verify
Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
$proxyOk = Test-NetConnection -ComputerName 127.0.0.1 -Port $AppPort -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
if ($proxyOk.TcpTestSucceeded) {
    Write-Host "  TCP proxy test PASSED: 127.0.0.1:$AppPort is reachable" -ForegroundColor Green
    Write-Host ""
    Write-Host "=== Setup Complete ===" -ForegroundColor Green
    Write-Host "Open your Windows browser and go to: http://127.0.0.1`:$AppPort" -ForegroundColor Cyan
    Write-Host "Make sure the app is running in WSL2 first: Rscript app.R" -ForegroundColor Yellow
} else {
    Write-Warning "TCP proxy test FAILED. The app may not be running in WSL2 yet."
    Write-Warning "Start the app in WSL2, then try again: Rscript app.R"
    Write-Host "After starting the app, run this command to verify:" -ForegroundColor Yellow
    Write-Host "  Test-NetConnection -ComputerName 127.0.0.1 -Port $AppPort" -ForegroundColor Gray
}

Write-Host ""
$proxyStatus = netsh interface portproxy show all
Write-Host "Current port proxy state:"
Write-Host $proxyStatus