-- The hosted project's agents.id ended up as text (created outside these migrations), while
-- 20261003162428_table_agents.sql declares uuid. Later migrations compare it with uuid
-- parameters and reference it from uuid foreign keys, so bring it back to uuid.
-- A no-op on databases built from these migrations. Fails (and rolls back) if a row's id is
-- not a valid UUID, rather than silently dropping it.
do $$
begin
    if (
        select data_type
        from information_schema.columns
        where table_schema = 'public' and table_name = 'agents' and column_name = 'id'
    ) <> 'uuid' then
        alter table public.agents alter column id drop default;
        alter table public.agents alter column id type uuid using id::uuid;
        alter table public.agents alter column id set default gen_random_uuid();
    end if;
end;
$$;
