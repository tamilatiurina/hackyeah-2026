export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return '—'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

// "2.5k" with the cached share in parens when it dominates: "2.5k (cache 2.3k)"
export function formatTokenSplit(total: number, cache: number): string {
  const base = formatTokens(total)
  if (cache > 0 && cache >= total * 0.5) return `${base} (cache ${formatTokens(cache)})`
  return base
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function formatAgo(ts: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(ts)) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

// Human label for a pi project dir slug: --home-lono-projects-hackyea2026-- → …/hackyea2026
export function projectLabel(projectDir: string): string {
  const parts = projectDir.replaceAll('--', '').split('-').filter(Boolean)
  return `…/${parts.slice(-2).join('/') || projectDir}`
}

