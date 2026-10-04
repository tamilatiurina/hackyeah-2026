-- SEC-01: security scans. The OWASP LLM Top 10 attack pack run against one agent, straight and
-- through its guardrails. Results hold short, redacted reply snippets (never full replies).
-- Saved and read by the agent's owner, with their own Supabase client (RLS below).
create table public.security_scans (
    id uuid primary key default gen_random_uuid(),
    agent_id uuid not null references public.agents (id) on delete cascade,
    created_at timestamp with time zone not null default now(),
    policy_version text not null,
    summary jsonb not null,
    categories jsonb not null,
    static_checks jsonb not null,
    results jsonb not null,

    constraint security_scans_policy_version_check check (char_length(policy_version) <= 200),
    constraint security_scans_summary_object_check check (jsonb_typeof(summary) = 'object'),
    constraint security_scans_categories_array_check check (jsonb_typeof(categories) = 'array'),
    constraint security_scans_static_checks_array_check
        check (jsonb_typeof(static_checks) = 'array'),
    constraint security_scans_results_array_check check (jsonb_typeof(results) = 'array')
);

comment on table public.security_scans is
    'OWASP LLM Top 10 scans per agent (SEC-01): verdicts without and with guardrails.';

create index security_scans_agent_created_idx on public.security_scans (agent_id, created_at desc);

alter table public.security_scans enable row level security;

create policy "Owners can read their agents' security scans"
on public.security_scans
for select
to authenticated
using (
    exists (
        select 1 from public.agents as a
        where a.id = security_scans.agent_id and a.owner_id = (select auth.uid())
    )
);

create policy "Owners can save security scans of their agents"
on public.security_scans
for insert
to authenticated
with check (
    exists (
        select 1 from public.agents as a
        where a.id = security_scans.agent_id and a.owner_id = (select auth.uid())
    )
);

revoke all on table public.security_scans from anon, authenticated;
grant select, insert on table public.security_scans to authenticated;
grant all on table public.security_scans to service_role;
