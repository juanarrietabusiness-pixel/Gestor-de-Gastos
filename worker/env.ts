export interface Env {
  DB: D1Database;
  HUB: DurableObjectNamespace;
  ASSETS: Fetcher;
  /**
   * Clave que habilita a crear el hogar la primera vez (endpoint /api/setup).
   * Se define con `wrangler secret put SETUP_KEY`. Sin esto, cualquiera que
   * encuentre la URL podria crear el hogar antes que tú.
   */
  SETUP_KEY?: string;
  /**
   * Clave de la API de Claude, para el consejero (ver worker/routes/consejo.ts).
   * Se define con `wrangler secret put ANTHROPIC_API_KEY`, nunca en el codigo
   * ni en wrangler.toml: los secretos de Cloudflare no se leen desde el
   * navegador ni aparecen en el repositorio.
   *
   * Sin ella la app funciona igual; solo el consejero queda apagado.
   */
  ANTHROPIC_API_KEY?: string;
  /**
   * A donde apunta el cliente de Claude. Vacio = la API de Anthropic, que es
   * lo normal. Existe para poder probar el consejero de punta a punta contra
   * un servidor de mentira, sin gastar ni necesitar una clave de verdad.
   */
  ANTHROPIC_BASE_URL?: string;
}
