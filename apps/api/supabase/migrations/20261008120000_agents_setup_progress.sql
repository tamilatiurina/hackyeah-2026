-- Agent setup flow: the panel walks each agent through Connection, Guardrails, MCP tools, Test
-- and Go live. Attaching a guardrail or granting an MCP server completes its step by itself;
-- these columns record the steps a user finished without doing that (reviewed, or skipped),
-- and the first test-chat call through the guarded pipeline.
alter table public.agents
add column guardrails_reviewed_at timestamptz,
add column mcp_reviewed_at timestamptz,
add column tested_at timestamptz;

comment on column public.agents.guardrails_reviewed_at is
    'When the owner confirmed the guardrails step, even with nothing attached.';
comment on column public.agents.mcp_reviewed_at is
    'When the owner confirmed or skipped the optional MCP tools step.';
comment on column public.agents.tested_at is
    'Last test-chat call through the guarded pipeline.';
