/**
 * Conexion de tiempo real con el Durable Object del hogar.
 *
 * Se encarga de tres cosas que en la practica son las que rompen una conexion
 * persistente en un celular:
 *
 * 1. Reconexion con espera creciente. Si el server o la red se caen, no se
 *    reintenta en bucle cerrado: 1s, 2s, 4s... hasta 30s.
 * 2. Latido cada 25s. Los proxies moviles cortan conexiones ociosas al minuto;
 *    el ping las mantiene vivas.
 * 3. Reconexion al volver a primer plano. iOS y Android congelan la pestaña al
 *    pasar a segundo plano y el socket muere sin avisar. Al volver se
 *    reconecta y se vuelve a sincronizar.
 */

import type { LiveEvent } from '@shared/types';

type Escucha = (evento: LiveEvent) => void;
type CambioEstado = (estado: EstadoLive) => void;

export type EstadoLive = 'conectando' | 'conectado' | 'desconectado';

const ESPERA_MAX_MS = 30_000;
const LATIDO_MS = 25_000;

export class Live {
  private ws: WebSocket | null = null;
  private escuchas = new Set<Escucha>();
  private cambios = new Set<CambioEstado>();
  private intentos = 0;
  private latido: ReturnType<typeof setInterval> | null = null;
  private reintento: ReturnType<typeof setTimeout> | null = null;
  private cerradoAproposito = false;
  private _estado: EstadoLive = 'desconectado';

  get estado(): EstadoLive {
    return this._estado;
  }

  conectar(): void {
    this.cerradoAproposito = false;
    this.abrir();

    // Al volver a la app: si el socket murio mientras estaba en segundo plano,
    // se reconecta al instante en vez de esperar el proximo reintento.
    document.addEventListener('visibilitychange', this.alVolver);
    window.addEventListener('online', this.alVolver);
  }

  desconectar(): void {
    this.cerradoAproposito = true;
    document.removeEventListener('visibilitychange', this.alVolver);
    window.removeEventListener('online', this.alVolver);
    this.limpiar();
    this.ws?.close();
    this.ws = null;
    this.marcar('desconectado');
  }

  al(escucha: Escucha): () => void {
    this.escuchas.add(escucha);
    return () => this.escuchas.delete(escucha);
  }

  alCambiarEstado(cb: CambioEstado): () => void {
    this.cambios.add(cb);
    cb(this._estado);
    return () => this.cambios.delete(cb);
  }

  private alVolver = (): void => {
    if (document.visibilityState !== 'visible') return;
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.intentos = 0;
    this.abrir();
  };

  private marcar(estado: EstadoLive): void {
    if (this._estado === estado) return;
    this._estado = estado;
    for (const cb of this.cambios) cb(estado);
  }

  private abrir(): void {
    if (this.cerradoAproposito) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.limpiar();
    this.marcar('conectando');

    const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocolo}//${location.host}/api/live`);
    this.ws = ws;

    ws.onopen = () => {
      this.intentos = 0;
      this.marcar('conectado');
      this.latido = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, LATIDO_MS);
    };

    ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      try {
        const evento = JSON.parse(ev.data as string) as LiveEvent;
        for (const escucha of this.escuchas) escucha(evento);
      } catch {
        // Mensaje que no se entiende: se ignora en vez de tirar la conexion.
      }
    };

    ws.onclose = () => {
      this.marcar('desconectado');
      this.programarReintento();
    };

    ws.onerror = () => {
      // onerror siempre viene seguido de onclose, que es donde se reintenta.
      ws.close();
    };
  }

  private programarReintento(): void {
    if (this.cerradoAproposito || this.reintento) return;

    // Espera creciente con algo de azar, para que los dos dispositivos no
    // reintenten exactamente al mismo tiempo si el server se reinicio.
    const base = Math.min(1000 * 2 ** this.intentos, ESPERA_MAX_MS);
    const espera = base + Math.random() * 500;
    this.intentos++;

    this.reintento = setTimeout(() => {
      this.reintento = null;
      this.abrir();
    }, espera);
  }

  private limpiar(): void {
    if (this.latido) {
      clearInterval(this.latido);
      this.latido = null;
    }
    if (this.reintento) {
      clearTimeout(this.reintento);
      this.reintento = null;
    }
  }
}

export const live = new Live();
