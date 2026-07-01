<?php
// turn.php — devolve credenciais TURN efemeras da Cloudflare para o navegador.
//
// O API token fica SO no servidor, em variavel de ambiente — nunca no cliente, nunca no git.
// Sem as variaveis configuradas, responde 204 e o app usa apenas STUN (comportamento padrao).
//
// Config (na VM):  export CF_TURN_KEY_ID=...   export CF_TURN_API_TOKEN=...   [CF_TURN_TTL=86400]

declare(strict_types=1);

header('Content-Type: application/json');
header('Cache-Control: no-store');

$keyId = getenv('CF_TURN_KEY_ID');
$token = getenv('CF_TURN_API_TOKEN');
if (!$keyId || !$token) { http_response_code(204); exit; } // TURN desligado -> cliente cai no STUN

$url  = 'https://rtc.live.cloudflare.com/v1/turn/keys/' . rawurlencode($keyId) . '/credentials/generate-ice-servers';
$ttl  = (int) (getenv('CF_TURN_TTL') ?: 86400);
$body = json_encode(['ttl' => $ttl]);
$headers = ['Authorization: Bearer ' . $token, 'Content-Type: application/json'];

$res = null; $code = 0;

if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => $body,
    ]);
    $res  = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
} else {
    // fallback sem ext-curl
    $ctx = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => implode("\r\n", $headers),
        'content'       => $body,
        'timeout'       => 5,
        'ignore_errors' => true,
    ]]);
    $res = @file_get_contents($url, false, $ctx);
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
        $code = (int) $m[1];
    }
}

if ($code < 200 || $code >= 300 || !$res) { http_response_code(204); exit; }
echo $res; // { "iceServers": [ ... ] }
