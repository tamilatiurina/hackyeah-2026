import type { MessageFormat } from '../../api/types'

export function formatLabel(format: MessageFormat): string {
  return format === 'json' ? 'JSON' : 'Text'
}
