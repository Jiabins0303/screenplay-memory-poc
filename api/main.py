"""FastAPI entrypoint — ``uvicorn api.main:app --reload --port 8000``.

Keeps per-project MemoryClients in ``app.state.client_cache``; closes
them on shutdown so Graphiti's Neo4j driver pools release cleanly.

CORS: ``API_ALLOWED_ORIGINS`` env var (comma-separated) controls what
origins can hit this server. Default ``*`` in dev. Set it to your
Cloudflare Pages domain in production.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.deps import ClientCache
from api.routes import edits, graph, ingest, ontology, projects, query


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client_cache = ClientCache()
    try:
        yield
    finally:
        await app.state.client_cache.close_all()


def _allowed_origins() -> list[str]:
    raw = os.getenv("API_ALLOWED_ORIGINS", "*")
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(title="screenplay-memory API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


app.include_router(projects.router)
app.include_router(ontology.router)
app.include_router(ingest.router)
app.include_router(graph.router)
app.include_router(edits.router)
app.include_router(query.router)


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}
