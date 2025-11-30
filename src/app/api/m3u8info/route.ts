import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const target = searchParams.get('url')
    if (!target) return new Response(JSON.stringify({ error: 'missing url' }), { status: 400 })

    const t0 = Date.now()
    const res = await fetch(target, { method: 'GET', cache: 'no-store' })
    const pingTime = Date.now() - t0
    if (!res.ok) return new Response(JSON.stringify({ error: `fetch failed ${res.status}` }), { status: 502 })

    const text = await res.text()

    let quality = '未知'
    let bandwidthKbps = 0

    const lines = text.split(/\r?\n/)
    let bestWidth = 0
    let bestBandwidth = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/)
        const bwMatch = line.match(/BANDWIDTH=(\d+)/)
        const width = resMatch ? parseInt(resMatch[1], 10) : 0
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0
        if (width > bestWidth || (width === 0 && bw > bestBandwidth)) {
          bestWidth = width
          bestBandwidth = bw
        }
      }
    }

    if (bestWidth >= 3840) quality = '4K'
    else if (bestWidth >= 2560) quality = '2K'
    else if (bestWidth >= 1920) quality = '1080p'
    else if (bestWidth >= 1280) quality = '720p'
    else if (bestWidth >= 854) quality = '480p'
    else if (bestWidth > 0) quality = 'SD'

    bandwidthKbps = Math.round(bestBandwidth / 1000)

    const loadSpeed = bandwidthKbps >= 1024
      ? `${(bandwidthKbps / 1024).toFixed(1)} MB/s`
      : `${Math.max(1, bandwidthKbps).toFixed(1)} KB/s`

    return new Response(
      JSON.stringify({ quality, loadSpeed, pingTime }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: 'unexpected error' }), { status: 500 })
  }
}
