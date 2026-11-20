$path = Join-Path $env:APPDATA "Discord\settings.json"
$key = 'DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING'

if (-not (Test-Path $path)) {
    Write-Host "settings.json not found at $path"
    return
}

$content = Get-Content $path -Raw

if ($content -match ('"' + $key + '"\s*:\s*false')) {
    $content = $content -replace ('("' + $key + '"\s*:\s*)false'), '${1}true'
    Set-Content $path $content -NoNewline
    Write-Host "DevTools enabled. Start Discord and press Ctrl+Shift+I."
    return
}

if ($content -match ('"' + $key + '"\s*:')) {
    Write-Host "DevTools already enabled."
    return
}

$newline = if ($content -match "`r`n") { "`r`n" } else { "`n" }
$lines = $content -split "`r?`n"

$closingIndex = -1
for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ($lines[$i] -match '^\s*\}\s*$') { $closingIndex = $i; break }
}

if ($closingIndex -lt 0) {
    Write-Host "Could not find closing brace in settings.json"
    return
}

$indent = "  "
foreach ($l in $lines) {
    if ($l -match '^(\s+)"') { $indent = $matches[1]; break }
}

$prevIndex = $closingIndex - 1
while ($prevIndex -ge 0 -and $lines[$prevIndex].Trim() -eq "") { $prevIndex-- }

if ($prevIndex -ge 0 -and $lines[$prevIndex] -notmatch ',\s*$') {
    $lines[$prevIndex] = $lines[$prevIndex] + ","
}

$lines = $lines[0..($closingIndex-1)] + ($indent + '"' + $key + '": true') + $lines[$closingIndex]
$content = $lines -join $newline
Set-Content $path $content -NoNewline
Write-Host "DevTools enabled. Start Discord and press Ctrl+Shift+I."