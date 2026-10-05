import { lazy, Suspense, useState } from 'react';
import { useStore } from './store/store.tsx';
import { AppLayout, type Solapa } from './components/layout/AppLayout.tsx';
import { CargaRapida } from './components/transactions/CargaRapida.tsx';
import { DetalleMovimiento } from './components/transactions/DetalleMovimiento.tsx';
import { Acceso } from './pages/Acceso.tsx';
import { Inicio } from './pages/Inicio.tsx';
import { Movimientos } from './pages/Movimientos.tsx';
import { Cuentas } from './pages/Cuentas.tsx';
import { Jarras } from './pages/Jarras.tsx';
import { Ajustes } from './pages/Ajustes.tsx';
import { Consejero } from './pages/Consejero.tsx';
import { Icono } from './components/ui/base.tsx';
import { cn } from './lib/utils.ts';
import type { Transaction } from '@shared/types';

// Analisis arrastra recharts, con diferencia la dependencia mas pesada.
// Cargandola aparte, la app abre sin descargarla.
const Analisis = lazy(() =>
  import('./pages/Analisis.tsx').then((m) => ({ default: m.Analisis })),
);

export default function App() {
  const { cargando, autenticado, aviso, cola } = useStore();

  const [solapa, setSolapa] = useState<Solapa>('inicio');
  const [cargaAbierta, setCargaAbierta] = useState(false);
  const [editando, setEditando] = useState<Transaction | null>(null);
  // Movimiento cuyo detalle se esta mirando. Tocar uno abre esto, no el
  // formulario: mirar es mucho mas frecuente que corregir.
  const [viendo, setViendo] = useState<Transaction | null>(null);

  if (cargando) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3">
        <div className="w-9 h-9 rounded-full border-2 border-marca-500 border-t-transparent animate-spin" />
        <p className="t-fila txt-3">Cargando...</p>
      </div>
    );
  }

  if (!autenticado) return <Acceso />;

  const abrirNuevo = () => { setEditando(null); setCargaAbierta(true); };

  const abrirEdicion = (tx: Transaction) => {
    setViendo(null);
    setEditando(tx);
    setCargaAbierta(true);
  };

  return (
    <>
      <AppLayout solapa={solapa} alCambiar={setSolapa} alAgregar={abrirNuevo}>
        {solapa === 'inicio' && (
          <Inicio alVerMovimiento={setViendo} alEditarMovimiento={abrirEdicion} alAgregar={abrirNuevo} />
        )}
        {solapa === 'movimientos' && (
          <Movimientos
            alVerMovimiento={setViendo}
            alEditarMovimiento={abrirEdicion}
            alAgregar={abrirNuevo}
          />
        )}
        {solapa === 'cuentas' && <Cuentas />}
        {solapa === 'jarras' && <Jarras alVerMovimiento={setViendo} />}
        {solapa === 'ajustes' && (
          <Ajustes
            alVerConsejero={() => setSolapa('consejero')}
          />
        )}
        {solapa === 'consejero' && <Consejero />}
        {solapa === 'analisis' && (
          <Suspense fallback={
            <div className="flex justify-center py-16">
              <div className="w-7 h-7 rounded-full border-2 border-marca-500 border-t-transparent animate-spin" />
            </div>
          }>
            <Analisis />
          </Suspense>
        )}
      </AppLayout>

      <DetalleMovimiento
        tx={viendo}
        alCerrar={() => setViendo(null)}
        alEditar={abrirEdicion}
      />

      <CargaRapida
        abierta={cargaAbierta}
        alCerrar={() => { setCargaAbierta(false); setEditando(null); }}
        editando={editando}
      />

      {cola.length > 0 && (
        <div className="fixed bottom-24 left-4 md:bottom-6 z-40 superficie borde border rounded-2xl px-3.5 py-2 shadow-lg flex items-center gap-2">
          <Icono nombre="cloud-off" size={15} className="txt-3" />
          <span className="t-nota txt-2">{cola.length} sin subir</span>
        </div>
      )}

      {aviso && (
        <div
          role="status"
          className={cn(
            'fixed top-4 inset-x-4 md:left-1/2 md:-translate-x-1/2 md:inset-x-auto md:w-96 z-[60]',
            'rounded-2xl px-4 py-3 t-fila font-medium shadow-lg text-center safe-top',
            'animate-[bajar_.2s_ease-out]',
            aviso.tipo === 'ok' ? 'bg-marca-600 text-white' : 'bg-red-600 text-white',
          )}
        >
          {aviso.texto}
          <style>{`@keyframes bajar { from { transform: translateY(-120%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
        </div>
      )}
    </>
  );
}
