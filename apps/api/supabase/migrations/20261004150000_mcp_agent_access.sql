-- FR-17: which MCP servers, and which of their tools, each agent may use.
-- Also repairs the mcp_servers privileges: on the hosted project signed-in users got
-- "permission denied for table mcp_servers" (42501), so the grants and policies from
-- 20261003215000_table_mcp_servers.sql are re-applied here. Idempotent.

-- --- repair mcp_servers access (same rules as its original migration) ---
alter table public.mcp_servers enable row level security;

drop policy if exists "Signed-in users can read MCP servers" on public.mcp_servers;
drop policy if exists "Signed-in users can register MCP servers" on public.mcp_servers;
drop policy if exists "Signed-in users can update MCP servers" on public.mcp_servers;
drop policy if exists "Signed-in users can delete MCP servers" on public.mcp_servers;

create policy "Signed-in users can read MCP servers"
on public.mcp_servers for select to authenticated using (true);
create policy "Signed-in users can register MCP servers"
on public.mcp_servers for insert to authenticated with check (true);
create policy "Signed-in users can update MCP servers"
on public.mcp_servers for update to authenticated using (true) with check (true);
create policy "Signed-in users can delete MCP servers"
on public.mcp_servers for delete to authenticated using (true);

revoke all on table public.mcp_servers from anon, authenticated;
-- Every column EXCEPT auth_secret, which can be written but never read back.
grant select (
    id, position, name, url, auth_type, auth_header, oauth_token_url, oauth_client_id,
    oauth_scopes, allowed_tools, created_at, updated_at
) on table public.mcp_servers to authenticated;
grant insert, update, delete on table public.mcp_servers to authenticated;
grant all on table public.mcp_servers to service_role;

-- --- per-agent access ---
create table public.agent_mcp_servers (
    agent_id uuid not null references public.agents (id) on delete cascade,
    server_id text not null references public.mcp_servers (id) on delete cascade,
    allowed_tools text[] not null,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),

    primary key (agent_id, server_id),
    constraint agent_mcp_servers_allowed_tools_check check (cardinality(allowed_tools) >= 1)
);

comment on table public.agent_mcp_servers is
    'FR-17: an MCP server an agent may use, with the subset of its tools that agent may call.';

create index agent_mcp_servers_server_idx on public.agent_mcp_servers (server_id);

create function public.set_agent_mcp_servers_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger set_agent_mcp_servers_updated_at
before update on public.agent_mcp_servers
for each row
execute function public.set_agent_mcp_servers_updated_at();

alter table public.agent_mcp_servers enable row level security;

-- Same ownership as the agent itself.
create policy "Owners can read their agents' MCP access"
on public.agent_mcp_servers for select to authenticated
using (exists (
    select 1 from public.agents as a
    where a.id = agent_mcp_servers.agent_id and a.owner_id = (select auth.uid())
));
create policy "Owners can grant their agents MCP access"
on public.agent_mcp_servers for insert to authenticated
with check (exists (
    select 1 from public.agents as a
    where a.id = agent_mcp_servers.agent_id and a.owner_id = (select auth.uid())
));
create policy "Owners can change their agents' MCP access"
on public.agent_mcp_servers for update to authenticated
using (exists (
    select 1 from public.agents as a
    where a.id = agent_mcp_servers.agent_id and a.owner_id = (select auth.uid())
))
with check (exists (
    select 1 from public.agents as a
    where a.id = agent_mcp_servers.agent_id and a.owner_id = (select auth.uid())
));
create policy "Owners can revoke their agents' MCP access"
on public.agent_mcp_servers for delete to authenticated
using (exists (
    select 1 from public.agents as a
    where a.id = agent_mcp_servers.agent_id and a.owner_id = (select auth.uid())
));

revoke all on table public.agent_mcp_servers from anon, authenticated;
grant select, insert, update, delete on table public.agent_mcp_servers to authenticated;
grant all on table public.agent_mcp_servers to service_role;

-- A tool removed from a server is removed from every agent; an agent left with none loses the
-- server. Security definer: it must reach every agent's rows, not only the editor's own.
create function public.sync_agent_mcp_tools()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.agent_mcp_servers as s
    set allowed_tools = array(
        select t from unnest(s.allowed_tools) as t where t = any (new.allowed_tools)
    )
    where s.server_id = new.id
      and not (s.allowed_tools <@ new.allowed_tools)
      and s.allowed_tools && new.allowed_tools;

    delete from public.agent_mcp_servers as s
    where s.server_id = new.id and not (s.allowed_tools && new.allowed_tools);
    return new;
end;
$$;

create trigger sync_agent_mcp_tools
after update of allowed_tools on public.mcp_servers
for each row
execute function public.sync_agent_mcp_tools();

-- --- what the agent is told on each call (no credentials, ever) ---
-- The gateway has no signed-in user: answers only to a caller holding the agent's key.
create function public.gateway_agent_mcp_servers(p_agent_id uuid, p_key_hash text)
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
                    'id', m.id, 'name', m.name, 'url', m.url, 'allowedTools', s.allowed_tools
                )
                order by m.position
            )
            from public.agent_mcp_servers as s
            join public.mcp_servers as m on m.id = s.server_id
            where s.agent_id = p_agent_id
        ), '[]'::jsonb)
    end;
$$;

-- The panel's test chat runs as the signed-in owner, who has no gateway key.
create function public.owner_agent_mcp_servers(p_agent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when exists (
            select 1 from public.agents as a
            where a.id = p_agent_id and a.owner_id = (select auth.uid())
        )
        then coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', m.id, 'name', m.name, 'url', m.url, 'allowedTools', s.allowed_tools
                )
                order by m.position
            )
            from public.agent_mcp_servers as s
            join public.mcp_servers as m on m.id = s.server_id
            where s.agent_id = p_agent_id
        ), '[]'::jsonb)
    end;
$$;

comment on function public.gateway_agent_mcp_servers(uuid, text) is
    'Gateway (FR-17): the MCP servers and tools an agent may use, only when the key hash matches.';
comment on function public.owner_agent_mcp_servers(uuid) is
    'Test chat (FR-17): the MCP servers and tools of an agent the caller owns.';

revoke all on function public.gateway_agent_mcp_servers(uuid, text) from public;
revoke all on function public.owner_agent_mcp_servers(uuid) from public;
revoke all on function public.sync_agent_mcp_tools() from public;
grant execute on function public.gateway_agent_mcp_servers(uuid, text) to anon, authenticated;
grant execute on function public.owner_agent_mcp_servers(uuid) to authenticated;
