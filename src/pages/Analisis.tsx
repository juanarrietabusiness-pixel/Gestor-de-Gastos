/**
 * Graficos y tendencias.
 *
 * Recharts se carga aparte (ver manualChunks en vite.config.ts): es la
 * dependencia mas pesada y no tiene sentido descargarla al abrir la app si
 * esta pantalla se visita de vez en cuando.
 */

import { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, Cell, Legend, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useStore } from '../store/store.tsx';
import { formatMonto } from '@shared/money';
import {
  balancePorMes, claveMes, filtrarPorEntidad, porCategoria, porPersona,
  resultadoPorEntidad, resumir, transaccionesDelMes,
} from '@shared/domain';
import { dentroDe, periodoMes, type Periodo } from '@shared/periodo';
import { cn, moverMes } from '../lib/utils.ts';
import { Ficha, Tarjeta, Vacio } from '../components/ui/base.tsx';
import { SelectorPeriodo } from '../components/ui/periodo.tsx';
import { decimalesDe } from '@shared/money';

/**
 * Recharts entrega el valor como number | string | array, asi que se
 * normaliza antes de formatear en vez de asumir que siempre es un numero.
 */
const formatearEje = (v: unknown, moneda: string, decimales: number): string => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? formatMonto(Math.round(n * 10 ** decimales), moneda) : '';
};

export function Analisis() {
  const {
    transactions: todos, categories, categoriasTodas, entities, entidadActiva, members,
    household,
  } = useStore();
  const moneda = household?.currency ?? 'USD';
  const decimales = decimalesDe(moneda);

  const [periodo, setPeriodo] = useState<Periodo>(() => periodoMes(Date.now()));

  // Los dos graficos de abajo son mes a mes por definicion: no siguen al rango,
  // siguen al mes donde termina. Cortar una barra mensual por la mitad de un
  // rango daria una tendencia que no existe.
  const mes = claveMes(Math.min(periodo.hasta, Date.now()));

  // Todo lo de abajo respeta la entidad elegida. En "Todo" no filtra nada,
  // que es la vista consolidada.
  const transactions = useMemo(
    () => filtrarPorEntidad(todos, categoriasTodas, entidadActiva),
    [todos, categoriasTodas, entidadActiva],
  );

  const delMes = useMemo(
    () => transactions.filter((t) => dentroDe(t.date, periodo)),
    [transactions, periodo],
  );
  const resumen = useMemo(() => resumir(delMes), [delMes]);

  const torta = useMemo(
    () => porCategoria(delMes, categories, 'gasto')
      .filter((x) => x.totalMinor > 0)
      .map((x) => ({
        nombre: x.category?.name ?? 'Sin categoría',
        valor: x.totalMinor / 10 ** decimales,
        minor: x.totalMinor,
        color: x.category?.color ?? '#64748b',
      })),
    [delMes, categories, decimales],
  );

  /** Ultimos 6 meses de ingresos contra gastos. */
  const tendencia = useMemo(() => {
    const meses: string[] = [];
    for (let i = 5; i >= 0; i--) meses.push(moverMes(mes, -i));

    return meses.map((m) => {
      const r = resumir(transaccionesDelMes(transactions, m));
      return {
        mes: new Date(`${m}-02`).toLocaleDateString('es', { month: 'short' }),
        Ingresos: r.ingresoMinor / 10 ** decimales,
        Gastos: r.gastoMinor / 10 ** decimales,
      };
    });
  }, [transactions, mes, decimales]);

  /**
   * Balance mes a mes del ultimo año, con su acumulado.
   *
   * El balance de un mes dice si ese mes se cerro en positivo; el acumulado
   * dice a donde va la cosa. Un mes malo suelto no significa nada, una linea
   * acumulada que baja sostenido si.
   */
  const balances = useMemo(() => {
    const meses: string[] = [];
    for (let i = 11; i >= 0; i--) meses.push(moverMes(mes, -i));

    return balancePorMes(transactions, meses).map(({ periodo, resumen: r, acumuladoMinor }) => ({
      mes: new Date(`${periodo}-02`).toLocaleDateString('es', { month: 'short' }),
      periodo,
      Balance: r.flujoMinor / 10 ** decimales,
      Acumulado: acumuladoMinor / 10 ** decimales,
    }));
  }, [transactions, mes, decimales]);

  const mesesConDatos = balances.filter((b) => b.Balance !== 0).length;
  const mejor = balances.reduce((a, b) => (b.Balance > a.Balance ? b : a), balances[0]);
  const peor = balances.reduce((a, b) => (b.Balance < a.Balance ? b : a), balances[0]);

  const personas = useMemo(() => porPersona(delMes, members), [delMes, members]);

  const hayDatos = delMes.length > 0;

  /**
   * Ingresos menos gastos, por economia, en el mes que se esta mirando.
   *
   * Es la pregunta que la app no podia responder: no cuanto capital hay, sino
   * si el negocio da. Solo aparece en la vista consolidada, porque dentro de
   * una entidad ya lo dice el resumen de arriba.
   */
  const porEntidad = useMemo(() => {
    if (entidadActiva !== null) return [];
    const nombres = new Map(entities.map((e) => [e.id, e]));
    return resultadoPorEntidad(todos.filter((t) => dentroDe(t.date, periodo)), categories)
      .filter((r) => r.cantidad > 0)
      .map((r) => ({ ...r, entidad: r.entityId ? nombres.get(r.entityId) : undefined }));
  }, [entidadActiva, entities, todos, categories, periodo]);

  return (
    <div className="space-y-4">
      <SelectorPeriodo periodo={periodo} alCambiar={setPeriodo} />

      {porEntidad.length > 1 && (
        <Tarjeta>
          <p className="t-nota txt-2 mb-3">Resultado por economía</p>
          <div className="space-y-2.5">
            {porEntidad.map((r) => (
              <div key={r.entityId ?? 'sin'} className="flex items-center gap-3">
                <Ficha
                  color={r.entidad?.color ?? '#64748b'}
                  icono={r.entidad?.icon ?? 'circle-help'}
                  size={36}
                />
                <div className="flex-1 min-w-0">
                  <p className="t-fila font-medium txt truncate">
                    {r.entidad?.name ?? 'Sin clasificar'}
                  </p>
                  <p className="t-nota txt-3 tabular">
                    {formatMonto(r.ingresoMinor, moneda, { compacto: true })} entró ·{' '}
                    {formatMonto(r.gastoMinor, moneda, { compacto: true })} salió
                  </p>
                </div>
                <p className={cn(
                  't-fila font-semibold tabular shrink-0',
                  r.resultadoMinor < 0 ? 'text-red-500' : 'text-marca-600 dark:text-marca-500',
                )}>
                  {r.resultadoMinor > 0 ? '+' : ''}{formatMonto(r.resultadoMinor, moneda)}
                </p>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      {!hayDatos ? (
        <Tarjeta>
          <Vacio
            icono="chart-pie"
            titulo="Sin datos en este período"
            texto="Cuando registren movimientos vas a ver acá en qué se va la plata y cómo evoluciona mes a mes."
          />
        </Tarjeta>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Tarjeta className="p-4">
              <p className="t-nota txt-2 mb-1">Entró</p>
              <p className="t-monto font-semibold tabular text-marca-600 dark:text-marca-500">
                {formatMonto(resumen.ingresoMinor, moneda, { compacto: true })}
              </p>
            </Tarjeta>
            <Tarjeta className="p-4">
              <p className="t-nota txt-2 mb-1">Salió</p>
              {/* Neutro, no rojo. Gastar no es un problema: es para lo que esta
                  la plata. El rojo se guarda para lo que si lo es. */}
              <p className="t-monto font-semibold tabular txt">
                {formatMonto(resumen.gastoMinor, moneda, { compacto: true })}
              </p>
            </Tarjeta>
          </div>

          {torta.length > 0 && (
            <Tarjeta>
              <h2 className="t-seccion font-semibold txt mb-3.5">Gastos por categoría</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={torta}
                      dataKey="valor"
                      nameKey="nombre"
                      innerRadius="52%"
                      outerRadius="80%"
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {torta.map((d) => <Cell key={d.nombre} fill={d.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v) => formatearEje(v, moneda, decimales)}
                      contentStyle={{
                        background: 'var(--superficie)',
                        border: '1px solid var(--borde)',
                        borderRadius: 12,
                        color: 'var(--texto)',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2 mt-2">
                {torta.slice(0, 6).map((d) => (
                  <div key={d.nombre} className="flex items-center gap-2.5 t-fila">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="flex-1 txt-2 truncate">{d.nombre}</span>
                    <span className="tabular txt shrink-0">{formatMonto(d.minor, moneda)}</span>
                    <span className="tabular txt-3 t-nota w-10 text-right shrink-0">
                      {resumen.gastoMinor > 0 ? Math.round((d.minor / resumen.gastoMinor) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </Tarjeta>
          )}

          {/* Balance mensual: barras que cruzan el cero, verde arriba y rojo
              abajo, con la linea del acumulado encima. */}
          {mesesConDatos > 1 && (
            <Tarjeta>
              <h2 className="t-seccion font-semibold txt mb-1">Balance mes a mes</h2>
              <p className="t-nota txt-3 mb-3">Último año. La línea es el acumulado.</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={balances} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradAcum" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="mes"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: 'var(--texto-3)' }}
                      interval={0}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: 'var(--texto-3)' }}
                      tickFormatter={(v: number) =>
                        new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v)}
                    />
                    {/* El cero es la referencia que separa un mes bueno de uno malo. */}
                    <ReferenceLine y={0} stroke="var(--texto-3)" strokeWidth={1} />
                    <Tooltip
                      formatter={(v, n) => [formatearEje(v, moneda, decimales), String(n)]}
                      contentStyle={{
                        background: 'var(--superficie)',
                        border: '1px solid var(--borde)',
                        borderRadius: 12,
                        color: 'var(--texto)',
                      }}
                      cursor={{ stroke: 'var(--borde)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Balance" radius={[4, 4, 0, 0]} maxBarSize={22}>
                      {balances.map((b) => (
                        <Cell key={b.periodo} fill={b.Balance >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                    <Area
                      type="monotone"
                      dataKey="Acumulado"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#gradAcum)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="superficie-2 rounded-2xl p-3">
                  <p className="t-nota txt-3 mb-0.5">Mejor mes</p>
                  <p className="t-fila font-semibold tabular text-marca-600 dark:text-marca-500 capitalize">
                    {mejor?.mes} · {formatMonto(Math.round((mejor?.Balance ?? 0) * 10 ** decimales), moneda, { compacto: true })}
                  </p>
                </div>
                <div className="superficie-2 rounded-2xl p-3">
                  <p className="t-nota txt-3 mb-0.5">Peor mes</p>
                  {/* El peor mes puede haber cerrado en positivo. Se pinta de
                      rojo solo si de verdad se gasto mas de lo que entro. */}
                  <p className={cn(
                    't-fila font-semibold tabular capitalize',
                    (peor?.Balance ?? 0) < 0 ? 'text-red-500' : 'txt',
                  )}>
                    {peor?.mes} · {formatMonto(Math.round((peor?.Balance ?? 0) * 10 ** decimales), moneda, { compacto: true })}
                  </p>
                </div>
              </div>
            </Tarjeta>
          )}

          <Tarjeta>
            <h2 className="t-seccion font-semibold txt mb-3.5">Últimos 6 meses</h2>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tendencia} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <XAxis
                    dataKey="mes"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--texto-3)' }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: 'var(--texto-3)' }}
                    tickFormatter={(v: number) =>
                      new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v)}
                  />
                  <Tooltip
                    formatter={(v) => formatearEje(v, moneda, decimales)}
                    contentStyle={{
                      background: 'var(--superficie)',
                      border: '1px solid var(--borde)',
                      borderRadius: 12,
                      color: 'var(--texto)',
                    }}
                    cursor={{ fill: 'var(--superficie-2)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Ingresos" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="Gastos" fill="#ef4444" radius={[6, 6, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Tarjeta>

          {members.length > 1 && (
            <Tarjeta>
              <h2 className="t-seccion font-semibold txt mb-3.5">Comparativa</h2>
              <div className="space-y-3">
                {personas.map(({ member, resumen: r }) => (
                  <div key={member.id} className="flex items-center justify-between t-fila">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: member.color }} />
                      <span className="txt truncate">{member.displayName}</span>
                    </div>
                    <div className="flex gap-4 shrink-0 tabular">
                      <span className="text-marca-600 dark:text-marca-500">
                        +{formatMonto(r.ingresoMinor, moneda, { compacto: true })}
                      </span>
                      <span className="txt-2">
                        -{formatMonto(r.gastoMinor, moneda, { compacto: true })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Tarjeta>
          )}
        </>
      )}
    </div>
  );
}
