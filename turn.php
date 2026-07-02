<?php
// turn.php — credenciais TURN efemeras da Cloudflare para o navegador.
//
// Le a config de VARIAVEL DE AMBIENTE ou de um arquivo .env (fora do git).
// Precedencia: env var real do sistema/php-fpm/Apache > .env.
// O .env e procurado PRIMEIRO fora do docroot (uma pasta acima) — assim nunca e servido
// pela web. O segredo fica so no servidor; sem config, responde 204 e o app usa so STUN.
//
// Config:  export CF_TURN_KEY_ID=...  export CF_TURN_API_TOKEN=...  [CF_TURN_TTL=86400]
//   ou um arquivo .env (veja .env.example).

declare(strict_types=1);

header('Content-Type: application/json');
header('Cache-Control: no-store');

// --- leitura de config: env var, senao .env ---
function env_get(string $key): ?string {
    $v = getenv($key);
    if ($v !== false && $v !== '') return $v;
    // Apache SetEnv (.htaccess/vhost) chega via $_SERVER — tanto em mod_php quanto em
    // php-fpm (proxy_fcgi). Por isso checamos $_SERVER/$_ENV alem de getenv().
    if (!empty($_SERVER[$key])) return (string) $_SERVER[$key];
    if (!empty($_ENV[$key]))    return (string) $_ENV[$key];
    static $dot = null;
    if ($dot === null) {
        $dot = [];
        // fora do docroot primeiro (recomendado), depois ao lado (exige bloqueio no servidor)
        foreach ([__DIR__ . '/../.env', __DIR__ . '/.env'] as $p) {
            if (is_file($p) && is_readable($p)) { $dot = parse_dotenv($p); break; }
        }
    }
    return $dot[$key] ?? null;
}
function parse_dotenv(string $path): array {
    $out = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        $eq = strpos($line, '=');
        if ($eq === false) continue;
        $k = trim(substr($line, 0, $eq));
        $v = trim(substr($line, $eq + 1));
        // remove aspas envolventes, se houver
        $n = strlen($v);
        if ($n >= 2 && ($v[0] === '"' || $v[0] === "'") && $v[$n - 1] === $v[0]) $v = substr($v, 1, -1);
        if ($k !== '') $out[$k] = $v;
    }
    return $out;
}

$keyId = env_get('CF_TURN_KEY_ID');
$token = env_get('CF_TURN_API_TOKEN');
if (!$keyId || !$token) { http_response_code(204); exit; } // TURN desligado -> cliente cai no STUN

$url  = 'https://rtc.live.cloudflare.com/v1/turn/keys/' . rawurlencode($keyId) . '/credentials/generate-ice-servers';
$ttl  = (int) (env_get('CF_TURN_TTL') ?: 86400);
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
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})/', $http_response_header[0], $m)) {
        $code = (int) $m[1];
    }
}

if ($code < 200 || $code >= 300 || !$res) { http_response_code(204); exit; }
echo $res; // { "iceServers": [ ... ] }
