-- The gateway must distinguish executable no-auth MCP grants from stored future auth modes.
create or replace function public.gateway_agent_mcp_servers(p_agent_id uuid, p_key_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when exists (
            select 1 from public.agents as a
            where a.id = p_agent_id
              and a.gateway_key_hash is not null
              and a.gateway_key_hash = p_key_hash
        )
        then coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', m.id,
                    'name', m.name,
                    'url', m.url,
                    'allowedTools', s.allowed_tools,
                    'authType', m.auth_type
                ) order by m.position
            )
            from public.agent_mcp_servers as s
            join public.mcp_servers as m on m.id = s.server_id
            where s.agent_id = p_agent_id
        ), '[]'::jsonb)
    end;
$$;

create or replace function public.owner_agent_mcp_servers(p_agent_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select case
        when exists (select 1 from public.agents as a where a.id = p_agent_id)
        then coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', m.id,
                    'name', m.name,
                    'url', m.url,
                    'allowedTools', s.allowed_tools,
                    'authType', m.auth_type
                ) order by m.position
            )
            from public.agent_mcp_servers as s
            join public.mcp_servers as m on m.id = s.server_id
            where s.agent_id = p_agent_id
        ), '[]'::jsonb)
    end;
$$;
