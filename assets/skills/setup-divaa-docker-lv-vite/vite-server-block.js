// Env-gated Vite dev-server block for divaa-docker.
//
// Merge this into the project's vite.config.(ts|js). It is a NO-OP locally
// (no VITE_* env vars set → Vite keeps its defaults), and only activates inside
// the divaa `*-vite` container, which sets these vars to route the dev server +
// HMR websocket through Traefik over HTTPS/WSS (topology A/C) or localhost ws
// (topology B). Do NOT hardcode the domain here — keep it env-driven so the same
// config works locally and on the host.
//
// 1) Add these consts above `export default defineConfig({...})`:

const hmrHost = process.env.VITE_HMR_HOST
const hmrProtocol = process.env.VITE_HMR_PROTOCOL // 'wss' behind Traefik TLS; undefined = plain ws
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT ? Number(process.env.VITE_HMR_CLIENT_PORT) : undefined
const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean)
const corsOrigin = process.env.VITE_CORS_ORIGIN
const usePolling = process.env.VITE_USE_POLLING === '1'

// 2) Set `server:` inside defineConfig to this (merge with any existing server
//    keys the project already has, e.g. watch.ignored):

const server = {
  ...(process.env.VITE_DEV_SERVER_HOST ? { host: process.env.VITE_DEV_SERVER_HOST } : {}),
  ...(process.env.VITE_DEV_SERVER_PORT ? { port: Number(process.env.VITE_DEV_SERVER_PORT), strictPort: true } : {}),
  // Behind Traefik the request arrives with a proxied Host header; Vite rejects
  // unknown hosts unless allow-listed.
  ...(allowedHosts ? { allowedHosts } : {}),
  // Assets are served cross-origin (app domain vs. vite domain), so the app
  // origin must be CORS-allowed.
  ...(corsOrigin ? { cors: { origin: corsOrigin } } : {}),
  // Route the HMR websocket through the proxy (wss:443) when configured.
  ...(hmrHost
    ? { hmr: { host: hmrHost, ...(hmrProtocol ? { protocol: hmrProtocol } : {}), ...(hmrClientPort ? { clientPort: hmrClientPort } : {}) } }
    : {}),
  // Polling fallback only when requested. If the project already has a
  // `server.watch` (e.g. watch.ignored), MERGE this in rather than replacing it.
  ...(usePolling ? { watch: { usePolling: true } } : {}),
}
