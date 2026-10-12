# FastAPI Starter

Deploy your [FastAPI](https://fastapi.tiangolo.com/) project to Vercel with zero configuration.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vercel/vercel/tree/main/examples/fastapi&template=fastapi)

Visit the [FastAPI documentation](https://fastapi.tiangolo.com/) to learn more.

## Project Structure

This example follows the [larger applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/) pattern from the FastAPI docs:

```
app/
├── __init__.py
├── main.py              # FastAPI application entry point
├── templates/
│   └── index.html       # Landing page template
├── api/
│   ├── __init__.py
│   ├── main.py          # API router assembly (every route needs a signed-in user)
│   └── routes/          # Agents, guardrails, bindings, MCP, audit, scans, test chat
└── core/
    ├── __init__.py
    ├── auth.py          # get_current_user: the Supabase user behind the bearer token
    └── config.py        # Application settings
```

## Getting Started

Install the required dependencies using [uv](https://docs.astral.sh/uv/):

```bash
uv sync
```

## Running Locally

```bash
vercel dev
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Landing page |
| `*` | `/api/v1/...` | Panel API; needs `Authorization: Bearer <Supabase access token>` |
| `POST` | `/a/{agent_id}` | Guarded A2A URL; needs the agent's gateway key in `X-API-Key` |
| `GET` | `/docs` | Interactive API docs (Swagger UI) |

## Deploying to Vercel

Deploy your project to Vercel with the following command:

```bash
npm install -g vercel
vercel --prod
```

Or `git push` to your repository with our [git integration](https://vercel.com/docs/deployments/git).

To view the source code for this template, [visit the example repository](https://github.com/vercel/vercel/tree/main/examples/fastapi).
