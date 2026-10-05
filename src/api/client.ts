/**
 * Cliente HTTP. Fino a proposito: la logica esta en el store.
 */

import { derivarClave } from '@shared/kdf';
import type {
  Account, Adjustment, Budget, Category, Entity, Jar, JarAporte, JarImputacion, JarTransfer,
  Member, Recurring, SeccionInicio, SeccionMovimientos, Snapshot, Transaction, TransactionInput,
} from '@shared/types';

export class ApiError extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
  /** Sin conexion o servidor caido: sirve para decidir si encolar el cambio. */
  get esDeRed(): boolean {
    return this.status === 0;
  }
}

/** Las tres cosas que se pueden mandar a la papelera. */
export type Descarte = 'categoria' | 'cuenta' | 'economia';

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  let res: Response;

  try {
    res = await fetch(ruta, {
      ...init,
      // La cookie de sesion es HttpOnly; hay que pedir que viaje.
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Sin conexion');
  }

  if (res.status === 204) return undefined as T;

  const texto = await res.text();
  let data: unknown = null;
  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    // Respuesta que no es JSON (por ejemplo un HTML de error del borde).
  }

  if (!res.ok) {
    const mensaje =
      (data as { error?: string } | null)?.error ?? `Error ${res.status}`;
    throw new ApiError(res.status, mensaje);
  }

  return data as T;
}

const get = <T>(ruta: string) => pedir<T>(ruta);
const post = <T>(ruta: string, body: unknown) =>
  pedir<T>(ruta, { method: 'POST', body: JSON.stringify(body) });
const put = <T>(ruta: string, body: unknown) =>
  pedir<T>(ruta, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(ruta: string) => pedir<T>(ruta, { method: 'DELETE' });

/** Saldos recalculados que el servidor devuelve junto a cada mutacion. */
interface ConSaldos {
  accounts: Account[];
  jars: Jar[];
}

/** Las imputaciones del movimiento tocado, para que el cliente parche solo esas. */
interface ConImputaciones {
  imputaciones: JarImputacion[];
}

/**
 * Todo lo que toca contraseñas pasa antes por derivarClave.
 *
 * La contraseña de verdad no sale nunca del dispositivo: lo que viaja es una
 * clave derivada con 210.000 iteraciones de PBKDF2. El motivo esta explicado
 * en shared/kdf.ts, pero el resumen es que el servidor tiene 10 ms de CPU y
 * ese trabajo cuesta 150; aca no hay limite.
 *
 * La sal es el email, asi que hay que derivar con el email de la persona DUEÑA
 * de la contraseña. En el alta de la pareja, eso significa el email de ella,
 * no el de quien esta invitando.
 */
export const api = {
  estado: () => get<{ instalado: boolean }>('/api/status'),

  setup: async (d: {
    email: string; password: string; displayName: string;
    householdName: string; currency: string; setupKey: string;
  }) => post<{ ok: true; householdId: string }>('/api/setup', {
    ...d,
    password: await derivarClave(d.password, d.email),
  }),

  login: async (email: string, password: string) =>
    post<{ ok: true }>('/api/login', {
      email,
      password: await derivarClave(password, email),
    }),

  logout: () => post<{ ok: true }>('/api/logout', {}),

  invitar: async (d: { email: string; password: string; displayName: string; color?: string }) =>
    post<{ member: Member }>('/api/invite', {
      ...d,
      // Con el email de ELLA: es su contraseña, y su email es la sal.
      password: await derivarClave(d.password, d.email),
    }),

  cambiarPassword: async (email: string, currentPassword: string, newPassword: string) =>
    post<{ ok: true }>('/api/password', {
      currentPassword: await derivarClave(currentPassword, email),
      newPassword: await derivarClave(newPassword, email),
    }),

  snapshot: () => get<Snapshot>('/api/snapshot'),

  crearTx: (t: TransactionInput) =>
    post<{ transaction: Transaction } & ConSaldos & ConImputaciones>('/api/transactions', t),

  editarTx: (id: string, t: TransactionInput) =>
    put<{ transaction: Transaction } & ConSaldos & ConImputaciones>(`/api/transactions/${id}`, t),

  borrarTx: (id: string) =>
    del<{ ok: true } & ConSaldos>(`/api/transactions/${id}`),

  crearTxLote: (transactions: TransactionInput[]) =>
    post<{ transactions: Transaction[]; rechazados: { indice: number; motivo: string }[] } & ConSaldos>(
      '/api/transactions/batch', { transactions },
    ),

  crearCuenta: (a: Partial<Account>) => post<{ account: Account }>('/api/accounts', a),
  editarCuenta: (id: string, a: Partial<Account>) => put<{ account: Account }>(`/api/accounts/${id}`, a),
  archivarCuenta: (id: string) => del<{ ok: true; account?: Account }>(`/api/accounts/${id}`),
  borrarCuenta: (id: string) => del<{ ok: true }>(`/api/accounts/${id}?purge=1`),

  /**
   * Fijar el saldo de una cuenta a mano.
   *
   * Se manda el saldo que se quiere ver, no la diferencia: la resta la hace el
   * servidor contra el saldo del momento. Si mandaramos la diferencia
   * calculada aca, un movimiento cargado por la otra persona entremedio la
   * dejaria mal.
   */
  ajustarSaldo: (accountId: string, balanceMinor: number, note?: string) =>
    post<{ account: Account; adjustment: Adjustment | null }>('/api/adjustments', {
      accountId, balanceMinor, note: note ?? null,
    }),

  ajustesDeCuenta: (accountId: string) =>
    get<{ adjustments: Adjustment[] }>(`/api/adjustments?account=${encodeURIComponent(accountId)}`),

  crearEntidad: (e: Partial<Entity>) => post<{ entity: Entity }>('/api/entities', e),
  editarEntidad: (id: string, e: Partial<Entity>) =>
    put<{ entity: Entity }>(`/api/entities/${id}`, e),
  archivarEntidad: (id: string) => del<{ ok: true; entity?: Entity }>(`/api/entities/${id}`),

  // --- papelera ---
  /** Que hay en la papelera, que la ata, y cuanto le queda. */
  revisarPapelera: () =>
    get<{
      items: {
        tipo: Descarte; id: string; motivo: string | null; diasQueQuedan: number | null;
      }[];
      diasHastaBorrar: number;
    }>('/api/papelera'),
  descartar: (tipo: Descarte, id: string) =>
    post<{ ok: true }>('/api/papelera', { tipo, id }),
  restaurar: (tipo: Descarte, id: string) =>
    post<{ ok: true }>('/api/papelera/restaurar', { tipo, id }),
  /** Sin `items`, vacia todo. Con `items`, solo lo marcado. */
  vaciarPapelera: (items?: { tipo: Descarte; id: string }[]) =>
    post<{
      ok: true; borrados: number;
      retenidos: { tipo: Descarte; id: string; nombre: string; motivo: string }[];
    }>('/api/papelera/vaciar', items ? { items } : {}),

  crearCategoria: (c: Partial<Category>) => post<{ category: Category }>('/api/categories', c),
  editarCategoria: (id: string, c: Partial<Category>) =>
    put<{ category: Category }>(`/api/categories/${id}`, c),

  guardarJarras: (jars: Partial<Jar>[]) => put<{ jars: Jar[] }>('/api/jars', { jars }),

  /**
   * Mover plata de una jarra a otra. No toca ninguna cuenta: es lo unico que
   * permite sacar del rojo a una jarra en la que se gasto de mas.
   */
  traspasarEntreJarras: (d: {
    fromJarId: string; toJarId: string; amountMinor: number; note?: string;
  }) => post<{ transfer: JarTransfer; jars: Jar[] }>('/api/jar-transfers', d),

  /**
   * Un negocio le paga a la casa. Sale de una jarra suya y entra repartido
   * entre las de la otra economia, con las reglas de esa economia. No toca
   * ninguna cuenta: la plata ya estaba ahi, lo que cambia es de quien es.
   */
  pagarAOtraEconomia: (d: {
    fromJarId: string; toEntityId: string; amountMinor: number; note?: string;
  }) => post<{ transfers: JarTransfer[]; jars: Jar[] }>('/api/jar-transfers/pago', d),

  borrarTraspaso: (id: string) =>
    del<{ ok: true; jars: Jar[] }>(`/api/jar-transfers/${id}`),

  /**
   * Reparte en las jarras plata que ya estaba en las cuentas y que ninguna
   * jarra vio: los saldos iniciales, sobre todo.
   */
  asignarAJarras: (d: {
    amountMinor: number; jarId?: string | null; entityId?: string | null; note?: string;
  }) => post<{ aportes: JarAporte[]; jars: Jar[] }>('/api/jars/asignar', d),

  borrarAporte: (id: string) =>
    del<{ ok: true; jars: Jar[] }>(`/api/jar-aportes/${id}`),

  /** Reparte los ingresos viejos que nunca llegaron a ninguna jarra. */
  ponerJarrasAlDia: () =>
    post<{ repartidos: number; jars: Jar[] }>('/api/jars/poner-al-dia', {}),

  guardarPresupuesto: (b: {
    id?: string;
    name?: string;
    categoryId?: string | null;
    entityId?: string | null;
    amountMinor: number;
    period?: string;
    closedAt?: number | null;
    icon?: string | null;
  }) =>
    put<{ budget: Budget }>('/api/budgets', b),
  borrarPresupuesto: (id: string) => del<{ ok: true }>(`/api/budgets/${id}`),

  editarPerfil: (d: {
    displayName?: string; color?: string; emoji?: string; homeLayout?: SeccionInicio[];
    movesLayout?: SeccionMovimientos[];
  }) => put<{ member: Member }>('/api/profile', d),

  crearRecurrente: (r: Partial<Recurring> & { startAt?: number }) =>
    post<{ recurring: Recurring }>('/api/recurring', r),
  editarRecurrente: (id: string, r: Partial<Recurring>) =>
    put<{ recurring: Recurring }>(`/api/recurring/${id}`, r),
  borrarRecurrente: (id: string) => del<{ ok: true }>(`/api/recurring/${id}`),

  /** "Ya me pagaron": crea el movimiento ahora, sin esperar a la fecha. */
  cobrarRecurrente: (id: string, d?: { amountMinor?: number; date?: number }) =>
    post<{ recurring: Recurring; tx: Transaction }>(`/api/recurring/cobrar/${id}`, d ?? {}),

  /** "Todavia no me pagaron": borra el movimiento que se dio por cobrado. */
  deshacerCobro: (id: string) =>
    post<{ recurring: Recurring; txBorrado: string }>(`/api/recurring/deshacer/${id}`, {}),
};
