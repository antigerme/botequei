<?php
// Botequei — signaling minimalista para WebRTC (arquivo unico, sem frameworks, sem banco).
//
// Papel: apenas ajudar navegadores da mesma "mesa" a se encontrarem, trocando SDP/ICE e
// presenca durante o handshake. Depois que os DataChannels P2P abrem, este arquivo sai do
// fluxo — todo o consumo trafega direto entre os celulares.
//
// Ele NUNCA armazena dados da aplicacao (consumo/historico/participantes de forma duravel).
// As mensagens ficam em arquivos temporarios com TTL curto e sao apagadas ao serem
// entregues (poll) ou ao expirarem. Sem banco de dados, sem persistencia.

declare(strict_types=1);

// ---- Config ----
const PRESENCE_TTL = 15;    // seg. que um peer segue "vivo" sem novo poll/join
const MBOX_TTL     = 120;   // seg. ate uma caixa-postal orfa ser descartada
const MAX_BODY     = 65536; // limite defensivo do corpo da requisicao

// ---- CORS / headers ----
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }
header('Content-Type: application/json; charset=utf-8');

// ---- Helpers ----
function out($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function bad(string $msg): void { out(['error' => $msg], 400); }

// Apenas caracteres seguros para uso como nome de arquivo/sala (evita path traversal).
function clean(string $s): string { return preg_replace('/[^A-Za-z0-9_-]/', '', $s) ?? ''; }

function body_json(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '' || strlen($raw) > MAX_BODY) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function room_dir(string $room): string {
    $dir = sys_get_temp_dir() . '/botequei/' . $room;
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

// Coleta de lixo: remove presencas e caixas-postais expiradas a cada requisicao.
function gc(string $dir): void {
    $now = time();
    foreach (glob($dir . '/peer_*.json') ?: [] as $f) {
        if ($now - (int)@filemtime($f) > PRESENCE_TTL) @unlink($f);
    }
    foreach (glob($dir . '/mbox_*.ndjson') ?: [] as $f) {
        if ($now - (int)@filemtime($f) > MBOX_TTL) @unlink($f);
    }
}

function list_peers(string $dir): array {
    $peers = [];
    $now = time();
    foreach (glob($dir . '/peer_*.json') ?: [] as $f) {
        if ($now - (int)@filemtime($f) > PRESENCE_TTL) continue;
        $j = json_decode((string)@file_get_contents($f), true);
        if (is_array($j) && isset($j['peer'])) {
            $peers[] = ['peer' => $j['peer']];
        }
    }
    return $peers;
}

// Guarda SO o id opaco do peer (nunca apelido). Apelidos trafegam P2P via 'hello'.
function touch_presence(string $dir, string $peer): void {
    @file_put_contents(
        $dir . '/peer_' . $peer . '.json',
        json_encode(['peer' => $peer, 'ts' => time()]),
        LOCK_EX
    );
}

function others(array $peers, string $me): array {
    return array_values(array_filter($peers, fn($p) => ($p['peer'] ?? '') !== $me));
}

// ---- Router ----
$action = (string)($_GET['action'] ?? '');
$room   = clean((string)($_GET['room'] ?? ''));
if ($room === '') bad('room obrigatorio');
$dir = room_dir($room);
gc($dir);

switch ($action) {
    // Registra/renova presenca e devolve os peers ja presentes para o recem-chegado.
    case 'join': {
        $b = body_json();
        $peer = clean((string)($b['peer'] ?? ''));
        if ($peer === '') bad('peer obrigatorio');
        touch_presence($dir, $peer);
        out(['ok' => true, 'peers' => others(list_peers($dir), $peer)]);
    }

    // Lista de participantes ativos na sala.
    case 'peers': {
        out(['peers' => list_peers($dir)]);
    }

    // Enfileira uma mensagem de sinalizacao (offer/answer/ice) endereçada a outro peer.
    case 'send': {
        $b = body_json();
        $from = clean((string)($b['from'] ?? ''));
        $to   = clean((string)($b['to'] ?? ''));
        $type = (string)($b['type'] ?? '');
        if ($from === '' || $to === '' || $type === '') bad('from/to/type obrigatorios');
        $msg = json_encode([
            'from' => $from, 'to' => $to, 'type' => $type,
            'payload' => $b['payload'] ?? null, 'ts' => time(),
        ], JSON_UNESCAPED_UNICODE);
        $fh = fopen($dir . '/mbox_' . $to . '.ndjson', 'a');
        if ($fh) { flock($fh, LOCK_EX); fwrite($fh, $msg . "\n"); flock($fh, LOCK_UN); fclose($fh); }
        out(['ok' => true]);
    }

    // Poll curto: devolve e apaga as mensagens do peer + a lista de peers (descobre novatos).
    case 'poll': {
        $peer = clean((string)($_GET['peer'] ?? ''));
        if ($peer === '') bad('peer obrigatorio');

        touch_presence($dir, $peer); // manter presenca viva enquanto faz poll

        $messages = [];
        $mf = $dir . '/mbox_' . $peer . '.ndjson';
        if (is_file($mf)) {
            $fh = fopen($mf, 'r+');
            if ($fh) {
                flock($fh, LOCK_EX);
                $content = (string)stream_get_contents($fh);
                ftruncate($fh, 0);
                flock($fh, LOCK_UN);
                fclose($fh);
                foreach (explode("\n", $content) as $line) {
                    $line = trim($line);
                    if ($line === '') continue;
                    $m = json_decode($line, true);
                    if (is_array($m)) $messages[] = $m;
                }
            }
        }
        out(['messages' => $messages, 'peers' => others(list_peers($dir), $peer)]);
    }

    // Saida explicita: limpa presenca e caixa-postal do peer.
    case 'leave': {
        $b = body_json();
        $peer = clean((string)($b['peer'] ?? ''));
        if ($peer !== '') {
            @unlink($dir . '/peer_' . $peer . '.json');
            @unlink($dir . '/mbox_' . $peer . '.ndjson');
        }
        out(['ok' => true]);
    }

    default:
        bad('acao desconhecida');
}
