#!/usr/bin/env python3
"""
Genera los iconos PNG de la aplicacion.

No hay ningun conversor de imagenes instalado (ni PIL, ni cairo, ni rsvg), asi
que se dibuja a mano: un rasterizador minimo con supermuestreo y un codificador
PNG escrito con zlib, que es parte de la biblioteca estandar.

Supermuestrear x4 y promediar es lo que da los bordes suaves. Sin eso, las
curvas del monedero quedarian escalonadas y en el telefono se notaria.
"""

import struct
import zlib
from pathlib import Path

MARCA = (16, 185, 129)   # el verde de la app
BLANCO = (255, 255, 255)
MUESTREO = 4             # 4x4 muestras por pixel


def dentro_rect_redondeado(x, y, x0, y0, x1, y1, r):
    """Punto dentro de un rectangulo de esquinas redondeadas."""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    # Solo las esquinas necesitan la prueba del circulo.
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        dentro_x = (x < x0 + r) if cx == x0 + r else (x > x1 - r)
        dentro_y = (y < y0 + r) if cy == y0 + r else (y > y1 - r)
        if dentro_x and dentro_y:
            return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return True


def dentro_circulo(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def dibujar(size, margen_rel=0.0):
    """
    Devuelve los pixeles RGB del icono.

    margen_rel encoge el dibujo dejando fondo alrededor. Lo usa la version
    'maskable' de Android, que recorta el icono en distintas formas y necesita
    una zona de seguridad para que no se coma el monedero.
    """
    pixeles = bytearray()
    m = size * margen_rel
    lado = size - 2 * m

    # Geometria en proporciones del lado util, para que escale a cualquier tamaño.
    fondo_r = lado * 0.22
    cuerpo_x0, cuerpo_y0 = m + lado * 0.20, m + lado * 0.34
    cuerpo_x1, cuerpo_y1 = m + lado * 0.80, m + lado * 0.72
    cuerpo_r = lado * 0.07
    grosor = lado * 0.052

    solapa_x0, solapa_y0 = cuerpo_x0, m + lado * 0.26
    solapa_x1, solapa_y1 = m + lado * 0.66, cuerpo_y0 + grosor

    broche_cx, broche_cy = m + lado * 0.665, m + lado * 0.53
    broche_r = lado * 0.043

    paso = 1.0 / MUESTREO
    for py in range(size):
        for px in range(size):
            r_acum = g_acum = b_acum = 0
            for sy in range(MUESTREO):
                for sx in range(MUESTREO):
                    x = px + (sx + 0.5) * paso
                    y = py + (sy + 0.5) * paso

                    # Fuera del cuadrado redondeado: transparente se ve mal en
                    # iOS, asi que se rellena con el verde de marca.
                    if not dentro_rect_redondeado(x, y, m, m, m + lado, m + lado, fondo_r):
                        color = MARCA
                    else:
                        color = MARCA
                        en_cuerpo = dentro_rect_redondeado(x, y, cuerpo_x0, cuerpo_y0, cuerpo_x1, cuerpo_y1, cuerpo_r)
                        en_hueco = dentro_rect_redondeado(
                            x, y,
                            cuerpo_x0 + grosor, cuerpo_y0 + grosor,
                            cuerpo_x1 - grosor, cuerpo_y1 - grosor,
                            max(cuerpo_r - grosor, 1),
                        )
                        en_solapa = dentro_rect_redondeado(x, y, solapa_x0, solapa_y0, solapa_x1, solapa_y1, cuerpo_r)
                        en_solapa_hueco = dentro_rect_redondeado(
                            x, y,
                            solapa_x0 + grosor, solapa_y0 + grosor,
                            solapa_x1 - grosor, solapa_y1 + grosor,
                            max(cuerpo_r - grosor, 1),
                        )
                        en_broche = dentro_circulo(x, y, broche_cx, broche_cy, broche_r)

                        trazo = (en_cuerpo and not en_hueco) or (en_solapa and not en_solapa_hueco)
                        if trazo or en_broche:
                            color = BLANCO

                    r_acum += color[0]
                    g_acum += color[1]
                    b_acum += color[2]

            n = MUESTREO * MUESTREO
            pixeles += bytes((r_acum // n, g_acum // n, b_acum // n))

    return bytes(pixeles)


def escribir_png(ruta, size, rgb):
    """Codifica RGB crudo como PNG. Cada fila lleva su byte de filtro en 0."""
    crudo = b''.join(
        b'\x00' + rgb[y * size * 3:(y + 1) * size * 3]
        for y in range(size)
    )

    def trozo(tipo, datos):
        c = tipo + datos
        return struct.pack('>I', len(datos)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    png = (
        b'\x89PNG\r\n\x1a\n'
        + trozo(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
        + trozo(b'IDAT', zlib.compress(crudo, 9))
        + trozo(b'IEND', b'')
    )
    Path(ruta).write_bytes(png)
    return len(png)


if __name__ == '__main__':
    salida = Path(__file__).resolve().parent.parent / 'public'

    trabajos = [
        ('icono-192.png', 192, 0.0),
        ('icono-512.png', 512, 0.0),
        ('icono-180.png', 180, 0.0),   # apple-touch-icon
        # Android recorta el 'maskable' en circulo, cuadrado o gota. El margen
        # del 10% deja la zona de seguridad para que no corte el dibujo.
        ('icono-maskable.png', 512, 0.10),
    ]

    for nombre, size, margen in trabajos:
        bytes_escritos = escribir_png(salida / nombre, size, dibujar(size, margen))
        print(f'  {nombre:22} {size}x{size}  {bytes_escritos:>6} bytes')
