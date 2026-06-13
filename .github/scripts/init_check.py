#!/usr/bin/env python3
"""
PayStream Harness — Init Check
Precondition sensor: verifies the repo is in a valid state before
the ADR reviewer calls the LLM. Fails fast with a clear error.
"""

import os
import sys
from pathlib import Path

# ── ANSI colors ────────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg: str)   -> None: print(f"{GREEN}  ✅ {msg}{RESET}")
def fail(msg: str) -> None: print(f"{RED}  ❌ {msg}{RESET}")
def warn(msg: str) -> None: print(f"{YELLOW}  ⚠️  {msg}{RESET}")
def header(msg: str) -> None: print(f"\n{BOLD}{msg}{RESET}")

# ── Checks ─────────────────────────────────────────────────────────────────────

def check_required_files(root: Path) -> list[str]:
    """Verify that the harness constitution files exist."""
    errors = []
    required = [
        "AGENTS.md",
        "CLAUDE.md",
        "README.md",
    ]
    for f in required:
        path = root / f
        if path.exists():
            ok(f"{f} exists")
        else:
            fail(f"{f} is missing — harness constitution incomplete")
            errors.append(f"Missing required file: {f}")
    return errors


def check_adrs(root: Path) -> list[str]:
    """Verify that all 7 ADRs exist and are non-empty."""
    errors = []
    adrs_dir = root / "docs" / "adrs"

    expected_adrs = [
        "ADR-001-event-driven-architecture.md",
        "ADR-002-kinesis-over-sqs.md",
        "ADR-003-dynamodb-over-relational.md",
        "ADR-004-ulid-over-uuid.md",
        "ADR-005-explicit-dlq-strategy.md",
        "ADR-006-gsi-access-pattern.md",
        "ADR-007-model-agnostic-ai.md",
    ]

    if not adrs_dir.exists():
        fail(f"docs/adrs/ directory not found")
        errors.append("Missing docs/adrs/ directory")
        return errors

    for adr in expected_adrs:
        path = adrs_dir / adr
        if not path.exists():
            fail(f"{adr} missing")
            errors.append(f"Missing ADR: {adr}")
        elif path.stat().st_size < 100:
            warn(f"{adr} exists but looks empty (< 100 bytes)")
        else:
            ok(f"{adr}")

    return errors


def check_lambda_structure(root: Path) -> list[str]:
    """Verify that all Lambda handlers exist."""
    errors = []
    lambdas = ["generator", "processor", "retrier", "query"]

    for fn in lambdas:
        handler = root / "lambda" / fn / "index.ts"
        if handler.exists():
            ok(f"lambda/{fn}/index.ts exists")
        else:
            fail(f"lambda/{fn}/index.ts missing")
            errors.append(f"Missing Lambda handler: lambda/{fn}/index.ts")

    return errors


def check_cdk_stack(root: Path) -> list[str]:
    """Verify CDK stack file exists."""
    errors = []
    stack = root / "lib" / "paystream-pipeline-stack.ts"
    if stack.exists():
        ok("lib/paystream-pipeline-stack.ts exists")
    else:
        fail("lib/paystream-pipeline-stack.ts missing — CDK stack not found")
        errors.append("Missing CDK stack file")
    return errors


def check_scripts(root: Path) -> list[str]:
    """Verify operational scripts exist."""
    errors = []
    scripts = [
        "scripts/localstack-start.sh",
        "scripts/load-test.sh",
        "scripts/dashboard.sh",
    ]
    for s in scripts:
        path = root / s
        if path.exists():
            ok(f"{s} exists")
        else:
            warn(f"{s} not found — operational script missing")
            # warn only, not hard error — scripts may be renamed
    return errors


def check_reviewer_dependencies() -> list[str]:
    """Verify Python dependencies for the ADR reviewer are available."""
    errors = []
    try:
        import litellm  # noqa: F401
        ok("litellm is installed")
    except ImportError:
        fail("litellm not installed — run: pip install litellm")
        errors.append("Missing dependency: litellm")

    try:
        import requests  # noqa: F401
        ok("requests is installed")
    except ImportError:
        fail("requests not installed — run: pip install requests")
        errors.append("Missing dependency: requests")

    return errors


def check_env_vars() -> list[str]:
    """Verify required environment variables are set."""
    errors = []
    review_model = os.environ.get("REVIEW_MODEL")
    if review_model:
        ok(f"REVIEW_MODEL is set ({review_model})")
    else:
        fail("REVIEW_MODEL environment variable not set")
        errors.append("Missing env var: REVIEW_MODEL")

    # At least one API key must be present (or Ollama running)
    has_key = any([
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
        os.environ.get("GEMINI_API_KEY"),
        os.environ.get("GROQ_API_KEY"),
    ])

    model = review_model or ""
    if "ollama" in model.lower():
        ok("Model is Ollama — no API key required")
    elif has_key:
        # Show which provider is active
        provider = (
            "Anthropic" if os.environ.get("ANTHROPIC_API_KEY") else
            "Groq"      if os.environ.get("GROQ_API_KEY")      else
            "OpenAI"    if os.environ.get("OPENAI_API_KEY")     else
            "Gemini"
        )
        ok(f"API key found — provider: {provider}")
    else:
        fail("No LLM API key found (GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY)")
        errors.append("Missing LLM API key")

    return errors


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> int:
    # Determine repo root: two levels up from .github/scripts/
    script_dir = Path(__file__).resolve().parent
    root = script_dir.parent.parent

    print(f"\n{BOLD}{'─' * 56}{RESET}")
    print(f"{BOLD}  PayStream Harness — Init Check{RESET}")
    print(f"{BOLD}{'─' * 56}{RESET}")
    print(f"  Repo root: {root}\n")

    all_errors: list[str] = []

    header("1. Harness constitution files")
    all_errors += check_required_files(root)

    header("2. Architecture Decision Records")
    all_errors += check_adrs(root)

    header("3. Lambda handlers")
    all_errors += check_lambda_structure(root)

    header("4. CDK stack")
    all_errors += check_cdk_stack(root)

    header("5. Operational scripts")
    all_errors += check_scripts(root)

    header("6. Python dependencies")
    all_errors += check_reviewer_dependencies()

    header("7. Environment variables")
    all_errors += check_env_vars()

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n{BOLD}{'─' * 56}{RESET}")
    if all_errors:
        print(f"{RED}{BOLD}  ❌ Init check FAILED — {len(all_errors)} error(s){RESET}")
        print(f"{BOLD}{'─' * 56}{RESET}\n")
        for e in all_errors:
            print(f"  • {e}")
        print()
        print("  Fix all errors above before running the ADR reviewer.")
        print(f"{BOLD}{'─' * 56}{RESET}\n")
        return 1
    else:
        print(f"{GREEN}{BOLD}  ✅ All checks passed — harness is ready{RESET}")
        print(f"{BOLD}{'─' * 56}{RESET}\n")
        return 0


if __name__ == "__main__":
    sys.exit(main())