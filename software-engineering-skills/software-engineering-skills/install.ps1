param(
  [string]$ProjectPath = "."
)

$Target = Join-Path $ProjectPath ".agents\skills"
New-Item -ItemType Directory -Force -Path $Target | Out-Null

Get-ChildItem -Path $PSScriptRoot -Directory | Where-Object { $_.Name -match '^\d{2}-' } | ForEach-Object {
  $Dest = Join-Path $Target $_.Name
  Copy-Item $_.FullName -Destination $Dest -Recurse -Force
  Write-Host "Installed $($_.Name)"
}

Write-Host "Done. Skills installed to $Target"
