-- Esquema del gestor de gastos compartido.
--
-- Diferencia central con el diseño anterior: TODO cuelga de un hogar
-- (household), no de un usuario. Antes cada fila llevaba userId y las reglas
-- de Firestore exigían resource.data.userId == request.auth.uid, así que cada
-- persona veía un libro privado e invisible para la otra. Acá las dos
-- personas pertenecen al mismo hogar y ven exactamente lo mismo; la columna
-- created_by es la que permite además la vista individual.
--
-- Todos los montos son INTEGER en unidades mínimas (centavos). Nunca REAL.

CREATE TABLE household (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  created_at  INTEGER NOT NULL
);

CREATE TABLE member (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  -- PBKDF2-SHA256. Ver worker/auth.ts.
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  display_name  TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#10b981',
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_member_email ON member(LOWER(email));
CREATE INDEX idx_member_household ON member(household_id);

CREATE TABLE session (
  -- Se guarda el SHA-256 del token, no el token. Si alguien lee la base,
  -- no puede hacerse pasar por nadie.
  token_hash  TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX idx_session_member ON session(member_id);
CREATE INDEX idx_session_expires ON session(expires_at);

CREATE TABLE account (
  id                    TEXT PRIMARY KEY,
  household_id          TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  category              INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'USD',
  initial_balance_minor INTEGER NOT NULL DEFAULT 0,
  color                 TEXT NOT NULL DEFAULT '#10b981',
  icon                  TEXT NOT NULL DEFAULT 'wallet',
  -- 'compartida' o el id de una persona.
  owner                 TEXT NOT NULL DEFAULT 'compartida',
  archived              INTEGER NOT NULL DEFAULT 0,
  display_order         INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_account_household ON account(household_id, archived, display_order);

CREATE TABLE category (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('ingreso','gasto')),
  -- Categorías de dos niveles, como ezBookkeeping: 'Comida' > 'Delivery'.
  parent_id     TEXT REFERENCES category(id) ON DELETE SET NULL,
  icon          TEXT NOT NULL DEFAULT 'tag',
  color         TEXT NOT NULL DEFAULT '#64748b',
  archived      INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_category_household ON category(household_id, type, archived, display_order);

CREATE TABLE jar (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- Puntos base: 2,5% se guarda como 250. Entero, no fracción.
  percentage_bp INTEGER NOT NULL DEFAULT 0,
  color         TEXT NOT NULL DEFAULT '#10b981',
  icon          TEXT NOT NULL DEFAULT 'piggy-bank',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_jar_household ON jar(household_id, display_order);

CREATE TABLE tx (
  id                 TEXT PRIMARY KEY,
  household_id       TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  type               INTEGER NOT NULL,
  amount_minor       INTEGER NOT NULL,
  account_id         TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  dest_account_id    TEXT REFERENCES account(id) ON DELETE CASCADE,
  dest_amount_minor  INTEGER,
  category_id        TEXT REFERENCES category(id) ON DELETE SET NULL,
  jar_id             TEXT REFERENCES jar(id) ON DELETE SET NULL,
  distribute_to_jars INTEGER NOT NULL DEFAULT 0,
  description        TEXT NOT NULL DEFAULT '',
  notes              TEXT,
  date               INTEGER NOT NULL,
  -- Quién la cargó: habilita la vista individual sin partir el libro.
  created_by         TEXT NOT NULL REFERENCES member(id),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
-- Índice principal: el listado siempre es "las del hogar, más nuevas primero".
CREATE INDEX idx_tx_household_date ON tx(household_id, date DESC);
CREATE INDEX idx_tx_account ON tx(account_id);
CREATE INDEX idx_tx_dest_account ON tx(dest_account_id);
CREATE INDEX idx_tx_category ON tx(category_id);
CREATE INDEX idx_tx_jar ON tx(jar_id);
CREATE INDEX idx_tx_creator ON tx(household_id, created_by);

CREATE TABLE budget (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  category_id   TEXT REFERENCES category(id) ON DELETE CASCADE,
  amount_minor  INTEGER NOT NULL,
  period        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_budget_household ON budget(household_id, period);
CREATE UNIQUE INDEX idx_budget_unico ON budget(household_id, period, IFNULL(category_id, ''));
