-- Segunda tanda de mejoras.
--
-- Todo lo que se agrega es opcional o tiene valor por defecto, asi que los
-- datos que ya existen siguen siendo validos sin tocarlos.

-- Quién hizo el gasto, que no es lo mismo que quién lo cargó.
-- created_by se sigue guardando solo y nunca se edita: es el rastro de quién
-- estuvo en la app. paid_by es editable y es el que cuenta para las
-- estadísticas. NULL significa "el mismo que lo cargó".
ALTER TABLE tx ADD COLUMN paid_by TEXT REFERENCES member(id) ON DELETE SET NULL;
CREATE INDEX idx_tx_paid_by ON tx(household_id, paid_by);

-- Ícono de la persona: un emoji. Vacío = se muestran las iniciales, como antes.
ALTER TABLE member ADD COLUMN emoji TEXT NOT NULL DEFAULT '';

-- Orden de las secciones del Inicio, como lista JSON de identificadores.
-- Es por persona y no por hogar: cada uno ordena su pantalla como quiere.
-- Vacío = el orden por defecto.
ALTER TABLE member ADD COLUMN home_layout TEXT NOT NULL DEFAULT '';

-- Pagos habituales: alquiler, servicios, suscripciones.
CREATE TABLE recurring (
  id             TEXT PRIMARY KEY,
  household_id   TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  -- Mismo TxType que la tabla tx: 2 ingreso, 3 gasto.
  type           INTEGER NOT NULL,
  amount_minor   INTEGER NOT NULL,
  account_id     TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  category_id    TEXT REFERENCES category(id) ON DELETE SET NULL,
  jar_id         TEXT REFERENCES jar(id) ON DELETE SET NULL,
  paid_by        TEXT REFERENCES member(id) ON DELETE SET NULL,

  frequency      TEXT NOT NULL CHECK (frequency IN ('semanal','mensual','anual')),
  day_of_month   INTEGER,
  day_of_week    INTEGER,
  month_of_year  INTEGER,

  active         INTEGER NOT NULL DEFAULT 1,
  -- Cuándo toca el próximo. Es lo que hace idempotente al disparador: una vez
  -- creado el movimiento, esta fecha avanza, así que volver a correr no
  -- duplica nada.
  next_run       INTEGER NOT NULL,
  last_run       INTEGER,

  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_recurring_household ON recurring(household_id, active);
-- El disparador barre por esta: los que ya vencieron y siguen activos.
CREATE INDEX idx_recurring_pendientes ON recurring(active, next_run);

-- Movimientos nacidos de un pago habitual, para poder rastrearlos.
ALTER TABLE tx ADD COLUMN recurring_id TEXT REFERENCES recurring(id) ON DELETE SET NULL;
