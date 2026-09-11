#Requires -Version 5.1
<#
Install the waverune CLI on Windows from GitHub Releases, without Node or Bun.
  powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/hamedniroomand/waverune/main/install.ps1 | iex"
Options (environment variables):
  WAVERUNE_REPO      owner/repo to download from (default: hamedniroomand/waverune)
  WAVERUNE_VERSION   release tag, e.g. v0.3.0 (default: latest)
  WAVERUNE_BIN_DIR   install directory (default: %LOCALAPPDATA%\Programs\waverune)
  WAVERUNE_BASE_URL  download base URL, for mirrors and tests (default: GitHub Releases)
#>
$ErrorActionPreference = "Stop"

$Repo = if ($env:WAVERUNE_REPO) { $env:WAVERUNE_REPO } else { "hamedniroomand/waverune" }
$Version = if ($env:WAVERUNE_VERSION) { $env:WAVERUNE_VERSION } else { "latest" }
$BinDir = if ($env:WAVERUNE_BIN_DIR) { $env:WAVERUNE_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\waverune" }

# x64 only: Windows 11 on ARM runs it through x64 emulation.
$Asset = "waverune-windows-x64.zip"
$Base = if ($env:WAVERUNE_BASE_URL) {
  $env:WAVERUNE_BASE_URL.TrimEnd("/")
} elseif ($Version -eq "latest") {
  "https://github.com/$Repo/releases/latest/download"
} else {
  "https://github.com/$Repo/releases/download/$Version"
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("waverune-install-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Write-Host "downloading $Asset ($Version) from $Base (about 30 MB)..."
  Invoke-WebRequest -Uri "$Base/$Asset" -OutFile (Join-Path $Tmp $Asset)
  Invoke-WebRequest -Uri "$Base/SHA256SUMS.txt" -OutFile (Join-Path $Tmp "SHA256SUMS.txt")

  $Line = Get-Content (Join-Path $Tmp "SHA256SUMS.txt") | Where-Object { $_ -match ([regex]::Escape($Asset) + "$") }
  if (-not $Line) { throw "checksum for $Asset not found in SHA256SUMS.txt; refusing to install" }
  $Expected = ($Line -split "\s+")[0].ToLower()
  $Actual = (Get-FileHash (Join-Path $Tmp $Asset) -Algorithm SHA256).Hash.ToLower()
  if ($Expected -ne $Actual) { throw "checksum mismatch for $Asset; refusing to install" }

  Expand-Archive -Path (Join-Path $Tmp $Asset) -DestinationPath $Tmp -Force
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  Move-Item -Force (Join-Path $Tmp "waverune.exe") (Join-Path $BinDir "waverune.exe")
  $InstalledVersion = & (Join-Path $BinDir "waverune.exe") --version
  Write-Host "installed $BinDir\waverune.exe (version $InstalledVersion)"

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (($UserPath -split ";") -notcontains $BinDir) {
    [Environment]::SetEnvironmentVariable("Path", "$BinDir;$UserPath", "User")
    $env:Path = "$BinDir;$env:Path"
    Write-Host ""
    Write-Host "added $BinDir to your user PATH; open a new terminal for it to take effect."
  }

  Write-Host ""
  Write-Host "try it:  waverune embed input.wav -o output.wav --id 42 --key secret"
  Write-Host "         waverune detect output.wav --key secret"
  Write-Host "docs:    https://github.com/$Repo#readme"
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
