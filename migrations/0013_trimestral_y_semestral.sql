-- Frecuencias trimestral y semestral en los pagos habituales.
--
-- Faltaban las dos, y no son un caso raro: un seguro semestral, un impuesto
-- trimestral o la cuota de una obra social son exactamente eso, y hasta ahora
-- habia que cargarlos a mano cuatro o dos veces al año, que es justo lo que un
-- pago habitual existe para evitar.
--
-- Como en la 0003, el problema es que `frequency` tiene un CHECK y SQLite no
-- permite modificarlo: hay que rehacer la tabla entera. Y vuelve la misma
-- trampa de entonces, que conviene repetir porque es facil de olvidar:
-- tx.recurring_id apunta aca con ON DELETE SET NULL, y DROP TABLE ejecuta un
-- borrado implicito que dispara esa accion. Soltar la tabla vieja sin mas
-- borraria el vinculo de TODOS los movimientos que nacieron de un pago
-- habitual, y con el la posibilidad de deshacer un cobro.
--
-- Por eso los ids se guardan aparte antes de soltarla y se reponen despues,
-- sin PRAGMA, para no depender de si D1 los acepta.
--
-- La tabla se recrea con todo lo que se le fue agregando desde la 0003:
-- distribute_to_jars (0004), entity_id (0005) y esperando_desde (0006). Si
-- alguna faltara aca, la migracion la borraria en silencio.

CREATE TABLE recurring_nuevo (
  id                 TEXT PRIMARY KEY,
  household_id       TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  type               INTEGER NOT NULL,
  amount_minor       INTEGER NOT NULL,
  account_id         TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  category_id        TEXT REFERENCES category(id) ON DELETE SET NULL,
  jar_id             TEXT REFERENCES jar(id) ON DELETE SET NULL,
  paid_by            TEXT REFERENCES member(id) ON DELETE SET NULL,

  frequency          TEXT NOT NULL CHECK (frequency IN
                       ('semanal','quincenal','mensual','trimestral','semestral','anual')),
  day_of_month       INTEGER,
  -- Segundo cobro del mes, solo para quincenal. 31 = ultimo dia del mes.
  day_of_month_2     INTEGER,
  day_of_week        INTEGER,
  -- Mes del ciclo. En la anual es el mes en que se cobra; en trimestral y
  -- semestral es el ANCLA: desde ahi se repite cada 3 o cada 6 meses. Con
  -- enero, una trimestral cae en enero, abril, julio y octubre.
  month_of_year      INTEGER,

  active             INTEGER NOT NULL DEFAULT 1,
  next_run           INTEGER NOT NULL,
  last_run           INTEGER,
  -- De la 0006: la fecha que se esperaba y todavia no se confirmo.
  esperando_desde    INTEGER,

  -- De la 0004.
  distribute_to_jars INTEGER NOT NULL DEFAULT 0,
  -- De la 0005. NULL = la de su categoria, que es el caso normal.
  entity_id          TEXT REFERENCES entity(id) ON DELETE SET NULL,

  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

INSERT INTO recurring_nuevo (
  id, household_id, name, type, amount_minor, account_id, category_id, jar_id,
  paid_by, frequency, day_of_month, day_of_month_2, day_of_week, month_of_year,
  active, next_run, last_run, esperando_desde, distribute_to_jars, entity_id,
  created_at, updated_at
)
SELECT
  id, household_id, name, type, amount_minor, account_id, category_id, jar_id,
  paid_by, frequency, day_of_month, day_of_month_2, day_of_week, month_of_year,
  active, next_run, last_run, esperando_desde, distribute_to_jars, entity_id,
  created_at, updated_at
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

-- Los indices no sobreviven al DROP: se rehacen igual que en la 0002 y la 0003.
CREATE INDEX idx_recurring_household ON recurring(household_id, active);
CREATE INDEX idx_recurring_pendientes ON recurring(active, next_run);
