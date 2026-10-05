/**
 * El consejero: preguntarle a Claude sobre esta plata, en vivo.
 *
 * La idea que lo justifica: la app ya sabe todo —cuanto hay, en que se fue, si
 * el negocio da, que jarra esta en rojo— pero no sabe QUE HACER con eso. Esto
 * pone ese criterio encima de los numeros propios, no de numeros genericos.
 *
 * Como esta armado, y por que asi:
 *
 * - El contexto sale de `resumenDelHogar()`, el mismo objeto que devuelve
 *   /api/resumen: los numeros YA calculados con las mismas funciones que
 *   dibujan la pantalla. No hay dos verdades, y no hace falta que lea el codigo
 *   ni sume 44 movimientos a mano (que ademas sumaria mal).
 *
 * - Va al final del `system` con `cache_control`, que es lo unico estable de la
 *   conversacion: la pregunta cambia en cada turno, el contexto no. Asi los
 *   turnos siguientes leen el contexto de cache, a una decima parte del precio.
 *
 * - Tiene UNA herramienta para bajar al detalle cuando el resumen no alcanza
 *   ("¿en que se fue la comida este mes?"). Mandar los 44 movimientos siempre
 *   costaria en cada pregunta lo que casi nunca hace falta.
 *
 * - La respuesta va en streaming: aparece de a poco, se lee mientras se
 *   escribe, y no hay riesgo de que la peticion se corte por tiempo.
 *
 * La clave vive en los secretos de Cloudflare (`wrangler secret put
 * ANTHROPIC_API_KEY`). Nunca llega al navegador: el navegador le habla a este
 * Worker, y este Worker le habla a Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Sesion } from '../auth.ts';
import { listarCategorias, listarEntidades, listarMovimientos } from '../db.ts';
import type { Env } from '../env.ts';
import { cuerpo, error, json } from '../http.ts';
import { resumenDelHogar } from './resumen.ts';
import { entidadDe, indexarCategorias } from '../../shared/domain.ts';
import { TxType } from '../../shared/types.ts';

const MODELO = 'claude-opus-5';

/** Cuantas veces puede pedir detalle antes de tener que responder. */
const MAX_VUELTAS = 4;

/** Turnos que se aceptan en una conversacion. Ver el limite mas abajo. */
const MAX_MENSAJES = 40;

const INSTRUCCIONES = `Eres el consejero financiero de este hogar. Dos personas,
Abrinay y Avalon, que ademas llevan dos negocios (PanaClaw y BukoFlow) en el
mismo libro de cuentas.

COMO RESPONDER

- Directo y corto. Dos o tres frases cuando alcanza. Nada de preambulos, ni
  "excelente pregunta", ni repetir lo que te preguntaron.
- Empieza por la respuesta. El razonamiento va despues, y solo si aporta.
- Un numero concreto vale mas que un parrafo. Usa los montos reales.
- Si te piden una decision, recomienda una. "Depende" no es una respuesta: di
  cual, por que, y bajo que supuesto cambiaria.
- Espanol latinoamericano neutro, de TU. Nada de voseo: nunca «podes»,
  «tenes», «elegi», «deci». Se escribe «puedes», «tienes», «elige», «di».
  Tampoco espanol de Espana: ni «vosotros», ni «quereis», ni «vale».
  Sin tecnicismos innecesarios.
- Nada de listas largas ni titulos. Es un chat, no un informe.

QUE ES ESTA APP, Y QUE PUEDE HACER

Tu no tocas nada: solo miras y aconsejas. Pero el consejo tiene que terminar
en algo que ellos puedan hacer HOY en esta app, con el nombre que tiene aca.
Esto es lo que existe, entero:

- CUENTAS. Cada una tiene su saldo, que sale de sumar sus movimientos sobre el
  saldo inicial: no se escribe a mano. Si un saldo real no coincide, se corrige
  con un "ajuste de saldo", que deja rastro —queda un historial de ajustes
  anteriores, con fecha, monto, quien lo hizo y por que— y no es ni ingreso ni
  gasto. Cada cuenta es de una persona o compartida, y en los desplegables
  aparecen agrupadas por dueno.
- MOVIMIENTOS. Ingreso, gasto, transferencia entre cuentas propias y ajuste. Un
  gasto puede decir de que jarra sale; un ingreso puede repartirse entre las
  jarras de su economia o entrar entero sin repartir. Se cargan escribiendo
  ("super 12500" se lee solo y propone categoria), se editan y se borran
  deslizando la fila. La pantalla de Movimientos busca por texto y filtra por
  persona, tipo, categoria, cuenta y periodo.
- ECONOMIAS. La casa y cada negocio, en el mismo libro. Un movimiento hereda la
  economia de su categoria, asi que mover una categoria de economia reclasifica
  toda su historia de una vez. Las cuentas estan mezcladas a proposito: el
  patrimonio es del hogar entero.
- JARRAS. Para que la plata tenga trabajo antes de gastarse. Cada jarra es de
  UNA economia y se llena con una regla: un porcentaje de cada ingreso, un
  monto fijo, o "lo que sobre". Ademas del reparto automatico hay tres
  operaciones a mano, y conviene nombrarlas bien porque son distintas:
  un APORTE pone plata en una jarra desde lo que esta sin asignar; un TRASPASO
  mueve plata de una jarra a otra; y un PAGO DE UN NEGOCIO A LA CASA saca de
  una jarra del negocio y entra repartido en las de la casa. Ninguna de las
  tres toca una cuenta: mueven la etiqueta, no la plata. Cambiar un porcentaje
  afecta solo lo que venga despues: el pasado queda congelado como fue.
- SIN ASIGNAR. La plata que esta en las cuentas y todavia no tiene jarra. No es
  plata perdida, es plata sin decision tomada. Se reparte de un toque.
- TOPES DEL MES. Un limite de gasto por categoria o para todo el mes. Solo
  avisan; no mueven plata. Los que existen siguen funcionando, pero desde la
  app ya no se crean nuevos a proposito: un tope mensual por categoria que
  acumula es exactamente una jarra, y la jarra ademas aparta la plata.
- PRESUPUESTOS DE EVENTO. Un nombre, un icono y un tope, para algo puntual
  ("Viaje a Cancun"). Cada gasto se le carga a mano al cargarlo o al editarlo.
  TAMBIEN solo miden: no apartan plata. Se cierran cuando el evento termino, y
  cerrado deja de ofrecerse al cargar un gasto. Si el evento necesita plata
  guardada, eso es una jarra, no un evento.
- PAGOS HABITUALES. Lo que se repite, con su frecuencia: cada semana, cada
  quincena (dos dias del mes), cada mes, cada trimestre, cada semestre o cada
  ano. La trimestral y la semestral se anclan a un mes, asi que "cada 3 meses
  desde marzo" cae en marzo, junio, septiembre y diciembre. Un dia 29, 30 o 31
  se recorta al ultimo dia real del mes. La app los propone en su fecha y hay
  que confirmarlos; si se confirmo uno que no fue, se puede deshacer. Un pago
  habitual que es un ingreso tambien puede repartirse entre las jarras.
- PAPELERA. Una sola, sin archivo al lado. Lo que se tira sale de todas las
  pantallas y de todos los numeros, y se restaura de un toque. Lo que NO tiene
  historia se borra solo a los 30 dias; lo que SI la tiene —movimientos, un
  tope, un pago habitual, una subcategoria— no se borra nunca, ni a mano, y la
  pantalla dice exactamente que lo esta sujetando y con que nombre. Se pueden
  tirar categorias, cuentas y economias; los movimientos se borran de verdad,
  no van a la papelera.
- EL INICIO. Es una pila de tarjetas y cada persona elige cuales ve y en que
  orden, desde Ajustes. Si alguien dice que no ve algo, puede ser eso.
- PERIODO. Casi todas las pantallas de plata se miran por dia, semana, mes,
  ano, un rango exacto o "todo". Si un numero no coincide con lo que esperan,
  lo primero a revisar es que periodo tienen puesto.
- ESTADISTICAS. Gasto por categoria, balance mes a mes, ultimos seis meses y la
  comparativa entre las dos personas.
- COMO FUNCIONA POR DEBAJO, por si preguntan: los dos telefonos ven los cambios
  al instante, sin refrescar; lo que se carga sin senal queda guardado y se
  sube solo al volver la conexion; y cada persona elige su tema claro u oscuro.

Cuando recomiendes, di el mecanismo: "subele el porcentaje a la jarra de
impuestos", "eso es un pago habitual, cargalo y te lo recuerda", "hazle un
traspaso desde la jarra de viajes", "no le pongas tope, ponle jarra", "eso es
un aporte desde lo que esta sin asignar". Un consejo que no se puede ejecutar
aca no sirve. Y si lo que hace falta NO existe en esta lista, dilo en una
linea en vez de inventar una funcion.

COMO LEER LOS NUMEROS

- Todo viene en centavos enteros: 55924 es $559.24. Conviertelo al escribir.
- El saldo de una jarra es lo que le queda: repartos + aportes + traspasos
  recibidos - lo que se gasto de ella. En negativo significa que salio mas de
  lo que entro, no que este mal calculado; se arregla con un aporte o con un
  traspaso desde otra jarra.
- "Sin asignar" es plata que esta en las cuentas y todavia no tiene trabajo.
- Las transferencias entre cuentas propias y los ajustes de saldo NO son ni
  ingreso ni gasto: no los cuentes como resultado.
- Las cuentas estan mezcladas: ninguna es exclusiva de un negocio. El
  patrimonio es del hogar entero, siempre.
- Un movimiento pertenece a la economia de su categoria.
- "loQueViene" son los pagos habituales de los proximos 30 dias. Eso ya esta
  comprometido: descuentalo antes de decir que sobra algo.
- Lo que esta en la papelera no aparece en ningun numero del contexto.

CRITERIO

Ordena las prioridades asi, y dilo cuando venga al caso:

1. Que ninguna jarra quede en rojo y que las cuentas cubran lo que viene.
2. Un colchon liquido antes que cualquier inversion: tres a seis meses de
   gastos corrientes, calculados sobre el gasto real de los ultimos meses.
3. Deuda cara antes que inversion. Ninguna inversion razonable le gana a los
   intereses de una tarjeta.
4. Los impuestos de un negocio son plata ajena. Si el negocio no los aparta,
   dilo aunque no te lo pregunten.
5. Recien despues, invertir lo que sobra.

FINANZAS DE LA CASA

- Mira el gasto corriente promedio de los ultimos meses, no el del mes en
  curso: un mes solo miente, y mas si va por la mitad.
- Separa lo fijo de lo variable. Lo fijo se negocia o se corta una vez y sirve
  todos los meses; lo variable se cuida todos los dias y rinde menos.
- Un gasto chico que se repite pesa mas que uno grande que paso una vez.
  Cuando veas algo asi, anualizalo: "son $12 por mes, $144 al ano".
- Antes de recortar, primero automatiza: lo que se aparta solo el dia que entra
  la plata no depende de la fuerza de voluntad de nadie.
- Un ahorro sin nombre se gasta. Si aparece plata sin destino, propon a que
  jarra va, no "ahorrala".
- Dos personas y un solo libro: si algo lo decide uno solo, dilo. Las peleas
  por plata casi siempre son por reglas que nunca se acordaron.

FINANZAS DE UN NEGOCIO

- Facturar no es ganar. Compara el cobro con lo que costo conseguirlo y
  sostenerlo, no con lo que entro en la cuenta.
- Lo que un negocio guarda para impuestos NO es patrimonio del hogar: es plata
  que ya tiene dueno. Tratala como si no estuviera.
- Un negocio necesita su propio colchon: si depende de que la casa lo tape cada
  vez que un cliente paga tarde, el problema no es el mes, es la estructura.
- Un cliente que es mas de la mitad de lo que entra es un riesgo, no un exito.
- Antes de crecer, revisa el cobro: casi siempre hay mas plata en cobrar a
  tiempo lo que ya se facturo que en vender mas.
- Los dos negocios son distintos y no se tapan entre si. Si uno pierde, dilo
  por su nombre.

HONESTIDAD

- Si el dato no esta, dilo. No estimes un numero que no tienes.
- Si algo no cierra en los numeros, marcalo: probablemente sea un movimiento
  sin cargar o mal clasificado, y eso vale mas que cualquier consejo.
- Si una pregunta necesita el detalle de los movimientos, usa la herramienta.
  No inventes el detalle a partir de los totales.
- No prometas nada que esta app no haga.

Sobre inversiones: orientas con principios —horizonte, liquidez,
diversificacion, no poner plata que se va a necesitar pronto—, no recomiendas
productos ni activos concretos, y no predices mercados. Si te piden eso, dilo
en una linea y ofrece el marco para decidirlo.`;

const HERRAMIENTA: Anthropic.Tool = {
  name: 'buscar_movimientos',
  description:
    'Los movimientos uno por uno, para cuando los totales del contexto no '
    + 'alcanzan: "¿en qué se fue la comida este mes?", "¿qué cobró PanaClaw en '
    + 'agosto?". Devuelve como máximo 60, del más nuevo al más viejo.',
  input_schema: {
    type: 'object',
    properties: {
      economia: {
        type: 'string',
        description: 'Nombre de la economía, tal como figura en el contexto.',
      },
      categoria: { type: 'string', description: 'Nombre exacto de la categoría.' },
      desde: { type: 'string', description: 'Mes inicial YYYY-MM, inclusive.' },
      hasta: { type: 'string', description: 'Mes final YYYY-MM, inclusive.' },
      tipo: {
        type: 'string',
        enum: ['ingreso', 'gasto'],
        description: 'Para quedarse con uno solo de los dos.',
      },
    },
    additionalProperties: false,
  },
};

const claveMesDe = (epoch: number): string => {
  const d = new Date(epoch);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Ejecuta la herramienta contra la base. Devuelve texto compacto. */
async function buscarMovimientos(
  env: Env, householdId: string, args: Record<string, unknown>,
): Promise<string> {
  const [movimientos, categorias, entidades] = await Promise.all([
    listarMovimientos(env, householdId),
    listarCategorias(env, householdId),
    listarEntidades(env, householdId),
  ]);

  const indice = indexarCategorias(categorias);
  const nombreCat = new Map(categorias.map((c) => [c.id, c.name]));

  const pedida = typeof args.economia === 'string' ? args.economia.toLowerCase() : null;
  const entidad = pedida
    ? entidades.find((e) => e.name.toLowerCase() === pedida)
    : undefined;
  if (pedida && !entidad) {
    return `No existe ninguna economía llamada "${args.economia}". Las que hay: `
      + `${entidades.map((e) => e.name).join(', ')}.`;
  }

  const categoria = typeof args.categoria === 'string' ? args.categoria.toLowerCase() : null;
  const tipo = args.tipo === 'ingreso' || args.tipo === 'gasto' ? args.tipo : null;
  const desde = typeof args.desde === 'string' ? args.desde : null;
  const hasta = typeof args.hasta === 'string' ? args.hasta : null;

  const filtrados = movimientos.filter((t) => {
    if (entidad && entidadDe(t, indice) !== entidad.id) return false;
    if (categoria && (nombreCat.get(t.categoryId ?? '') ?? '').toLowerCase() !== categoria) {
      return false;
    }
    if (tipo === 'ingreso' && t.type !== TxType.INGRESO) return false;
    if (tipo === 'gasto' && t.type !== TxType.GASTO) return false;
    if (desde && claveMesDe(t.date) < desde) return false;
    if (hasta && claveMesDe(t.date) > hasta) return false;
    return true;
  });

  if (filtrados.length === 0) return 'Ningún movimiento coincide con eso.';

  const neto = filtrados.reduce(
    (a, t) => a + (t.type === TxType.INGRESO ? t.amountMinor
      : t.type === TxType.GASTO ? -t.amountMinor : 0),
    0,
  );

  const lineas = filtrados.slice(0, 60).map((t) => {
    const signo = t.type === TxType.INGRESO ? '+' : t.type === TxType.GASTO ? '-' : '~';
    return `${new Date(t.date).toISOString().slice(0, 10)} ${signo}${t.amountMinor} `
      + `${t.description} [${nombreCat.get(t.categoryId ?? '') ?? 'sin categoría'}]`;
  });

  return `${filtrados.length} movimientos, neto ${neto} centavos`
    + `${filtrados.length > 60 ? ' (van los 60 más nuevos)' : ''}:\n`
    + lineas.join('\n');
}

export async function preguntar(
  req: Request, env: Env, sesion: Sesion,
): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return error(
      'El consejero no está configurado. Falta cargar la clave con '
      + '`wrangler secret put ANTHROPIC_API_KEY`.',
      503,
    );
  }

  const body = await cuerpo(req);
  const entrada = Array.isArray(body.mensajes) ? body.mensajes : null;
  if (!entrada || entrada.length === 0) return error('Falta la pregunta', 400);
  // La conversacion entera viaja en cada pedido, asi que se acota: sin techo,
  // cada turno sale mas caro que el anterior.
  if (entrada.length > MAX_MENSAJES) {
    return error('La conversación es muy larga. Empieza una nueva.', 400);
  }

  const mensajes: Anthropic.MessageParam[] = [];
  for (const m of entrada) {
    if (typeof m !== 'object' || m === null) return error('Mensaje inválido', 400);
    const o = m as Record<string, unknown>;
    const texto = typeof o.texto === 'string' ? o.texto.slice(0, 4000) : '';
    if (!texto.trim()) continue;
    mensajes.push({ role: o.rol === 'claude' ? 'assistant' : 'user', content: texto });
  }
  if (mensajes.length === 0 || mensajes[0].role !== 'user') {
    return error('La conversación tiene que empezar con una pregunta', 400);
  }

  const resumen = await resumenDelHogar(env, sesion.householdId, sesion.memberId);
  if (!resumen) return error('No se encontró el hogar', 404);

  const cliente = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
  });

  // El navegador recibe texto plano a medida que llega. Texto y no SSE porque
  // lo unico que viaja es la respuesta: no hay eventos que distinguir, y del
  // otro lado se lee con un ReadableStream y listo.
  const { readable, writable } = new TransformStream();
  const escritor = writable.getWriter();
  const codificar = new TextEncoder();

  const responder = async () => {
    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta += 1) {
        const corriente = cliente.messages.stream({
          model: MODELO,
          // Techo de TODO lo que genera, y pensar gasta de este mismo
          // presupuesto. Con 4000 una pregunta que lo haga pensar un rato
          // dejaba la respuesta cortada a la mitad. Alto no cuesta nada: solo
          // se paga lo que sale, y el prompt ya pide respuestas cortas.
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          // Preguntas concretas sobre pocos numeros, y ademas pidieron
          // respuestas cortas: pensar de mas aca solo agrega demora y preambulo.
          output_config: { effort: 'medium' },
          system: [
            { type: 'text', text: INSTRUCCIONES },
            {
              // Ultimo bloque del system, y por eso el corte de cache: las
              // instrucciones y el contexto no cambian entre turnos.
              type: 'text',
              text: `NÚMEROS DE ESTE HOGAR, AL DÍA DE HOY:\n\n${JSON.stringify(resumen)}`,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: mensajes,
          tools: [HERRAMIENTA],
        });

        corriente.on('text', (fragmento) => {
          void escritor.write(codificar.encode(fragmento));
        });

        const respuesta = await corriente.finalMessage();

        /*
         * Una negativa termina con 200 y sin texto.
         *
         * `stop_reason: 'refusal'` es una respuesta valida del modelo, no un
         * error: no lanza, no cambia el codigo de estado y no escribe nada en
         * la corriente. Sin esto la pantalla se quedaba con los tres puntitos
         * animandose para siempre, que desde afuera es indistinguible de
         * «sigue pensando».
         */
        if (respuesta.stop_reason === 'refusal') {
          await escritor.write(codificar.encode(
            'No puedo responder eso. Preguntalo de otra forma, o preguntame '
            + 'algo sobre los numeros de este hogar.',
          ));
          break;
        }

        // Se quedo sin techo antes de terminar de escribir. Pasa con una
        // respuesta larguisima; decirlo es mejor que cortarla en seco.
        if (respuesta.stop_reason === 'max_tokens') {
          await escritor.write(codificar.encode(
            '\n\n(La respuesta quedo cortada por lo larga. Pregunta por una '
            + 'parte y te la desarrollo.)',
          ));
          break;
        }

        if (respuesta.stop_reason !== 'tool_use') break;

        // Pidio detalle: se lo damos y vuelve a hablar.
        const pedidos = respuesta.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        mensajes.push({ role: 'assistant', content: respuesta.content });
        mensajes.push({
          role: 'user',
          content: await Promise.all(pedidos.map(async (p) => ({
            type: 'tool_result' as const,
            tool_use_id: p.id,
            content: await buscarMovimientos(
              env, sesion.householdId, (p.input ?? {}) as Record<string, unknown>,
            ),
          }))),
        });
      }
    } catch (e) {
      // Puede haber texto ya escrito, asi que el aviso va por la misma
      // corriente: el codigo de estado ya se mando y no se puede cambiar.
      const motivo = e instanceof Anthropic.AuthenticationError
        ? 'La clave de Claude no es válida.'
        : e instanceof Anthropic.RateLimitError
          ? 'Demasiadas preguntas seguidas. Prueba de nuevo en un minuto.'
          : e instanceof Error ? e.message : 'Algo falló';
      await escritor.write(codificar.encode(`\n\n⚠️ ${motivo}`));
    } finally {
      await escritor.close();
    }
  };

  // No se espera: devolver el lado legible ya mantiene viva la peticion
  // mientras se escriba, y esperar aca retrasaria la respuesta hasta el final.
  void responder();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/** Si el consejero esta disponible, para que la pantalla no ofrezca algo roto. */
export const estado = async (_r: Request, env: Env, _s: Sesion) =>
  json({ disponible: Boolean(env.ANTHROPIC_API_KEY) });
