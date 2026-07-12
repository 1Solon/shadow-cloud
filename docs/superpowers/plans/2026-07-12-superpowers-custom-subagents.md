# Superpowers Custom Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install four personal Codex subagents that implement the exploration, implementation, specification-review, and quality-review phases of the Superpowers workflow.

**Architecture:** Each role is a standalone TOML configuration layer under `C:\Users\Solon\.codex\agents`. Read-only roles pin a read-only sandbox; the implementer inherits the parent runtime permissions. The parent thread retains design, orchestration, integration, and final-verification ownership.

**Tech Stack:** Codex custom-agent TOML, PowerShell 7, Python 3 `tomllib`, Codex CLI

---

## File Structure

- Create: `C:\Users\Solon\.codex\agents\superpowers-explorer.toml` — read-only evidence gathering and code-path mapping.
- Create: `C:\Users\Solon\.codex\agents\superpowers-implementer.toml` — one-task TDD implementation and focused verification.
- Create: `C:\Users\Solon\.codex\agents\superpowers-spec-reviewer.toml` — independent requirements-compliance review.
- Create: `C:\Users\Solon\.codex\agents\superpowers-quality-reviewer.toml` — independent correctness and maintainability review.

The personal agent files live outside any Git repository, so installation tasks do not include commits. Do not modify `C:\Users\Solon\.codex\config.toml` or add project-local `.codex` files.

### Task 1: Confirm a Safe Installation Target

**Files:**
- Inspect: `C:\Users\Solon\.codex\agents\`
- Preserve: `C:\Users\Solon\.codex\config.toml`

- [ ] **Step 1: Check the personal agent directory and target-name collisions**

Run:

```powershell
$agentRoot = Join-Path $HOME '.codex\agents'
$targets = @(
  'superpowers-explorer.toml',
  'superpowers-implementer.toml',
  'superpowers-spec-reviewer.toml',
  'superpowers-quality-reviewer.toml'
)

"agentRoot=$agentRoot"
"directoryExists=$(Test-Path -LiteralPath $agentRoot)"
foreach ($target in $targets) {
  $path = Join-Path $agentRoot $target
  "$target=$(Test-Path -LiteralPath $path)"
}
```

Expected:

```text
agentRoot=C:\Users\Solon\.codex\agents
directoryExists=True
superpowers-explorer.toml=False
superpowers-implementer.toml=False
superpowers-spec-reviewer.toml=False
superpowers-quality-reviewer.toml=False
```

If any target reports `True`, stop and show its contents and diff to the user. Do not overwrite an existing personal agent without explicit approval.

- [ ] **Step 2: Record the existing global config hash**

Run:

```powershell
$configPath = Join-Path $HOME '.codex\config.toml'
Get-FileHash -Algorithm SHA256 -LiteralPath $configPath | Format-List Path, Hash
```

Expected: one SHA-256 hash for `C:\Users\Solon\.codex\config.toml`. Save the hash in the task notes for comparison after installation.

### Task 2: Install the Explorer Agent

**Files:**
- Create: `C:\Users\Solon\.codex\agents\superpowers-explorer.toml`

- [ ] **Step 1: Run the schema check before the file exists**

Run:

```powershell
@'
from pathlib import Path
path = Path.home() / ".codex" / "agents" / "superpowers-explorer.toml"
assert path.exists(), f"missing: {path}"
'@ | python -
```

Expected: FAIL with `AssertionError: missing:`.

- [ ] **Step 2: Create the explorer agent with `apply_patch`**

Create `C:\Users\Solon\.codex\agents\superpowers-explorer.toml` with this exact content:

```toml
name = "superpowers_explorer"
description = "Read-only explorer for gathering codebase evidence before a Superpowers implementation task begins."
model = "gpt-5.6-terra"
model_reasoning_effort = "medium"
sandbox_mode = "read-only"

developer_instructions = """
Handle one bounded exploration task from the parent agent.

Trace the relevant execution path, tests, constraints, and repository instructions. Prefer targeted searches and file reads. Separate verified facts from uncertainties, and cite concrete files and symbols in the result.

Do not edit files, design the feature, produce an implementation plan, or propose changes beyond the question asked. Do not spawn subagents. If the request is ambiguous or evidence is missing, report the gap to the parent instead of guessing.
"""
```

- [ ] **Step 3: Parse and validate the explorer agent**

Run:

```powershell
@'
from pathlib import Path
import tomllib

path = Path.home() / ".codex" / "agents" / "superpowers-explorer.toml"
with path.open("rb") as handle:
    data = tomllib.load(handle)

assert data["name"] == "superpowers_explorer"
assert data["model"] == "gpt-5.6-terra"
assert data["model_reasoning_effort"] == "medium"
assert data["sandbox_mode"] == "read-only"
assert data["description"].strip()
assert data["developer_instructions"].strip()
print("explorer: valid")
'@ | python -
```

Expected: `explorer: valid`.

### Task 3: Install the Implementer Agent

**Files:**
- Create: `C:\Users\Solon\.codex\agents\superpowers-implementer.toml`

- [ ] **Step 1: Run the schema check before the file exists**

Run:

```powershell
@'
from pathlib import Path
path = Path.home() / ".codex" / "agents" / "superpowers-implementer.toml"
assert path.exists(), f"missing: {path}"
'@ | python -
```

Expected: FAIL with `AssertionError: missing:`.

- [ ] **Step 2: Create the implementer agent with `apply_patch`**

Create `C:\Users\Solon\.codex\agents\superpowers-implementer.toml` with this exact content:

```toml
name = "superpowers_implementer"
description = "Implementation worker for one approved Superpowers plan task using TDD and focused verification."
model = "gpt-5.6-sol"
model_reasoning_effort = "high"

developer_instructions = """
Execute exactly one bounded task from an approved implementation plan. The parent agent owns design, sequencing, integration, and final acceptance.

For a feature or bug fix, load and follow the test-driven-development skill before changing implementation code. Follow red-green-refactor: add the focused failing test, confirm the expected failure, make the smallest implementation change, and confirm the test passes. Before reporting success, load and follow verification-before-completion and run the checks proportionate to the assigned task.

Keep unrelated files untouched. Do not broaden scope, alter requirements, commit, push, change permissions, or spawn subagents unless the parent explicitly authorizes that action. Stop and report conflicting requirements, unresolved ambiguity, or unrelated test failures instead of guessing.

Return a concise summary of changed files, test evidence, and any remaining risks.
"""
```

Do not set `sandbox_mode`; the implementer must inherit the parent session's live permissions.

- [ ] **Step 3: Parse and validate the implementer agent**

Run:

```powershell
@'
from pathlib import Path
import tomllib

path = Path.home() / ".codex" / "agents" / "superpowers-implementer.toml"
with path.open("rb") as handle:
    data = tomllib.load(handle)

assert data["name"] == "superpowers_implementer"
assert data["model"] == "gpt-5.6-sol"
assert data["model_reasoning_effort"] == "high"
assert "sandbox_mode" not in data
assert "test-driven-development" in data["developer_instructions"]
assert "verification-before-completion" in data["developer_instructions"]
print("implementer: valid")
'@ | python -
```

Expected: `implementer: valid`.

### Task 4: Install the Specification Reviewer Agent

**Files:**
- Create: `C:\Users\Solon\.codex\agents\superpowers-spec-reviewer.toml`

- [ ] **Step 1: Run the schema check before the file exists**

Run:

```powershell
@'
from pathlib import Path
path = Path.home() / ".codex" / "agents" / "superpowers-spec-reviewer.toml"
assert path.exists(), f"missing: {path}"
'@ | python -
```

Expected: FAIL with `AssertionError: missing:`.

- [ ] **Step 2: Create the specification reviewer with `apply_patch`**

Create `C:\Users\Solon\.codex\agents\superpowers-spec-reviewer.toml` with this exact content:

```toml
name = "superpowers_spec_reviewer"
description = "Independent read-only reviewer that checks implementation against an approved specification and plan task."
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
sandbox_mode = "read-only"

developer_instructions = """
Review one completed implementation task for compliance with the approved specification and assigned plan task. Inspect the actual implementation and tests; do not rely only on the implementer's summary.

Return either APPROVED or a list of exact requirement deviations with concrete file and symbol evidence. Check for missing requirements, extra unapproved behavior, and incorrect interpretation. Avoid general style, maintainability, or optimization commentary unless it directly violates an approved requirement.

Do not edit files, fix findings, commit, change permissions, or spawn subagents. If requirements or evidence are incomplete, state exactly what the parent must provide instead of assuming compliance.
"""
```

- [ ] **Step 3: Parse and validate the specification reviewer**

Run:

```powershell
@'
from pathlib import Path
import tomllib

path = Path.home() / ".codex" / "agents" / "superpowers-spec-reviewer.toml"
with path.open("rb") as handle:
    data = tomllib.load(handle)

assert data["name"] == "superpowers_spec_reviewer"
assert data["model"] == "gpt-5.6-sol"
assert data["model_reasoning_effort"] == "high"
assert data["sandbox_mode"] == "read-only"
assert "APPROVED" in data["developer_instructions"]
print("spec reviewer: valid")
'@ | python -
```

Expected: `spec reviewer: valid`.

### Task 5: Install the Quality Reviewer Agent

**Files:**
- Create: `C:\Users\Solon\.codex\agents\superpowers-quality-reviewer.toml`

- [ ] **Step 1: Run the schema check before the file exists**

Run:

```powershell
@'
from pathlib import Path
path = Path.home() / ".codex" / "agents" / "superpowers-quality-reviewer.toml"
assert path.exists(), f"missing: {path}"
'@ | python -
```

Expected: FAIL with `AssertionError: missing:`.

- [ ] **Step 2: Create the quality reviewer with `apply_patch`**

Create `C:\Users\Solon\.codex\agents\superpowers-quality-reviewer.toml` with this exact content:

```toml
name = "superpowers_quality_reviewer"
description = "Independent read-only reviewer for correctness, regressions, maintainability, and test quality after spec approval."
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
sandbox_mode = "read-only"

developer_instructions = """
Review one implementation task only after the parent confirms specification compliance. Inspect the actual diff, surrounding code, repository instructions, and relevant tests.

Look for correctness defects, behavioral regressions, unsafe assumptions, missing edge cases, weak tests, and unnecessary complexity. Report only actionable findings, ordered by severity, with concrete file and symbol references and a concise explanation of impact. If there are no material findings, return APPROVED.

Do not edit files, fix findings, repeat resolved specification issues, commit, change permissions, or spawn subagents. Distinguish verified defects from questions that need more evidence.
"""
```

- [ ] **Step 3: Parse and validate the quality reviewer**

Run:

```powershell
@'
from pathlib import Path
import tomllib

path = Path.home() / ".codex" / "agents" / "superpowers-quality-reviewer.toml"
with path.open("rb") as handle:
    data = tomllib.load(handle)

assert data["name"] == "superpowers_quality_reviewer"
assert data["model"] == "gpt-5.6-sol"
assert data["model_reasoning_effort"] == "high"
assert data["sandbox_mode"] == "read-only"
assert "ordered by severity" in data["developer_instructions"]
print("quality reviewer: valid")
'@ | python -
```

Expected: `quality reviewer: valid`.

### Task 6: Validate the Complete Agent Set and Codex Discovery

**Files:**
- Verify: `C:\Users\Solon\.codex\agents\superpowers-explorer.toml`
- Verify: `C:\Users\Solon\.codex\agents\superpowers-implementer.toml`
- Verify: `C:\Users\Solon\.codex\agents\superpowers-spec-reviewer.toml`
- Verify: `C:\Users\Solon\.codex\agents\superpowers-quality-reviewer.toml`
- Preserve: `C:\Users\Solon\.codex\config.toml`

- [ ] **Step 1: Run the aggregate schema and responsibility check**

Run:

```powershell
@'
from pathlib import Path
import tomllib

root = Path.home() / ".codex" / "agents"
expected = {
    "superpowers-explorer.toml": ("superpowers_explorer", "gpt-5.6-terra", "medium", "read-only"),
    "superpowers-implementer.toml": ("superpowers_implementer", "gpt-5.6-sol", "high", None),
    "superpowers-spec-reviewer.toml": ("superpowers_spec_reviewer", "gpt-5.6-sol", "high", "read-only"),
    "superpowers-quality-reviewer.toml": ("superpowers_quality_reviewer", "gpt-5.6-sol", "high", "read-only"),
}

loaded = {}
for filename, values in expected.items():
    with (root / filename).open("rb") as handle:
        data = tomllib.load(handle)
    name, model, effort, sandbox = values
    assert data["name"] == name
    assert data["model"] == model
    assert data["model_reasoning_effort"] == effort
    assert data.get("sandbox_mode") == sandbox
    assert data["description"].strip()
    assert data["developer_instructions"].strip()
    assert "Do not" in data["developer_instructions"]
    assert name not in loaded
    loaded[name] = filename

assert "test-driven-development" in tomllib.loads(
    (root / "superpowers-implementer.toml").read_text(encoding="utf-8")
)["developer_instructions"]
print("agent set: valid")
print("names:", ", ".join(sorted(loaded)))
'@ | python -
```

Expected:

```text
agent set: valid
names: superpowers_explorer, superpowers_implementer, superpowers_quality_reviewer, superpowers_spec_reviewer
```

- [ ] **Step 2: Confirm model and reasoning availability in the installed Codex catalog**

Run:

```powershell
$catalog = codex debug models | ConvertFrom-Json
$required = @{
  'gpt-5.6-terra' = 'medium'
  'gpt-5.6-sol' = 'high'
}

foreach ($slug in $required.Keys) {
  $model = $catalog.models | Where-Object slug -EQ $slug
  if (-not $model) { throw "missing model: $slug" }
  $efforts = $model.supported_reasoning_levels.effort
  if ($required[$slug] -notin $efforts) { throw "$slug does not support $($required[$slug])" }
  "$slug=$($required[$slug])"
}
```

Expected output includes:

```text
gpt-5.6-terra=medium
gpt-5.6-sol=high
```

- [ ] **Step 3: Confirm strict Codex configuration loading**

Run:

```powershell
codex --strict-config debug prompt-input "Report the custom subagent roles available for delegation." | Out-File -Encoding utf8 "$env:TEMP\superpowers-agent-prompt.json"
Get-Content -Raw "$env:TEMP\superpowers-agent-prompt.json" | Select-String -Pattern 'superpowers_explorer|superpowers_implementer|superpowers_spec_reviewer|superpowers_quality_reviewer' -AllMatches
```

Expected: the first command exits successfully with no strict-config error, and the second command finds all four role names in the fresh model-visible configuration. If strict loading succeeds but the debug output does not expose agent metadata, open a fresh Codex session and request: `List the custom subagent roles available for delegation without spawning them.` Do not run an agent task merely to test discovery.

- [ ] **Step 4: Verify the explorer remains read-only when selected**

In a fresh Codex session rooted at this repository, request:

```text
Spawn the superpowers_explorer agent. Ask it to inspect this repository and then attempt to create `.tmp/explorer-write-sentinel.txt`. It must report the sandbox denial and make no changes. Wait for its result.
```

Expected: the explorer can read repository files, the write attempt is denied, and `.tmp/explorer-write-sentinel.txt` does not exist. If the file exists, stop and remove it only after reporting that the read-only invariant failed.

- [ ] **Step 5: Confirm the global config was not modified**

Run:

```powershell
$configPath = Join-Path $HOME '.codex\config.toml'
Get-FileHash -Algorithm SHA256 -LiteralPath $configPath | Format-List Path, Hash
```

Expected: the SHA-256 hash exactly matches the value recorded in Task 1.

- [ ] **Step 6: Report the installed roles and restart boundary**

Report:

```text
Installed personal Codex agents:
- superpowers_explorer: gpt-5.6-terra / medium / read-only
- superpowers_implementer: gpt-5.6-sol / high / parent permissions
- superpowers_spec_reviewer: gpt-5.6-sol / high / read-only
- superpowers_quality_reviewer: gpt-5.6-sol / high / read-only

Validation: all TOML files parsed, strict Codex config loading succeeded, and config.toml was unchanged.
Open a fresh Codex thread before relying on the new agent catalog.
```
