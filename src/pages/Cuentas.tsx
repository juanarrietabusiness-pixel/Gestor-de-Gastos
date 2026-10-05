/**
 * Cuentas del hogar.
 *
 * Separa activos de pasivos, algo que la version anterior no hacia: sumaba el
 * saldo de la tarjeta de credito al patrimonio como si fuera plata disponible.
 */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store.tsx';
import { api } from '../api/client.ts';
import { formatMonto, montoPlano, parseMonto } from '@shared/money';
import {
  ACCOUNT_CATEGORY_LABEL, AccountCategory, esActivo, type Account, type Adjustment,
} from '@shared/types';
import { calcularPatrimonio } from '@shared/domain';
import {
  Boton, Campo, COLORES, Ficha, Hoja, Icono, Selector, SelectorColor, Tarjeta, Vacio,
} from '../components/ui/base.tsx';
import { HeroPatrimonio } from './Inicio.tsx';
import { useDescartar } from './Ajustes.tsx';
import { cn } from '../lib/utils.ts';

const ICONOS: Record<AccountCategory, string> = {
  [AccountCategory.EFECTIVO]: 'banknote',
  [AccountCategory.CUENTA_CORRIENTE]: 'landmark',
  [AccountCategory.TARJETA_CREDITO]: 'credit-card',
  [AccountCategory.AHORRO]: 'piggy-bank',
  [AccountCategory.INVERSION]: 'trending-up',
  [AccountCategory.DEUDA]: 'file-minus',
  [AccountCategory.POR_COBRAR]: 'hand-coins',
};

export function Cuentas() {
  const { accounts, household, members } = useStore();
  const moneda = household?.currency ?? 'USD';

  const [editando, setEditando] = useState<Account | null>(null);
  const [abierta, setAbierta] = useState(false);

  const activas = accounts.filter((c) => !c.archived);

  const activos = activas.filter((c) => esActivo(c.category));
  const pasivos = activas.filter((c) => !esActivo(c.category));

  const totalActivos = useMemo(
    () => activos.reduce((s, c) => s + c.balanceMinor, 0), [activos],
  );
  // Los saldos de pasivo son negativos (consumir con la tarjeta resta). Para
  // mostrarlos bajo "lo que debes" se invierte el signo: "$450" se lee mejor
  // que "-$450" debajo de esa etiqueta.
  const totalPasivos = useMemo(
    () => -pasivos.reduce((s, c) => s + c.balanceMinor, 0), [pasivos],
  );
  const patrimonio = useMemo(() => calcularPatrimonio(accounts), [accounts]);

  const abrirNueva = () => { setEditando(null); setAbierta(true); };
  const abrirEdicion = (c: Account) => { setEditando(c); setAbierta(true); };

  return (
    <div className="space-y-4">
      {activas.length === 0 ? (
        <Tarjeta>
          <Vacio
            icono="wallet"
            titulo="Sin cuentas todavía"
            texto="Crea una cuenta para empezar a registrar movimientos: efectivo, banco, tarjeta."
            accion={<Boton onClick={abrirNueva}>Crear la primera</Boton>}
          />
        </Tarjeta>
      ) : (
        <>
          {/* El MISMO bloque que corona el Inicio, no una version parecida.
              Es el mismo numero: si en una pantalla es una tarjeta de color y
              en la otra un texto gris, parecen dos datos distintos. */}
          <HeroPatrimonio
            montoMinor={patrimonio}
            moneda={moneda}
            /* A la izquierda, no centrado: esta tarjeta lleva además el botón
               de «Cuenta». Centrar el número con un botón encima de su mitad
               derecha lo hacía VER corrido; con el número a la izquierda y el
               botón a la derecha cada uno ocupa su lado. */
            alineacion="izquierda"
            accion={(
              /* Con la palabra, no solo el «+»: el botón flotante de abajo
                 también es un «+» y significa otra cosa (un movimiento). Dos
                 cruces iguales en la misma pantalla se prestan a confusión. */
              <button
                onClick={abrirNueva}
                className="min-h-9 pl-2.5 pr-3 rounded-full bg-white/20 border border-white/25 flex items-center gap-1 t-fila font-medium active:scale-[0.94] transition-transform duration-100"
              >
                <Icono nombre="plus" size={16} /> Cuenta
              </button>
            )}
            extra={pasivos.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 mt-4 pt-3.5 border-t border-white/15">
                <div>
                  <p className="t-nota opacity-70 mb-0.5">Tienes</p>
                  <p className="t-seccion font-semibold tabular">{formatMonto(totalActivos, moneda)}</p>
                </div>
                <div>
                  <p className="t-nota opacity-70 mb-0.5">Debes</p>
                  <p className="t-seccion font-semibold tabular">{formatMonto(totalPasivos, moneda)}</p>
                </div>
              </div>
            ) : undefined}
          />

          {activos.length > 0 && (
            <Grupo cuentas={activos} alTocar={abrirEdicion} members={members} />
          )}
          {pasivos.length > 0 && (
            <Grupo titulo="Lo que debes" cuentas={pasivos} alTocar={abrirEdicion} members={members} />
          )}
        </>
      )}

      <FormularioCuenta
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        editando={editando}
      />
    </div>
  );
}

function Grupo({ titulo, cuentas, alTocar, members }: {
  /** Solo cuando distingue algo. Con un grupo solo, decir «lo que tienes»
      encima de la lista de cuentas es nombrar lo que ya se ve. */
  titulo?: string;
  cuentas: Account[];
  alTocar: (c: Account) => void;
  members: { id: string; displayName: string }[];
}) {
  return (
    <Tarjeta className="py-3">
      {titulo && <h2 className="t-seccion font-semibold txt px-1 mb-2">{titulo}</h2>}
      <div className="divide-y divide-[var(--borde)] -mx-1">
        {cuentas.map((c) => {
          const dueno = c.owner === 'compartida'
            ? 'Compartida'
            : members.find((m) => m.id === c.owner)?.displayName ?? 'Personal';
          return (
            <button
              key={c.id}
              onClick={() => alTocar(c)}
              className="w-full flex items-center gap-3 py-3 px-1 text-left active:opacity-60 transition-opacity"
            >
              <Ficha color={c.color} icono={c.icon} size={40} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="t-fila font-medium txt truncate">{c.name}</p>
                  <p className={cn(
                    't-fila font-semibold tabular shrink-0',
                    c.balanceMinor < 0 ? 'text-red-500' : 'txt',
                  )}>
                    {formatMonto(c.balanceMinor, c.currency)}
                  </p>
                </div>
                <p className="t-nota txt-3 truncate mt-0.5">
                  {ACCOUNT_CATEGORY_LABEL[c.category]} · {dueno}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </Tarjeta>
  );
}

function FormularioCuenta({ abierta, alCerrar, editando }: {
  abierta: boolean; alCerrar: () => void; editando: Account | null;
}) {
  const { household, members, transactions, guardarCuenta, ajustarSaldo, avisar } = useStore();
  const descartar = useDescartar();
  const moneda = household?.currency ?? 'USD';

  const [name, setName] = useState('');
  const [category, setCategory] = useState<AccountCategory>(AccountCategory.EFECTIVO);
  const [saldoTexto, setSaldoTexto] = useState('');
  const [nota, setNota] = useState('');
  const [color, setColor] = useState<string>(COLORES[0]);
  const [owner, setOwner] = useState('compartida');
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState<Adjustment[]>([]);

  // Al editar, el campo del saldo muestra el saldo ACTUAL (el que se ve en la
  // lista), no el inicial. Es el numero que la persona quiere corregir: el
  // inicial es un dato interno que ya nadie recuerda despues del primer mes.
  const saldoDeReferencia = editando ? editando.balanceMinor : 0;

  useEffect(() => {
    if (!abierta) return;
    if (editando) {
      setName(editando.name);
      setCategory(editando.category);
      setSaldoTexto(montoPlano(editando.balanceMinor, moneda));
      setColor(editando.color);
      setOwner(editando.owner);
    } else {
      setName('');
      setCategory(AccountCategory.EFECTIVO);
      setSaldoTexto('');
      setColor(COLORES[0]);
      setOwner('compartida');
    }
    setNota('');
    setHistorial([]);
  }, [abierta, editando, moneda]);

  // El historial se pide al abrir, no viene en el snapshot: son datos que se
  // miran una vez cada tanto y cargarlos siempre engordaria cada arranque.
  useEffect(() => {
    if (!abierta || !editando) return;
    let vigente = true;
    api.ajustesDeCuenta(editando.id)
      .then((r) => { if (vigente) setHistorial(r.adjustments); })
      .catch(() => { /* el historial es informativo: si falla, no molesta */ });
    return () => { vigente = false; };
  }, [abierta, editando]);

  const saldoMinor = parseMonto(saldoTexto || '0', moneda) ?? 0;
  const cambioElSaldo = editando !== null && saldoMinor !== saldoDeReferencia;
  const diferencia = saldoMinor - saldoDeReferencia;

  async function guardar() {
    if (!name.trim()) return;
    setGuardando(true);
    try {
      await guardarCuenta({
        name: name.trim(),
        category,
        currency: moneda,
        // En una cuenta nueva no hay movimientos, asi que el saldo que se
        // escribe ES el inicial. En una que ya existe el saldo no se toca por
        // aca: va por el ajuste, que ademas deja constancia.
        ...(editando ? {} : { initialBalanceMinor: saldoMinor }),
        color,
        icon: ICONOS[category],
        owner,
      }, editando?.id);

      if (editando && cambioElSaldo) {
        await ajustarSaldo(editando.id, saldoMinor, nota.trim() || undefined);
      }
      alCerrar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function tirar() {
    if (!editando) return;
    // El mismo diálogo que las categorías y las economías: una sola pregunta,
    // y lo que tenga movimientos se queda guardado en vez de borrarse.
    const enUso = transactions.filter(
      (t) => t.accountId === editando.id || t.destAccountId === editando.id,
    ).length;
    await descartar('cuenta', editando.id, editando.name, enUso);
    alCerrar();
  }

  return (
    <Hoja abierta={abierta} alCerrar={alCerrar} titulo={editando ? 'Editar cuenta' : 'Nueva cuenta'}>
      <div className="space-y-4">
        <Campo
          etiqueta="Nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Efectivo, Banco, Visa..."
        />

        <Selector
          etiqueta="Tipo"
          value={category}
          onChange={(e) => setCategory(Number(e.target.value) as AccountCategory)}
        >
          {Object.values(AccountCategory).map((c) => (
            <option key={c} value={c}>{ACCOUNT_CATEGORY_LABEL[c]}</option>
          ))}
        </Selector>

        {!esActivo(category) && (
          <p className="t-nota txt-3 px-1 -mt-2">
            Es una cuenta de deuda: lo que gastes con ella deja el saldo en
            negativo y resta del patrimonio.
          </p>
        )}

        <Campo
          etiqueta="Saldo actual"
          value={saldoTexto}
          onChange={(e) => setSaldoTexto(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
        />
        {editando && !cambioElSaldo && (
          <p className="t-nota txt-3 px-1 -mt-2 leading-relaxed">
            Se calcula solo con cada movimiento. Escribe otro número si la
            cuenta real dice algo distinto y no aparece por qué.
          </p>
        )}
        {cambioElSaldo && (
          <div className="-mt-2 space-y-3">
            <div className="rounded-2xl p-3 superficie-2 borde border">
              <p className="t-nota txt-2 leading-relaxed">
                Queda en{' '}
                <span className="font-semibold txt tabular">{formatMonto(saldoMinor, moneda)}</span>
                {' '}·{' '}
                <span className={cn('font-semibold tabular', diferencia < 0 ? 'text-red-500' : 'text-marca-600 dark:text-marca-500')}>
                  {diferencia > 0 ? '+' : '−'}{formatMonto(Math.abs(diferencia), moneda)}
                </span>
              </p>
            </div>
            <Campo
              etiqueta="Por qué (opcional)"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Faltaba plata, propina no anotada..."
              maxLength={200}
            />
          </div>
        )}

        {historial.length > 0 && (
          <details className="rounded-2xl superficie-2 borde border overflow-hidden">
            <summary className="t-nota font-medium txt-2 px-3 py-2.5 cursor-pointer select-none">
              Ajustes anteriores ({historial.length})
            </summary>
            <div className="px-3 pb-3 space-y-2">
              {historial.map((a) => {
                const quien = members.find((m) => m.id === a.memberId)?.displayName;
                return (
                  <div key={a.id} className="flex items-start gap-2 t-nota">
                    <span className={cn(
                      'font-semibold tabular shrink-0',
                      a.deltaMinor < 0 ? 'text-red-500' : 'text-marca-600 dark:text-marca-500',
                    )}>
                      {a.deltaMinor > 0 ? '+' : '−'}{formatMonto(Math.abs(a.deltaMinor), moneda, { compacto: true })}
                    </span>
                    <span className="txt-3 flex-1 min-w-0">
                      {new Date(a.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'short' })}
                      {quien && ` · ${quien}`}
                      {a.note && <span className="block txt-3 truncate">{a.note}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {members.length > 1 && (
          <Selector etiqueta="De quién es" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="compartida">Compartida</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))}
          </Selector>
        )}

        <div>
          <span className="block t-nota font-medium txt-2 mb-2">Color</span>
          <SelectorColor valor={color} alElegir={setColor} />
        </div>

        <div className="flex gap-2 pt-1">
          {editando && (
            <Boton variante="secundario" onClick={() => void tirar()} disabled={guardando}>
              <Icono nombre="trash-2" size={16} /> A la papelera
            </Boton>
          )}
          <Boton
            onClick={() => void guardar()}
            disabled={!name.trim() || guardando}
            className="flex-1 min-h-12"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </Boton>
        </div>
      </div>
    </Hoja>
  );
}
