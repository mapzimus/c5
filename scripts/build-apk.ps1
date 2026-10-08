$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    $localJava = Get-ChildItem "$projectRoot\.android-tools\java" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($localJava) { $env:JAVA_HOME = $localJava.FullName }
    if (Test-Path "$projectRoot\.android-tools\sdk") { $env:ANDROID_HOME = "$projectRoot\.android-tools\sdk" }
    if (-not $env:JAVA_HOME -or -not $env:ANDROID_HOME) { throw 'Set JAVA_HOME (JDK 21) and ANDROID_HOME (Android SDK), or use the local .android-tools setup.' }
    $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Web build / Android sync failed.' }
    Push-Location android
    try {
        & .\gradlew.bat assembleDebug --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    } finally { Pop-Location }
    New-Item -ItemType Directory -Force artifacts | Out-Null
    Copy-Item android\app\build\outputs\apk\debug\app-debug.apk artifacts\c5-games.apk -Force
    Write-Host "APK: $projectRoot\artifacts\c5-games.apk"
} finally { Pop-Location }
