#requires -Version 7.0
# Build native callback diagnostic; pwsh -File tools/winfsp-build.ps1 -VcTools <version-dir> -WindowsSdk <kit-root> -SdkVersion <version> -Out <new-dir>.
param([Parameter(Mandatory)][string]$VcTools,[Parameter(Mandatory)][string]$WindowsSdk,[Parameter(Mandatory)][string]$SdkVersion,[Parameter(Mandatory)][string]$Out,[string]$WinFspRoot=(Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'WinFsp'))
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Out){throw 'Use a new build output directory'}
$cl=Join-Path $VcTools 'bin/Hostx64/x64/cl.exe'
$source=Join-Path $PSScriptRoot 'winfsp-probe.cpp'
foreach($path in @($cl,$source,(Join-Path $WinFspRoot 'inc/winfsp/winfsp.h'))){if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Missing input $path"}}
$dest=(New-Item -ItemType Directory -Path $Out).FullName
$args=@('/nologo','/std:c++17','/EHsc','/utf-8','/W4','/WX','/MT','/DUNICODE','/D_UNICODE',('/I'+(Join-Path $VcTools 'include')),('/external:I'+(Join-Path $WinFspRoot 'inc')),'/external:W0')
foreach($part in @('ucrt','shared','um','winrt')){$args+=('/I'+(Join-Path $WindowsSdk "Include/$SdkVersion/$part"))}
$args+=@($source,('/Fo'+(Join-Path $dest 'winfsp-probe.obj')),('/Fe'+(Join-Path $dest 'winfsp-probe.exe')),'/link',('/LIBPATH:'+(Join-Path $VcTools 'lib/x64')),('/LIBPATH:'+(Join-Path $WindowsSdk "Lib/$SdkVersion/ucrt/x64")),('/LIBPATH:'+(Join-Path $WindowsSdk "Lib/$SdkVersion/um/x64")),'Advapi32.lib')
& $cl @args
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
@{source=$source;sourceSha256=(Get-FileHash -LiteralPath $source).Hash;binary=(Join-Path $dest 'winfsp-probe.exe');binarySha256=(Get-FileHash -LiteralPath (Join-Path $dest 'winfsp-probe.exe')).Hash;compiler=$cl;sdk=$SdkVersion;builtAt=(Get-Date -Format o)}|ConvertTo-Json
