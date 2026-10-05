/**
 * Selector de periodo: dia, semana, mes, año o rango libre.
 *
 * Tocar el encabezado de fecha lo abre. Las flechas a los costados mueven el
 * periodo sin abrir nada, que es el gesto mas frecuente por lejos (ver el mes
 * anterior). Elegir OTRO tipo de periodo es mucho menos habitual, asi que vive
 * un toque mas adentro.
 */

import { useState } from 'react';
import {
  describirPeriodo, moverPeriodo, periodoAnio, periodoDia, periodoMes,
  periodoRango, periodoSemana, periodoTodo, type Periodo, type TipoPeriodo,
} from '@shared/periodo';
import { aInputDate, deInputDate, mayusculaInicial } from '../../lib/utils.ts';
import { Boton, Campo, Hoja, Icono } from './base.tsx';
import { cn } from '../../lib/utils.ts';

const TIPOS: { id: TipoPeriodo; etiqueta: string }[] = [
  { id: 'dia', etiqueta: 'Día' },
  { id: 'semana', etiqueta: 'Semana' },
  { id: 'mes', etiqueta: 'Mes' },
  { id: 'anio', etiqueta: 'Año' },
  { id: 'rango', etiqueta: 'Rango' },
  { id: 'todo', etiqueta: 'Todo' },
];

export function SelectorPeriodo({ periodo, alCambiar }: {
  periodo: Periodo;
  alCambiar: (p: Periodo) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [desde, setDesde] = useState(aInputDate(periodo.desde));
  const [hasta, setHasta] = useState(aInputDate(periodo.hasta));

  // Un rango libre o "todo" no tienen un siguiente evidente, asi que las
  // flechas se apagan en vez de no hacer nada al tocarlas.
  const movible = periodo.tipo !== 'rango' && periodo.tipo !== 'todo';
  // No dejar avanzar hacia un futuro que todavia no existe.
  const haySiguiente = movible && periodo.hasta < Date.now();

  function elegirTipo(tipo: TipoPeriodo) {
    const ahora = Date.now();
    switch (tipo) {
      case 'dia': alCambiar(periodoDia(ahora)); break;
      case 'semana': alCambiar(periodoSemana(ahora)); break;
      case 'mes': alCambiar(periodoMes(ahora)); break;
      case 'anio': alCambiar(periodoAnio(ahora)); break;
      case 'todo': alCambiar(periodoTodo()); break;
      case 'rango': return; // el rango se aplica con su boton
    }
    setAbierto(false);
  }

  return (
    <>
      {/* Una fila fina y no una barra de 40px.
          Con el patrimonio ya arriba de todo, esta era la unica fila que
          seguia empujando los numeros hacia abajo: dos botones grandes a los
          costados de un texto centrado, para algo que se toca de vez en
          cuando. Los botones bajan a 32px —que sigue siendo tocable con el
          margen de la fila— y la fila entera se achica. */}
      <div className="flex items-center justify-between gap-1">
        <button
          onClick={() => movible && alCambiar(moverPeriodo(periodo, -1))}
          disabled={!movible}
          aria-label="Período anterior"
          className="w-8 h-8 rounded-lg flex items-center justify-center txt-3 disabled:opacity-25 shrink-0 active:superficie-2 transition-colors"
        >
          <Icono nombre="chevron-left" size={18} />
        </button>

        {/* min-w-0: sin eso el boton no baja de lo que mide su texto, y a
            320px "Septiembre de 2026" empujaba la flecha fuera de pantalla. */}
        <button
          onClick={() => setAbierto(true)}
          className="flex-1 min-w-0 min-h-8 rounded-lg flex items-center justify-center gap-1 px-2 active:superficie-2 transition-colors"
        >
          <span className="t-fila font-semibold txt truncate">
            {mayusculaInicial(describirPeriodo(periodo))}
          </span>
          <Icono nombre="chevron-down" size={13} className="txt-3 shrink-0" />
        </button>

        <button
          onClick={() => haySiguiente && alCambiar(moverPeriodo(periodo, 1))}
          disabled={!haySiguiente}
          aria-label="Período siguiente"
          className="w-8 h-8 rounded-lg flex items-center justify-center txt-3 disabled:opacity-25 shrink-0 active:superficie-2 transition-colors"
        >
          <Icono nombre="chevron-right" size={18} />
        </button>
      </div>

      <Hoja abierta={abierto} alCerrar={() => setAbierto(false)} titulo="Período">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {TIPOS.map((t) => (
              <button
                key={t.id}
                onClick={() => elegirTipo(t.id)}
                className={cn(
                  'min-h-11 rounded-xl t-fila font-medium border transition-all',
                  periodo.tipo === t.id
                    ? 'bg-marca-600 text-white border-transparent'
                    : 'superficie-2 borde txt-2',
                )}
              >
                {t.etiqueta}
              </button>
            ))}
          </div>

          {/* El rango necesita sus dos fechas, asi que se despliega al elegirlo. */}
          {periodo.tipo === 'rango' && (
            <div className="space-y-3 pt-1">
              <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              <Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              <Boton
                onClick={() => {
                  alCambiar(periodoRango(deInputDate(desde), deInputDate(hasta)));
                  setAbierto(false);
                }}
                className="w-full min-h-12"
              >
                Aplicar
              </Boton>
            </div>
          )}

          {periodo.tipo !== 'rango' && (
            <button
              onClick={() => {
                setDesde(aInputDate(periodo.desde));
                setHasta(aInputDate(periodo.hasta));
                alCambiar(periodoRango(periodo.desde, periodo.hasta));
              }}
              className="w-full min-h-11 rounded-xl superficie-2 borde border t-fila txt-2 flex items-center justify-center gap-2"
            >
              <Icono nombre="calendar-days" size={16} /> Elegir un rango exacto
            </button>
          )}
        </div>
      </Hoja>
    </>
  );
}
