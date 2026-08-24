import { setGlobalDispatcher, ProxyAgent as UndiciProxyAgent } from "undici"
import { HttpsProxyAgent } from "https-proxy-agent"
import { WebSocket as RealWS } from "ws"

export const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  (process.env as any).https_proxy ||
  (process.env as any).http_proxy ||
  "http://127.0.0.1:7897"

let initialized = false

export function setupProxy(): void {
  if (initialized) return
  initialized = true

  if (proxyUrl) {
    try {
      const undiciAgent = new UndiciProxyAgent(proxyUrl)
      setGlobalDispatcher(undiciAgent)
    } catch {}

    try {
      const agent = new HttpsProxyAgent(proxyUrl)
      class ProxiedWS extends RealWS {
        constructor(url: string, protocols?: string | string[], options?: any) {
          super(url, protocols, { ...options, agent })
        }
      }
      // @ts-ignore
      globalThis.WebSocket = ProxiedWS as any
    } catch {}
  }
}

// Auto-run on import
setupProxy()
