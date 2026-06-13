#!/usr/bin/env python3
"""
PayStream Harness — ADR Reviewer
Sensor: reads a PR diff, loads all ADRs as context,
calls an LLM via LiteLLM (model-agnostic), and outputs
a structured violation report.

Model is selected via REVIEW_MODEL environment variable.
See ADR-007 for the rationale behind this design.

Usage:
    REVIEW_MODEL=groq/llama-3.3-70b-versatile  python adr_reviewer.py --diff pr.diff
    REVIEW_MODEL=anthropic/claude-haiku-4-5    python adr_reviewer.py --diff pr.diff
    REVIEW_MODEL=openai/gpt-4o-mini            python adr_reviewer.py --diff pr.diff
    REVIEW_MODEL=ollama/qwen2.5-coder          python adr_reviewer.py --diff pr.diff
"""

import argparse
import json
import os
import sys
from pathlib import Path

# ── ANSI colors ────────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

# ── ADR loading ────────────────────────────────────────────────────────────────

def load_adrs(repo_root: Path) -> str:
    """Load all ADR files and return them as a single context block."""
    adrs_dir = repo_root / "docs" / "adrs"
    if not adrs_dir.exists():
        print(f"{RED}ERROR: docs/adrs/ not found at {adrs_dir}{RESET}", file=sys.stderr)
        sys.exit(1)

    adr_files = sorted(adrs_dir.glob("ADR-*.md"))
    if not adr_files:
        print(f"{RED}ERROR: No ADR files found in {adrs_dir}{RESET}", file=sys.stderr)
        sys.exit(1)

    parts = []
    for f in adr_files:
        content = f.read_text(encoding="utf-8")
        parts.append(f"### {f.name}\n\n{content}")

    print(f"{BLUE}  Loaded {len(adr_files)} ADRs as context{RESET}")
    return "\n\n---\n\n".join(parts)


def load_diff(diff_path: str) -> str:
    """Load the PR diff from a file or stdin."""
    if diff_path == "-":
        diff = sys.stdin.read()
    else:
        path = Path(diff_path)
        if not path.exists():
            print(f"{RED}ERROR: Diff file not found: {diff_path}{RESET}", file=sys.stderr)
            sys.exit(1)
        diff = path.read_text(encoding="utf-8")

    if not diff.strip():
        print(f"{YELLOW}WARNING: Diff is empty — nothing to review{RESET}")
        sys.exit(0)

    return diff


# ── Prompt ─────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are the PayStream Architecture Governance Agent.

Your job is to review Pull Request diffs against a set of Architecture Decision Records (ADRs).
You enforce architectural consistency — not code style, not formatting, not performance.

## Your responsibilities

1. Read each ADR carefully to understand the decision and its constraints.
2. Analyze the diff for violations of those decisions.
3. Report ONLY actual violations — not warnings, not suggestions, not style feedback.
4. If there are no violations, say so clearly.

## Violation criteria

A violation occurs when code in the diff:
- Uses a pattern explicitly rejected by an ADR (e.g., DynamoDB Scan when ADR-006 mandates GSI)
- Bypasses a constraint documented as a hard rule (e.g., client-supplied transaction ID when ADR-004 mandates server-side generation)
- Introduces a dependency or pattern that contradicts a documented decision (e.g., UUID when ADR-004 mandates ULID)

## What is NOT a violation

- Using a pattern not mentioned in any ADR
- Code style differences
- Performance concerns not related to an ADR constraint
- Test coverage gaps (unless an ADR specifically requires tests)

## Output format

Respond ONLY with valid JSON. No markdown, no preamble, no explanation outside the JSON.

{
  "has_violations": true | false,
  "violations": [
    {
      "adr": "ADR-XXX",
      "adr_title": "Short title of the ADR",
      "severity": "critical" | "warning",
      "file": "path/to/file.ts",
      "line_hint": "approximate line or code snippet from the diff",
      "description": "Clear explanation of what rule was violated",
      "fix": "Concrete suggestion for how to fix it"
    }
  ],
  "summary": "One sentence summary of the review result"
}

If has_violations is false, violations must be an empty array [].
"""

def build_user_prompt(adrs_context: str, diff: str) -> str:
    return f"""## Architecture Decision Records

{adrs_context}

---

## Pull Request Diff

```diff
{diff}
```

Review this diff against the ADRs above. Report any violations in the JSON format specified.
"""


# ── LLM call ──────────────────────────────────────────────────────────────────

def call_llm(system_prompt: str, user_prompt: str, model: str) -> str:
    """Call the LLM via LiteLLM. Model-agnostic per ADR-007."""
    try:
        from litellm import completion
    except ImportError:
        print(f"{RED}ERROR: litellm not installed. Run: pip install litellm{RESET}", file=sys.stderr)
        sys.exit(1)

    print(f"{BLUE}  Calling LLM: {model}{RESET}")

    try:
        response = completion(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            max_tokens=2000,
            temperature=0.1,
        )
        return response.choices[0].message.content

    except Exception as e:
        print(f"{RED}ERROR: LLM call failed: {e}{RESET}", file=sys.stderr)
        sys.exit(1)


# ── Output ─────────────────────────────────────────────────────────────────────

def parse_response(raw: str) -> dict:
    """Parse the LLM JSON response, stripping markdown fences if present."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        cleaned = "\n".join(lines[1:-1]) if lines[-1] == "```" else "\n".join(lines[1:])
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        print(f"{RED}ERROR: Failed to parse LLM response as JSON: {e}{RESET}", file=sys.stderr)
        print(f"Raw response:\n{raw}", file=sys.stderr)
        sys.exit(1)


def format_report(result: dict) -> str:
    """Format the violation report for GitHub PR comment and terminal output."""
    lines = []

    if not result.get("has_violations"):
        lines.append("## ✅ ADR Review — No Violations")
        lines.append("")
        lines.append(result.get("summary", "No architectural violations detected."))
        lines.append("")
        lines.append("---")
        lines.append("*PayStream ADR Governance Agent — model-agnostic via LiteLLM*")
        return "\n".join(lines)

    violations = result.get("violations", [])
    lines.append(f"## ❌ ADR Review — {len(violations)} Violation(s) Found")
    lines.append("")
    lines.append(result.get("summary", ""))
    lines.append("")

    for i, v in enumerate(violations, 1):
        severity_icon = "🔴" if v.get("severity") == "critical" else "🟡"
        lines.append(f"### {severity_icon} Violation {i} — {v.get('adr')} · {v.get('adr_title', '')}")
        lines.append("")
        lines.append(f"**File:** `{v.get('file', 'unknown')}`")
        if v.get("line_hint"):
            lines.append(f"**Code:** `{v.get('line_hint')}`")
        lines.append("")
        lines.append(f"**Violation:** {v.get('description', '')}")
        lines.append("")
        lines.append(f"**Fix:** {v.get('fix', '')}")
        lines.append("")

    lines.append("---")
    lines.append("*PayStream ADR Governance Agent — model-agnostic via LiteLLM*")
    lines.append("*To suppress a violation, update the relevant ADR first.*")
    return "\n".join(lines)


def print_terminal_summary(result: dict) -> None:
    """Print a colored terminal summary."""
    print()
    if not result.get("has_violations"):
        print(f"{GREEN}{BOLD}  ✅ No ADR violations found{RESET}")
    else:
        violations = result.get("violations", [])
        critical = [v for v in violations if v.get("severity") == "critical"]
        warnings  = [v for v in violations if v.get("severity") == "warning"]
        print(f"{RED}{BOLD}  ❌ {len(violations)} violation(s): "
              f"{len(critical)} critical, {len(warnings)} warning(s){RESET}")
        for v in violations:
            icon = "🔴" if v.get("severity") == "critical" else "🟡"
            print(f"     {icon} {v.get('adr')} — {v.get('file', '?')} — {v.get('description', '')[:80]}")
    print()


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="PayStream ADR Reviewer — checks PR diffs against architectural decisions"
    )
    parser.add_argument(
        "--diff",
        required=True,
        help="Path to the git diff file, or '-' to read from stdin",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Optional path to write the markdown report (for GitHub Actions step output)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print raw JSON result to stdout instead of formatted report",
    )
    parser.add_argument(
        "--json-output",
        default=None,
        dest="json_output",
        help="Optional path to write the raw JSON result (avoids second LLM call in CI)",
    )
    args = parser.parse_args()

    # ── Model ──────────────────────────────────────────────────────────────────
    model = os.environ.get("REVIEW_MODEL")
    if not model:
        print(f"{RED}ERROR: REVIEW_MODEL environment variable is not set.{RESET}", file=sys.stderr)
        print("  Examples:", file=sys.stderr)
        print("    REVIEW_MODEL=groq/llama-3.3-70b-versatile  (free, no credit card)", file=sys.stderr)
        print("    REVIEW_MODEL=anthropic/claude-haiku-4-5", file=sys.stderr)
        print("    REVIEW_MODEL=openai/gpt-4o-mini", file=sys.stderr)
        print("    REVIEW_MODEL=ollama/qwen2.5-coder          (local, no API cost)", file=sys.stderr)
        sys.exit(1)

    # ── Repo root ──────────────────────────────────────────────────────────────
    script_dir = Path(__file__).resolve().parent
    repo_root  = script_dir.parent.parent

    print(f"\n{BOLD}{'─' * 56}{RESET}")
    print(f"{BOLD}  PayStream ADR Reviewer{RESET}")
    print(f"{BOLD}{'─' * 56}{RESET}")
    print(f"  Model:     {model}")
    print(f"  Diff:      {args.diff}")
    print(f"  Repo root: {repo_root}")

    # ── Load inputs ────────────────────────────────────────────────────────────
    print(f"\n{BOLD}Loading context...{RESET}")
    adrs_context = load_adrs(repo_root)
    diff         = load_diff(args.diff)

    print(f"  Diff size: {len(diff):,} chars")

    # ── Call LLM (once) ────────────────────────────────────────────────────────
    print(f"\n{BOLD}Reviewing diff...{RESET}")
    user_prompt  = build_user_prompt(adrs_context, diff)
    raw_response = call_llm(SYSTEM_PROMPT, user_prompt, model)

    # ── Parse and format ───────────────────────────────────────────────────────
    result = parse_response(raw_response)
    report = format_report(result)

    print_terminal_summary(result)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(report)

    if args.output:
        Path(args.output).write_text(report, encoding="utf-8")
        print(f"{BLUE}  Report written to: {args.output}{RESET}")

    if args.json_output:
        Path(args.json_output).write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"{BLUE}  JSON written to: {args.json_output}{RESET}")

    # ── Exit code ──────────────────────────────────────────────────────────────
    has_critical = any(
        v.get("severity") == "critical"
        for v in result.get("violations", [])
    )
    return 1 if has_critical else 0


if __name__ == "__main__":
    sys.exit(main())