# ADR-007: Model-Agnostic AI Integration via LiteLLM

**Status**: Accepted  
**Date**: 2026-06

## Context

PayStream's governance layer includes an automated ADR reviewer that runs on every Pull Request. The reviewer calls an LLM to analyze code diffs against the project's ADRs and report violations.

The first implementation decision: which LLM provider to hardcode?

The answer: none.

## Decision

Use **LiteLLM** as a provider-agnostic abstraction layer. The target model is configured via the `REVIEW_MODEL` environment variable, not hardcoded in the reviewer script.

```python
# The reviewer script never imports anthropic, openai, or google directly
from litellm import completion

response = completion(
    model=os.environ["REVIEW_MODEL"],
    messages=[{"role": "user", "content": prompt}]
)
```

The GitHub Actions workflow injects `REVIEW_MODEL` as a repository secret. Changing providers requires updating one secret — no code changes.

## Rationale

**Vendor lock-in is an architectural risk.** Hardcoding `anthropic/claude-haiku-4-5` means the reviewer breaks if Anthropic changes pricing, deprecates the model, or experiences downtime. Payment pipelines need resilient tooling.

**Cost optimization over time.** The best price/performance model changes every few months. A model-agnostic interface means we can switch to a cheaper or faster model without touching the reviewer logic.

**Local development without API costs.** With `REVIEW_MODEL=ollama/qwen2.5-coder`, the reviewer runs entirely locally via Ollama — zero API cost during development and testing.

**Demonstrated architectural thinking.** Abstracting over LLM providers follows the same principle as abstracting over cloud providers: depend on interfaces, not implementations. This is the same reason we use CDK instead of raw CloudFormation.

## Supported configurations

```bash
# Production (fast, cheap)
REVIEW_MODEL=anthropic/claude-haiku-4-5

# Alternative providers, zero code changes
REVIEW_MODEL=openai/gpt-4o-mini
REVIEW_MODEL=google/gemini-flash-1.5
REVIEW_MODEL=mistral/mistral-small

# Local development, no API cost
REVIEW_MODEL=ollama/qwen2.5-coder
```

## Tradeoff

LiteLLM adds a dependency and a thin abstraction layer. For a reviewer script that runs in GitHub Actions, the added ~200ms cold start from LiteLLM initialization is irrelevant. The portability benefit far outweighs the overhead.

LiteLLM normalizes provider APIs but does not normalize model behavior — a prompt tuned for Claude may produce different output quality on GPT-4o-mini. The reviewer prompt should be tested against the target model before changing providers in production.
