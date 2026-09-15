# Yeni sürümü derler ve GitHub Releases'e yayınlar.
# Kullanım: package.json içindeki "version" değerini artır, commit'le, sonra: npm run release
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
$repo = 'jordenss00-coder/tft-asistan'

if (git status --porcelain --untracked-files=no) { throw 'Commit edilmemiş değişiklikler var. Önce commit et.' }
gh release view $tag --repo $repo *> $null
if ($LASTEXITCODE -eq 0) { throw "$tag zaten yayınlanmış. package.json içindeki sürümü artır." }

Write-Host "==> $tag derleniyor"
if (Test-Path dist) { Remove-Item dist -Recurse -Force }
npx electron-builder --win nsis --publish never
if ($LASTEXITCODE -ne 0) { throw 'Derleme başarısız.' }

$exe = "dist/TFT-Asistan-Setup-$version.exe"
$files = @($exe, "$exe.blockmap", 'dist/latest.yml')
foreach ($f in $files) { if (-not (Test-Path $f)) { throw "Eksik derleme çıktısı: $f" } }

Write-Host "==> $tag etiketi gönderiliyor"
git tag $tag
git push origin $tag

Write-Host "==> GitHub sürümü oluşturuluyor"
gh release create $tag @files --repo $repo --title "TFT Asistan $version" --notes "Kurulum için TFT-Asistan-Setup-$version.exe dosyasını indir. Kurulu uygulamalar bu sürümü otomatik olarak alır."
if ($LASTEXITCODE -ne 0) { throw 'Sürüm oluşturulamadı.' }
Write-Host "==> Yayınlandı: https://github.com/$repo/releases/tag/$tag"
