$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:8090/")
$listener.Start()

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response
    $path = "C:\Users\Oem\Desktop\site" + $context.Request.Url.LocalPath

    if (Test-Path $path) {
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $response.OutputStream.Write($bytes,0,$bytes.Length)
    } else {
        $response.StatusCode = 404
    }

    $response.Close()
}
