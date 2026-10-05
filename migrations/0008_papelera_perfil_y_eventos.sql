-- Papelera y archivo, perfil propio, y presupuestos por evento.
--
-- Todo aditivo: columnas nuevas con valor por defecto y una tabla que no
-- existia. Nada se reescribe, nada se borra, y una version vieja del Worker
-- seguiria funcionando contra esta base.

-- ---------------------------------------------------------------------------
-- PAPELERA Y ARCHIVO
--
-- `archived` solo sabia decir "no la muestres mas", y por eso una categoria
-- creada por error y una categoria jubilada con dos años de historia se veian
-- igual y terminaban en la misma bolsa invisible.
--
-- Ahora son dos estados distintos y explicitos:
--
--   archivado  -> se jubila pero su historia importa. No se puede borrar
--                 mientras algo la referencie.
--   papelera   -> se tira. Se puede restaurar, y vaciar la papelera la borra
--                 de verdad.
--
-- Se guarda CUANDO y QUIEN, porque son dos personas y la pregunta "¿esto lo
-- tiraste vos?" tiene que tener respuesta.
-- ---------------------------------------------------------------------------
ALTER TABLE category ADD COLUMN trashed_at INTEGER;
ALTER TABLE category ADD COLUMN trashed_by TEXT REFERENCES member(id);
ALTER TABLE account  ADD COLUMN trashed_at INTEGER;
ALTER TABLE account  ADD COLUMN trashed_by TEXT REFERENCES member(id);
ALTER TABLE entity   ADD COLUMN trashed_at INTEGER;
ALTER TABLE entity   ADD COLUMN trashed_by TEXT REFERENCES member(id);

CREATE INDEX idx_category_papelera ON category(household_id, trashed_at);
CREATE INDEX idx_account_papelera  ON account(household_id, trashed_at);
CREATE INDEX idx_entity_papelera   ON entity(household_id, trashed_at);

-- ---------------------------------------------------------------------------
-- PERFIL
--
-- Tema por persona: una puede preferir claro de dia y el otro oscuro siempre,
-- y son dos telefonos distintos. 'auto' sigue al sistema, que es lo de hoy.
--
-- La foto va como data URI en la misma fila. Para dos personas con un avatar
-- recortado a 256px eso son unos 20 KB, y evita montar R2 y su ciclo de vida
-- para dos imagenes. Si algun dia son muchas, se muda.
-- ---------------------------------------------------------------------------
ALTER TABLE member ADD COLUMN theme TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE member ADD COLUMN photo TEXT;

-- ---------------------------------------------------------------------------
-- PRESUPUESTOS POR EVENTO
--
-- Los de antes eran por mes y por categoria: `period = '2026-09'`. Eso es un
-- tope recurrente, o sea una jarra. Un presupuesto de verdad es "Viaje a
-- Cancun": un nombre, un tope, y los gastos que ustedes digan que son de ahi.
--
-- `period` se queda NOT NULL por compatibilidad con la fila que ya existe y
-- con el indice unico; los eventos guardan el mes en que nacieron y no lo
-- usan para nada.
-- ---------------------------------------------------------------------------
ALTER TABLE budget ADD COLUMN name TEXT;
ALTER TABLE budget ADD COLUMN closed_at INTEGER;

-- A que evento pertenece un gasto. NULL es lo normal: la enorme mayoria de
-- los gastos no son de ningun evento.
--
-- ON DELETE SET NULL y no CASCADE: borrar el presupuesto del viaje no puede
-- llevarse puestos los gastos del viaje. El tope desaparece, la plata no.
ALTER TABLE tx ADD COLUMN budget_id TEXT REFERENCES budget(id) ON DELETE SET NULL;
CREATE INDEX idx_tx_presupuesto ON tx(budget_id);
