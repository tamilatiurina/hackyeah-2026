-- Every row belongs to one user, and a user reaches only their own rows (migration
-- 20261009120000_per_user_ownership). Run with: make test-db
begin;
select plan(27);

-- Two accounts. The profile trigger gives each one a profile row.
insert into auth.users (id, email) values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.com'),
    ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.com');

select is(
    (select count(*)::int from public.profiles
     where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')),
    2,
    'each new account gets a profile'
);

-- --- user A builds a workspace -----------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.agents (id, name, base_url, upstream_url, gateway_key_hash)
values (
    'a0000000-0000-0000-0000-00000000000a', 'Agent A', 'https://a.example', 'https://a.example/a2a',
    repeat('a', 64)
);
insert into public.guardrails (id, name, engine, stages, action, config, is_mandatory) values
    ('gr-shared-id', 'A shared id', 'regex', '{input}', 'block',
     '{"template": "regex", "pattern": "a"}', false),
    ('gr-only-a', 'A only', 'regex', '{input}', 'warn',
     '{"template": "regex", "pattern": "x"}', true);
insert into public.rule_bindings (id, scope_type, scope_id, guardrail_id)
values ('b-a', 'agent', 'a0000000-0000-0000-0000-00000000000a', 'gr-shared-id');
insert into public.mcp_servers (id, name, url, auth_type, allowed_tools)
values ('mcp-a', 'Orders', 'https://mcp.example', 'none', '{lookup}');
insert into public.agent_mcp_servers (agent_id, server_id, allowed_tools)
values ('a0000000-0000-0000-0000-00000000000a', 'mcp-a', '{lookup}');
insert into public.injection_signatures (id, regex) values ('sig-a', 'ignore');
insert into public.security_scans (agent_id, policy_version, summary, categories, static_checks, results)
values ('a0000000-0000-0000-0000-00000000000a', 'v1', '{}', '[]', '[]', '[]');

select is(
    (select owner_id from public.guardrails where id = 'gr-only-a'),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'owner_id defaults to the signed-in user'
);
select is(
    (select owner_id from public.agent_mcp_servers where server_id = 'mcp-a'),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'an MCP grant takes its agent''s owner'
);
select is(
    (select owner_id from public.security_scans limit 1),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'a security scan takes its agent''s owner'
);
select throws_ok(
    $$insert into public.guardrails (owner_id, id, name, engine, stages, action, config)
      values ('bbbbbbbb-0000-0000-0000-000000000002', 'gr-forged', 'Forged', 'regex', '{input}',
              'block', '{"template": "regex", "pattern": "a"}')$$,
    '42501',
    'a user cannot create a row owned by someone else'
);

-- --- user B sees none of it ------------------------------------------------------------------------
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

select is((select count(*)::int from public.agents), 0, 'B sees no agents of A');
select is((select count(*)::int from public.guardrails), 0, 'B sees no guardrails of A');
select is((select count(*)::int from public.rule_bindings), 0, 'B sees no bindings of A');
select is((select count(*)::int from public.mcp_servers), 0, 'B sees no MCP servers of A');
select is((select count(*)::int from public.agent_mcp_servers), 0, 'B sees no MCP grants of A');
select is((select count(*)::int from public.injection_signatures), 0, 'B sees no signatures of A');
select is((select count(*)::int from public.security_scans), 0, 'B sees no scans of A');
select is((select count(*)::int from public.profiles), 1, 'B sees only their own profile');

update public.profiles set bootstrapped_at = now(), demo_agent_added_at = now();
select is(
    (select count(*)::int from public.profiles where bootstrapped_at is not null),
    1,
    'B can record their own setup steps'
);

update public.guardrails set name = 'Hijacked' where id = 'gr-only-a';
delete from public.agents where id = 'a0000000-0000-0000-0000-00000000000a';

-- Ids are per user: B can reuse A's slug.
insert into public.guardrails (id, name, engine, stages, action, config)
values ('gr-shared-id', 'B shared id', 'regex', '{input}', 'block',
        '{"template": "regex", "pattern": "b"}');
select is((select count(*)::int from public.guardrails), 1, 'B can reuse a guardrail id A uses');

insert into public.agents (id, name, base_url, upstream_url)
values ('b0000000-0000-0000-0000-00000000000b', 'Agent B', 'https://b.example', 'https://b.example/a2a');

select throws_ok(
    $$insert into public.rule_bindings (id, scope_type, scope_id, guardrail_id)
      values ('b-b', 'agent', 'b0000000-0000-0000-0000-00000000000b', 'gr-only-a')$$,
    '23503',
    'B cannot bind a guardrail that only A has'
);
select throws_ok(
    $$insert into public.agent_mcp_servers (agent_id, server_id, allowed_tools)
      values ('b0000000-0000-0000-0000-00000000000b', 'mcp-a', '{lookup}')$$,
    '23503',
    'B cannot grant A''s MCP server to their own agent'
);
select throws_ok(
    $$insert into public.agent_mcp_servers (agent_id, server_id, allowed_tools)
      values ('a0000000-0000-0000-0000-00000000000a', 'mcp-a', '{lookup}')$$,
    '42501',
    'B cannot grant MCP access to A''s agent'
);

-- --- anonymous visitors see nothing ----------------------------------------------------------------
set local role anon;
select throws_ok(
    'select count(*) from public.guardrails',
    '42501',
    'anon cannot read guardrails'
);

-- --- back as the superuser: B's writes to A's rows did nothing --------------------------------------
reset role;
select is(
    (select name from public.guardrails
     where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and id = 'gr-only-a'),
    'A only',
    'B could not rename A''s guardrail'
);
select is(
    (select count(*)::int from public.agents where id = 'a0000000-0000-0000-0000-00000000000a'),
    1,
    'B could not delete A''s agent'
);
select is(
    (select bootstrapped_at from public.profiles
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    null,
    'B could not change A''s profile'
);

-- --- the gateway answers with the agent owner's library only ---------------------------------------
select is(
    jsonb_array_length(
        public.gateway_agent_guardrails('a0000000-0000-0000-0000-00000000000a', repeat('a', 64))
            -> 'guardrails'
    ),
    2,
    'gateway: A''s agent gets A''s bound and mandatory guardrails, not B''s'
);
select is(
    public.gateway_agent_guardrails('a0000000-0000-0000-0000-00000000000a', 'wrong'),
    null::jsonb,
    'gateway: a wrong key gets nothing'
);
select is(
    public.gateway_agent_signatures('a0000000-0000-0000-0000-00000000000a', repeat('a', 64)),
    '[{"id": "sig-a", "regex": "ignore"}]'::jsonb,
    'gateway: A''s agent gets A''s signatures'
);
select is(
    public.gateway_record_events(
        'a0000000-0000-0000-0000-00000000000a', repeat('a', 64), 'ctx-1',
        '[{"rule_id": "gr-only-a", "rule_name": "A only", "kind": "guardrail",
           "stage": "input", "action": "warn"}]'
    ),
    1,
    'gateway: an audit event is stored'
);
select is(
    (select owner_id from public.audit_events where context_id = 'ctx-1'),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'gateway: the audit event belongs to the agent''s owner'
);

select * from finish();
rollback;
