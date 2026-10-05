/**
 * Entrada a la app: instalacion la primera vez, ingreso despues.
 * Sin Google, sin terceros: email y contraseña contra tu propia base.
 */

import { useState } from 'react';
import { useStore } from '../store/store.tsx';
import { Boton, Campo, Icono } from '../components/ui/base.tsx';
import { MIN_PASSWORD } from '@shared/kdf';

export function Acceso() {
  const { instalado } = useStore();
  return instalado ? <Ingreso /> : <Instalacion />;
}

function Marco({ titulo, subtitulo, children }: {
  titulo: string; subtitulo: string; children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-marca-600 text-white border border-white/15 rounded-3xl flex items-center justify-center mb-5 shadow-xl shadow-marca-600/30">
            <Icono nombre="wallet" size={30} />
          </div>
          <h1 className="t-seccion font-semibold txt tracking-tight text-balance mb-2">{titulo}</h1>
          <p className="t-fila txt-2 leading-relaxed">{subtitulo}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Ingreso() {
  const { entrar } = useStore();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      await entrar(email, pass);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar');
      setCargando(false);
    }
  }

  return (
    <Marco titulo="Nuestros gastos" subtitulo="Entra con tu email y contraseña.">
      <form onSubmit={enviar} className="space-y-3">
        <Campo
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          autoComplete="username"
          enterKeyHint="next"
          required
        />
        <Campo
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="Tu contraseña"
          autoComplete="current-password"
          enterKeyHint="go"
          required
        />

        {error && <p className="t-fila text-red-500 text-center px-2">{error}</p>}

        <Boton type="submit" disabled={!email || !pass || cargando} className="w-full min-h-12">
          {cargando ? 'Entrando...' : 'Entrar'}
        </Boton>
      </form>

      <p className="t-nota txt-3 text-center mt-6 leading-relaxed">
        Solo ustedes dos tienen acceso. No hay registro público.
      </p>
    </Marco>
  );
}

function Instalacion() {
  const { instalar } = useStore();
  const [setupKey, setSetupKey] = useState('');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [hogar, setHogar] = useState('Nuestra casa');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      await instalar({
        setupKey, email, password: pass, displayName: nombre,
        householdName: hogar, currency: 'USD',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo instalar');
      setCargando(false);
    }
  }

  return (
    <Marco
      titulo="Primera vez"
      subtitulo="Crea tu hogar. Después sumas a tu pareja desde Ajustes."
    >
      <form onSubmit={enviar} className="space-y-3">
        <Campo
          etiqueta="Clave de instalación"
          value={setupKey}
          onChange={(e) => setSetupKey(e.target.value)}
          placeholder="La SETUP_KEY que cargaste en GitHub"
          autoComplete="off"
          required
        />
        <Campo
          etiqueta="Nombre del hogar"
          value={hogar}
          onChange={(e) => setHogar(e.target.value)}
          required
        />
        <Campo
          etiqueta="Tu nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Cómo te llamas"
          required
        />
        <Campo
          etiqueta="Tu email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          autoComplete="username"
          required
        />
        <Campo
          etiqueta="Tu contraseña"
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="Mínimo 8 caracteres"
          autoComplete="new-password"
          required
        />

        {error && <p className="t-fila text-red-500 text-center px-2">{error}</p>}

        <Boton
          type="submit"
          disabled={!setupKey || !email || !nombre || pass.length < MIN_PASSWORD || cargando}
          className="w-full min-h-12"
        >
          {cargando ? 'Creando...' : 'Crear el hogar'}
        </Boton>
      </form>
    </Marco>
  );
}
