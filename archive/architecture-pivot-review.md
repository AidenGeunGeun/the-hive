# Architecture Pivot Review Request

## Your Role

You are reviewing a proposed architectural pivot for The Hive, a multi-agent deliberation system. The system produces architectural proposals through structured discussion between LLM agents. No code is written until a human approves the output.

**Be adversarial.** Find what breaks. Find what we haven't thought of. Don't validate — interrogate.

## What Exists Today (Phases 0–5 complete, working e2e)

### Current Agent Model (WRONG — being replaced)

Agents are **single-shot completion calls.** The server pre-builds a static ContextBundle from curated documentation (AGENTS.md, architecture docs, etc.), injects it into a prompt, makes one API call via `pi-ai`'s `completeSimple()`, and parses a structured `submit_turn` tool call out of the response. The agent never sees the repo. It responds once and its turn is over.

Each turn produces a structured payload: a summary + ledger actions (create_issue, challenge, propose_resolution, etc.) + optional control actions. The room kernel iterates agents in round-robin, collecting these structured payloads. A "room conversation" is a sequence of structured tool calls, not natural discussion.

This was built on two assumptions:
1. Mini models (GPT-5.4 mini) are weak at long context, so we must pre-curate and minimize what they see
2. Agents should be sealed from the codebase — docs only, no file access

Both assumptions are now being reconsidered.

### What Works and Should Be Preserved

- **Workflow reducer** — Pure function: `apply(command, state) → { newState, events, jobs }`. Task lifecycle, state machine, job emission. This doesn't care about agent internals. It just sees "room started" and "room completed."
- **Storage** — SQLite persistence for workflow events, ledger entries, turn traces, review packets, task index. Append-only. Works well.
- **Wire protocol** — WebSocket-based. Commands (submit, approve, reject, cancel, subscribe, snapshot), events (state changes, room lifecycle, review packets). CLI is a thin WS client. All working.
- **Server** — Composition root. Authority (serial write queue), dispatcher (async job execution), projector (workflow→wire translation), WS server. All working.
- **Two-stage deliberation + human gate** — Domain rooms (Stage 1) → synthesis room (Stage 2) → human approve/reject/cancel. This overall flow is sound.
- **Config, protocol types, test infrastructure** — All functional.

### What Is Being Replaced

- **The `providers` package** — Currently wraps `pi-ai`'s `completeSimple()` with prompt building, tool schema, normalization, retry. This entire abstraction is wrong for the new model.
- **The `room` kernel** — Currently a for-loop calling `agent.takeTurn()`. Needs fundamental rethinking.
- **The `context` package** — Currently empty (static fixture in server). Was planned to pre-build ContextBundles from curated docs. This approach is being abandoned.
- **Structured per-turn output** — The 8-action ledger vocabulary as forced tool calls per turn. This constraint is being removed.
- **Sealed agent boundary** — "No filesystem, no shell, no network." The "no filesystem" part is being relaxed to allow read access.

## The Proposed Pivot

### New Agent Model

Each agent is a **persistent Pi instance running an agentic loop.**

Pi (`@mariozechner/pi-ai` + the broader pi-mono ecosystem) is a coding harness / agent framework. It provides:
- Multi-provider LLM abstraction (OpenAI, Anthropic, Google, etc.)
- Streaming completion with tool calling
- Agentic loop: the model calls tools → gets results → continues until done
- Built-in tools for file reading, directory listing, etc.
- Session/conversation persistence
- Context management (system prompts, message history)

**The key insight the user identified:** Pi is already an agentic loop framework. We chose it for exactly this reason. But then we stripped it down to a single `completeSimple()` call — lobotomizing the very capability we selected it for.

### How Agents Work in the New Model

1. Each agent in a room is a Pi instance with its own identity (persona, system prompt, model selection)
2. The agent gets **read access to the repository** (read files, list directories — no write, no shell, no network)
3. When it's the agent's turn, its Pi session is activated with the conversation so far (other agents' outputs appended as context)
4. The Pi loop runs: the agent reads files it thinks are relevant, reasons, reads more, forms its position
5. When the loop completes, the agent's **natural language output** is its contribution to the discussion
6. That output gets appended to the conversation context for the next agent
7. On subsequent turns, the same Pi instance is resumed with new conversation context

### What Changes About the Room

- **No pre-built ContextBundle.** Agents explore the repo themselves. They read what they think is relevant based on their domain expertise and the conversation.
- **No structured per-turn tool call.** Agents produce natural language output — reasoning, proposals, concerns, evidence. The conversation IS the deliberation.
- **Structured extraction happens post-room.** After the room conversation concludes, a summarizer pass extracts issues, decisions, risks, and unresolved concerns from the natural language transcript.
- **The room kernel orchestrates Pi sessions**, not completion calls. It manages: whose turn it is, injecting new context into the next agent's session, detecting when the conversation has converged, enforcing max rounds.

### Why This Is Better

1. **No staleness gap.** Agents read actual code, not documentation that may be outdated.
2. **No curation overhead.** No one has to maintain a ContextBundle pipeline. The repo IS the context.
3. **Natural deliberation.** Agents discuss like architects, not like structured-output machines. The conversation quality should be dramatically higher.
4. **Domain scoping is natural.** A frontend agent instinctively reads frontend files. A backend agent reads backend files. The 400K context window on modern models can easily hold a domain-scoped slice of any reasonable codebase.
5. **Pi already handles the hard parts.** Tool calling, retries, streaming, multi-provider support, session management — we don't need to rebuild any of this.

## Questions for Review

### Architecture Questions

1. **What breaks in the current package structure?** The dependency graph was: protocol ← providers ← room ← server. If providers becomes "Pi session management" and room becomes "Pi session orchestration," do the package boundaries still make sense? Should providers and room merge? Should there be a new package?

2. **How does the room kernel work now?** It was a deterministic for-loop with round-robin turns. Now it needs to: start/resume Pi sessions, inject conversation context, detect convergence, enforce limits. What does this actually look like?

3. **How does post-room extraction work?** The ledger was built incrementally during the room. Now we need to extract structured data (issues, decisions, risks) from a natural language transcript after the fact. Is this a separate model call? What's the schema? How reliable is extraction vs. incremental structured output?

4. **What happens to the wire protocol?** Currently, room_started and room_completed events carry room metadata. The review packet is built from ledger entries. If the ledger is now extracted post-hoc, does the review packet pipeline change?

5. **What happens to the workflow reducer?** It emits jobs like `run_domain_room` and `run_synthesis_room`. Those jobs currently expect room results with ledger entries and artifacts. Do the job interfaces change?

6. **How do we persist the conversation?** Turn traces were "raw model output per turn." Now each "turn" is an entire agentic loop with multiple LLM calls and tool uses. What do we store? The full Pi session transcript? Just the final output?

7. **What about the synthesis room?** Stage 2 agents read Stage 1 outputs. In the old model, those were structured ledgers. In the new model, those are... what? The full room transcripts? The extracted summaries? The raw natural language output?

8. **What about consensus/convergence detection?** The old model had explicit signals (propose_closure, no open objections). Natural language conversations don't have explicit termination signals. How does the room know when agents have converged? Is it max_rounds only? Or can we detect convergence from the conversation?

### Risk Questions

9. **Extraction reliability.** Post-hoc extraction from natural language is inherently lossy. The old model guaranteed structure (every turn had typed actions). The new model hopes the summarizer catches everything. What's the failure mode when extraction misses a key disagreement or risk?

10. **Cost model.** Each agent now makes multiple LLM calls per turn (the agentic loop). A 3-agent room with 5 rounds could be 15 "turns" × N calls per loop. Is this still economically viable with mini models? What's the expected cost per room?

11. **Determinism/reproducibility.** The old room was deterministic (same inputs → same outputs for scripted agents). An agentic loop with file reading is inherently non-deterministic. Does this matter for testing, replay, or debugging?

12. **Scope creep risk.** Giving agents read access to the whole repo means they might read everything and still hit context limits. Or they might read irrelevant files and waste tokens. Is there a guardrail, or do we trust the model's judgment entirely?

### Pi-Specific Questions

13. **What exactly from Pi do we use?** Just `pi-ai` (the provider abstraction)? Or also `pi-agent-core` (the full agent loop with built-in tools)? If we use pi-agent-core, we inherit its tool set, session model, and conventions. Is that what we want, or do we want to build our own loop using pi-ai's streaming/completion primitives?

14. **Pi session persistence.** How does Pi handle session state? Can we serialize/resume a Pi session across room turns? Or do we reconstruct context from conversation history each time?

15. **Pi's tool model vs our needs.** Pi's built-in tools are designed for coding agents (read, write, edit, bash, etc.). We want read-only. Can we restrict Pi's tool set? How?

## What We Need Back

1. **Verdict:** Is this pivot architecturally sound? What are the fatal flaws, if any?
2. **Revised package structure:** What packages change, merge, or get created?
3. **Room kernel design:** How does the new room orchestration work, concretely?
4. **Extraction strategy:** How do we get structured data out of natural language rooms?
5. **Migration path:** Given Phases 0–5 are built and working, what's the most efficient path to the new architecture? What can we keep? What must be rewritten?
6. **Cost/quality tradeoff analysis:** Is this viable economically? What are the expected costs?

## Appendix: Current Implementation Statistics

- 9 packages, ~15K lines of implementation
- 113 tests passing
- Full e2e pipeline working: submit → context → room → render → review → approve (67ms with scripted agents)
- Packages with significant code: protocol (2850 lines), config (850 lines), workflow (1200 lines), storage (900 lines), room (1800 lines), providers (2400 lines), server (2400 lines), cli (400 lines)
- Packages being replaced/rewritten: providers, room, context
- Packages largely preserved: protocol, config, workflow, storage, server, cli

## Appendix: Pi API Surface (from pi-ai types)

```typescript
// Core completion functions
function stream(model, context, options?): AssistantMessageEventStream
function complete(model, context, options?): Promise<AssistantMessage>
function streamSimple(model, context, options?): AssistantMessageEventStream
function completeSimple(model, context, options?): Promise<AssistantMessage>

// Context structure
interface Context {
  systemPrompt?: string
  messages: Message[]
  tools?: Tool[]
}

// Message types
type Message = UserMessage | AssistantMessage | ToolResultMessage

// Tool definition
interface Tool<TParameters extends TSchema> {
  name: string
  description: string
  parameters: TParameters
}

// Model with full provider info
interface Model<TApi> {
  id: string; name: string; api: TApi; provider: Provider
  baseUrl: string; reasoning: boolean
  cost: { input, output, cacheRead, cacheWrite }
  contextWindow: number; maxTokens: number
}
```

Pi's streaming supports: text, thinking/reasoning, tool calls — all with partial deltas. Multi-provider: OpenAI, Anthropic, Google, Bedrock, Mistral, and more.
