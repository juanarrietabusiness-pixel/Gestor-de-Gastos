/**
 * GET /api/resumen — la app contada en un solo JSON.
 *
 * Existe para que una inteligencia artificial pueda auditar estas cuentas sin
 * leer el codigo. Sin esto, preguntarle "¿PanaClaw da o no da?" obliga a que
 * lea las migraciones para entender el esquema, el dominio para entender como
 * se calcula un saldo, y despues 44 movimientos crudos para sumarlos: miles de
 * tokens para una respuesta de una linea, y con riesgo de que sume mal.
 *
 * Aca vienen los numeros YA calculados con las mismas funciones que usa la
 * pantalla —asi no hay dos verdades— mas las reglas que hay que conocer para
 * interpretarlos. Los movimientos NO vienen: para eso esta /api/snapshot.
 *
 * Es de lectura y respeta la sesion, como todo lo demas: nadie ve los numeros
 * de este hogar sin estar adentro.
 */

import { snapshot } from '../db.ts';
import type { Env } from '../env.ts';
import type { Sesion } from '../auth.ts';
import { error, json } from '../http.ts';
import {
  balancePorMes, calcularPatrimonio, entidadDe, entidadPorDefecto, estadoPresupuestos,
  flujoDeJarras, gastadoEnEvento, indexarCategorias, jarrasDe, porCategoria, resumir,
  sinAsignar,
} from '../../shared/domain.ts';
import { claveMes } from '../../shared/domain.ts';
import { TxType } from '../../shared/types.ts';

/** Los meses hacia atras que se resumen por defecto. */
const MESES = 12;

/** Que significa cada tabla, para no tener que leer las migraciones. */
const TABLAS: Record<string, string> = {
  household: 'El hogar. Uno solo. Guarda la moneda.',
  member: 'Las personas. Solo dos, sin registro publico.',
  entity: 'Las economias: la casa y cada negocio. kind es personal|negocio.',
  account: 'Las cuentas. balance_minor NO se guarda: se calcula sumando movimientos y ajustes sobre initial_balance_minor.',
  category: 'Las categorias. entity_id dice de que economia son, y el movimiento lo hereda.',
  tx: 'Los movimientos. type: 1 transferencia, 2 ingreso, 3 gasto, 4 ajuste de saldo. entity_id en NULL significa "la de mi categoria".',
  jar: 'Las jarras. fill_kind: porcentaje|fijo|resto. entity_id es duro: una jarra es de una sola economia.',
  jar_imputacion: 'Lo que cada movimiento le hizo a cada jarra, calculado UNA vez al guardar y congelado. Cambiar un porcentaje no reescribe el pasado.',
  jar_transfer: 'Mover plata entre jarras sin tocar ninguna cuenta.',
  jar_aporte: 'Plata puesta a mano en una jarra, sin que venga de repartir un ingreso. Tambien suma al saldo de la jarra.',
  budget: 'Dos cosas distintas en la misma tabla: con name en NULL es un tope mensual (category_id en NULL = tope global del mes); con name es un presupuesto de evento, que solo mide lo que se le carga y no aparta plata.',
  recurring: 'Pagos habituales. frequency: semanal|quincenal|mensual|trimestral|semestral|anual. En trimestral y semestral month_of_year es el ANCLA del ciclo, no el unico mes: con 3 (marzo) una trimestral cae en marzo, junio, septiembre y diciembre. esperando_desde con fecha = se esperaba y todavia no lo confirmaron.',
  account_adjustment: 'Correcciones manuales de saldo, con su rastro. No inventan ni borran movimientos.',
  'category/account/entity.trashed_at': 'Si tiene fecha, esta en la papelera y no cuenta para nada de aca. Se restaura de un toque. Lo que no tiene historia se borra solo a los 30 dias; lo que si la tiene no se borra nunca. archived es lo que quedo de antes de unificar archivo y papelera: sigue contando su historia y solo deja de ofrecerse al cargar.',
};

const INVARIANTES = [
  'Todos los montos son enteros en centavos: 55924 es $559.24. Nunca hay decimales ni float.',
  'sumaDeCuentasActivas = sumaDeJarras + sinAsignar. Siempre, y por eso borrar un movimiento devuelve el saldo exacto.',
  'El reparto de un ingreso suma EXACTAMENTE el monto del ingreso, al centavo (metodo del mayor resto, o la jarra de resto absorbiendo el redondeo).',
  'Los porcentajes de las jarras suman 100% dentro de cada economia, no entre todas.',
  'Un cobro de un negocio se reparte solo entre las jarras de ese negocio. Un ingreso sin economia cae en las de la primera, que es la casa.',
  'Las transferencias entre cuentas propias y los ajustes de saldo no son ni ingreso ni gasto: no entran en ningun resultado.',
  'El saldo de una jarra es repartos de ingresos + aportes a mano + traspasos recibidos - lo que se gasto de ella. En negativo significa que salio mas de lo que entro, no que este mal calculado.',
  'Lo que esta en la papelera no aparece en ningun numero de aca. Lo archivado si: sigue sumando su historia, solo que no se ofrece al cargar.',
  'Cada cuenta guarda su moneda, pero el patrimonio las suma sin convertir: hoy solo es correcto si todas las cuentas estan en la moneda del hogar.',
];

/**
 * El resumen como objeto, para reusarlo sin pasar por HTTP.
 *
 * Lo usa la ruta de abajo y tambien el consejero (consejo.ts), que necesita
 * exactamente estos numeros como contexto. Que salga de un solo lugar es lo
 * que evita que la pantalla y la IA cuenten cosas distintas.
 */
export async function resumenDelHogar(
  env: Env, householdId: string, memberId: string,
): Promise<Record<string, unknown> | null> {
  const snap = await snapshot(env, householdId, memberId);
  if (!snap) return null;

  const { jars, transactions, budgets, recurring } = snap;

  // Lo que esta en la papelera no existe para la pantalla, asi que tampoco
  // puede existir aca: si el consejero suma una cuenta tirada, su patrimonio
  // no es el que la persona ve, y esa es la peor forma de equivocarse.
  const accounts = snap.accounts.filter((a) => a.trashedAt === null);
  const categories = snap.categories.filter((c) => c.trashedAt === null);
  const entities = snap.entities.filter((e) => e.trashedAt === null);

  const activas = accounts.filter((c) => !c.archived);
  // El indice se arma con TODAS, tiradas incluidas: un movimiento viejo de una
  // categoria tirada sigue heredando su economia, y sin esto caeria en
  // «sin clasificar» y desordenaria los totales por economia.
  const indice = indexarCategorias(snap.categories);
  const porDefecto = entidadPorDefecto(entities);

  const saldosJarras = new Map(jars.map((j) => [j.id, j.balanceMinor]));
  const libre = sinAsignar(activas, saldosJarras);
  const flujoVida = flujoDeJarras(jars, snap.imputaciones, snap.jarTransfers, snap.jarAportes);

  // Los ultimos N meses, del mas viejo al mas nuevo.
  const hoy = new Date();
  const meses = Array.from({ length: MESES }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - (MESES - 1 - i), 1);
    return claveMes(d.getTime());
  });

  const nombreEntidad = (id: string | null) =>
    entities.find((e) => e.id === id)?.name ?? null;

  const usosPorCategoria = new Map<string, { cantidad: number; totalMinor: number }>();
  for (const t of transactions) {
    if (!t.categoryId) continue;
    const a = usosPorCategoria.get(t.categoryId) ?? { cantidad: 0, totalMinor: 0 };
    a.cantidad += 1;
    a.totalMinor += t.amountMinor;
    usosPorCategoria.set(t.categoryId, a);
  }

  return {
    generadoEn: Date.now(),
    moneda: snap.household.currency,

    comoLeerlo: {
      queEsEsto: 'Los numeros de este hogar ya calculados, para responder preguntas sin leer el codigo ni sumar movimientos a mano. Los movimientos crudos estan en GET /api/snapshot.',
      invariantes: INVARIANTES,
      tablas: TABLAS,
    },

    // --- de quien es la plata ---
    economias: entities.map((e) => {
      const suyas = transactions.filter((t) => entidadDe(t, indice) === e.id);
      const r = resumir(suyas);
      return {
        id: e.id,
        nombre: e.name,
        tipo: e.kind,
        archivada: e.archived,
        movimientos: r.cantidad,
        ingresoMinor: r.ingresoMinor,
        gastoMinor: r.gastoMinor,
        resultadoMinor: r.flujoMinor,
        jarras: jarrasDe(jars, e.id).length,
      };
    }),
    // Lo que todavia no tiene economia, para que nada desaparezca del total.
    sinClasificar: (() => {
      const sueltos = transactions.filter((t) => entidadDe(t, indice) === null);
      const r = resumir(sueltos);
      return { movimientos: r.cantidad, ingresoMinor: r.ingresoMinor, gastoMinor: r.gastoMinor, resultadoMinor: r.flujoMinor };
    })(),

    // --- donde esta la plata ---
    patrimonioMinor: calcularPatrimonio(activas),
    cuentas: activas.map((c) => ({
      id: c.id, nombre: c.name, tipo: c.category, duenio: c.owner,
      saldoMinor: c.balanceMinor, economia: nombreEntidad(c.entityId),
    })),

    // --- para que esta guardada ---
    enJarrasMinor: jars.reduce((s, j) => s + j.balanceMinor, 0),
    sinAsignarMinor: libre,
    jarras: jars.map((j) => {
      const v = flujoVida.get(j.id) ?? { entroMinor: 0, salioMinor: 0 };
      return {
        id: j.id,
        nombre: j.name,
        economia: nombreEntidad(j.entityId),
        regla: j.fillKind === 'resto' ? 'lo que sobre'
          : j.fillKind === 'fijo' ? `${j.fillMinor ?? 0} centavos de cada ingreso`
            : `${j.percentageBp / 100}% de cada ingreso`,
        acumulaDePorVida: j.acumula,
        saldoMinor: j.balanceMinor,
        recibioEnLaVidaMinor: v.entroMinor,
        gastoEnLaVidaMinor: v.salioMinor,
        enRojo: j.balanceMinor < 0,
      };
    }),

    // --- en que se va ---
    // Solo las que se usaron alguna vez. De las 30 que hay, 13 cubren el 100%
    // de la historia: listar las otras 17 es gastar tokens en nada.
    categorias: categories
      .filter((c) => !c.archived && usosPorCategoria.has(c.id))
      .map((c) => ({
        id: c.id, nombre: c.name, tipo: c.type,
        economia: nombreEntidad(c.entityId),
        usos: usosPorCategoria.get(c.id)?.cantidad ?? 0,
        totalMinor: usosPorCategoria.get(c.id)?.totalMinor ?? 0,
      })),
    categoriasSinUsar: categories.filter(
      (c) => !c.archived && !usosPorCategoria.has(c.id),
    ).length,
    gastoPorCategoria: porCategoria(transactions, categories, 'gasto')
      .map((x) => ({
        categoria: x.category?.name ?? 'Sin categoría',
        economia: nombreEntidad(x.category?.entityId ?? null),
        totalMinor: x.totalMinor, cantidad: x.cantidad,
      })),

    // --- como viene la mano ---
    porMes: balancePorMes(transactions, meses)
      .filter((m) => m.resumen.cantidad > 0)
      .map((m) => ({
        mes: m.periodo,
        ingresoMinor: m.resumen.ingresoMinor,
        gastoMinor: m.resumen.gastoMinor,
        resultadoMinor: m.resumen.flujoMinor,
        movimientos: m.resumen.cantidad,
      })),
    desdeSiempre: resumir(transactions),

    // --- lo que viene ---
    presupuestosDelMes: estadoPresupuestos(budgets, transactions, claveMes(Date.now()), categories)
      .map((e) => ({
        categoria: categories.find((c) => c.id === e.budget.categoryId)?.name ?? 'Todo el mes',
        topeMinor: e.budget.amountMinor,
        gastadoMinor: e.gastadoMinor,
        excedido: e.gastadoMinor > e.budget.amountMinor,
      })),
    // Los eventos con nombre: «Viaje a Cancún». Solo miden, no apartan plata.
    presupuestosDeEvento: budgets.filter((b) => b.name).map((b) => {
      const gastado = gastadoEnEvento(b.id, transactions);
      return {
        nombre: b.name,
        economia: nombreEntidad(b.entityId),
        topeMinor: b.amountMinor,
        gastadoMinor: gastado,
        restanteMinor: b.amountMinor - gastado,
        cerrado: b.closedAt !== null,
        gastosCargados: transactions.filter((t) => t.budgetId === b.id).length,
      };
    }),

    /**
     * Lo que va a pasar solo en los proximos 30 dias.
     *
     * Sin esto el consejero solo ve el pasado y responde «te sobran $500»
     * cuando el dia 5 se va el alquiler. Un consejo sobre plata que ignora lo
     * que ya esta comprometido es peor que ninguno.
     */
    loQueViene: (() => {
      const limite = Date.now() + 30 * 86_400_000;
      const proximos = recurring.filter((r) => r.active && r.nextRun <= limite);
      const entra = proximos.filter((r) => r.type === TxType.INGRESO)
        .reduce((a, r) => a + r.amountMinor, 0);
      const sale = proximos.filter((r) => r.type === TxType.GASTO)
        .reduce((a, r) => a + r.amountMinor, 0);
      return {
        enLosProximos30Dias: proximos.length,
        entraMinor: entra,
        saleMinor: sale,
        netoMinor: entra - sale,
        patrimonioProyectadoMinor: calcularPatrimonio(activas) + entra - sale,
      };
    })(),

    pagosHabituales: recurring.filter((r) => r.active).map((r) => ({
      nombre: r.name,
      tipo: r.type === TxType.INGRESO ? 'ingreso' : r.type === TxType.GASTO ? 'gasto' : 'otro',
      montoMinor: r.amountMinor,
      frecuencia: r.frequency,
      economia: nombreEntidad(
        r.entityId ?? (r.categoryId ? indice.get(r.categoryId)?.entityId ?? null : null) ?? porDefecto,
      ),
      repartEnJarras: r.distributeToJars,
      proximo: r.nextRun,
    })),
  };
}

export async function traer(_req: Request, env: Env, sesion: Sesion): Promise<Response> {
  const resumen = await resumenDelHogar(env, sesion.householdId, sesion.memberId);
  if (!resumen) return error('No se encontro el hogar', 404);
  return json(resumen);
}
