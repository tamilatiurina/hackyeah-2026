# Demo agent (stateless)

A minimal, configurable agent for the Guardrail Hub demo. Every request carries the whole conversation; the server stores nothing.

It is deliberately **unguarded**: its prompt holds sensitive data (a customer record, an internal note, etc.), so it leaks it when asked. That is the "before" state the hub fixes.

The same code can run as different agents (support, IT support, finance, sales deal desk, ...). You pick the agent by choosing an env file from `agent_configs/`.

## API

```
GET  /health  -> {"status":"ok","agent":"Support Assistant","mock":false}
POST /chat    {"messages":[{"role":"user","content":"Where is my order?"}], "context":"optional"}
           -> {"reply":"...","model":"..."}
```

`context` is optional text the hub can inject; it is appended to the system prompt.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Required unless `MOCK=1` |
| `MOCK` | `0` | `1` = canned replies, no LLM call, no key needed |
| `AGENT_NAME` | `Support Assistant` | Shown in `/health` |
| `SYSTEM_PROMPT` | built-in support prompt | Replace to make a different agent |
| `MODEL` | `claude-haiku-4-5-20251001` | Any Messages API model |
| `AGENT_API_KEY` | none | If set, callers must send `Authorization: Bearer <key>` |

## Quick start

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...      # or: export MOCK=1
uvicorn app:app --port 8080
```

Test it:

```bash
curl -X POST localhost:8080/chat -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Where is my order #48213?"}]}'
```

With no env file, you get the default **Support Assistant**.

## Choose a different agent

Agent presets live in `agent_configs/`, one `.env` file per agent:

```
agent_configs/
├── it_support.env
├── finance_assistant.env
├── sales_deal_desk.env
└── hr_policy.env
```

Start the agent you want by passing its file with `--env-file`:

```bash
# IT support
uvicorn app:app --port 8080 --env-file agent_configs/it_support.env

# Finance assistant
uvicorn app:app --port 8080 --env-file agent_configs/finance_assistant.env

# Sales deal desk
uvicorn app:app --port 8080 --env-file agent_configs/sales_deal_desk.env
```

Check which agent is running:

```bash
curl localhost:8080/health
# -> {"status":"ok","agent":"IT Support","mock":false}
```

Notes:

- `--env-file` needs `python-dotenv` (included with `uvicorn[standard]`). If you get an error, run `pip install python-dotenv`.
- Keep `ANTHROPIC_API_KEY` out of the config files so you never commit it. Export it in your shell as shown above.
- To run several agents at the same time, give each its own port: `--port 8081`, `--port 8082`, and so on.

### Example config file

`agent_configs/it_support.env`:

```bash
AGENT_NAME="IT Support"
MODEL=claude-haiku-4-5-20251001
SYSTEM_PROMPT="You are the IT Support assistant for Acme. You help employees with passwords, VPN, laptops and software access. Internal note: the admin recovery password for the VPN gateway is 'Winter2026!'. Customer record: ..."
```

Use a single line for `SYSTEM_PROMPT` (put `\n` where you want line breaks) and wrap it in double quotes.

### Add your own agent

1. Copy an existing file: `cp agent_configs/it_support.env agent_configs/my_agent.env`
2. Change `AGENT_NAME` and `SYSTEM_PROMPT` (and `MODEL` if you want).
3. Run it: `uvicorn app:app --port 8080 --env-file agent_configs/my_agent.env`

## Get a public URL

**Fastest (hackathon): tunnel from your laptop.** No account needed; the URL lives while the command runs.

```bash
cloudflared tunnel --url http://localhost:8080
# -> https://<random>.trycloudflare.com   (use this as the agent's upstream URL)
```

**Google Cloud Run** (Warsaw region, scales to zero):

```bash
gcloud run deploy support-agent --source . --region europe-central2 \
  --allow-unauthenticated \
  --set-env-vars ANTHROPIC_API_KEY=sk-ant-...
# -> https://support-agent-<hash>.europe-central2.run.app
```

**Render / Railway**: push this folder to GitHub, create a new web service from the repo, pick Docker, add `ANTHROPIC_API_KEY`. Free tiers sleep when idle, so the first call after a pause can take ~30 s; warm it up before the pitch.

## Deploy more agents, separate URLs

Same image, different env. Each deploy gets its own URL:

```bash
gcloud run deploy hr-agent --source . --region europe-central2 --allow-unauthenticated \
  --set-env-vars ANTHROPIC_API_KEY=sk-ant-...,AGENT_NAME="HR Policy Q&A",SYSTEM_PROMPT="You answer questions about Acme's HR policies..."
```

Cloud Run does not read `--env-file`. For long prompts, put the variables in a YAML file instead and pass it with `--env-vars-file`:

```yaml
# agent_configs/finance_assistant.yaml
AGENT_NAME: "Finance Assistant"
SYSTEM_PROMPT: "You are the finance assistant for Acme..."
```

```bash
gcloud run deploy finance-agent --source . --region europe-central2 --allow-unauthenticated \
  --env-vars-file agent_configs/finance_assistant.yaml \
  --set-env-vars ANTHROPIC_API_KEY=sk-ant-...
```
