-- Cuarta tanda: que las jarras digan la verdad.
--
-- Todo es aditivo. No hay DROP, no hay UPDATE sobre movimientos, y los saldos
-- del dia del despliegue son exactamente los de hoy. Lo unico que se escribe
-- sobre datos existentes es el relleno de jar_imputacion, que copia el efecto
-- que las jarras YA tienen.

-- ---------------------------------------------------------------------------
-- 1. Imputaciones: lo que cada movimiento le hizo a cada jarra
-- ---------------------------------------------------------------------------
--
-- Hasta hoy el saldo de una jarra se recalculaba aplicando los porcentajes
-- ACTUALES a todos los ingresos repartidos del historial. Subir el ahorro del
-- 10% al 20% reescribia el sueldo de enero. Eso no se nota todavia porque
-- ningun ingreso llego a repartirse nunca, pero nace vivo con el primero.
--
-- A partir de aca, cuanto le toco a cada jarra se escribe en el momento y no
-- se vuelve a calcular. Cambiar un porcentaje solo afecta lo que venga
-- despues, que es lo que cualquiera espera.
--
-- Guarda tanto lo que entra (reparto de un ingreso, ingreso entero a una
-- jarra) como lo que sale (gasto imputado a una jarra), con signo. Una sola
-- tabla y una sola regla en vez de dos caminos que hay que acordarse de
-- mantener iguales.
CREATE TABLE jar_imputacion (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  -- Al borrar el movimiento se va su imputacion: el saldo vuelve solo.
  tx_id         TEXT NOT NULL REFERENCES tx(id) ON DELETE CASCADE,
  jar_id        TEXT NOT NULL REFERENCES jar(id) ON DELETE CASCADE,
  -- Positivo entra, negativo sale.
  amount_minor  INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  -- Un movimiento toca cada jarra una sola vez.
  UNIQUE (tx_id, jar_id)
);
CREATE INDEX idx_imputacion_jarra ON jar_imputacion(jar_id);
CREATE INDEX idx_imputacion_hogar ON jar_imputacion(household_id);

-- ---------------------------------------------------------------------------
-- 2. Traspasos entre jarras
-- ---------------------------------------------------------------------------
--
-- Pasar plata de Ahorro a Diversion no mueve dinero: no toca ninguna cuenta.
-- Es un cambio de plan, y hoy no hay forma de hacerlo, asi que una jarra en
-- negativo se queda en negativo para siempre.
--
-- Vive aparte de tx a proposito. tx.account_id es NOT NULL y un traspaso no
-- tiene cuenta: meterlo ahi obligaria a volver esa columna anulable para el
-- 100% de las filas que si la necesitan, y a acordarse de excluir el tipo
-- nuevo en el resumen, en el saldo, en los presupuestos y en las
-- estadisticas. Una tabla propia no puede afectar un saldo por accidente.
CREATE TABLE jar_transfer (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  from_jar_id   TEXT NOT NULL REFERENCES jar(id) ON DELETE CASCADE,
  to_jar_id     TEXT NOT NULL REFERENCES jar(id) ON DELETE CASCADE,
  amount_minor  INTEGER NOT NULL,
  note          TEXT,
  date          INTEGER NOT NULL,
  created_by    TEXT NOT NULL REFERENCES member(id),
  created_at    INTEGER NOT NULL,
  -- Un traspaso a la misma jarra no es nada, y uno negativo es el de vuelta.
  CHECK (from_jar_id <> to_jar_id),
  CHECK (amount_minor > 0)
);
CREATE INDEX idx_traspaso_hogar ON jar_transfer(household_id, date DESC);

-- ---------------------------------------------------------------------------
-- 3. Jarras del mes y jarras que acumulan
-- ---------------------------------------------------------------------------
--
-- "Ahorro largo plazo" no tiene sentido si se lee de a un mes, y "Diversion"
-- no tiene sentido si se lee de toda la vida. El saldo acumulado se sigue
-- calculando siempre (es el que cuadra con las cuentas); esto solo decide cual
-- de los dos numeros es el protagonista en pantalla.
--
-- Ojo: mensual es una forma de leer, no un borron. Lo que sobra de un mes no
-- se tira, se queda en la jarra.
ALTER TABLE jar ADD COLUMN acumula INTEGER NOT NULL DEFAULT 0;

-- Las dos que acumulan, por su nombre de la semilla. Si les cambiaron el
-- nombre no pasa nada: queda en 0 y lo cambian de un toque en Ajustes.
UPDATE jar SET acumula = 1 WHERE name IN ('Ahorro largo plazo', 'Libertad financiera');

-- ---------------------------------------------------------------------------
-- 4. Que un pago habitual pueda repartir
-- ---------------------------------------------------------------------------
--
-- El disparador inserta los movimientos con distribute_to_jars fijo en 0, asi
-- que un sueldo que entra por ahi no puede llegar a las jarras aunque se
-- quiera. Es el agujero mas grande para una pareja que cobra por quincena.
ALTER TABLE recurring ADD COLUMN distribute_to_jars INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 5. Relleno: copiar el efecto que las jarras ya tienen
-- ---------------------------------------------------------------------------
--
-- Solo los movimientos con jar_id, que son los unicos que hoy mueven una
-- jarra (ninguno tiene distribute_to_jars = 1). El monto es el mismo que ya
-- estaba usando el calculo, asi que despues de esto cada jarra vale
-- exactamente lo que valia antes. El signo replica imputacionJarras:
-- un ingreso suma, un gasto resta, y ningun otro tipo toca jarras.
INSERT INTO jar_imputacion (id, household_id, tx_id, jar_id, amount_minor, created_at)
SELECT
  t.id || ':' || t.jar_id,
  t.household_id,
  t.id,
  t.jar_id,
  CASE WHEN t.type = 2 THEN t.amount_minor ELSE -t.amount_minor END,
  t.created_at
FROM tx t
WHERE t.jar_id IS NOT NULL
  AND t.type IN (2, 3);
