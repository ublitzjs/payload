$server = Start-Process node -ArgumentList "tests\k6\server.mjs" -PassThru -NoNewWindow

Register-EngineEvent PowerShell.Exiting -Action {
    if (!$server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
} | Out-Null

Start-Sleep 2
k6 run tests\k6\test.ts
