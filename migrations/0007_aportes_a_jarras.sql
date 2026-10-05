-- Septima tanda: poder asignar a las jarras la plata que ya estaba.
--
-- Aditiva: una tabla nueva y nada mas. Ni un DROP, ni un UPDATE.
--
-- EL PROBLEMA
--
-- La pantalla de jarras decia "Sin asignar $887.10" con TODOS los movimientos
-- asignados. No era un error de calculo: $887.10 es exactamente la suma de los
-- saldos iniciales de las cuentas —la plata que ya estaba ahi el dia que se
-- creo cada cuenta—. Las jarras solo ven movimientos, asi que ese capital de
-- arranque nunca paso por ninguna.
--
-- El numero era cierto y a la vez inservible: no habia forma de bajarlo, ni de
-- saber de donde salia. Un numero que no se puede mover y no se explica enseña
-- a desconfiar del resto.
--
-- LA SOLUCION
--
-- Un aporte es plata que entra a una jarra SIN venir de un movimiento: sale de
-- lo que esta sin asignar. Es la contracara del traspaso —que mueve entre dos
-- jarras— y del movimiento —que mueve plata de verdad—.
--
-- No toca ninguna cuenta, como el traspaso: la plata ya estaba ahi, lo que
-- cambia es para que esta. Y borrarlo lo deshace entero, porque el saldo de la
-- jarra no se guarda: se suma.
--
-- Va en tabla propia y no como una imputacion con tx_id nulo, que seria lo
-- corto: `jar_imputacion.tx_id` es NOT NULL con borrado en cascada, y eso es
-- justo lo que garantiza que borrar un movimiento devuelva su efecto. Aflojarlo
-- para este caso romperia esa garantia para todos los demas.
CREATE TABLE jar_aporte (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  jar_id        TEXT NOT NULL REFERENCES jar(id) ON DELETE CASCADE,
  -- Positivo mete plata en la jarra; negativo la devuelve a sin asignar.
  amount_minor  INTEGER NOT NULL CHECK (amount_minor <> 0),
  note          TEXT,
  date          INTEGER NOT NULL,
  created_by    TEXT NOT NULL REFERENCES member(id),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_jar_aporte_hogar ON jar_aporte(household_id, date DESC);
CREATE INDEX idx_jar_aporte_jarra ON jar_aporte(jar_id);
