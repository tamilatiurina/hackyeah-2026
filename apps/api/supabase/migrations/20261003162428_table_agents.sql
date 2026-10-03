create table public.agents (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    description text not null default '',
    upstream_url text not null,
    auth_header_name text,
    auth_header_value text,
    request_format text not null,
    response_format text not null,
    config_version integer not null default 1,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),

    constraint agents_name_length_check
        check (char_length(btrim(name)) between 1 and 100),
    constraint agents_description_length_check
        check (char_length(description) <= 1000),
    constraint agents_upstream_url_check
        check (upstream_url ~* '^https?://[^[:space:]]+$'),
    constraint agents_auth_header_pair_check
        check (
            (auth_header_name is null and auth_header_value is null)
            or
            (
                auth_header_name is not null
                and auth_header_value is not null
                and char_length(btrim(auth_header_name)) > 0
                and char_length(auth_header_value) > 0
            )
        ),
    constraint agents_request_format_check
        check (request_format in ('json', 'text')),
    constraint agents_response_format_check
        check (response_format in ('json', 'text')),
    constraint agents_config_version_check
        check (config_version > 0),
    constraint agents_owner_name_unique
        unique (owner_id, name)
);

comment on table public.agents is
    'Current configuration of registered upstream AI agents.';
comment on column public.agents.auth_header_value is
    'Sensitive value. Never return it from public API responses or logs.';
comment on column public.agents.config_version is
    'Current config version. Version history belongs in a separate agent_config_versions table.';

create index agents_owner_id_idx on public.agents (owner_id);
create index agents_created_at_idx on public.agents (created_at desc);

create function public.set_agents_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger set_agents_updated_at
before update on public.agents
for each row
execute function public.set_agents_updated_at();

alter table public.agents enable row level security;

create policy "Users can read their own agents"
on public.agents
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Users can create their own agents"
on public.agents
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Users can update their own agents"
on public.agents
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users can delete their own agents"
on public.agents
for delete
to authenticated
using ((select auth.uid()) = owner_id);

revoke all on table public.agents from anon;
grant select, insert, update, delete on table public.agents to authenticated;
grant all on table public.agents to service_role;
