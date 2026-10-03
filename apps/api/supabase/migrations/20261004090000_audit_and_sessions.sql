-- A-07: audit events and session counters (FR-28, FR-36). No message content is ever stored.
-- Written only by the gateway through the security definer functions below (it runs without a
-- signed-in user and proves itself with the agent's gateway key hash, like gateway_resolve_agent).
-- Read by signed-in users for the agents they own.

create table public.agent_sessions (
    agent_id uuid not null references public.agents (id) on delete cascade,
    context_id text not null,
    turns integer not null default 0,
    input_tokens bigint not null default 0,
    output_tokens bigint not null default 0,
    cost_usd numeric(12, 6) not null default 0,
    started_at timestamp with time zone not null default now(),
    last_at timestamp with time zone not null default now(),
    stopped_at timestamp with time zone,
    stop_reason text,

    primary key (agent_id, context_id),
    constraint agent_sessions_context_id_check
        check (char_length(context_id) between 1 and 200),
    constraint agent_sessions_counters_check
        check (turns >= 0 and input_tokens >= 0 and output_tokens >= 0 and cost_usd >= 0)
);

comment on table public.agent_sessions is
    'One A2A conversation (contextId) per agent: counters only, no content (FR-36).';

create index agent_sessions_last_at_idx on public.agent_sessions (last_at desc);

create table public.audit_events (
    id uuid primary key default gen_random_uuid(),
    at timestamp with time zone not null default now(),
    agent_id uuid not null references public.agents (id) on delete cascade,
    context_id text,
    rule_id text not null,
    rule_name text not null,
    kind text not null,
    stage text,
    action text not null,
    config_version text,
    details text not null default '',

    constraint audit_events_kind_check check (kind in ('guardrail', 'limit')),
    constraint audit_events_stage_check check (stage is null or stage in ('input', 'output')),
    constraint audit_events_action_check check (action in ('block', 'redact', 'warn')),
    constraint audit_events_rule_check
        check (char_length(rule_id) between 1 and 200 and char_length(rule_name) between 1 and 200),
    constraint audit_events_details_check check (char_length(details) <= 500),
    constraint audit_events_context_id_check
        check (context_id is null or char_length(context_id) between 1 and 200)
);

comment on table public.audit_events is
    'Every guardrail or limit hit (block, redact, warn), keyed by rule id (FR-28). No content.';

create index audit_events_at_idx on public.audit_events (at desc, id desc);
create index audit_events_agent_at_idx on public.audit_events (agent_id, at desc);
create index audit_events_context_idx on public.audit_events (context_id);

alter table public.agent_sessions enable row level security;
alter table public.audit_events enable row level security;

create policy "Owners can read their agents' sessions"
on public.agent_sessions
for select
to authenticated
using (
    exists (
        select 1 from public.agents as a
        where a.id = agent_sessions.agent_id and a.owner_id = (select auth.uid())
    )
);

create policy "Owners can read their agents' audit events"
on public.audit_events
for select
to authenticated
using (
    exists (
        select 1 from public.agents as a
        where a.id = audit_events.agent_id and a.owner_id = (select auth.uid())
    )
);

revoke all on table public.agent_sessions from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;
grant select on table public.agent_sessions to authenticated;
grant select on table public.audit_events to authenticated;
grant all on table public.agent_sessions to service_role;
grant all on table public.audit_events to service_role;

-- One more turn in a session (created on its first turn). Returns the counters after the update,
-- or no row when the key is wrong.
create function public.gateway_record_turn(
    p_agent_id uuid,
    p_key_hash text,
    p_context_id text,
    p_input_tokens bigint,
    p_output_tokens bigint,
    p_cost_usd numeric
)
returns setof public.agent_sessions
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.agents as a
        where a.id = p_agent_id
          and a.gateway_key_hash is not null
          and a.gateway_key_hash = p_key_hash
    ) then
        return;
    end if;

    return query
    insert into public.agent_sessions as s
        (agent_id, context_id, turns, input_tokens, output_tokens, cost_usd)
    values (
        p_agent_id, p_context_id, 1,
        greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cost_usd, 0)
    )
    on conflict (agent_id, context_id) do update
        set turns = s.turns + 1,
            input_tokens = s.input_tokens + excluded.input_tokens,
            output_tokens = s.output_tokens + excluded.output_tokens,
            cost_usd = s.cost_usd + excluded.cost_usd,
            last_at = now()
    returning s.*;
end;
$$;

comment on function public.gateway_record_turn(uuid, text, text, bigint, bigint, numeric) is
    'Gateway (A-07): count one turn of a session, only when the key hash matches.';

-- Audit events for one call. A limit block also stops the session (FR-36: "shows it as stopped").
-- Returns how many events were stored (0 when the key is wrong).
create function public.gateway_record_events(
    p_agent_id uuid,
    p_key_hash text,
    p_context_id text,
    p_events jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    inserted integer;
    stop_details text;
begin
    if not exists (
        select 1 from public.agents as a
        where a.id = p_agent_id
          and a.gateway_key_hash is not null
          and a.gateway_key_hash = p_key_hash
    ) then
        return 0;
    end if;
    if jsonb_typeof(p_events) <> 'array' then
        raise exception 'p_events must be a JSON array' using errcode = '22023';
    end if;
    -- One call reports one message's hits; a cap keeps a key holder from flooding the log.
    if jsonb_array_length(p_events) > 100 then
        raise exception 'At most 100 events per call' using errcode = '22023';
    end if;

    insert into public.audit_events
        (agent_id, context_id, rule_id, rule_name, kind, stage, action, config_version, details)
    select
        p_agent_id, p_context_id, e ->> 'rule_id', e ->> 'rule_name', e ->> 'kind',
        e ->> 'stage', e ->> 'action', e ->> 'config_version', coalesce(e ->> 'details', '')
    from jsonb_array_elements(p_events) as e;
    get diagnostics inserted = row_count;

    if p_context_id is not null then
        select e ->> 'details' into stop_details
        from jsonb_array_elements(p_events) as e
        where e ->> 'kind' = 'limit' and e ->> 'action' = 'block'
        limit 1;
        if found then
            insert into public.agent_sessions as s (agent_id, context_id, stopped_at, stop_reason)
            values (
                p_agent_id, p_context_id, now(), coalesce(nullif(stop_details, ''), 'Limit reached')
            )
            on conflict (agent_id, context_id) do update
                set stopped_at = coalesce(s.stopped_at, now()),
                    stop_reason = coalesce(s.stop_reason, excluded.stop_reason),
                    last_at = now();
        end if;
    end if;

    return inserted;
end;
$$;

comment on function public.gateway_record_events(uuid, text, text, jsonb) is
    'Gateway (A-07): store audit events for a call, only when the key hash matches.';

revoke all on function public.gateway_record_turn(uuid, text, text, bigint, bigint, numeric)
    from public;
revoke all on function public.gateway_record_events(uuid, text, text, jsonb) from public;
grant execute on function public.gateway_record_turn(uuid, text, text, bigint, bigint, numeric)
    to anon, authenticated;
grant execute on function public.gateway_record_events(uuid, text, text, jsonb)
    to anon, authenticated;
