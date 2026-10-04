-- #102: the panel's Audit log and Sessions pages listen to these tables through Supabase Realtime.
-- Realtime applies the tables' RLS, so each user only hears about their own agents' rows.
-- Skipped where the publication doesn't exist (plain Postgres), and safe to run twice.
do $$
declare
    t text;
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        return;
    end if;
    foreach t in array array['audit_events', 'agent_sessions'] loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end;
$$;
