/**
 * Estado de la app.
 *
 * Tres propiedades que hacen que se sienta instantanea:
 *
 * 1. Actualizacion optimista: al cargar un gasto aparece en pantalla antes de
 *    que el servidor conteste. Si el servidor rechaza, se revierte y se avisa.
 * 2. Tiempo real: lo que carga una persona aparece en el telefono de la otra
 *    sin refrescar, por el WebSocket.
 * 3. Cola sin conexion: si no hay señal, el movimiento se guarda igual y se
 *    manda solo cuando vuelve. Nada se pierde por estar en el subte.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../api/client.ts';
import type { Descarte } from '../api/client.ts';
import { live, type EstadoLive } from '../api/live.ts';
import { calcularJarras, calcularSaldos } from '@shared/domain';
import type {
  Account, Budget, Category, Entity, Jar, JarAporte, JarImputacion, JarTransfer, LiveEvent,
  Tema,
  Member, Recurring, SeccionInicio, SeccionMovimientos, Snapshot, Transaction, TransactionInput,
} from '@shared/types';

const CLAVE_COLA = 'gg_cola_v1';

interface Estado {
  cargando: boolean;
  autenticado: boolean;
  instalado: boolean;
  me: Member | null;
  members: Member[];
  household: Snapshot['household'] | null;
  accounts: Account[];
  categories: Category[];
  entities: Entity[];
  /**
   * Que economia se esta mirando. null = todo junto, con etiquetas.
   * Vive en el estado y no en la URL porque se cambia decenas de veces por
   * sesion y no tiene sentido llenar el historial del navegador con eso.
   */
  entidadActiva: string | null;
  jars: Jar[];
  budgets: Budget[];
  transactions: Transaction[];
  recurring: Recurring[];
  /** Lo que cada movimiento le hizo a cada jarra, congelado al guardarlo. */
  imputaciones: JarImputacion[];
  jarTransfers: JarTransfer[];
  jarAportes: JarAporte[];
  /** Ids con una escritura en vuelo: la UI los muestra atenuados. */
  enVuelo: Set<string>;
  /**
   * Lo que acaba de llegar del otro telefono, por unos segundos.
   *
   * Es lo que hace visible el "estamos los dos adentro": sin esto, una fila
   * nueva aparece de la nada en medio de la lista y no se sabe si estaba desde
   * antes. Se limpia solo; no es un dato, es un destello.
   */
  recienLlegados: Set<string>;
  /** Movimientos cargados sin conexion, esperando para subir. */
  cola: TransactionInput[];
  online: string[];
  estadoLive: EstadoLive;
  aviso: { texto: string; tipo: 'error' | 'ok' } | null;
}

const inicial: Estado = {
  cargando: true, autenticado: false, instalado: true, me: null, members: [],
  household: null, accounts: [], categories: [], entities: [], entidadActiva: null,
  jars: [], budgets: [],
  transactions: [], recurring: [], imputaciones: [], jarTransfers: [], jarAportes: [],
  enVuelo: new Set(), recienLlegados: new Set(), cola: [], online: [],
  estadoLive: 'desconectado', aviso: null,
};

type Accion =
  | { t: 'cargando'; v: boolean }
  | { t: 'instalado'; v: boolean }
  | { t: 'snapshot'; snap: Snapshot }
  | { t: 'salir' }
  | { t: 'tx:upsert'; tx: Transaction }
  | { t: 'recien'; id: string; dentro: boolean }
  | { t: 'tx:delete'; id: string }
  | { t: 'saldos'; accounts: Account[]; jars: Jar[] }
  | { t: 'account:upsert'; account: Account }
  | { t: 'account:delete'; id: string }
  | { t: 'category:upsert'; category: Category }
  | { t: 'entities'; entities: Entity[] }
  | { t: 'entity:upsert'; entity: Entity }
  | { t: 'entity:delete'; id: string }
  | { t: 'entidadActiva'; id: string | null }
  | { t: 'jars'; jars: Jar[] }
  | { t: 'jar:upsert'; jar: Jar }
  | { t: 'budget:upsert'; budget: Budget }
  | { t: 'budget:delete'; id: string }
  | { t: 'members'; members: Member[] }
  | { t: 'member:upsert'; member: Member }
  | { t: 'recurring:upsert'; recurring: Recurring }
  | { t: 'recurring:delete'; id: string }
  | { t: 'imputaciones'; txId: string; imputaciones: JarImputacion[] }
  | { t: 'jarTransfer:upsert'; transfer: JarTransfer }
  | { t: 'jarTransfer:delete'; id: string }
  | { t: 'vuelo:add'; id: string }
  | { t: 'vuelo:del'; id: string }
  | { t: 'cola'; cola: TransactionInput[] }
  | { t: 'online'; ids: string[] }
  | { t: 'live'; estado: EstadoLive }
  | { t: 'aviso'; aviso: Estado['aviso'] };

/** Mas nuevos primero; a igual fecha, el ultimo cargado arriba. */
const ordenar = (txs: Transaction[]): Transaction[] =>
  [...txs].sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);

function reducer(s: Estado, a: Accion): Estado {
  switch (a.t) {
    case 'cargando':
      return { ...s, cargando: a.v };

    case 'instalado':
      return { ...s, instalado: a.v, cargando: false };

    case 'snapshot':
      return {
        ...s, cargando: false, autenticado: true, instalado: true,
        me: a.snap.me, members: a.snap.members, household: a.snap.household,
        accounts: a.snap.accounts, categories: a.snap.categories,
        entities: a.snap.entities,
        jars: a.snap.jars, budgets: a.snap.budgets, recurring: a.snap.recurring,
        transactions: ordenar(a.snap.transactions),
        imputaciones: a.snap.imputaciones, jarTransfers: a.snap.jarTransfers,
        jarAportes: a.snap.jarAportes ?? [],
      };

    case 'salir':
      return { ...inicial, cargando: false, autenticado: false, instalado: s.instalado };

    case 'tx:upsert': {
      const resto = s.transactions.filter((t) => t.id !== a.tx.id);
      return { ...s, transactions: ordenar([...resto, a.tx]) };
    }

    case 'imputaciones': {
      const resto = s.imputaciones.filter((i) => i.txId !== a.txId);
      return { ...s, imputaciones: [...resto, ...a.imputaciones] };
    }

    case 'jarTransfer:upsert': {
      const resto = s.jarTransfers.filter((t) => t.id !== a.transfer.id);
      return { ...s, jarTransfers: [a.transfer, ...resto] };
    }

    case 'jarTransfer:delete':
      return { ...s, jarTransfers: s.jarTransfers.filter((t) => t.id !== a.id) };

    case 'tx:delete':
      // Sus imputaciones tambien: en la base se van por ON DELETE CASCADE, y
      // si el cliente las conservara, la jarra quedaria con plata fantasma.
      return {
        ...s,
        transactions: s.transactions.filter((t) => t.id !== a.id),
        imputaciones: s.imputaciones.filter((i) => i.txId !== a.id),
      };

    case 'saldos':
      return { ...s, accounts: a.accounts, jars: a.jars };

    case 'account:upsert': {
      const resto = s.accounts.filter((c) => c.id !== a.account.id);
      return {
        ...s,
        accounts: [...resto, a.account].sort(
          (x, y) => Number(x.archived) - Number(y.archived) || x.displayOrder - y.displayOrder,
        ),
      };
    }

    case 'account:delete':
      return {
        ...s,
        accounts: s.accounts.filter((c) => c.id !== a.id),
        transactions: s.transactions.filter(
          (t) => t.accountId !== a.id && t.destAccountId !== a.id,
        ),
      };

    case 'category:upsert': {
      const resto = s.categories.filter((c) => c.id !== a.category.id);
      return {
        ...s,
        categories: [...resto, a.category].sort(
          (x, y) => Number(x.archived) - Number(y.archived) || x.displayOrder - y.displayOrder,
        ),
      };
    }

    case 'entities':
      return { ...s, entities: a.entities };

    case 'entity:upsert': {
      const resto = s.entities.filter((e) => e.id !== a.entity.id);
      return {
        ...s,
        entities: [...resto, a.entity].sort((x, y) => x.displayOrder - y.displayOrder),
      };
    }

    case 'entity:delete':
      return {
        ...s,
        entities: s.entities.filter((e) => e.id !== a.id),
        // Si estabas mirando la que se fue, se vuelve al consolidado en vez de
        // dejar la pantalla filtrando por algo que ya no existe.
        entidadActiva: s.entidadActiva === a.id ? null : s.entidadActiva,
      };

    case 'entidadActiva':
      return { ...s, entidadActiva: a.id };

    case 'jars':
      return { ...s, jars: a.jars };

    case 'jar:upsert': {
      const resto = s.jars.filter((j) => j.id !== a.jar.id);
      return { ...s, jars: [...resto, a.jar].sort((x, y) => x.displayOrder - y.displayOrder) };
    }

    case 'budget:upsert': {
      const resto = s.budgets.filter((b) => b.id !== a.budget.id);
      return { ...s, budgets: [...resto, a.budget] };
    }

    case 'budget:delete':
      return { ...s, budgets: s.budgets.filter((b) => b.id !== a.id) };

    case 'members':
      return { ...s, members: a.members };

    case 'member:upsert': {
      const resto = s.members.filter((m) => m.id !== a.member.id);
      return {
        ...s,
        members: [...resto, a.member].sort((x, y) => x.createdAt - y.createdAt),
        // Si el que cambio soy yo, tambien se actualiza mi propia ficha.
        me: s.me?.id === a.member.id ? a.member : s.me,
      };
    }

    case 'recurring:upsert': {
      const resto = s.recurring.filter((r) => r.id !== a.recurring.id);
      return {
        ...s,
        recurring: [...resto, a.recurring].sort(
          (x, y) => Number(y.active) - Number(x.active) || x.nextRun - y.nextRun,
        ),
      };
    }

    case 'recurring:delete':
      return { ...s, recurring: s.recurring.filter((r) => r.id !== a.id) };

    case 'recien': {
      const v = new Set(s.recienLlegados);
      if (a.dentro) v.add(a.id);
      else v.delete(a.id);
      return { ...s, recienLlegados: v };
    }

    case 'vuelo:add': {
      const v = new Set(s.enVuelo);
      v.add(a.id);
      return { ...s, enVuelo: v };
    }

    case 'vuelo:del': {
      const v = new Set(s.enVuelo);
      v.delete(a.id);
      return { ...s, enVuelo: v };
    }

    case 'cola':
      return { ...s, cola: a.cola };

    case 'online':
      return { ...s, online: a.ids };

    case 'live':
      return { ...s, estadoLive: a.estado };

    case 'aviso':
      return { ...s, aviso: a.aviso };

    default:
      return s;
  }
}

// --- cola sin conexion ---------------------------------------------------

function leerCola(): TransactionInput[] {
  try {
    const crudo = localStorage.getItem(CLAVE_COLA);
    return crudo ? (JSON.parse(crudo) as TransactionInput[]) : [];
  } catch {
    return [];
  }
}

function escribirCola(cola: TransactionInput[]): void {
  try {
    localStorage.setItem(CLAVE_COLA, JSON.stringify(cola));
  } catch {
    // Almacenamiento lleno o bloqueado (modo privado). La app sigue
    // funcionando, solo que sin poder guardar para despues.
  }
}

// --- contexto ------------------------------------------------------------

interface Acciones {
  entrar: (email: string, password: string) => Promise<void>;
  instalar: (d: Parameters<typeof api.setup>[0]) => Promise<void>;
  salir: () => Promise<void>;
  recargar: () => Promise<void>;
  guardarTx: (tx: TransactionInput, idExistente?: string) => Promise<void>;
  borrarTx: (id: string) => Promise<void>;
  guardarCuenta: (c: Partial<Account>, id?: string) => Promise<void>;
  archivarCuenta: (id: string) => Promise<void>;
  ajustarSaldo: (id: string, saldoMinor: number, nota?: string) => Promise<void>;
  guardarCategoria: (c: Partial<Category>, id?: string) => Promise<void>;
  guardarEntidad: (e: Partial<Entity>, id?: string) => Promise<void>;
  archivarEntidad: (id: string) => Promise<void>;
  /** A la papelera. Se deshace de un toque, y se borra sola a los 30 dias. */
  descartar: (tipo: Descarte, id: string) => Promise<void>;
  restaurar: (tipo: Descarte, id: string) => Promise<void>;
  /** Borra de verdad lo de la papelera que no tenga historia. */
  vaciarPapelera: (items?: { tipo: Descarte; id: string }[]) => Promise<{
    borrados: number;
    retenidos: { tipo: Descarte; id: string; nombre: string; motivo: string }[];
  }>;
  verEntidad: (id: string | null) => void;
  guardarJarras: (jars: Partial<Jar>[]) => Promise<void>;
  traspasarEntreJarras: (d: {
    fromJarId: string; toJarId: string; amountMinor: number; note?: string;
  }) => Promise<void>;
  pagarAOtraEconomia: (d: {
    fromJarId: string; toEntityId: string; amountMinor: number; note?: string;
  }) => Promise<void>;
  borrarTraspaso: (id: string) => Promise<void>;
  ponerJarrasAlDia: () => Promise<number>;
  asignarAJarras: (d: {
    amountMinor: number; jarId?: string | null; entityId?: string | null; note?: string;
  }) => Promise<void>;
  borrarAporte: (id: string) => Promise<void>;
  /**
   * Un presupuesto de EVENTO lleva `name` y nada mas que el tope.
   * Uno mensual de los viejos lleva `categoryId` y `period`.
   */
  guardarPresupuesto: (b: {
    id?: string;
    name?: string;
    categoryId?: string | null;
    entityId?: string | null;
    amountMinor: number;
    period?: string;
    closedAt?: number | null;
    icon?: string | null;
  }) => Promise<void>;
  borrarPresupuesto: (id: string) => Promise<void>;
  guardarPerfil: (d: {
    displayName?: string; color?: string; emoji?: string;
    homeLayout?: SeccionInicio[];
    movesLayout?: SeccionMovimientos[];
    /** Data URI ya recortada y achicada en el navegador. '' la quita. */
    photo?: string;
    theme?: Tema;
  }) => Promise<void>;
  guardarRecurrente: (r: Partial<Recurring> & { startAt?: number }, id?: string) => Promise<void>;
  borrarRecurrente: (id: string) => Promise<void>;
  cobrarRecurrente: (id: string, d?: { amountMinor?: number; date?: number }) => Promise<void>;
  deshacerCobro: (id: string) => Promise<void>;
  invitar: (d: { email: string; password: string; displayName: string }) => Promise<void>;
  avisar: (texto: string, tipo?: 'error' | 'ok') => void;
}

/**
 * Lo que el store calcula y no viene de la API tal cual.
 *
 * `categories`, `accounts` y `entities` del Estado ya vienen sin lo tirado;
 * esto es lo tirado, que solo mira la pantalla de la papelera.
 */
interface Derivados {
  papelera: { categories: Category[]; accounts: Account[]; entities: Entity[] };
  /**
   * Buscar una categoría POR SU ID, esté tirada o no.
   *
   * Existe por un agujero que dejaba la regla de arriba. Tirar una categoría
   * la saca de `categories`, y entonces los movimientos que la usaban dejaban
   * de encontrarla: se dibujaban como «Sin categoría», con el icono gris, y el
   * buscador de Movimientos tampoco los encontraba por su nombre. O sea que la
   * app decía «esta categoría no se puede borrar, la usan 3 movimientos» y al
   * mismo tiempo escondía esos 3 movimientos. Uno miraba la lista, no veía
   * ninguno, y concluía —con razón— que la app se equivocaba.
   *
   * La regla sigue en pie donde importa: lo tirado no se OFRECE para elegir.
   * Pero lo ya guardado se sigue leyendo, que es lo contrario de ofrecerlo.
   */
  categoriaPorId: (id: string | null | undefined) => Category | undefined;
  /**
   * TODAS las categorías, tiradas incluidas.
   *
   * Es para `filtrarPorEntidad` e `indexarCategorias`, que no ofrecen nada:
   * resuelven de qué economía es un movimiento ya guardado. Con la lista
   * recortada, un movimiento cuya categoría estaba en la papelera no resolvía
   * economía y desaparecía de Inicio, de Movimientos y de Jarras en cuanto se
   * elegía una economía: la plata seguía en los saldos pero no estaba en
   * ninguna lista.
   */
  categoriasTodas: Category[];
}

const Ctx = createContext<(Estado & Derivados & Acciones) | null>(null);

export function Store({ children }: { children: ReactNode }) {
  const [estado, dispatch] = useReducer(reducer, inicial);

  // Se usa una ref para que `vaciarCola` pueda leer la cola actual sin
  // volver a crearse en cada cambio (lo que reiniciaria los efectos).
  const colaRef = useRef<TransactionInput[]>([]);

  const avisar = useCallback((texto: string, tipo: 'error' | 'ok' = 'error') => {
    dispatch({ t: 'aviso', aviso: { texto, tipo } });
    setTimeout(() => dispatch({ t: 'aviso', aviso: null }), 4000);
  }, []);

  const cargar = useCallback(async () => {
    try {
      const snap = await api.snapshot();
      dispatch({ t: 'snapshot', snap });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        const { instalado } = await api.estado().catch(() => ({ instalado: true }));
        dispatch({ t: 'instalado', v: instalado });
        dispatch({ t: 'cargando', v: false });
      } else {
        dispatch({ t: 'cargando', v: false });
        avisar(e instanceof Error ? e.message : 'No se pudo cargar');
      }
    }
  }, [avisar]);

  // Arranque.
  useEffect(() => {
    colaRef.current = leerCola();
    dispatch({ t: 'cola', cola: colaRef.current });
    void cargar();
  }, [cargar]);

  const setCola = useCallback((cola: TransactionInput[]) => {
    colaRef.current = cola;
    escribirCola(cola);
    dispatch({ t: 'cola', cola });
  }, []);

  /** Sube lo que haya quedado pendiente por falta de conexion. */
  const vaciarCola = useCallback(async () => {
    const pendientes = colaRef.current;
    if (pendientes.length === 0) return;

    try {
      const r = await api.crearTxLote(pendientes);
      for (const tx of r.transactions) dispatch({ t: 'tx:upsert', tx });
      dispatch({ t: 'saldos', accounts: r.accounts, jars: r.jars });
      setCola([]);

      if (r.transactions.length > 0) {
        avisar(
          `Se sincronizaron ${r.transactions.length} movimiento${r.transactions.length > 1 ? 's' : ''} pendiente${r.transactions.length > 1 ? 's' : ''}`,
          'ok',
        );
      }
      if (r.rechazados.length > 0) {
        avisar(`${r.rechazados.length} movimiento(s) no se pudieron guardar`);
      }
    } catch {
      // Sigue sin conexion. Se queda en la cola para el proximo intento.
    }
  }, [avisar, setCola]);

  // Tiempo real: se conecta solo cuando hay sesion.
  useEffect(() => {
    if (!estado.autenticado) return;

    live.conectar();

    const quitarEscucha = live.al((ev: LiveEvent) => {
      switch (ev.kind) {
        case 'tx:upsert':
          dispatch({ t: 'tx:upsert', tx: ev.tx });
          // Lo que llega por el cable es del otro telefono: destella un
          // segundo y medio y despues es una fila mas.
          dispatch({ t: 'recien', id: ev.tx.id, dentro: true });
          setTimeout(() => dispatch({ t: 'recien', id: ev.tx.id, dentro: false }), 1600);
          break;
        case 'tx:delete': dispatch({ t: 'tx:delete', id: ev.id }); break;
        case 'account:upsert': dispatch({ t: 'account:upsert', account: ev.account }); break;
        case 'account:delete': dispatch({ t: 'account:delete', id: ev.id }); break;
        case 'category:upsert': dispatch({ t: 'category:upsert', category: ev.category }); break;
        case 'budget:upsert': dispatch({ t: 'budget:upsert', budget: ev.budget }); break;
        case 'budget:delete': dispatch({ t: 'budget:delete', id: ev.id }); break;
        case 'member:upsert': dispatch({ t: 'member:upsert', member: ev.member }); break;
        case 'recurring:upsert': dispatch({ t: 'recurring:upsert', recurring: ev.recurring }); break;
        case 'recurring:delete': dispatch({ t: 'recurring:delete', id: ev.id }); break;
        // Antes esto era un `break` a secas y el otro telefono no veia ningun
        // cambio de jarra hasta recargar: ni un porcentaje, ni un nombre.
        case 'jar:upsert': dispatch({ t: 'jar:upsert', jar: ev.jar }); break;
        case 'jars': dispatch({ t: 'jars', jars: ev.jars }); break;
        case 'entity:upsert': dispatch({ t: 'entity:upsert', entity: ev.entity }); break;
        case 'entity:delete': dispatch({ t: 'entity:delete', id: ev.id }); break;
        case 'imputaciones':
          dispatch({ t: 'imputaciones', txId: ev.txId, imputaciones: ev.imputaciones });
          break;
        case 'jarTransfer:upsert':
          dispatch({ t: 'jarTransfer:upsert', transfer: ev.transfer });
          break;
        case 'jarTransfer:delete': dispatch({ t: 'jarTransfer:delete', id: ev.id }); break;
        case 'recargar':
          // El disparador de pagos habituales creo movimientos por fuera de la
          // app. Se recarga entero en vez de parchear evento por evento.
          void cargar();
          break;
        case 'hello':
        case 'presence': dispatch({ t: 'online', ids: ev.online }); break;
      }
    });

    const quitarEstado = live.alCambiarEstado((e) => {
      dispatch({ t: 'live', estado: e });
      // Al recuperar la conexion: subir lo pendiente y volver a sincronizar,
      // porque mientras estuvo caida pudieron pasar cosas que no llegaron.
      if (e === 'conectado') {
        void vaciarCola().then(() => cargar());
      }
    });

    return () => {
      quitarEscucha();
      quitarEstado();
      live.desconectar();
    };
  }, [estado.autenticado, vaciarCola, cargar]);

  // Los eventos de tiempo real traen movimientos pero no saldos: se recalculan
  // en el cliente con la misma funcion que usa el servidor, asi que coinciden.
  const cuentasConSaldo = useMemo(() => {
    const saldos = calcularSaldos(estado.accounts, estado.transactions);
    return estado.accounts.map((c) => ({ ...c, balanceMinor: saldos.get(c.id) ?? c.balanceMinor }));
  }, [estado.accounts, estado.transactions]);

  // El saldo de una jarra sale de sus imputaciones congeladas, no de volver a
  // repartir el historial con los porcentajes de hoy. Es lo que hace que
  // cambiar un porcentaje no mueva el pasado.
  const jarrasConSaldo = useMemo(() => {
    const saldos = calcularJarras(
      estado.jars, estado.imputaciones, estado.jarTransfers, estado.jarAportes,
    );
    return estado.jars.map((j) => ({ ...j, balanceMinor: saldos.get(j.id) ?? 0 }));
  }, [estado.jars, estado.imputaciones, estado.jarTransfers, estado.jarAportes]);

  const acciones = useMemo<Acciones>(() => ({
    avisar,

    entrar: async (email, password) => {
      await api.login(email, password);
      await cargar();
    },

    instalar: async (d) => {
      await api.setup(d);
      await cargar();
    },

    salir: async () => {
      await api.logout().catch(() => {});
      live.desconectar();
      dispatch({ t: 'salir' });
    },

    recargar: cargar,

    guardarTx: async (entrada, idExistente) => {
      const id = idExistente ?? crypto.randomUUID();
      const esNuevo = !idExistente;

      // Version optimista: se pinta ya, con los datos que se tienen.
      const previo = estado.transactions.find((t) => t.id === id);
      const optimista: Transaction = {
        ...entrada,
        id,
        householdId: estado.household?.id ?? '',
        createdBy: previo?.createdBy ?? estado.me?.id ?? '',
        createdAt: previo?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };

      dispatch({ t: 'tx:upsert', tx: optimista });
      dispatch({ t: 'vuelo:add', id });

      try {
        const r = esNuevo
          ? await api.crearTx({ ...entrada, id })
          : await api.editarTx(id, entrada);

        dispatch({ t: 'tx:upsert', tx: r.transaction });
        dispatch({ t: 'imputaciones', txId: r.transaction.id, imputaciones: r.imputaciones });
        dispatch({ t: 'saldos', accounts: r.accounts, jars: r.jars });
      } catch (e) {
        if (e instanceof ApiError && e.esDeRed && esNuevo) {
          // Sin conexion: se deja en pantalla y se encola para despues.
          setCola([...colaRef.current, { ...entrada, id }]);
          avisar('Guardado sin conexión. Se subirá al volver la señal.', 'ok');
        } else {
          // El servidor lo rechazo: se deshace para no mostrar algo falso.
          if (previo) dispatch({ t: 'tx:upsert', tx: previo });
          else dispatch({ t: 'tx:delete', id });
          avisar(e instanceof Error ? e.message : 'No se pudo guardar');
          throw e;
        }
      } finally {
        dispatch({ t: 'vuelo:del', id });
      }
    },

    borrarTx: async (id) => {
      const previo = estado.transactions.find((t) => t.id === id);
      dispatch({ t: 'tx:delete', id });

      try {
        const r = await api.borrarTx(id);
        dispatch({ t: 'saldos', accounts: r.accounts, jars: r.jars });
      } catch (e) {
        if (previo) dispatch({ t: 'tx:upsert', tx: previo });
        avisar(e instanceof Error ? e.message : 'No se pudo borrar');
        throw e;
      }
    },

    guardarCuenta: async (c, id) => {
      const r = id ? await api.editarCuenta(id, c) : await api.crearCuenta(c);
      dispatch({ t: 'account:upsert', account: r.account });
    },

    ajustarSaldo: async (id, saldoMinor, nota) => {
      const r = await api.ajustarSaldo(id, saldoMinor, nota);
      dispatch({ t: 'account:upsert', account: r.account });
    },

    archivarCuenta: async (id) => {
      const r = await api.archivarCuenta(id);
      if (r.account) dispatch({ t: 'account:upsert', account: r.account });
      else dispatch({ t: 'account:delete', id });
    },

    guardarCategoria: async (c, id) => {
      const r = id ? await api.editarCategoria(id, c) : await api.crearCategoria(c);
      dispatch({ t: 'category:upsert', category: r.category });
    },

    guardarEntidad: async (e, id) => {
      const r = id ? await api.editarEntidad(id, e) : await api.crearEntidad(e);
      dispatch({ t: 'entity:upsert', entity: r.entity });
    },

    archivarEntidad: async (id) => {
      const r = await api.archivarEntidad(id);
      if (r.entity) dispatch({ t: 'entity:upsert', entity: r.entity });
      else dispatch({ t: 'entity:delete', id });
    },

    // La papelera no toca el estado local a mano: el Worker vuelve a
    // difundir la fila y llega por el canal en vivo, igual que si lo hubiera
    // hecho la otra persona. Asi las dos pantallas quedan iguales.
    descartar: async (tipo, id) => {
      await api.descartar(tipo, id);
      await cargar();
    },

    restaurar: async (tipo, id) => {
      await api.restaurar(tipo, id);
      await cargar();
    },

    vaciarPapelera: async (items) => {
      const r = await api.vaciarPapelera(items);
      await cargar();
      return { borrados: r.borrados, retenidos: r.retenidos };
    },

    verEntidad: (id) => dispatch({ t: 'entidadActiva', id }),

    guardarJarras: async (jars) => {
      const r = await api.guardarJarras(jars);
      dispatch({ t: 'jars', jars: r.jars });
    },

    traspasarEntreJarras: async (d) => {
      const r = await api.traspasarEntreJarras(d);
      dispatch({ t: 'jarTransfer:upsert', transfer: r.transfer });
    },

    pagarAOtraEconomia: async (d) => {
      const r = await api.pagarAOtraEconomia(d);
      // Son varios traspasos de una vez: se aplican todos y se toman los
      // saldos ya recalculados que devuelve el servidor.
      for (const transfer of r.transfers) dispatch({ t: 'jarTransfer:upsert', transfer });
      dispatch({ t: 'jars', jars: r.jars });
    },

    borrarTraspaso: async (id) => {
      await api.borrarTraspaso(id);
      dispatch({ t: 'jarTransfer:delete', id });
    },

    ponerJarrasAlDia: async () => {
      const r = await api.ponerJarrasAlDia();
      // Cambiaron varios movimientos de golpe: se recarga entero en vez de
      // parchear uno por uno. Pasa una sola vez.
      if (r.repartidos > 0) await cargar();
      return r.repartidos;
    },

    asignarAJarras: async (d) => {
      const r = await api.asignarAJarras(d);
      dispatch({ t: 'jars', jars: r.jars });
      // Se recarga para traer los aportes nuevos: el saldo ya vino recalculado,
      // pero la lista de movimientos de cada jarra sale de ellos.
      await cargar();
    },

    borrarAporte: async (id) => {
      await api.borrarAporte(id);
      await cargar();
    },

    guardarPresupuesto: async (b) => {
      const r = await api.guardarPresupuesto(b);
      dispatch({ t: 'budget:upsert', budget: r.budget });
    },

    borrarPresupuesto: async (id) => {
      await api.borrarPresupuesto(id);
      dispatch({ t: 'budget:delete', id });
    },

    guardarPerfil: async (d) => {
      const r = await api.editarPerfil(d);
      dispatch({ t: 'member:upsert', member: r.member });
    },

    guardarRecurrente: async (rec, id) => {
      const r = id ? await api.editarRecurrente(id, rec) : await api.crearRecurrente(rec);
      dispatch({ t: 'recurring:upsert', recurring: r.recurring });
    },

    borrarRecurrente: async (id) => {
      await api.borrarRecurrente(id);
      dispatch({ t: 'recurring:delete', id });
    },

    cobrarRecurrente: async (id, d) => {
      const r = await api.cobrarRecurrente(id, d);
      dispatch({ t: 'recurring:upsert', recurring: r.recurring });
      dispatch({ t: 'tx:upsert', tx: r.tx });
    },

    deshacerCobro: async (id) => {
      const r = await api.deshacerCobro(id);
      dispatch({ t: 'recurring:upsert', recurring: r.recurring });
      dispatch({ t: 'tx:delete', id: r.txBorrado });
    },

    invitar: async (d) => {
      const r = await api.invitar(d);
      dispatch({ t: 'members', members: [...estado.members, r.member] });
    },
  }), [avisar, cargar, estado.transactions, estado.household, estado.me, estado.members, setCola]);

  /**
   * Lo que esta en la papelera no existe para el resto de la app.
   *
   * Se filtra ACA, una sola vez, y no en las 43 pantallas que listan
   * categorias, cuentas o economias. Filtrar en cada una significaria que la
   * pantalla que escriba alguien mañana se olvide y muestre algo tirado; asi,
   * para verlo hay que pedirlo a proposito con `papelera`.
   *
   * Archivado NO se filtra aca: eso lo decide cada pantalla, porque una
   * categoria archivada tiene que seguir apareciendo en el historial y en los
   * totales del pasado.
   */
  const vivos = useMemo(() => ({
    categories: estado.categories.filter((c) => !c.trashedAt),
    accounts: cuentasConSaldo.filter((c) => !c.trashedAt),
    entities: estado.entities.filter((e) => !e.trashedAt),
  }), [estado.categories, estado.entities, cuentasConSaldo]);

  /**
   * Para LEER un movimiento viejo: busca entre todas, tiradas incluidas.
   * Para OFRECER algo que elegir sigue estando `categories`, sin lo tirado.
   */
  const categoriaPorId = useMemo(() => {
    const porId = new Map(estado.categories.map((c) => [c.id, c]));
    return (id: string | null | undefined) => (id ? porId.get(id) : undefined);
  }, [estado.categories]);

  /** Lo tirado, para la pantalla de la papelera y para nada mas. */
  const papelera = useMemo(() => ({
    categories: estado.categories.filter((c) => Boolean(c.trashedAt)),
    accounts: estado.accounts.filter((c) => Boolean(c.trashedAt)),
    entities: estado.entities.filter((e) => Boolean(e.trashedAt)),
  }), [estado.categories, estado.accounts, estado.entities]);

  /**
   * El tema de cada persona, estampado en <html>.
   *
   * Va aca y no en un componente porque tiene que aplicarse apenas se sabe
   * quien entro, antes de que se dibuje nada: si se hiciera al montar una
   * pantalla, la app parpadearia del tema del sistema al elegido.
   */
  useEffect(() => {
    const tema = estado.me?.theme ?? 'auto';
    const raiz = document.documentElement;
    if (tema === 'auto') raiz.removeAttribute('data-tema');
    else raiz.setAttribute('data-tema', tema);
    // `color-scheme` le dice al navegador de que color pintar los controles
    // nativos y las barras de scroll. Sin esto, un desplegable del sistema
    // sale claro sobre una app oscura.
    raiz.style.colorScheme = tema === 'auto' ? 'light dark' : tema === 'oscuro' ? 'dark' : 'light';
  }, [estado.me?.theme]);

  const valor = useMemo(
    () => ({
      ...estado,
      categories: vivos.categories,
      accounts: vivos.accounts,
      entities: vivos.entities,
      jars: jarrasConSaldo,
      papelera,
      categoriaPorId,
      categoriasTodas: estado.categories,
      ...acciones,
    }),
    [estado, vivos, jarrasConSaldo, papelera, categoriaPorId, acciones],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore tiene que usarse dentro de <Store>');
  return ctx;
}
