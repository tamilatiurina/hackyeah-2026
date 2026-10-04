-- The hosted project's agents.id ended up as text (created outside these migrations), while
-- 20261003162428_table_agents.sql declares uuid. Later migrations compare it with uuid
-- parameters and reference it from uuid foreign keys, so bring it back to uuid.
-- A no-op on databases built from these migrations. Fails (and rolls back) if a row's id is
-- not a valid UUID, rather than silently dropping it.
do $$
declare
    id_check record;
begin
    if (
        select data_type
        from information_schema.columns
        where table_schema = 'public' and table_name = 'agents' and column_name = 'id'
    ) <> 'uuid' then
        -- Text format checks on id alone (e.g. id ~ '...') can't be evaluated on uuid, and the
        -- uuid type enforces the format itself.
        for id_check in
            select c.conname
            from pg_constraint as c
            join pg_attribute as a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.conrelid = 'public.agents'::regclass
              and c.contype = 'c'
              and cardinality(c.conkey) = 1
              and a.attname = 'id'
        loop
            execute format('alter table public.agents drop constraint %I', id_check.conname);
        end loop;

        alter table public.agents alter column id drop default;
        alter table public.agents alter column id type uuid using id::uuid;
        alter table public.agents alter column id set default gen_random_uuid();
    end if;
end;
$$;
