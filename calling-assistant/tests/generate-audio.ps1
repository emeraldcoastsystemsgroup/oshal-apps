param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($speaker.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
$fixtures = @(
  @{ name='menu-before'; text='For billing, press one. For claims, press two. For roadside assistance, press three.'; kind='digits'; value='2' },
  @{ name='menu-after'; text='Press one for sales. Press four for existing claims. Press nine for our opening hours.'; kind='digits'; value='4' },
  @{ name='speech-choice'; text='For the claims department, say claims.'; kind='say'; value='claims' },
  @{ name='human'; text='Hello. My name is Sarah. How can I help you today?'; kind='transfer'; value='' },
  @{ name='hold'; text='All our representatives are busy. Please hold. Your call is important to us.'; kind='wait'; value='' },
  @{ name='voicemail'; text='You have reached our office after hours. Please leave a message after the beep.'; kind='wait'; value='' },
  @{ name='recording'; text='This call is recorded. Please hold the line for the next representative.'; kind='wait'; value='' },
  @{ name='unknown'; text='Welcome to our service. Our opening hours are nine to five.'; kind='wait'; value='' },
  @{ name='no-match'; text='For sales, press one. For billing, press two.'; kind='wait'; value='' },
  @{ name='sensitive'; text='Please enter your social security number now.'; kind='transfer'; value='' },
  @{ name='ambiguous'; text='For new claims press one. For existing claims press two.'; kind='wait'; value='' },
  @{ name='outbound-reply'; text='claims'; kind='wait'; value='' }
)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$manifest = @()
foreach ($voice in $voices) {
  $speaker.SelectVoice($voice)
  foreach ($fixture in $fixtures) {
    $name = ($voice -replace '[^a-zA-Z0-9]','') + '-' + $fixture.name
    $speaker.Rate = if ($fixture.name -eq 'menu-after') { 1 } else { 0 }
    $speaker.SetOutputToWaveFile((Join-Path $OutputDirectory ($name + '.wav')), (New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)))
    $speaker.Speak($fixture.text)
    $speaker.SetOutputToNull()
    $manifest += @{ name=$name; file=$name+'.wav'; expected=$fixture.kind; value=$fixture.value; source='Windows speech synthesis'; voice=$voice; spoken=$fixture.text }
  }
}
$speaker.Dispose()
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $OutputDirectory 'fixtures.json')
Write-Output ('Generated ' + $manifest.Count + ' actual WAV recordings with ' + $voices.Count + ' installed voices.')
