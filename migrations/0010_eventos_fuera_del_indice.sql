-- Un presupuesto de evento no es un tope mensual, y el índice los confundía.
--
-- EL BUG: idx_budget_unico era UNIQUE sobre
-- (hogar, periodo, categoria, economia). Un evento —«Viaje a Cancún»— no tiene
-- categoría y guarda como periodo el mes en que nació, así que su clave era
-- exactamente la misma que la del tope global de esa economía ese mes.
--
-- Resultado: crear un segundo evento en el mismo mes, o crear un evento
-- teniendo un tope global del mes, fallaba con un 500 crudo. Dos presupuestos
-- de evento en un mismo mes eran imposibles.
--
-- El arreglo es un índice PARCIAL: la unicidad vale solo para los topes
-- mensuales, que son los que tienen name NULL. Los eventos se identifican por
-- su id y no necesitan ser únicos por nada.
--
-- Un índice no guarda datos: cambiarlo no puede perder ninguna fila.

DROP INDEX IF EXISTS idx_budget_unico;

CREATE UNIQUE INDEX idx_budget_unico
  ON budget(household_id, period, IFNULL(category_id, ''), IFNULL(entity_id, ''))
  WHERE name IS NULL;
