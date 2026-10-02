import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { setGlobalDispatcher, ProxyAgent as UndiciProxyAgent } from "undici"
import { HttpsProxyAgent } from "https-proxy-agent"
import { WebSocket as RealWS } from "ws"

const logFile = path.join(os.tmpdir(), "opencode-discord-channel.log")
function plog(msg: string) {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`)
  } catch {}
}

export const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  (process.env as any).https_proxy ||
  (process.env as any).http_proxy ||
  "http://127.0.0.1:7897"

let ProxiedWS: any = null

export function setupProxy(): void {
  plog(`[proxy] setupProxy called; ws-before=${globalThis.WebSocket && (globalThis.WebSocket as any).name}`)
  if (!ProxiedWS && proxyUrl) {
    try {
      const undiciAgent = new UndiciProxyAgent(proxyUrl)
      setGlobalDispatcher(undiciAgent)
      plog(`[proxy] undici dispatcher set (${proxyUrl})`)
    } catch (e) {
      plog(`[proxy] undici FAILED: ${e instanceof Error ? e.message : String(e)}`)
    }

    try {
      const agent = new HttpsProxyAgent(proxyUrl)
      ProxiedWS = class ProxiedWS extends RealWS {
        constructor(url: string, protocols?: string | string[], options?: any) {
          super(url, protocols, { ...options, agent })
        }
      }
      plog(`[proxy] ProxiedWS built`)
    } catch (e) {
      plog(`[proxy] ProxiedWS build FAILED: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (ProxiedWS && globalThis.WebSocket !== ProxiedWS) {
    try {
      ;(globalThis as any).WebSocket = ProxiedWS
      plog(`[proxy] ws reassigned -> ${globalThis.WebSocket && (globalThis.WebSocket as any).name}`)
    } catch (e) {
      plog(`[proxy] ws assign FAILED: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else if (ProxiedWS) {
    plog(`[proxy] ws already ours`)
  }
}

plog(`[proxy] module eval; ws=${globalThis.WebSocket && (globalThis.WebSocket as any).name}; proxyUrl=${proxyUrl}`)
setupProxy()
