"""Unit tests for SmartModelClient model routing."""

from graphiti_core.llm_client.config import LLMConfig, ModelSize

from screenplay_memory.llm_client import SmartModelClient


def test_routes_small_to_small_model():
    config = LLMConfig(api_key="test", model="big-model", small_model="small-model")
    client = SmartModelClient(config=config)
    assert client._get_model_for_size(ModelSize.small) == "small-model"
    assert client._get_model_for_size(ModelSize.medium) == "big-model"


def test_falls_back_when_small_model_unset():
    config = LLMConfig(api_key="test", model="big-model")
    client = SmartModelClient(config=config)
    assert client._get_model_for_size(ModelSize.small) == "big-model"
    assert client._get_model_for_size(ModelSize.medium) == "big-model"


def test_inherits_temperature():
    config = LLMConfig(api_key="test", model="m", temperature=0.2)
    client = SmartModelClient(config=config)
    assert client.temperature == 0.2
