"""Environment-driven configuration. Fail fast on missing required keys."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    neo4j_uri: str
    neo4j_user: str
    neo4j_password: str

    openrouter_api_key: str
    openrouter_api_base: str
    chat_model: str
    chat_small_model: str
    embedding_model: str
    embedding_dim: int
    llm_max_tokens: int

    @classmethod
    def from_env(cls) -> "Settings":
        required = {
            "NEO4J_URI": os.getenv("NEO4J_URI", "bolt://localhost:7687"),
            "NEO4J_USER": os.getenv("NEO4J_USER", "neo4j"),
            "NEO4J_PASSWORD": os.getenv("NEO4J_PASSWORD", "testpassword"),
            "OPENROUTER_API_KEY": os.getenv("OPENROUTER_API_KEY"),
            "OPENROUTER_API_BASE": os.getenv(
                "OPENROUTER_API_BASE", "https://openrouter.ai/api/v1"
            ),
            "CHAT_MODEL": os.getenv("CHAT_MODEL", "qwen/qwen-2.5-72b-instruct"),
            "CHAT_SMALL_MODEL": os.getenv(
                "CHAT_SMALL_MODEL", "qwen/qwen-2.5-7b-instruct"
            ),
            "EMBEDDING_MODEL": os.getenv(
                "EMBEDDING_MODEL", "qwen/qwen3-embedding-8b"
            ),
            "EMBEDDING_DIM": os.getenv("EMBEDDING_DIM", "4096"),
        }
        missing = [k for k, v in required.items() if not v]
        if missing:
            raise RuntimeError(
                f"Missing required env vars: {missing}. Copy .env.example to .env."
            )
        try:
            embedding_dim = int(required["EMBEDDING_DIM"])
        except ValueError as e:
            raise RuntimeError(
                f"EMBEDDING_DIM must be an integer, got {required['EMBEDDING_DIM']!r}"
            ) from e
        try:
            llm_max_tokens = int(os.getenv("LLM_MAX_TOKENS", "5000"))
        except ValueError as e:
            raise RuntimeError(
                f"LLM_MAX_TOKENS must be an integer, got {os.getenv('LLM_MAX_TOKENS')!r}"
            ) from e
        return cls(
            neo4j_uri=required["NEO4J_URI"],
            neo4j_user=required["NEO4J_USER"],
            neo4j_password=required["NEO4J_PASSWORD"],
            openrouter_api_key=required["OPENROUTER_API_KEY"],
            openrouter_api_base=required["OPENROUTER_API_BASE"],
            chat_model=required["CHAT_MODEL"],
            chat_small_model=required["CHAT_SMALL_MODEL"],
            embedding_model=required["EMBEDDING_MODEL"],
            embedding_dim=embedding_dim,
            llm_max_tokens=llm_max_tokens,
        )
