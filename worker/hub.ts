/**
 * Durable Object: un objeto por hogar que mantiene abiertos los WebSockets de
 * los dos telefonos y reparte cada cambio al instante.
 *
 * Por que un Durable Object y no polling: Cloudflare garantiza que existe una
 * sola instancia de este objeto por hogar en todo el mundo. Las dos personas,
 * esten donde esten, se conectan a la misma. Cuando una carga un gasto, la
 * otra lo ve aparecer sin refrescar y sin preguntar cada N segundos.
 *
 * Usa WebSocket Hibernation: cuando no hay trafico, Cloudflare descarga el
 * objeto de memoria pero mantiene vivos los sockets. No se paga por estar
 * esperando, y la conexion no se corta. Para dos personas, el costo real de
 * tener la app "escuchando" todo el dia es practicamente cero.
 */

import type { LiveEvent } from '../shared/types.ts';

interface DatosSocket {
  memberId: string;
  displayName: string;
}

export class HouseholdHub implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Alta de conexion: el Worker ya valido la sesion antes de llegar aca.
    if (url.pathname.endsWith('/connect')) {
      if (req.headers.get('Upgrade') !== 'websocket') {
        return new Response('Se esperaba una conexion WebSocket', { status: 426 });
      }

      const memberId = url.searchParams.get('memberId') ?? '';
      const displayName = url.searchParams.get('displayName') ?? '';
      if (!memberId) return new Response('Falta la identidad', { status: 400 });

      const par = new WebSocketPair();
      const [cliente, servidor] = Object.values(par);

      // acceptWebSocket (en vez de servidor.accept()) es lo que habilita la
      // hibernacion: el socket sobrevive aunque el objeto se descargue.
      this.state.acceptWebSocket(servidor);
      servidor.serializeAttachment({ memberId, displayName } satisfies DatosSocket);

      const online = this.conectados();
      servidor.send(JSON.stringify({ kind: 'hello', online } satisfies LiveEvent));
      this.difundir({ kind: 'presence', online }, servidor);

      return new Response(null, { status: 101, webSocket: cliente });
    }

    // El Worker avisa de un cambio para que se reparta a los conectados.
    //
    // Va a TODOS, incluida la persona que lo origino. A proposito: el cambio
    // llego al Worker por HTTP, no por un WebSocket, asi que no hay forma de
    // saber que pestaña lo genero. Y aunque se pudiera excluir por persona,
    // seria un error: si alguien tiene la app abierta en el celular y en la
    // compu, al cargar desde el celular la compu tiene que enterarse.
    //
    // Recibir el eco de lo propio no molesta: el cliente aplica los eventos
    // por id (upsert), asi que reaplicar el mismo dato no cambia nada.
    if (url.pathname.endsWith('/broadcast')) {
      const evento = (await req.json()) as LiveEvent;
      this.difundir(evento);
      return new Response(null, { status: 204 });
    }

    return new Response('No encontrado', { status: 404 });
  }

  /** Se llama sola cuando llega un mensaje del cliente. */
  async webSocketMessage(ws: WebSocket, mensaje: string | ArrayBuffer): Promise<void> {
    // Latido para mantener viva la conexion a traves de proxies y NAT moviles.
    if (typeof mensaje === 'string' && mensaje === 'ping') {
      ws.send('pong');
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // El socket que se va todavia figura en getWebSockets() en este punto,
    // por eso se lo excluye explicitamente del listado de presencia.
    this.difundir({ kind: 'presence', online: this.conectados(ws) }, ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.difundir({ kind: 'presence', online: this.conectados(ws) }, ws);
  }

  /** Ids de las personas conectadas ahora mismo, sin repetir. */
  private conectados(excluir?: WebSocket): string[] {
    const ids = new Set<string>();
    for (const ws of this.state.getWebSockets()) {
      if (ws === excluir) continue;
      const datos = ws.deserializeAttachment() as DatosSocket | null;
      if (datos?.memberId) ids.add(datos.memberId);
    }
    return [...ids];
  }

  /**
   * Manda un evento a los conectados.
   *
   * `excluir` se usa solo para los avisos de presencia, donde el socket que
   * entra o sale no necesita que le cuenten sobre si mismo. Los cambios de
   * datos van sin exclusion: ver el comentario en /broadcast.
   */
  private difundir(evento: LiveEvent, excluir?: WebSocket): void {
    const payload = JSON.stringify(evento);

    for (const ws of this.state.getWebSockets()) {
      if (ws === excluir) continue;
      try {
        ws.send(payload);
      } catch {
        // Socket muerto que todavia no se limpio. Se ignora: el cliente
        // reconecta solo y vuelve a sincronizar.
      }
    }
  }
}
