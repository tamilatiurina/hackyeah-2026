-- One shared workspace: every signed-in user can see, edit and delete every agent, and everything
-- tied to an agent follows the agent's visibility. Production already shared the agents table
-- (changed by hand in Supabase); this records it, so a fresh database behaves the same, and
-- aligns the rules that still required ownership:
--   sessions and audit log (A-07), security scans (SEC-01), the test chat's recording (B-06).
-- MCP access (FR-17) already follows visibility (20261004170000).
--
-- Known trade-off (accepted for the demo): the panel signs visitors in as anonymous guests, so
-- anyone with the panel's URL is a signed-in user and can read and change every agent,
-- including its stored upstream auth header.

-- --- agents: shared (creating one still records its owner) ---
drop policy if exists "Users can read their own agents" on public.agents;
drop policy if exists "Users can update their own agents" on public.agents;
drop policy if exists "Users can delete their own agents" on public.agents;
drop policy if exists "Signed-in users can read agents" on public.agents;
drop policy if exists "Signed-in users can update agents" on public.agents;
drop policy if exists "Signed-in users can delete agents" on public.agents;

create policy "Signed-in users can read agents"
on public.agents for select to authenticated using (true);
create policy "Signed-in users can update agents"
on public.agents for update to authenticated using (true) with check (true);
create policy "Signed-in users can delete agents"
on public.agents for delete to authenticated using (true);
-- "Users can create their own agents" stays: owner_id must be the caller.

-- --- sessions and audit log: whoever sees the agent (checked under the caller's RLS) ---
drop policy if exists "Owners can read their agents' sessions" on public.agent_sessions;
drop policy if exists "Users who see an agent can read its sessions" on public.agent_sessions;
create policy "Users who see an agent can read its sessions"
on public.agent_sessions for select to authenticated
using (exists (select 1 from public.agents as a where a.id = agent_sessions.agent_id));

drop policy if exists "Owners can read their agents' audit events" on public.audit_events;
drop policy if exists "Users who see an agent can read its audit events" on public.audit_events;
create policy "Users who see an agent can read its audit events"
on public.audit_events for select to authenticated
using (exists (select 1 from public.agents as a where a.id = audit_events.agent_id));

-- --- security scans ---
drop policy if exists "Owners can read their agents' security scans" on public.security_scans;
drop policy if exists "Owners can save security scans of their agents" on public.security_scans;
drop policy if exists "Users who see an agent can read its security scans" on public.security_scans;
drop policy if exists "Users who see an agent can save its security scans" on public.security_scans;
create policy "Users who see an agent can read its security scans"
on public.security_scans for select to authenticated
using (exists (select 1 from public.agents as a where a.id = security_scans.agent_id));
create policy "Users who see an agent can save its security scans"
on public.security_scans for insert to authenticated
with check (exists (select 1 from public.agents as a where a.id = security_scans.agent_id));

-- --- the test chat's recording (security definer: users can't write these tables directly) ---
-- A definer function can't evaluate the caller's RLS, so with agents shared the check is: a
-- signed-in caller and an existing agent. Same signatures and behaviour otherwise.
create or replace function public.owner_record_turn(
    p_agent_id uuid,
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
    if (select auth.uid()) is null
       or not exists (select 1 from public.agents as a where a.id = p_agent_id) then
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

create or replace function public.owner_record_events(
    p_agent_id uuid,
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
begin
    if (select auth.uid()) is null
       or not exists (select 1 from public.agents as a where a.id = p_agent_id) then
        return 0;
    end if;
    if jsonb_typeof(p_events) <> 'array' then
        raise exception 'p_events must be a JSON array' using errcode = '22023';
    end if;
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
    return inserted;
end;
$$;

comment on function public.owner_record_turn(uuid, text, bigint, bigint, numeric) is
    'Test chat (B-06): count one turn of a session, for any signed-in user (shared workspace).';
comment on function public.owner_record_events(uuid, text, jsonb) is
    'Test chat (B-06): store audit events, for any signed-in user (shared workspace).';
