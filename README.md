# Nuestros gastos.

Gestor de gastos para dos personas. Libro compartido, en tiempo real, sobre
Cloudflare. Sin Google, sin Firebase, sin servicios de terceros.

- **Un solo libro compartido.** Los dos ven exactamente lo mismo.
- **En vivo.** Lo que carga uno aparece en el teléfono del otro sin refrescar.
- **Vista individual.** Cada movimiento sabe quién lo cargó, y se puede filtrar
  por persona sin partir los datos.
- **Funciona sin señal.** Lo que cargues offline se guarda y sube solo al
  volver la conexión.
- **Instalable.** PWA: se agrega a la pantalla de inicio y abre como app nativa.

## Cómo está armado

| Pieza | Tecnología | Por qué |
|---|---|---|
| Frontend | React 19 + Vite + Tailwind 4 | El caparazón móvil del repo original, reconstruido |
| API + hosting | Cloudflare Workers | Un solo Worker sirve todo; no se paga si nadie lo usa |
| Base de datos | Cloudflare D1 (SQLite) | Relacional, con integridad referencial real |
| Tiempo real | Durable Object + WebSocket | Una única instancia por hogar, en todo el mundo |
| Sesiones | PBKDF2 + cookie firmada | Propio, sin proveedor de identidad externo |

```
shared/     Dominio puro, compartido por cliente y servidor
  types.ts    Fuente única de tipos
  money.ts    Aritmética en enteros + reparto por mayor resto
  domain.ts   Saldos, jarras, resúmenes
  parser.ts   Lectura de "super 12500" sin IA externa
worker/     API, auth y Durable Object
src/        Interfaz React
migrations/ Esquema de D1
```

## Desplegar

La infraestructura ya esta creada. Lo unico que falta es cargar tres secretos
en GitHub y apretar un boton.

```
push / pull request  ──>  Verificar  (tipos + tests + build)
                              │
boton "Run workflow"  ──>  Verificar  ──>  Publicar en Cloudflare
                                            (solo si lo anterior esta en verde)

boton "Run workflow"  ──>  Probar tiempo real  (contra produccion, cuando quieras)
```

Hacer merge de un pull request **no publica**: solo verifica.

### Lo que ya esta hecho

| | Estado |
|---|---|
| Base de datos `gastos-db` | creada en la cuenta (region ENAM) |
| Esquema (9 tablas, 15 indices) | aplicado y probado contra D1 real |
| Migracion `0001_init.sql` | registrada en `d1_migrations` |
| `database_id` en `wrangler.toml` | escrito |
| Workflows de CI y despliegue | listos |

### Lo que falta: tres secretos

**Settings → Secrets and variables → Actions → pestaña Secrets →
*New repository secret***

| Nombre | De donde sale |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | panel de Cloudflare, ver abajo |
| `CLOUDFLARE_API_TOKEN` | panel de Cloudflare, ver abajo |
| `SETUP_KEY` | la inventas vos |

**`CLOUDFLARE_ACCOUNT_ID`**

1. [dash.cloudflare.com](https://dash.cloudflare.com)
2. Menu izquierdo → **Compute (Workers)**
3. A la derecha aparece **Account ID**, con boton de copiar

También está en la URL del panel:
`dash.cloudflare.com/`**`<esto es tu account id>`**`/workers`

**`CLOUDFLARE_API_TOKEN`**

1. [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. **Create Token**
3. Plantilla **Edit Cloudflare Workers** → **Use template**
4. Agregale un permiso que la plantilla no siempre trae:
   **Account** → **D1** → **Edit**
5. *Account Resources*: tu cuenta. *Zone Resources*: todas, o ninguna si no
   vas a usar dominio propio
6. **Continue to summary** → **Create Token**
7. **Copialo ahora**, Cloudflare no lo vuelve a mostrar

| Permiso | Para que |
|---|---|
| Account → Workers Scripts → Edit | publicar el Worker y el Durable Object |
| Account → D1 → Edit | aplicar futuras migraciones |
| Account → Account Settings → Read | que wrangler identifique la cuenta |
| Zone → Workers Routes → Edit | solo con dominio propio |

**`SETUP_KEY`**

La inventas vos. Habilita a crear el hogar la primera vez, y una sola vez:
despues de creado, el endpoint de instalacion rechaza cualquier intento. Que
sea larga y no la uses en ningun otro lado.

### Publicar

1. Pestaña **Actions**
2. **Publicar** en la lista de la izquierda
3. **Run workflow** → elegi la rama → **Run workflow**

Corre los tests y, solo si pasan, publica y comprueba que la app responda. El
resumen de la corrida te muestra la URL.

### Crear el hogar

Entra a esa URL. Te pide la `SETUP_KEY`, tu nombre, email y contraseña.
Despues, en **Ajustes → Sumar a tu pareja**, le creas la cuenta a ella y le
pasas email y contraseña.

### Instalarla en el telefono

- iPhone: Safari → Compartir → *Agregar a inicio*
- Android: Chrome → menu → *Instalar aplicacion*

### Ajustes opcionales

**Pedir tu aprobacion antes de publicar.** Settings → Environments →
`produccion` → *Required reviewers*, agregate. El workflow corre los tests y
despues espera que toques *Approve*.

**Publicar al mergear a main.** En `.github/workflows/deploy.yml` descomenta:

```yaml
  # push:
  #   branches: [main]
```

Los tests siguen siendo obligatorios: la barrera es `needs: verificar`, no el
disparador.

**Usar otra base de datos.** Defini la variable `CLOUDFLARE_D1_DATABASE_ID` en
Settings → Secrets and variables → Actions → pestaña *Variables*. El workflow
la prefiere sobre lo que diga `wrangler.toml`.

**Dominio propio.** Agrega al final de `wrangler.toml`:

```toml
[[routes]]
pattern = "gastos.tudominio.com"
custom_domain = true
```

## Desarrollo local

```bash
npm run db:init:local        # crea las tablas en la base local
echo 'SETUP_KEY = "lo-que-quieras"' > .dev.vars
npm run dev                  # http://localhost:8787
```

`npm run dev` levanta el Worker con D1 y Durable Objects simulados. Para
trabajar solo en la interfaz, `npm run dev:web` arranca Vite con recarga en
caliente y redirige `/api` al Worker.

```bash
npm test        # 51 tests del núcleo de dominio
npm run lint    # typecheck de cliente y Worker
```

### Comprobar el tiempo real

Los 51 tests cubren la aritmética del dominio, pero no dicen nada sobre si los
WebSockets funcionan en Cloudflare: en local wrangler los simula, y lo que
puede fallar de verdad (la hibernación de sockets, que las dos personas caigan
en la misma instancia del hogar, el upgrade de protocolo detrás del borde)
solo existe en producción.

Para eso está **Actions → Probar tiempo real → Run workflow**. Siembra un hogar
de prueba, abre dos WebSockets como si fueran dos teléfonos, verifica que un
alta y una baja lleguen al otro lado, y borra todo lo sembrado. Tarda unos 20
segundos y no toca los datos reales: todo cuelga de un `household_id` propio
con prefijo `__smoke__`.

Conviene correrlo después de cualquier cambio que toque `worker/hub.ts`,
`src/api/live.ts` o la configuración de Durable Objects.

### Publicar a mano

`npm run deploy` publica directo desde tu maquina, sin pasar por los tests. Es
una salida de emergencia, no la via normal: usa el workflow **Publicar**, que
verifica antes. Necesita `npx wrangler login` primero.

## Decisiones que conviene conocer

**La plata se guarda en enteros.** Cada monto es un entero de centavos, nunca
un decimal. En JavaScript `0.1 + 0.2` no da `0.3`, y con plata ese error se
acumula en silencio hasta que los saldos dejan de cuadrar y no hay forma de
saber por qué.

**El reparto de las jarras cierra exacto.** Repartir un ingreso entre
porcentajes deja centavos sueltos: 2,5% de $1.000,00 no es un número redondo.
Se usa el método del mayor resto —el mismo con el que se reparten bancas en una
elección— así que la suma de las jarras siempre da exactamente el ingreso.

**Los saldos no se guardan, se calculan.** El saldo de una cuenta es su saldo
inicial más la suma de sus movimientos, resuelto por SQL en cada lectura. La
alternativa habitual —guardar el saldo e irlo incrementando— se desincroniza
ante cualquier fallo a mitad de camino, y después no se sabe cuál de los dos
números es el correcto.

**Las deudas restan.** Una tarjeta de crédito con consumo tiene saldo negativo
y baja el patrimonio. Suena obvio, pero es fácil que una app te cuente la deuda
como si fuera plata disponible.

**Los ajustes son un tipo de movimiento.** Cuando el saldo real no coincide con
el de la app, se registra un ajuste en lugar de corregir el saldo a mano. Así
el historial explica cada peso.

**La economía vive en la categoría.** La casa y cada negocio son economías
distintas dentro del mismo libro. De quién es un movimiento sale de su
categoría, y el movimiento la hereda: `tx.entity_id` en `NULL` significa «la de
mi categoría». Así, corregirse es cambiar una categoría y que toda su historia
se reclasifique sola, sin reescribir un solo movimiento. Las jarras sí
pertenecen a una economía de forma dura, porque los porcentajes tienen que
sumar 100% dentro de un ámbito: un cobro de un negocio se reparte entre las
jarras de ese negocio, y a la casa la plata le llega después.

**Cuando el negocio le paga a la casa, no se mueve ninguna cuenta.** Las
cuentas están mezcladas: no hay una que sea de PanaClaw. La plata ya está ahí,
lo que cambia es de quién es. Por eso el pago sale de una jarra del negocio y
entra repartido en las de la casa, con las reglas de la casa, y **no cuenta
como ingreso**: el negocio ya lo contó cuando cobró, y contarlo dos veces
inflaría el total del hogar.

## Auditar las cuentas con una IA

`GET /api/resumen` devuelve los números de tu hogar **ya calculados** —resultado
por economía, saldos de cuentas y jarras, gasto por categoría, los últimos doce
meses— junto con las reglas que hacen falta para interpretarlos y qué guarda
cada tabla.

Existe para que puedas pedirle a Claude (o a quien sea) «¿PanaClaw da o no
da?» sin que tenga que leerse el código. Sin esto, responder eso obliga a leer
las migraciones para entender el esquema, el dominio para saber cómo se calcula
un saldo, y después los movimientos crudos para sumarlos a mano: miles de
tokens y riesgo de que sume mal. Los números que devuelve salen de las mismas
funciones que dibujan la pantalla, así que no hay dos verdades.

Pide sesión, como todo lo demás. Los movimientos uno por uno siguen estando en
`GET /api/snapshot`.

## El consejero

La pestaña **Consejero** le pregunta a Claude sobre tu plata, en vivo. Lo que
la hace útil no es el modelo: es que del otro lado el Worker le manda **tus
números ya calculados** —los mismos de `/api/resumen`—, así que «¿me conviene
invertir?» deja de ser un ensayo genérico y pasa a ser una respuesta con tus
montos. Cuando una pregunta necesita el detalle, tiene una herramienta para
buscar movimientos en la base; no inventa el detalle a partir de los totales.

Para encenderlo hace falta una clave de la API de Claude, cargada **una sola
vez** como secreto de Cloudflare:

```bash
wrangler secret put ANTHROPIC_API_KEY
```

La clave nunca llega al navegador: el navegador le habla al Worker, y el Worker
le habla a Claude. Sin la clave la app funciona igual y la pestaña lo dice.

Cuesta plata por pregunta —es la API de Anthropic, no una suscripción—, aunque
poca: el contexto viaja marcado para caché, así que a partir del segundo turno
de una conversación se cobra una fracción. La conversación no se guarda en
ningún lado: vive mientras la pantalla esté abierta.

Orienta con principios —colchón antes que inversión, deuda cara antes que
inversión, los impuestos de un negocio son plata ajena— y no recomienda
productos ni predice mercados. No es un asesor matriculado, y lo dice.

## Privacidad

Los datos viven en tu propia base de D1, en tu cuenta de Cloudflare. No hay
analítica ni rastreadores. La única llamada a un servicio externo es la del
consejero, y solo cuando le preguntás algo: ahí van tus números resumidos a la
API de Anthropic. Si no cargás la clave, esa llamada no existe. La app no se
puede indexar y no tiene registro público: las únicas dos cuentas son las que
creás vos.

Desde **Ajustes → Exportar a CSV** te llevás todo cuando quieras.
