-- Tercera tanda.
--
-- 1. Saldo de cuenta ajustable a mano, con rastro de quien lo ajusto.
-- 2. Frecuencia quincenal en los pagos habituales.

-- ---------------------------------------------------------------------------
-- Ajustes manuales de saldo
-- ---------------------------------------------------------------------------
--
-- El saldo sigue siendo derivado: saldo inicial + movimientos. Ajustarlo a
-- mano mueve el saldo INICIAL, nunca los movimientos. Asi el numero queda en
-- lo que se pidio y los movimientos que vengan despues lo siguen cambiando,
-- que es justo lo que se busca.
--
-- Esta tabla es el rastro. Sin ella el saldo dejaria de coincidir con
-- inicial + movimientos y no habria forma de reconstruir por que: quien vea
-- el numero raro dentro de tres meses no tendria nada que mirar.
CREATE TABLE account_adjustment (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  -- Quien lo ajusto. Si esa persona se borra, el ajuste se queda: paso.
  member_id     TEXT REFERENCES member(id) ON DELETE SET NULL,
  from_minor    INTEGER NOT NULL,
  to_minor      INTEGER NOT NULL,
  delta_minor   INTEGER NOT NULL,
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_adjustment_account ON account_adjustment(account_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Frecuencia quincenal
-- ---------------------------------------------------------------------------
--
-- frequency tiene un CHECK y SQLite no permite modificarlo: hay que rehacer la
-- tabla entera. La trampa es que tx.recurring_id apunta aca con ON DELETE SET
-- NULL, y DROP TABLE ejecuta un borrado implicito que dispara esa accion. Es
-- decir: soltar la tabla vieja borraria el vinculo de todos los movimientos
-- que nacieron de un pago habitual.
--
-- Por eso los ids se guardan aparte antes de soltarla y se reponen despues.
-- Se hace sin PRAGMA a proposito, para no depender de si D1 los acepta.

CREATE TABLE recurring_nuevo (
  id             TEXT PRIMARY KEY,
  household_id   TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           INTEGER NOT NULL,
  amount_minor   INTEGER NOT NULL,
  account_id     TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  category_id    TEXT REFERENCES category(id) ON DELETE SET NULL,
  jar_id         TEXT REFERENCES jar(id) ON DELETE SET NULL,
  paid_by        TEXT REFERENCES member(id) ON DELETE SET NULL,

  frequency      TEXT NOT NULL CHECK (frequency IN ('semanal','quincenal','mensual','anual')),
  day_of_month   INTEGER,
  -- Segundo cobro del mes, solo para quincenal. 31 = ultimo dia del mes.
  day_of_month_2 INTEGER,
  day_of_week    INTEGER,
  month_of_year  INTEGER,

  active         INTEGER NOT NULL DEFAULT 1,
  next_run       INTEGER NOT NULL,
  last_run       INTEGER,

  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

INSERT INTO recurring_nuevo (
  id, household_id, name, type, amount_minor, account_id, category_id, jar_id,
  paid_by, frequency, day_of_month, day_of_month_2, day_of_week, month_of_year,
  active, next_run, last_run, created_at, updated_at
)
SELECT
  id, household_id, name, type, amount_minor, account_id, category_id, jar_id,
  paid_by, frequency, day_of_month, NULL, day_of_week, month_of_year,
  active, next_run, last_run, created_at, updated_at
FROM recurring;

-- El vinculo de los movimientos, a resguardo del borrado implicito.
CREATE TABLE tx_recurring_respaldo AS
  SELECT id AS tx_id, recurring_id FROM tx WHERE recurring_id IS NOT NULL;

DROP TABLE recurring;
ALTER TABLE recurring_nuevo RENAME TO recurring;

UPDATE tx
   SET recurring_id = (SELECT r.recurring_id FROM tx_recurring_respaldo r WHERE r.tx_id = tx.id)
 WHERE id IN (SELECT tx_id FROM tx_recurring_respaldo);

DROP TABLE tx_recurring_respaldo;

-- Los indices no sobreviven al DROP: se rehacen igual que en 0002.
CREATE INDEX idx_recurring_household ON recurring(household_id, active);
CREATE INDEX idx_recurring_pendientes ON recurring(active, next_run);
