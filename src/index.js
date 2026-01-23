import { env } from "cloudflare:workers";

/* =======================
   Configuration via Environment Variables
   ======================= */
const TOKEN = env.TELEGRAM_BOT_TOKEN       // Bot token
const ADMIN_ID = parseInt(env.TELEGRAM_ADMIN_ID) // Your chat ID for admin
const CONFIG_URL = env.AUDIO_CONFIG_URL    // URL to JSON with audio mappings
const CACHE_TTL = 60 * 60 * 1000       // 1 hour cache for JSON

const API = `https://api.telegram.org/bot${TOKEN}`

/* =======================
   In-memory cache
   ======================= */
let audioCache = null
let cacheTime = 0

// Load JSON config from GitHub or cache
async function loadConfig(force = false) {
  if (!audioCache || force || Date.now() - cacheTime > CACHE_TTL) {
    console.log(`Get voices: ${CONFIG_URL}`)
    const res = await fetch(CONFIG_URL, {
      headers: { "User-Agent": "cf-worker-bot" }
    })
    audioCache = await res.json()
    cacheTime = Date.now()
  }
  return audioCache
}

// Helper to call Telegram API
async function telegram(method, body) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  console.log("[Telegram API]", {
    method,
    httpStatus: response.status,
    ok: data.ok,
    errorCode: data.error_code,
    description: data.description,
  });

  if (data.ok) {
      return new Response("OK!")
  }
  return new Response("TG Error!")
}

export default {
  async fetch(req) {
    if (req.method !== "POST") return new Response("OK")

    const update = await req.json()
    console.log(`Handle update: ${JSON.stringify(update)}`)

    /* =======================
       INLINE MODE
       ======================= */
    if (update.inline_query) {
      const query = update.inline_query.query.toLowerCase()
      const data = await loadConfig()

      let results = []

      if (!query) {
        // Empty query: return all audio (up to 50 items)
        results = data.slice(0, 50).map(a => ({
          type: "voice",
          id: a.id,
          title: a.title,
          voice_file_id: a.file_id
        }))
      } else {
        // Filter audio by query text
        results = data
          .filter(a => a.title.toLowerCase().includes(query))
          .map(a => ({
            type: "voice",
            id: a.id,
            title: a.title,
            voice_file_id: a.file_id
          }))
          .slice(0, 50)
      }

      return telegram("answerInlineQuery", {
        inline_query_id: update.inline_query.id,
        results
      })
    }

    /* =======================
       PRIVATE CHAT / ADMIN ONLY
       ======================= */
    if (update.message) {
      const msg = update.message
      const chatId = msg.chat.id

      // Admin check
      if (chatId !== ADMIN_ID) return new Response("OK") // ignore non-admin users

      // Return file_id for Voice messages
      if (msg.voice) {
        return telegram("sendMessage", {
          chat_id: chatId,
          text: `file_id: ${msg.voice.file_id}`,
        })
      }

      // Flush cache command
      if (msg.text === "/flush") {
        await loadConfig(true) // force reload from CONFIG_URL
        return telegram("sendMessage", {
          chat_id: chatId,
          text: "✅ Cache flushed"
        })
      }
    }

    return new Response("OK")
  }
}
