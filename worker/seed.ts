/**
 * Datos iniciales del hogar.
 *
 * Las jarras son el metodo de los 6 frascos (T. Harv Eker), que ya estaba en
 * la version anterior y se conserva porque es una decision del hogar, no un
 * detalle tecnico. Los porcentajes van en puntos base y suman exactamente
 * 10.000 = 100%.
 */

export const CATEGORIAS_INICIALES: {
  name: string; type: 'ingreso' | 'gasto'; icon: string; color: string;
}[] = [
  // Gastos
  { name: 'Comida', type: 'gasto', icon: 'utensils', color: '#ef4444' },
  { name: 'Hogar', type: 'gasto', icon: 'house', color: '#3b82f6' },
  { name: 'Transporte', type: 'gasto', icon: 'car', color: '#f59e0b' },
  { name: 'Salud', type: 'gasto', icon: 'heart-pulse', color: '#10b981' },
  { name: 'Compras', type: 'gasto', icon: 'shopping-bag', color: '#ec4899' },
  { name: 'Ocio', type: 'gasto', icon: 'popcorn', color: '#8b5cf6' },
  { name: 'Servicios', type: 'gasto', icon: 'zap', color: '#06b6d4' },
  { name: 'Mascotas', type: 'gasto', icon: 'paw-print', color: '#a16207' },
  { name: 'Educación', type: 'gasto', icon: 'graduation-cap', color: '#0ea5e9' },
  { name: 'Otros', type: 'gasto', icon: 'circle-ellipsis', color: '#64748b' },
  // Ingresos
  { name: 'Sueldo', type: 'ingreso', icon: 'briefcase', color: '#10b981' },
  { name: 'Freelance', type: 'ingreso', icon: 'laptop', color: '#3b82f6' },
  { name: 'Regalo', type: 'ingreso', icon: 'gift', color: '#ec4899' },
  { name: 'Otros ingresos', type: 'ingreso', icon: 'circle-plus', color: '#64748b' },
];

/**
 * `acumula` decide que numero es el protagonista: el del mes o el de toda la
 * vida. "Ahorro largo plazo" leido de a un mes no significa nada, y
 * "Diversion" acumulada desde siempre tampoco. Lo que sobra de un mes no se
 * tira en ningun caso: se queda en la jarra.
 */
export const JARRAS_INICIALES: {
  name: string; percentageBp: number; icon: string; color: string; acumula: boolean;
}[] = [
  { name: 'Necesidades', percentageBp: 5500, icon: 'house', color: '#3b82f6', acumula: false },
  { name: 'Ahorro largo plazo', percentageBp: 1000, icon: 'piggy-bank', color: '#10b981', acumula: true },
  { name: 'Educación', percentageBp: 1000, icon: 'graduation-cap', color: '#8b5cf6', acumula: false },
  { name: 'Diversión', percentageBp: 1000, icon: 'party-popper', color: '#ec4899', acumula: false },
  { name: 'Libertad financiera', percentageBp: 1000, icon: 'trending-up', color: '#f59e0b', acumula: true },
  { name: 'Donaciones', percentageBp: 500, icon: 'heart-handshake', color: '#f43f5e', acumula: false },
];
