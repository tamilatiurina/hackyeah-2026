-- B-06: the panel's test chat records into the same audit log as the gateway (A-07).
-- The test chat runs as the signed-in owner, who has no gateway key (only its hash is stored),
-- so these mirror gateway_record_turn / gateway_record_events but check ownership instead:
-- they work only for an agent whose owner_id is the caller (auth.uid()).

create function public.owner_record_turn(
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
    if not exists (
        select 1 from public.agents as a
        where a.id = p_agent_id and a.owner_id = (select auth.uid())
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

create function public.owner_record_events(
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
    if not exists (
        select 1 from public.agents as a
        where a.id = p_agent_id and a.owner_id = (select auth.uid())
    ) then
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
    'Test chat (B-06): count one turn of a session for an agent the caller owns.';
comment on function public.owner_record_events(uuid, text, jsonb) is
    'Test chat (B-06): store audit events for an agent the caller owns.';

revoke all on function public.owner_record_turn(uuid, text, bigint, bigint, numeric) from public;
revoke all on function public.owner_record_events(uuid, text, jsonb) from public;
grant execute on function public.owner_record_turn(uuid, text, bigint, bigint, numeric)
    to authenticated;
grant execute on function public.owner_record_events(uuid, text, jsonb) to authenticated;
