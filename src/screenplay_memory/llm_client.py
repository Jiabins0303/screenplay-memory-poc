"""SmartModelClient — routes ModelSize.small calls to the configured small_model.

OpenAIGenericClient in graphiti-core v0.28.x ignores ``small_model``,
always using ``self.model``.  This subclass selects the model based on
``model_size`` and records token usage via ``self.token_tracker``.
"""

from __future__ import annotations

import json
import logging
import typing
from typing import Any

import openai
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel

from graphiti_core.llm_client.config import DEFAULT_MAX_TOKENS, ModelSize
from graphiti_core.llm_client.errors import RateLimitError
from graphiti_core.llm_client.openai_generic_client import (
    DEFAULT_MODEL,
    OpenAIGenericClient,
)
from graphiti_core.prompts.models import Message

logger = logging.getLogger(__name__)


class SmartModelClient(OpenAIGenericClient):
    """OpenAIGenericClient that honours ``small_model``."""

    def _get_model_for_size(self, model_size: ModelSize) -> str:
        if model_size == ModelSize.small and self.small_model:
            return self.small_model
        return self.model or DEFAULT_MODEL

    async def _generate_response(
        self,
        messages: list[Message],
        response_model: type[BaseModel] | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        model_size: ModelSize = ModelSize.medium,
    ) -> dict[str, typing.Any]:
        openai_messages: list[ChatCompletionMessageParam] = []
        for m in messages:
            m.content = self._clean_input(m.content)
            if m.role == "user":
                openai_messages.append({"role": "user", "content": m.content})
            elif m.role == "system":
                openai_messages.append({"role": "system", "content": m.content})

        try:
            response_format: dict[str, Any] = {"type": "json_object"}
            if response_model is not None:
                schema_name = getattr(response_model, "__name__", "structured_response")
                json_schema = response_model.model_json_schema()
                response_format = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": schema_name,
                        "schema": json_schema,
                    },
                }

            model = self._get_model_for_size(model_size)

            response = await self.client.chat.completions.create(
                model=model,
                messages=openai_messages,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                response_format=response_format,  # type: ignore[arg-type]
            )

            input_tokens = 0
            output_tokens = 0
            if hasattr(response, "usage") and response.usage:
                input_tokens = getattr(response.usage, "prompt_tokens", 0) or 0
                output_tokens = getattr(response.usage, "completion_tokens", 0) or 0
            self.token_tracker.record(None, input_tokens, output_tokens)

            if logger.isEnabledFor(logging.DEBUG):
                logger.debug(
                    "LLM %s [%s] → %d in / %d out tokens",
                    model,
                    model_size.value,
                    input_tokens,
                    output_tokens,
                )

            result = response.choices[0].message.content or ""
            return json.loads(result)
        except openai.RateLimitError as e:
            raise RateLimitError from e
        except Exception as e:
            logger.error(f"Error in generating LLM response: {e}")
            raise
