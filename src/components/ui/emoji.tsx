/**
 * Elegir el emoji del avatar.
 *
 * Eran 32 curados, con el argumento de que en 40px la mayoria no se distingue.
 * Es cierto para los emojis densos —una escena con cinco elementos— pero no
 * para la enorme mayoria, y 32 se agotan rapido cuando la gracia es que cada
 * uno se sienta suyo.
 *
 * Ahora: un buscador sobre una lista amplia, con los de siempre arriba como
 * atajo. El buscador es lo que hace usable una lista larga; sin el seria un
 * muro de emojis.
 */

import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils.ts';
import { Campo, Icono } from './base.tsx';

/** Los de antes, que siguen siendo los que mejor se leen en chico. */
const FAVORITOS = [
  '🦊', '🐱', '🐶', '🐼', '🦁', '🐧', '🦉', '🐢',
  '🌿', '🌻', '🌊', '🔥', '⭐', '🌙', '☀️', '🍀',
];

/**
 * El resto, con las palabras con que se los busca.
 *
 * La lista es a mano y no el set Unicode entero: con el set completo el
 * buscador devuelve cosas que nadie quiere de avatar, y sin nombres en
 * español no se podria buscar «gato» y encontrar 🐱.
 */
const EMOJIS: [string, string][] = [
  ['🦊', 'zorro'], ['🐱', 'gato michi'], ['🐶', 'perro can'], ['🐼', 'panda oso'],
  ['🦁', 'leon'], ['🐧', 'pinguino'], ['🦉', 'buho lechuza'], ['🐢', 'tortuga'],
  ['🐙', 'pulpo'], ['🦋', 'mariposa'], ['🐝', 'abeja'], ['🐬', 'delfin'],
  ['🦅', 'aguila'], ['🦄', 'unicornio'], ['🐸', 'rana sapo'], ['🐨', 'koala'],
  ['🦒', 'jirafa'], ['🐘', 'elefante'], ['🦩', 'flamenco'], ['🦜', 'loro'],
  ['🐳', 'ballena'], ['🦈', 'tiburon'], ['🐞', 'vaquita mariquita'], ['🦔', 'erizo'],
  ['🐻', 'oso'], ['🐰', 'conejo'], ['🐹', 'hamster'], ['🦝', 'mapache'],
  ['🌿', 'planta hoja'], ['🌻', 'girasol flor'], ['🌸', 'flor cerezo'], ['🌵', 'cactus'],
  ['🍀', 'trebol suerte'], ['🌴', 'palmera'], ['🍄', 'hongo'], ['🌹', 'rosa'],
  ['🌊', 'ola mar agua'], ['🔥', 'fuego llama'], ['⭐', 'estrella'], ['🌙', 'luna'],
  ['☀️', 'sol'], ['⚡', 'rayo'], ['❄️', 'nieve copo'], ['🌈', 'arcoiris'],
  ['💧', 'gota agua'], ['🏔️', 'montaña'], ['🌋', 'volcan'], ['🪨', 'piedra roca'],
  ['🎸', 'guitarra'], ['🎹', 'piano teclado'], ['🥁', 'bateria tambor'], ['🎤', 'microfono cantar'],
  ['🎧', 'auriculares musica'], ['🎨', 'arte pintura'], ['🎬', 'cine pelicula'], ['📷', 'camara foto'],
  ['📚', 'libros leer'], ['✏️', 'lapiz escribir'], ['🖌️', 'pincel'], ['🎭', 'teatro'],
  ['⚽', 'futbol pelota'], ['🏀', 'basquet'], ['🎾', 'tenis'], ['🏐', 'voley'],
  ['🏄', 'surf'], ['🚴', 'bici ciclismo'], ['🏊', 'natacion nadar'], ['🧗', 'escalada'],
  ['🥊', 'boxeo'], ['⛷️', 'esqui'], ['🤸', 'gimnasia'], ['🧘', 'yoga meditar'],
  ['🎮', 'videojuego gamer'], ['🎲', 'dados juego'], ['🧩', 'rompecabezas puzzle'], ['♟️', 'ajedrez'],
  ['🍕', 'pizza'], ['🍔', 'hamburguesa'], ['🌮', 'taco'], ['🍣', 'sushi'],
  ['☕', 'cafe'], ['🍺', 'cerveza'], ['🍷', 'vino'], ['🧉', 'mate'],
  ['🍫', 'chocolate'], ['🍦', 'helado'], ['🥑', 'palta aguacate'], ['🍉', 'sandia'],
  ['🚀', 'cohete espacio'], ['✈️', 'avion viaje'], ['🚗', 'auto coche'], ['🛵', 'moto'],
  ['⛵', 'velero barco'], ['🚲', 'bicicleta'], ['🏕️', 'camping carpa'], ['🗺️', 'mapa'],
  ['💎', 'diamante gema'], ['👑', 'corona rey'], ['🎯', 'diana objetivo'], ['🧿', 'ojo turco'],
  ['🔮', 'bola cristal magia'], ['🪐', 'planeta saturno'], ['🧲', 'iman'], ['🔑', 'llave'],
  ['💡', 'idea lampara'], ['🧠', 'cerebro'], ['❤️', 'corazon amor'], ['🫀', 'corazon organo'],
  ['😀', 'cara feliz sonrisa'], ['😎', 'lentes cool'], ['🤓', 'nerd'], ['🥳', 'fiesta'],
  ['😇', 'angel'], ['🤠', 'vaquero'], ['🦸', 'heroe'], ['🧙', 'mago'],
  ['👻', 'fantasma'], ['🤖', 'robot'], ['👽', 'alien'], ['🐉', 'dragon'],
];

export function SelectorEmoji({ valor, alElegir, color }: {
  valor: string;
  alElegir: (emoji: string) => void;
  color: string;
}) {
  const [busqueda, setBusqueda] = useState('');

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return FAVORITOS;
    return EMOJIS.filter(([e, palabras]) => palabras.includes(q) || e === q)
      .map(([e]) => e)
      .slice(0, 48);
  }, [busqueda]);

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Campo
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar: gato, fuego, guitarra..."
          type="search"
          className="pl-9"
        />
        <Icono
          nombre="search-x"
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 txt-3 pointer-events-none"
        />
      </div>

      {busqueda.trim() && visibles.length === 0 && (
        <p className="t-nota txt-3 px-1">Nada con esa palabra. Prueba con otra.</p>
      )}

      <div className="grid grid-cols-8 gap-1.5">
        {/* Sin emoji = vuelve a las iniciales. */}
        {!busqueda.trim() && (
          <button
            onClick={() => alElegir('')}
            aria-label="Sin emoji, usar iniciales"
            className={cn(
              'aspect-square rounded-xl flex items-center justify-center t-nota font-semibold transition-transform active:scale-90',
              valor === '' ? 'text-white' : 'superficie-2 txt-3',
            )}
            style={valor === '' ? { background: color } : undefined}
          >
            Aa
          </button>
        )}
        {visibles.map((e) => (
          <button
            key={e}
            onClick={() => alElegir(e)}
            aria-label={`Emoji ${e}`}
            className={cn(
              'aspect-square rounded-xl flex items-center justify-center t-glifo transition-transform active:scale-90',
              valor === e ? 'ring-2' : 'superficie-2',
            )}
            style={valor === e
              ? { background: `color-mix(in srgb, ${color} 18%, var(--superficie))`, '--tw-ring-color': color } as React.CSSProperties
              : undefined}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
