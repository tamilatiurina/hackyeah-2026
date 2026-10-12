-- Real multi-user accounts: every row belongs to one user (owner_id -> auth.users) and RLS keeps
-- each user's data private. Replaces the company-wide guardrail library, rule bindings and MCP
-- registry, the in-memory injection signatures and anonymous guest sessions.
--
-- Library ids (guardrails, bindings, MCP servers, signatures) are slugs chosen per user, so their
-- keys become (owner_id, id): two users can both have "gr-injection". Composite foreign keys make
-- a binding or an MCP grant point at a row of the same owner.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- --- 1. Clean slate: shared rows have no owner, guests are not accounts -------------------------
delete from public.agent_mcp_servers;
delete from public.rule_bindings;
delete from public.guardrails;
delete from public.mcp_servers;
delete from auth.users where is_anonymous;

-- --- 2. Drop every policy on the owned tables (production has hand-made ones) -------------------
do $$
declare
    p record;
begin
    for p in
        select policyname, tablename
        from pg_policies
        where schemaname = 'public'
          and tablename in (
              'agents', 'guardrails', 'rule_bindings', 'mcp_servers', 'agent_mcp_servers',
              'agent_sessions', 'audit_events', 'security_scans'
          )
    loop
        execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    end loop;
end;
$$;

-- --- 3. Owner columns and per-owner keys ----------------------------------------------------------
alter table public.agents alter column owner_id set default auth.uid();

alter table public.rule_bindings drop constraint rule_bindings_guardrail_id_fkey;
alter table public.agent_mcp_servers drop constraint agent_mcp_servers_server_id_fkey;

-- guardrails
alter table public.guardrails
    add column owner_id uuid not null default auth.uid()
        references auth.users (id) on delete cascade;
alter table public.guardrails drop constraint guardrails_pkey;
alter table public.guardrails add primary key (owner_id, id);
comment on table public.guardrails is
    'Each user''s guardrail library. Each guardrail runs exactly one engine.';
comment on column public.guardrails.is_mandatory is
    'Applies to every agent of its owner regardless of bindings, and always runs first.';

-- rule_bindings
alter table public.rule_bindings
    add column owner_id uuid not null default auth.uid()
        references auth.users (id) on delete cascade;
alter table public.rule_bindings drop constraint rule_bindings_pkey;
alter table public.rule_bindings add primary key (owner_id, id);
alter table public.rule_bindings drop constraint rule_bindings_unique_attachment;
alter table public.rule_bindings
    add constraint rule_bindings_unique_attachment
        unique (owner_id, scope_type, scope_id, guardrail_id);
alter table public.rule_bindings
    add constraint rule_bindings_guardrail_fkey
        foreign key (owner_id, guardrail_id)
        references public.guardrails (owner_id, id) on delete cascade;
drop index public.rule_bindings_scope_idx;
create index rule_bindings_scope_idx
    on public.rule_bindings (owner_id, scope_type, scope_id, order_index);

-- mcp_servers
alter table public.mcp_servers
    add column owner_id uuid not null default auth.uid()
        references auth.users (id) on delete cascade;
alter table public.mcp_servers drop constraint mcp_servers_pkey;
alter table public.mcp_servers add primary key (owner_id, id);
drop index public.mcp_servers_name_unique;
create unique index mcp_servers_name_unique on public.mcp_servers (owner_id, lower(name));
grant select (owner_id) on table public.mcp_servers to authenticated;

-- Rows that hang off an agent take the agent's owner. The trigger sets it for every writer,
-- including the gateway's security definer functions, which have no signed-in user.
create function private.set_owner_from_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    select a.owner_id into new.owner_id from public.agents as a where a.id = new.agent_id;
    return new;
end;
$$;
revoke all on function private.set_owner_from_agent() from public, anon, authenticated;

-- agent_mcp_servers
alter table public.agent_mcp_servers add column owner_id uuid;
alter table public.agent_mcp_servers
    alter column owner_id set not null,
    add constraint agent_mcp_servers_owner_fkey
        foreign key (owner_id) references auth.users (id) on delete cascade,
    add constraint agent_mcp_servers_server_fkey
        foreign key (owner_id, server_id)
        references public.mcp_servers (owner_id, id) on delete cascade;
drop index public.agent_mcp_servers_server_idx;
create index agent_mcp_servers_server_idx on public.agent_mcp_servers (owner_id, server_id);

create trigger set_agent_mcp_servers_owner
before insert or update of agent_id on public.agent_mcp_servers
for each row execute function private.set_owner_from_agent();

-- agent_sessions, audit_events, security_scans: backfill from the agent, then require it.
alter table public.agent_sessions add column owner_id uuid;
update public.agent_sessions as s set owner_id = a.owner_id
from public.agents as a where a.id = s.agent_id;
alter table public.agent_sessions
    alter column owner_id set not null,
    add constraint agent_sessions_owner_fkey
        foreign key (owner_id) references auth.users (id) on delete cascade;
create index agent_sessions_owner_idx on public.agent_sessions (owner_id, last_at desc);
create trigger set_agent_sessions_owner
before insert or update of agent_id on public.agent_sessions
for each row execute function private.set_owner_from_agent();

alter table public.audit_events add column owner_id uuid;
update public.audit_events as e set owner_id = a.owner_id
from public.agents as a where a.id = e.agent_id;
alter table public.audit_events
    alter column owner_id set not null,
    add constraint audit_events_owner_fkey
        foreign key (owner_id) references auth.users (id) on delete cascade;
create index audit_events_owner_at_idx on public.audit_events (owner_id, at desc, id desc);
create trigger set_audit_events_owner
before insert or update of agent_id on public.audit_events
for each row execute function private.set_owner_from_agent();

alter table public.security_scans add column owner_id uuid;
update public.security_scans as s set owner_id = a.owner_id
from public.agents as a where a.id = s.agent_id;
alter table public.security_scans
    alter column owner_id set not null,
    add constraint security_scans_owner_fkey
        foreign key (owner_id) references auth.users (id) on delete cascade;
create index security_scans_owner_idx on public.security_scans (owner_id, created_at desc);
create trigger set_security_scans_owner
before insert or update of agent_id on public.security_scans
for each row execute function private.set_owner_from_agent();

-- --- 4. New tables ---------------------------------------------------------------------------------
-- Prompt-injection signatures were kept in API memory; now each user has their own list.
create table public.injection_signatures (
    owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    id text not null,
    position bigint generated always as identity,
    regex text not null,
    created_at timestamp with time zone not null default now(),

    primary key (owner_id, id),
    constraint injection_signatures_id_check
        check (id ~ '^[a-z0-9][a-z0-9-]*$' and char_length(id) <= 60),
    constraint injection_signatures_regex_length_check
        check (char_length(regex) between 1 and 500)
);
comment on table public.injection_signatures is
    'Each user''s prompt-injection signatures, used by the prompt_injection guardrail template.';

alter table public.injection_signatures enable row level security;
revoke all on table public.injection_signatures from anon, authenticated;
grant select, insert, update, delete on table public.injection_signatures to authenticated;
grant all on table public.injection_signatures to service_role;

-- One profile per account: OAuth name and avatar, and whether first sign-in seeding is done.
create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text,
    display_name text,
    avatar_url text,
    bootstrapped_at timestamp with time zone,
    demo_agent_added_at timestamp with time zone,
    created_at timestamp with time zone not null default now()
);
comment on table public.profiles is
    'One row per account, with what the first-sign-in setup (POST /api/v1/me/bootstrap) did.';
comment on column public.profiles.bootstrapped_at is
    'When the seed guardrails and injection signatures were copied into this account.';
comment on column public.profiles.demo_agent_added_at is
    'When the shared demo agent was registered for this user (they may delete it later).';
comment on column public.profiles.id is 'The owning user (auth.users.id), like owner_id elsewhere.';

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url, bootstrapped_at, demo_agent_added_at)
    on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

create function private.create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, email, display_name, avatar_url)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
        new.raw_user_meta_data ->> 'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;
revoke all on function private.create_profile() from public, anon, authenticated;

create trigger create_profile
after insert on auth.users
for each row execute function private.create_profile();

insert into public.profiles (id, email, display_name, avatar_url)
select
    u.id,
    u.email,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
    u.raw_user_meta_data ->> 'avatar_url'
from auth.users as u
on conflict (id) do nothing;

-- --- 5. Policies: a user reaches only their own rows ------------------------------------------------
create policy "Users manage their own agents" on public.agents
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage their own guardrails" on public.guardrails
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage their own rule bindings" on public.rule_bindings
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage their own MCP servers" on public.mcp_servers
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage their own agents' MCP access" on public.agent_mcp_servers
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage their own injection signatures" on public.injection_signatures
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

-- Sessions and audit events are written only by the security definer functions.
create policy "Users read their own sessions" on public.agent_sessions
for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users read their own audit events" on public.audit_events
for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users read their own security scans" on public.security_scans
for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users save security scans of their own agents" on public.security_scans
for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Users read their own profile" on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

create policy "Users update their own profile" on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- --- 6. Functions that read the library on behalf of an agent ---------------------------------------
-- The gateway has no signed-in user: it answers for the agent whose key matches, and only with
-- that agent's owner's guardrails, bindings, MCP servers and signatures.
create or replace function public.gateway_agent_guardrails(
    p_agent_id uuid,
    p_key_hash text,
    p_role text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    with agent as (
        select a.owner_id
        from public.agents as a
        where a.id = p_agent_id
          and a.gateway_key_hash is not null
          and a.gateway_key_hash = p_key_hash
    ),
    scoped_bindings as (
        select b.*
        from public.rule_bindings as b
        join agent on agent.owner_id = b.owner_id
        where (b.scope_type = 'agent' and b.scope_id = p_agent_id::text)
           or (p_role is not null and b.scope_type = 'role' and b.scope_id = p_role)
    )
    select case
        when exists (select 1 from agent)
        then jsonb_build_object(
            'guardrails', coalesce((
                select jsonb_agg(to_jsonb(g) - 'owner_id' order by g.position)
                from public.guardrails as g
                join agent on agent.owner_id = g.owner_id
                where g.is_mandatory
                   or g.id in (select guardrail_id from scoped_bindings)
            ), '[]'::jsonb),
            'bindings', coalesce((
                select jsonb_agg(to_jsonb(b) - 'owner_id' order by b.order_index, b.position)
                from scoped_bindings as b
            ), '[]'::jsonb)
        )
    end;
$$;

create function public.gateway_agent_signatures(p_agent_id uuid, p_key_hash text)
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
            select jsonb_agg(jsonb_build_object('id', s.id, 'regex', s.regex) order by s.position)
            from public.injection_signatures as s
            join public.agents as a on a.owner_id = s.owner_id
            where a.id = p_agent_id
        ), '[]'::jsonb)
    end;
$$;
comment on function public.gateway_agent_signatures(uuid, text) is
    'Gateway: the agent owner''s injection signatures, only when the key hash matches.';
revoke all on function public.gateway_agent_signatures(uuid, text) from public;
grant execute on function public.gateway_agent_signatures(uuid, text) to anon, authenticated;

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
                    'id', m.id, 'name', m.name, 'url', m.url, 'allowedTools', s.allowed_tools
                )
                order by m.position
            )
            from public.agent_mcp_servers as s
            join public.mcp_servers as m on m.owner_id = s.owner_id and m.id = s.server_id
            where s.agent_id = p_agent_id
        ), '[]'::jsonb)
    end;
$$;

-- The test chat runs as the signed-in owner; RLS limits it to their own agents and servers.
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
                    'id', m.id, 'name', m.name, 'url', m.url, 'allowedTools', s.allowed_tools
                )
                order by m.position
            )
            from public.agent_mcp_servers as s
            join public.mcp_servers as m on m.owner_id = s.owner_id and m.id = s.server_id
            where s.agent_id = p_agent_id
        ), '[]'::jsonb)
    end;
$$;
comment on function public.owner_agent_mcp_servers(uuid) is
    'Test chat (FR-17): the MCP servers and tools of an agent the caller owns.';

-- A tool removed from a server is removed from that owner's agents.
create or replace function public.sync_agent_mcp_tools()
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
    where s.owner_id = new.owner_id
      and s.server_id = new.id
      and not (s.allowed_tools <@ new.allowed_tools)
      and s.allowed_tools && new.allowed_tools;

    delete from public.agent_mcp_servers as s
    where s.owner_id = new.owner_id
      and s.server_id = new.id
      and not (s.allowed_tools && new.allowed_tools);
    return new;
end;
$$;
