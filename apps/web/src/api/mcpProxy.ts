import type { Agent } from './types'

export const MCP_PROXY_EXTENSION = 'urn:guardrail-hub:mcp-proxy:v1'

export function supportsMcpProxy(agent: Agent): boolean {
  return agent.agent_card?.capabilities.extensions?.some((extension) => extension.uri === MCP_PROXY_EXTENSION) ?? false
}
