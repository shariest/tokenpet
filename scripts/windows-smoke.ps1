$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ("tokenpet test's " + [char]0xD55C + [char]0xAE00 + '-' + [guid]::NewGuid().ToString('N'))
$originalUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$originalPath = $env:Path
$env:TOKENPET_INSTALL_DIR = Join-Path $root 'app'
$env:TOKENPET_BIN_DIR = Join-Path $root 'bin'
$env:TOKENPET_DATA_DIR = Join-Path $root 'game'
$env:CODEX_HOME = Join-Path $root 'codex'
$env:CLAUDE_CONFIG_DIR = Join-Path $root 'claude'
$env:TOKENPET_WATCH = '0'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$env:TOKENPET_PORT = [string]$listener.LocalEndpoint.Port
$listener.Stop()
New-Item -ItemType Directory -Force -Path $env:CLAUDE_CONFIG_DIR | Out-Null
$originalStatusline = "printf 'original-statusline\n'; cat"
[IO.File]::WriteAllText((Join-Path $env:CLAUDE_CONFIG_DIR 'settings.json'), (@{ statusLine = @{ type = 'command'; command = $originalStatusline } } | ConvertTo-Json))

function Assert-That($condition, $message) { if (-not $condition) { throw $message } }
function Stop-TestServer {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -match 'tokenpet.mjs"? server'
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
    & "$PSScriptRoot\..\install.ps1"
    $command = Join-Path $env:TOKENPET_BIN_DIR 'tokenpet.cmd'
    $status = & $command status
    Assert-That ($LASTEXITCODE -eq 0 -and "$status" -match '300 C') 'Local installation failed.'
    $roster = & $command list
    Assert-That ($LASTEXITCODE -eq 0 -and "$roster" -match '\[[a-z]+\].*Lv\.1' -and "$roster" -match '/100') 'Random first pet list failed.'
    Assert-That (Test-Path -LiteralPath (Join-Path $env:CODEX_HOME 'skills\pet\SKILL.md')) 'Codex skill missing.'
    Assert-That (Test-Path -LiteralPath (Join-Path $env:CLAUDE_CONFIG_DIR 'commands\pet.md')) 'Claude command missing.'
    Assert-That ((Get-Content -LiteralPath (Join-Path $env:CODEX_HOME 'config.toml') -Raw) -match 'custom:tokenpet') 'Codex pet was not selected.'
    foreach ($cli in @('claude', 'codex')) {
        $registration = & $cli mcp get tokenpet
        Assert-That ($LASTEXITCODE -eq 0 -and "$registration" -match 'tokenpet.mjs') "$cli MCP registration failed."
    }
    $settings = Get-Content -LiteralPath (Join-Path $env:CLAUDE_CONFIG_DIR 'settings.json') -Raw | ConvertFrom-Json
    $statusArgs = $settings.statusLine.command.Split(' ') | Select-Object -Skip 1
    $env:COLUMNS = '100'
    $env:LINES = '24'
    $footer = '{"test":"preserved-input"}' | & powershell.exe @statusArgs
    Assert-That ($LASTEXITCODE -eq 0 -and "$footer" -match 'original-statusline' -and "$footer" -match 'preserved-input' -and "$footer" -match 'Lv\.1' -and "$footer" -match '/100' -and "$footer" -match '[\u2580\u2584\u2588]' -and @($footer).Count -eq 8) ("Claude statusline must preserve the existing HUD and pixel character. Received $(@($footer).Count) rows: " + ($footer -join ' | '))

    Stop-TestServer
    $env:TOKENPET_TEST_MCP = (& codex mcp get tokenpet --json) -join "`n"
    Assert-That ($LASTEXITCODE -eq 0) 'Could not read the registered MCP transport.'
    @'
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const { transport } = JSON.parse(process.env.TOKENPET_TEST_MCP);
const client = new Client({ name: 'windows-install-test', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ ...transport, env: { ...process.env, ...transport.env }, stderr: 'pipe' }));
  const result = await client.callTool({ name: 'pet_status', arguments: {} });
  assert.ok(!result.isError && result.content[0].text.includes('400 C') && result.content[0].text.includes('/100'));
  const checkin = await client.callTool({ name: 'pet_checkin', arguments: {} });
  assert.ok(!checkin.isError && checkin.content[0].text.includes('400 C'));
} finally { await client.close(); }
'@ | & node --input-type=module
    Assert-That ($LASTEXITCODE -eq 0) 'Registered MCP failed to start the local server and return pet status.'
    Remove-Item Env:TOKENPET_TEST_MCP

    $env:TOKENPET_API_KEY_FILE = Join-Path $env:TOKENPET_DATA_DIR 'api-key'
    & "$PSScriptRoot\..\install.ps1" -Endpoint "http://127.0.0.1:$($env:TOKENPET_PORT)/api"
    $saved = Get-Content -LiteralPath (Join-Path $env:TOKENPET_DATA_DIR 'connection.json') -Raw | ConvertFrom-Json
    Assert-That ($saved.server -eq "http://127.0.0.1:$($env:TOKENPET_PORT)") 'Endpoint normalization failed.'
    $previous = Get-Content -LiteralPath (Join-Path $env:TOKENPET_DATA_DIR 'previous-statusline.json') -Raw | ConvertFrom-Json
    Assert-That ($previous.command -eq $originalStatusline) 'Reinstall replaced the original statusline backup.'
    Remove-Item Env:TOKENPET_API_KEY_FILE
    & "$PSScriptRoot\..\install.ps1"
    $updated = Get-Content -LiteralPath (Join-Path $env:TOKENPET_DATA_DIR 'connection.json') -Raw | ConvertFrom-Json
    Assert-That ($updated.server -eq $saved.server -and $updated.key -eq $saved.key) 'Default update replaced the existing server connection.'
    $status = & $command status
    Assert-That ($LASTEXITCODE -eq 0 -and "$status" -match '400 C') 'Saved endpoint did not survive a new process.'

    $env:Path = (($originalPath -split ';') | Where-Object { $_ -and -not (Test-Path -LiteralPath (Join-Path $_ 'node.exe')) }) -join ';'
    Assert-That (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) 'The bootstrap fixture still has Node.js on PATH.'
    $env:TOKENPET_INSTALL_DIR = Join-Path $root 'without-node'
    $env:TOKENPET_BIN_DIR = Join-Path $root 'without-node-bin'
    & "$PSScriptRoot\..\install.ps1" -Local
    $runtime = @(Get-ChildItem -LiteralPath $env:TOKENPET_INSTALL_DIR -Directory -Filter 'node-v24*-win-*')
    Assert-That ($runtime.Count -eq 1) 'Private Node.js bootstrap failed.'
    $env:Path = (($env:Path -split ';') | Where-Object { $_ -and -not (Test-Path -LiteralPath (Join-Path $_ 'node.exe')) }) -join ';'
    $status = & (Join-Path $env:TOKENPET_BIN_DIR 'tokenpet.cmd') status
    Assert-That ($LASTEXITCODE -eq 0 -and "$status" -match '400 C') 'Installed command requires Node.js on PATH.'

    $removal = & (Join-Path $env:TOKENPET_BIN_DIR 'tokenpet.cmd') uninstall --purge
    Assert-That ($LASTEXITCODE -eq 0) ("Uninstall failed: " + ($removal -join ' | '))
    $started = Get-Date
    while ((Test-Path -LiteralPath $env:TOKENPET_INSTALL_DIR) -and ((Get-Date) - $started).TotalSeconds -lt 120) { Start-Sleep -Milliseconds 500 }
    Write-Host ("Program folder check finished after {0:N1}s" -f ((Get-Date) - $started).TotalSeconds)
    $holders = (Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe', 'codex.exe') -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'EncodedCommand') } | ForEach-Object { $line = "$($_.ProcessId) $($_.Name) $($_.CreationDate) $($_.CommandLine)"; $line.Substring(0, [Math]::Min(300, $line.Length)) }) -join ' | '
    $left = @(Get-ChildItem -LiteralPath $env:TOKENPET_INSTALL_DIR -Recurse -Force -ErrorAction SilentlyContinue)
    $cleanupLog = Join-Path ([IO.Path]::GetTempPath()) 'tokenpet-uninstall.log'
    $diagnostics = ' Output: ' + ($removal -join ' | ') + ' Cleanup log: ' + $(if (Test-Path -LiteralPath $cleanupLog) { Get-Content -LiteralPath $cleanupLog -Raw } else { 'none' }) + " Processes: $holders Left: $($left.Count) " + (($left | Select-Object -First 3 | ForEach-Object { "$($_.FullName.Length) $($_.FullName)" }) -join ' | ')
    Assert-That (-not (Test-Path -LiteralPath $env:TOKENPET_INSTALL_DIR)) ('Uninstall left the program folder.' + $diagnostics)
    Assert-That (-not (Test-Path -LiteralPath (Join-Path $env:TOKENPET_BIN_DIR 'tokenpet.cmd'))) ('Uninstall left the launcher command.' + $diagnostics)
    Assert-That (-not (Test-Path -LiteralPath $env:TOKENPET_DATA_DIR)) ('Uninstall --purge left the game data.' + $diagnostics)
    $settings = Get-Content -LiteralPath (Join-Path $env:CLAUDE_CONFIG_DIR 'settings.json') -Raw | ConvertFrom-Json
    Assert-That ($settings.statusLine.command -eq $originalStatusline) 'Uninstall did not restore the original statusline.'
    Assert-That (-not (Test-Path -LiteralPath (Join-Path $env:CLAUDE_CONFIG_DIR 'commands\pet.md'))) 'Uninstall left the Claude command.'
    Assert-That (-not (Test-Path -LiteralPath (Join-Path $env:CODEX_HOME 'skills\pet'))) 'Uninstall left the Codex skill.'
    Assert-That ((Get-Content -LiteralPath (Join-Path $env:CODEX_HOME 'config.toml') -Raw) -notmatch 'custom:tokenpet') 'Uninstall left the Codex pet selected.'
    $env:Path = $originalPath
    foreach ($cli in @('claude', 'codex')) {
        # Windows PowerShell turns redirected native stderr into a terminating error under Stop.
        $ErrorActionPreference = 'Continue'
        & $cli mcp get tokenpet *> $null
        $ErrorActionPreference = 'Stop'
        Assert-That ($LASTEXITCODE -ne 0) "$cli still has the TokenPet MCP."
    }
    # The expected lookup failures above must not become the step's exit code.
    $global:LASTEXITCODE = 0
    Write-Host 'PASS: local install, real CLI registration, MCP server startup, statusline, update, endpoint persistence, private Node.js bootstrap, and uninstall.'
} finally {
    Stop-TestServer
    [Environment]::SetEnvironmentVariable('Path', $originalUserPath, 'User')
    $env:Path = $originalPath
    # A cleanup error must not replace the test result.
    try { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue } catch { Write-Host "Could not remove the test folder: $_" }
}
