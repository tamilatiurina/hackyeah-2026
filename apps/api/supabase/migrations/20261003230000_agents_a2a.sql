-- Agents speak A2A 1.0 (docs/agent-contract-a2a.md). Registration now reads the agent's
-- Agent Card instead of asking for request/response formats.
--   base_url      where the Agent Card is published (<base_url>/.well-known/agent-card.json)
--   upstream_url  the A2A JSON-RPC endpoint taken from the card; the gateway calls it
--   agent_card    snapshot of the card at registration

alter table public.agents
    add column base_url text,
    add column agent_card jsonb;

-- Agents registered before A2A keep working rows but have no card; the UI asks to re-register.
update public.agents set base_url = upstream_url where base_url is null;

alter table public.agents
    alter column base_url set not null,
    add constraint agents_base_url_check
        check (base_url ~* '^https?://[^[:space:]]+$'),
    add constraint agents_agent_card_object_check
        check (agent_card is null or jsonb_typeof(agent_card) = 'object'),
    drop constraint agents_request_format_check,
    drop constraint agents_response_format_check,
    drop column request_format,
    drop column response_format;

comment on column public.agents.base_url is
    'Agent base URL; its A2A Agent Card is at <base_url>/.well-known/agent-card.json.';
comment on column public.agents.upstream_url is
    'A2A 1.0 JSON-RPC endpoint from the Agent Card; the gateway forwards SendMessage here.';
comment on column public.agents.agent_card is
    'Snapshot of the A2A Agent Card taken at registration; null for agents registered before A2A.';
