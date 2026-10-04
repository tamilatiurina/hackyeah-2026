from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.api.main import api_router
from app.core.config import settings
from app.gateway.router import router as gateway_router
from app.mcp.proxy import proxy_app, proxy_server


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    async with proxy_server.session_manager.run():
        yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    description=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
)

app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(gateway_router)
app.mount("/mcp-proxy", proxy_app, name="mcp_proxy")

templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


@app.get("/", response_class=HTMLResponse)
def read_root(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=5001, reload=True)
