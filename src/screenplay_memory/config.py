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

    qwen_api_key: str
    qwen_api_base: str
    qwen_model: str
    qwen_small_model: str

    embedding_api_key: str
    embedding_api_base: str
    embedding_model: str
    embedding_dim: int = 1024  # DashScope text-embedding-v3

    @classmethod
    def from_env(cls) -> "Settings":
        required = {
            "NEO4J_URI": os.getenv("NEO4J_URI", "bolt://localhost:7687"),
            "NEO4J_USER": os.getenv("NEO4J_USER", "neo4j"),
            "NEO4J_PASSWORD": os.getenv("NEO4J_PASSWORD", "testpassword"),
            "QWEN_API_KEY": os.getenv("QWEN_API_KEY"),
            "QWEN_API_BASE": os.getenv(
                "QWEN_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1"
            ),
            "QWEN_MODEL": os.getenv("QWEN_MODEL", "qwen2.5-72b-instruct"),
            "QWEN_SMALL_MODEL": os.getenv("QWEN_SMALL_MODEL", "qwen2.5-7b-instruct"),
            "EMBEDDING_API_KEY": os.getenv("EMBEDDING_API_KEY") or os.getenv("QWEN_API_KEY"),
            "EMBEDDING_API_BASE": os.getenv(
                "EMBEDDING_API_BASE",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            "EMBEDDING_MODEL": os.getenv("EMBEDDING_MODEL", "text-embedding-v3"),
        }
        missing = [k for k, v in required.items() if not v]
        if missing:
            raise RuntimeError(
                f"Missing required env vars: {missing}. Copy .env.example to .env."
            )
        return cls(
            neo4j_uri=required["NEO4J_URI"],
            neo4j_user=required["NEO4J_USER"],
            neo4j_password=required["NEO4J_PASSWORD"],
            qwen_api_key=required["QWEN_API_KEY"],
            qwen_api_base=required["QWEN_API_BASE"],
            qwen_model=required["QWEN_MODEL"],
            qwen_small_model=required["QWEN_SMALL_MODEL"],
            embedding_api_key=required["EMBEDDING_API_KEY"],
            embedding_api_base=required["EMBEDDING_API_BASE"],
            embedding_model=required["EMBEDDING_MODEL"],
        )
