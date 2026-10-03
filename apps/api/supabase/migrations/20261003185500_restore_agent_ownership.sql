-- Remove records created by the temporary unauthenticated service-role endpoint.
-- They have no owner and therefore cannot be made visible safely under user RLS.
delete from public.agents
where owner_id is null;

alter table public.agents
alter column owner_id set not null;

comment on column public.agents.owner_id is
    'Authenticated Supabase user that owns the agent; enforced by RLS.';
