-- Sexta tanda: confirmar un cobro a mano, y topes por economia.
--
-- Aditiva otra vez: una columna nueva y un indice. Ni un DROP TABLE, ni un
-- UPDATE que reescriba movimientos. Los numeros del dia del despliegue son
-- exactamente los mismos.

-- ---------------------------------------------------------------------------
-- 1. El cobro que se espera y todavia no llego
-- ---------------------------------------------------------------------------
--
-- Un pago habitual tiene una fecha, pero la vida no. A veces cobran el 14
-- aunque el sueldo sea el 15, y a veces el 15 pasa y el jefe no pago.
--
-- Hasta ahora la app solo sabia la fecha teorica: el disparador creaba el
-- movimiento el dia 15 pasara lo que pasara. Un ingreso que no existe infla el
-- saldo y ademas se reparte en las jarras, asi que el error se propaga.
--
-- `esperando_desde` guarda la fecha del ciclo que se dio por cobrado y despues
-- se deshizo. Distingue los dos casos, que necesitan cosas distintas:
--
--   NULL           -> el proximo cobro es `next_run`. Confirmarlo a mano crea
--                     el movimiento HOY y adelanta `next_run` al ciclo que
--                     sigue: ese ciclo queda consumido.
--   con fecha      -> el ciclo ya se conto y se deshizo. Confirmarlo crea el
--                     movimiento y NO adelanta nada, porque `next_run` ya
--                     apunta al ciclo siguiente. Adelantarlo otra vez se
--                     saltearia un cobro entero.
--
-- Deshacer nunca retrocede `next_run`: si lo hiciera, quedaria en el pasado y
-- el disparador volveria a crear el movimiento en su proximo barrido, que es
-- justo lo que se acaba de decir que no paso.
ALTER TABLE recurring ADD COLUMN esperando_desde INTEGER;

-- ---------------------------------------------------------------------------
-- 2. Un tope global por economia
-- ---------------------------------------------------------------------------
--
-- El tope de una categoria ya sabe de quien es, porque la categoria lo sabe.
-- El que no podia era el global —"todo el mes"—: el indice unico solo miraba
-- hogar + periodo + categoria, asi que solo podia existir UNO en todo el
-- hogar. Poner un tope a PanaClaw pisaba el de la casa.
--
-- Un indice no guarda datos: cambiarlo no puede perder ninguna fila.
DROP INDEX idx_budget_unico;
CREATE UNIQUE INDEX idx_budget_unico
  ON budget(household_id, period, IFNULL(category_id, ''), IFNULL(entity_id, ''));
