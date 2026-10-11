# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are security and AI platform teams responsible for governing agent behavior
across an organization. They need to establish mandatory controls, understand enforcement
outcomes, investigate incidents, and produce credible audit evidence without owning every agent's
codebase.

Agent developers are a secondary audience. They register and test agents, attach permitted
guardrails, deploy guarded endpoints, and debug rule-level outcomes. QA and business testers use
the guarded chat flow to validate behavior without changing configuration.

## Product Purpose

AgentsOnRails.dev places centrally managed controls around A2A agents. It lets an organization
register an existing agent, configure ordered input and output checks, issue a guarded replacement
endpoint, and inspect the resulting sessions, traces, security scans, and audit events.

Success means security teams can enforce a company baseline consistently, developers can adopt it
without changing agent code, and operators can explain why a request or response was allowed,
redacted, warned, blocked, or limited.

## Positioning

AgentsOnRails.dev is an A2A 1.0-compatible reverse gateway: the original and guarded endpoints both
speak `SendMessage`, so a client switches one URL and adds an API key instead of integrating a
governance SDK into each agent. Guardrails execute in a deterministic order and return a per-rule
trace with each guarded interaction.

## Operating Context

Security and platform teams define mandatory guardrails and shared prompt-injection signatures.
Developers register an agent from its Agent Card, configure and dry-run guardrails, attach and
order optional controls, then create a one-time-visible gateway key and guarded URL. Operators test
the real guarded pipeline, run security scans, review A2A sessions by `contextId`, and investigate
negative outcomes in the audit log.

The product distinguishes these terms:

- **Guardrail:** one gateway text check with one engine, stage set, and action.
- **Binding:** an attachment of a guardrail to an agent, role, or user.
- **Effective guardrails:** the resolved ordered checks after mandatory and scoped bindings.
- **Session:** an A2A conversation keyed by `contextId`; it is not a stored transcript.
- **Audit event:** a gateway block, redaction, warning, or limit hit.

## Capabilities and Constraints

- Register A2A 1.0 JSON-RPC agents by base URL and discover their Agent Card.
- Create regex/rules, LLM judge, open-source library, and moderation guardrails for input, output,
  or both, with block, redact, or warn actions.
- Run mandatory guardrails before scoped optional guardrails; feed redacted text into later checks.
- Apply per-call and per-session token and cost limits plus call timeouts.
- Create gateway keys and guarded Agent Card URLs, test through the guarded pipeline, and inspect
  rule verdicts, reasons, latency, usage, cost, and simulated state.
- Review session counters and costs, negative audit events, OWASP LLM Top 10 security scans, and
  registered MCP servers with tool allowlists.
- Give every user a private workspace: Supabase accounts (email and password, GitHub, Google),
  every database row owned by one user, and row-level security that returns only the owner's rows.
  New accounts start with the seed guardrails, injection signatures and the demo agent.
- Store session counters rather than conversation content. Audit details contain short reasons, not
  message text. Agent and MCP secrets are not returned to the frontend.
- Fail closed when a mandatory guardrail engine errors; optional guardrails fail open with a
  warning. Simulated judge or moderation results cannot produce a real block.
- The A2A profile does not currently cover streaming, long-running tasks, push notifications,
  gRPC, HTTP+JSON binding, non-1.0 versions, extended Agent Cards, or raw/file-part checking.
- Named gateway policies, exemptions, complete approval and evaluator workflows, and MCP-to-agent
  attachment are not current capabilities or product commitments. Future work must not claim them
  without renewed approval.
- Shared team workspaces, roles and anonymous guest access are not current capabilities.

## Brand Commitments

The product name is **AgentsOnRails.dev**. Its voice is direct, operational, and specific, using factual
language such as “guarded URL,” “runs first,” “never shown again,” and “counters only, no message
content.” It must not imply that prototype, simulated, placeholder, or unimplemented behavior is
production-ready.

The in-product mark is a shield with a check. The repository's favicon uses a conflicting mark, so
the approved canonical brand asset remains undecided.

## Evidence on Hand

- The working React application in `src/` contains the implemented registration, guardrail,
  deployment, test, session, audit, MCP, and security-scan flows.
- The gateway contract is documented in `../../docs/agent-contract-a2a.md`.
- Product and implementation decisions are recorded in `../../docs/superpowers/specs/`.
- The marketing implementation in `../landing/` provides product language, but unsupported claims
  there are not accepted evidence of shipped functionality.
- There are no approved customer testimonials, case studies, benchmarks, pricing claims, or press
  assets in the repository; future work must not fabricate them.

## Product Principles

1. **Enforce outside the agent.** Put organizational controls at a boundary the governed agent does
   not own or bypass.
2. **Make every intervention explainable.** Show which rule ran, what it decided, and why, while
   retaining the minimum sensitive content required.
3. **Make the company baseline non-optional.** Mandatory controls run first and fail safely when
   their enforcement cannot be established.
4. **Keep adoption protocol-native.** Preserve A2A compatibility and minimize changes required of
   agent developers and clients.
5. **Separate shipped truth from demonstrations.** Label simulated and prototype behavior clearly
   and never convert roadmap language into a product claim without approval.

## Accessibility & Inclusion

The product is an English-language responsive web application operated on desktop and mobile web.
Existing keyboard navigation, visible focus, semantic labeling, status announcements, and minimum
control sizing are baseline behavior to preserve. No product-specific conformance target or
localization requirement has been confirmed.
