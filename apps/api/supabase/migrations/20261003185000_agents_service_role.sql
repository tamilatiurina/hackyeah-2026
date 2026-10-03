alter table public.agents
alter column owner_id drop not null;

comment on column public.agents.owner_id is
    'Optional until application login is enabled; server-created agents are unowned.';
