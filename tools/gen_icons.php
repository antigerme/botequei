<?php
// Gera os icones PNG do PWA a partir de um desenho vetorial em GD.
// Uso: php tools/gen_icons.php   ->  escreve icons/icon-192.png, icon-512.png, icon-maskable.png
// (Ferramenta de build; nao faz parte do runtime do app.)

declare(strict_types=1);
$OUT = __DIR__ . '/../icons';
@mkdir($OUT, 0755, true);

const M = 1024;                 // resolucao mestre (super-sampling p/ antialias)
$K = M / 512.0;                 // fator base 512 -> mestre

function chex(\GdImage $img, string $hex, int $a = 0): int {
    return imagecolorallocatealpha($img,
        hexdec(substr($hex,1,2)), hexdec(substr($hex,3,2)), hexdec(substr($hex,5,2)), $a);
}
function lerp(\GdImage $img, string $h1, string $h2, float $t): int {
    $c = fn($p)=> (int) round((1-$t)*hexdec(substr($h1,$p,2)) + $t*hexdec(substr($h2,$p,2)));
    return imagecolorallocate($img, $c(1), $c(3), $c(5));
}
function rrect(\GdImage $img,int $x1,int $y1,int $x2,int $y2,int $r,int $col): void {
    imagefilledrectangle($img,$x1+$r,$y1,$x2-$r,$y2,$col);
    imagefilledrectangle($img,$x1,$y1+$r,$x2,$y2-$r,$col);
    imagefilledellipse($img,$x1+$r,$y1+$r,2*$r,2*$r,$col);
    imagefilledellipse($img,$x2-$r,$y1+$r,2*$r,2*$r,$col);
    imagefilledellipse($img,$x1+$r,$y2-$r,2*$r,2*$r,$col);
    imagefilledellipse($img,$x2-$r,$y2-$r,2*$r,2*$r,$col);
}
// retangulo arredondado com gradiente vertical (h1 no topo, h2 embaixo)
function grrect(\GdImage $img,int $x1,int $y1,int $x2,int $y2,int $r,string $h1,string $h2): void {
    $h = max(1,$y2-$y1);
    for ($y=$y1; $y<=$y2; $y++) {
        $t = ($y-$y1)/$h;
        $dy = min($y-$y1, $y2-$y);
        $inset = $dy < $r ? (int) round($r - sqrt(max(0,$r*$r-($r-$dy)*($r-$dy)))) : 0;
        imageline($img,$x1+$inset,$y,$x2-$inset,$y, lerp($img,$h1,$h2,$t));
    }
}

function draw(bool $maskable): \GdImage {
    global $K;
    $img = imagecreatetruecolor(M, M);
    imagesavealpha($img,true);
    imagealphablending($img,false);
    imagefilledrectangle($img,0,0,M,M, imagecolorallocatealpha($img,0,0,0,127)); // transparente
    imagealphablending($img,true);

    $bgHex = '#17130c';
    // fundo: full-bleed p/ maskable, cantos arredondados p/ normal
    if ($maskable) imagefilledrectangle($img,0,0,M,M, chex($img,$bgHex));
    else           rrect($img,0,0,(int)M-1,(int)M-1,(int)(112*$K), chex($img,$bgHex));

    // conteudo desenhado em coordenadas base-512, escalado p/ caber na zona segura
    $cs = $maskable ? 0.72 : 0.92;
    $cx = M/2; $cy = M/2;
    $sx = fn($x)=> (int) round($cx + ($x-256)*$cs*$K);
    $sy = fn($y)=> (int) round($cy + ($y-256)*$cs*$K);
    $sl = fn($l)=> max(1,(int) round($l*$cs*$K));

    // alca (anel dourado, depois vazado, o corpo cobre a esquerda -> vira "C")
    imagefilledellipse($img, $sx(372), $sy(268), $sl(132), $sl(132), chex($img,'#f2b02a'));
    imagefilledellipse($img, $sx(372), $sy(268), $sl(70),  $sl(70),  chex($img,$bgHex));

    // corpo com gradiente
    grrect($img, $sx(150), $sy(182), $sx(358), $sy(410), $sl(28), '#ffd463', '#e8890b');

    // espuma
    $foam = chex($img,'#fbf4e4');
    foreach ([[186,182,40],[234,164,48],[288,170,46],[332,184,40]] as [$x,$y,$r])
        imagefilledellipse($img,$sx($x),$sy($y),$sl(2*$r),$sl(2*$r),$foam);
    rrect($img,$sx(150),$sy(176),$sx(358),$sy(210),$sl(17),$foam);

    // bolhas
    $bub = chex($img,'#fff2c8');
    foreach ([[204,300,11],[250,352,8],[300,292,9]] as [$x,$y,$r])
        imagefilledellipse($img,$sx($x),$sy($y),$sl(2*$r),$sl(2*$r),$bub);

    return $img;
}

function save_scaled(\GdImage $master,int $size,string $path): void {
    $o = imagecreatetruecolor($size,$size);
    imagesavealpha($o,true);
    imagealphablending($o,false);
    imagefilledrectangle($o,0,0,$size,$size, imagecolorallocatealpha($o,0,0,0,127));
    imagecopyresampled($o,$master,0,0,0,0,$size,$size,imagesx($master),imagesy($master));
    imagepng($o,$path);
    imagedestroy($o);
    echo "  -> $path\n";
}

$normal = draw(false);
save_scaled($normal, 512, "$OUT/icon-512.png");
save_scaled($normal, 192, "$OUT/icon-192.png");
save_scaled($normal, 180, "$OUT/apple-touch-icon.png");
imagedestroy($normal);

$mask = draw(true);
save_scaled($mask, 512, "$OUT/icon-maskable.png");
imagedestroy($mask);

echo "Icones gerados.\n";
