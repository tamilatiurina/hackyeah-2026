-- The prompt injection detector and the topic guardrail also check the agent's replies, so an
-- injected instruction or an off-topic answer coming back from an agent is caught (app/seeds.py).
-- app.seed_db never overwrites existing rows, so update the seeded ones here. Rows whose stages
-- were already changed through the panel are left alone.
update public.guardrails
set stages = array['input', 'output']::text[]
where id in ('gr-injection', 'gr-topic')
    and stages = array['input']::text[];

update public.guardrails
set description = 'Matches messages and replies against the company injection signatures.'
where id = 'gr-injection'
    and description = 'Matches inputs against the company injection signatures.';
