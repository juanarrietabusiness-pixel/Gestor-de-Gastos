-- Quinta tanda: separar la casa de los negocios.
--
-- Todo aditivo otra vez. Ni un DROP, ni un UPDATE que reescriba movimientos.
-- El dia del despliegue los numeros son los mismos: todo pasa a ser de
-- Familia, que es lo que efectivamente era hasta hoy.

-- ---------------------------------------------------------------------------
-- 1. Entidad
-- ---------------------------------------------------------------------------
--
-- Un solo libro, tres dueños del dinero. No son tres apps ni tres hogares:
-- justamente lo valioso es poder cruzarlos.
--
-- `kind` no cambia la logica, solo el vocabulario de la pantalla y las jarras
-- que se proponen al crearla.
CREATE TABLE entity (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal','negocio')),
  color         TEXT NOT NULL DEFAULT '#14655a',
  icon          TEXT NOT NULL DEFAULT 'house',
  display_order INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_entity_household ON entity(household_id, display_order);

-- ---------------------------------------------------------------------------
-- 2. Donde vive la entidad
-- ---------------------------------------------------------------------------
--
-- En la CATEGORIA, y el movimiento la hereda. No al reves.
--
-- Ellos ya venian clasificando por entidad con el unico campo que tenian:
-- crearon categorias llamadas "PanaClaw" y "BukoFlow". De 31 categorias, 13
-- se usaron alguna vez, y esas 13 cubren el 100% de los movimientos. Poner la
-- entidad ahi convierte 44 decisiones en 13, y no agrega ninguna pregunta al
-- cargar un gasto: se elige la categoria que se iba a elegir igual.
--
-- Y la hace reversible: si se equivocan, cambian la categoria y toda su
-- historia se reclasifica sola. No hay movimientos reescritos que deshacer.
ALTER TABLE category ADD COLUMN entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL;

-- NULL = "la de mi categoria". Solo se escribe cuando lo corrigen a mano en un
-- movimiento suelto, o cuando no hay categoria (una transferencia).
ALTER TABLE tx ADD COLUMN entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL;

-- La jarra SI pertenece a una entidad de forma dura: los porcentajes tienen
-- que sumar 100% dentro de un ambito, y no hay forma de heredar eso de otra
-- tabla.
ALTER TABLE jar ADD COLUMN entity_id TEXT REFERENCES entity(id) ON DELETE CASCADE;

-- El presupuesto NO: casi siempre es de una categoria, y la categoria ya sabe
-- de quien es. La columna queda para el unico caso que no puede heredar —un
-- tope global del mes acotado a una economia—, y hasta que hagan falta se
-- guarda en NULL, que significa "todas".
ALTER TABLE budget ADD COLUMN entity_id TEXT REFERENCES entity(id) ON DELETE CASCADE;

-- En la cuenta es opcional y solo sirve como valor por defecto y para saber de
-- quien era el efectivo. NULL = mezclada. Hoy son todas: no tienen ninguna
-- cuenta exclusiva de un negocio, asi que si la entidad viviera aca no se
-- podria clasificar nada.
ALTER TABLE account ADD COLUMN entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL;

-- El pago habitual hereda de su categoria igual que un movimiento.
ALTER TABLE recurring ADD COLUMN entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL;

CREATE INDEX idx_tx_entity       ON tx(household_id, entity_id);
CREATE INDEX idx_category_entity ON category(household_id, entity_id);
CREATE INDEX idx_jar_entity      ON jar(household_id, entity_id);
-- Sin indice en budget: son una docena de filas por mes y nada las busca por
-- entidad. Un indice sobre una columna que hoy es toda NULL no acelera nada.

-- ---------------------------------------------------------------------------
-- 3. Como se llena cada jarra
-- ---------------------------------------------------------------------------
--
-- Los frascos de la casa funcionan con porcentajes porque el ingreso es
-- parejo. Un cobro de agencia va de $50 a $5.000: "20% de impuestos" tiene
-- sentido, pero "$100 de publicidad" es mas realista como monto fijo.
--
-- La jarra 'resto' absorbe lo que sobra y el redondeo, asi que la regla de
-- sumar 100% se cumple sola cuando existe una.
ALTER TABLE jar ADD COLUMN fill_kind TEXT NOT NULL DEFAULT 'porcentaje'
  CHECK (fill_kind IN ('porcentaje','fijo','resto'));
-- Centavos, solo para fill_kind = 'fijo'.
ALTER TABLE jar ADD COLUMN fill_minor INTEGER;

-- ---------------------------------------------------------------------------
-- 4. Familia, y todo lo que ya existe adentro
-- ---------------------------------------------------------------------------
--
-- El id se arma con el del hogar para que sea estable y sin colisiones sin
-- necesitar generar uuid desde SQL.
INSERT INTO entity (id, household_id, name, kind, color, icon, display_order, archived, created_at)
SELECT h.id || ':familia', h.id, 'Familia', 'personal', '#14655a', 'house', 0, 0,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM household h;

UPDATE category SET entity_id = household_id || ':familia';
UPDATE jar      SET entity_id = household_id || ':familia';
-- Las cuentas quedan en NULL a proposito: estan mezcladas y decirlo es mas
-- honesto que fingir que son de la Familia. Para las deudas entre entidades,
-- una cuenta sin entidad cuenta como efectivo de la Familia.
--
-- Los movimientos tambien quedan en NULL: heredan de su categoria, que acaba
-- de quedar en Familia. Escribirlo en las 44 filas seria congelar una
-- clasificacion que despues no se podria corregir cambiando la categoria.
--
-- Y los pagos habituales y los presupuestos igual, por el mismo motivo: si
-- mañana la categoria "Suscripciones" pasa a PanaClaw, el pago habitual y su
-- tope tienen que irse con ella. Escribir 'familia' aca los dejaria clavados
-- en la casa para siempre.
