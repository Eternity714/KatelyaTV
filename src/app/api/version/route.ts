import type { NextRequest } from 'next/server'
export const runtime = 'edge'

const DEFAULT_URLS = [
  process.env.NEXT_PUBLIC_VERSION_URL_PRIMARY,
  process.env.NEXT_PUBLIC_VERSION_URL_BACKUP,
  'https://raw.githubusercontent.com/katelya77/KatelyaTV/main/VERSION.txt'
].filter(Boolean) as string[]

async function fetchWithTimeout(url: string, ms: number): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const txt = await res.text()
    return txt.trim()
  } catch (_) {
    return null
  }
}

export async function GET(_req: NextRequest) {
  const urls = DEFAULT_URLS
  for (const url of urls) {
    const v = await fetchWithTimeout(url, 4000)
    if (v) return new Response(JSON.stringify({ version: v }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({ version: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
