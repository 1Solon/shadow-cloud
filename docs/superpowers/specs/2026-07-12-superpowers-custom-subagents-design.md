# Superpowers Custom Subagents Design

## Goal

Define a focused set of personal Codex subagents that support the Superpowers development workflow across repositories. The agents should provide balanced speed and quality, preserve independent review, and keep lifecycle orchestration in the parent thread.

## Scope

Create four standalone custom-agent TOML files under the user's personal `~/.codex/agents/` directory:

- `superpowers-explorer.toml`
- `superpowers-implementer.toml`
- `superpowers-spec-reviewer.toml`
- `superpowers-quality-reviewer.toml`

Do not modify repository-specific Codex configuration, global concurrency settings, or the existing global `config.toml`. Do not add recursive delegation.

## Architecture

The parent agent owns the complete Superpowers lifecycle: brainstorming, design approval, implementation planning, task sequencing, review sequencing, and final integration. Custom subagents handle one bounded phase or task and return concise evidence to the parent.

This creates four clear boundaries:

1. Exploration gathers facts before changes are proposed.
2. Implementation executes one approved plan task with test-driven development.
3. Specification review verifies that the result matches the approved requirements.
4. Quality review evaluates the implementation only after specification compliance passes.

Agents must not spawn further subagents. They must not broaden their assigned task, commit, push, or change permissions unless the parent explicitly authorizes that action.

## Agent Definitions

### `superpowers_explorer`

- **Purpose:** Map relevant code, tests, constraints, and execution paths before implementation.
- **Model:** `gpt-5.6-terra`
- **Reasoning effort:** `medium`
- **Sandbox:** `read-only`
- **Behavior:** Prefer targeted searches and file reads. Separate verified facts from uncertainties. Cite concrete files and symbols. Do not edit files or propose implementation beyond the question asked.

The faster model is appropriate because this role is read-heavy and returns distilled findings rather than making final implementation decisions.

### `superpowers_implementer`

- **Purpose:** Execute one bounded task from an approved implementation plan.
- **Model:** `gpt-5.6-sol`
- **Reasoning effort:** `high`
- **Sandbox:** Inherit the parent session's permissions.
- **Behavior:** Load and follow the test-driven-development and verification-before-completion skills when applicable. Use red-green-refactor, keep changes within the assigned task, run focused verification, and report changed files and evidence. Stop and report conflicts, ambiguous requirements, or unrelated failures rather than guessing.

The implementer does not own design or integration decisions and must not commit unless explicitly instructed.

### `superpowers_spec_reviewer`

- **Purpose:** Verify implementation compliance with the approved specification and assigned plan task.
- **Model:** `gpt-5.6-sol`
- **Reasoning effort:** `high`
- **Sandbox:** `read-only`
- **Behavior:** Compare requirements against the actual implementation and tests. Return either approval or exact deviations with file-level evidence. Avoid maintainability and style feedback unless it represents a direct requirement violation.

This reviewer runs before the quality reviewer and remains independent from implementation.

### `superpowers_quality_reviewer`

- **Purpose:** Review correctness, regressions, maintainability, and test quality after specification compliance passes.
- **Model:** `gpt-5.6-sol`
- **Reasoning effort:** `high`
- **Sandbox:** `read-only`
- **Behavior:** Report only actionable findings, ordered by severity, with concrete file references and reasoning. Check edge cases, failure handling, test adequacy, and unnecessary complexity. Do not edit files or repeat already-resolved specification issues.

## Configuration Schema

Each standalone TOML file must define:

- `name`
- `description`
- `developer_instructions`

Each file also pins `model` and `model_reasoning_effort`. Read-only roles set `sandbox_mode = "read-only"`; the implementer omits `sandbox_mode` so the current parent permissions remain authoritative. Skills and MCP servers also inherit from the parent rather than embedding machine-specific paths.

Filenames should match the agent names using hyphens for readability, while the `name` field remains the source of truth used by Codex.

## Orchestration Contract

A parent task should provide every subagent with:

- One bounded objective
- Relevant approved requirements or plan-task text
- The expected output format
- Any files or test commands already known to be relevant
- Whether the parent will wait for other agents before continuing

The normal sequence is:

1. Dispatch the explorer when codebase context is incomplete.
2. Dispatch the implementer with one approved plan task.
3. Dispatch the spec reviewer against the resulting implementation.
4. Resolve specification deviations through a fresh implementer turn.
5. Dispatch the quality reviewer only after specification approval.
6. Resolve quality findings through a fresh implementer turn and repeat review as needed.

The parent integrates results, decides which findings are valid, and performs final whole-task verification.

## Failure Handling

- If an agent encounters conflicting requirements, it stops and reports the conflict.
- If verification fails for reasons outside the assigned task, the agent records the failure without expanding scope.
- If the configured model or reasoning level is unavailable, Codex should surface the spawn/configuration failure; the parent must not silently rewrite the agent profile.
- If a reviewer lacks enough evidence, it requests the missing input instead of assuming compliance or inventing a finding.
- Parent runtime permission overrides remain authoritative over custom-agent defaults.

## Verification

Implementation is complete when:

1. All four TOML files exist in `~/.codex/agents/`.
2. Each file parses as TOML and contains all required fields.
3. Model, reasoning, and sandbox values match this design.
4. The four instruction sets have no overlapping ownership or contradictory directives.
5. A fresh Codex session discovers the four custom-agent names.
6. A read-only agent can be selected without receiving write permissions.

Discovery verification may require starting a fresh Codex session because agent configuration is loaded by the client. It should avoid running an unnecessary paid task when listing or inspecting loaded agents is sufficient.

## Source Basis

OpenAI's Codex subagent documentation supports standalone personal agents under `~/.codex/agents/`, per-agent model and `model_reasoning_effort` settings, inherited configuration, read-only sandbox overrides, and narrow role definitions. It recommends the `gpt-5.6` family for demanding multi-step work and `gpt-5.6-terra` for fast read-heavy work, with `medium` as a balanced reasoning level and `high` for complex logic and edge cases. The installed Codex model catalog exposes the demanding model as `gpt-5.6-sol`, so the personal agent files pin that verified local slug rather than the generic family name used by the public guide.

Reference: [Codex subagents documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)
