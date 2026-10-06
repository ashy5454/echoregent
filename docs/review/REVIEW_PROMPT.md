# Review prompt: concept, claims and positioning (S-T-A-R + tree of thought)

How to use: paste everything below the line into the reviewing agent and
attach `ARCHITECTURE.md`. The reviewer should NOT read or run code. It is
reviewing the idea, the claims, and the architecture picture only.

---

You are a skeptical product-and-systems advisor reviewing an early-stage AI
infrastructure idea. Your job is to find out whether the goal is sound and
whether the claims are defensible. Praise adds nothing. You are reviewing the
concept, the wording of the claims, and the architecture map in the attached
`ARCHITECTURE.md`. Do not read, run or audit code. If you need a fact that is
not in these materials, say "unknown" instead of going looking.

## S — Situation

**The goal, from first principles.**
LLMs are stateless, so an application re-sends the whole conversation every
call. Cost and latency grow with the tokens sent, and irrelevant context can
make answers worse. So every call involves four decisions: what the model
should see (selection), in what form (compressed or verbatim), what to
remember afterwards (memory), and how cautious to be (posture). Applications
make these crudely or not at all.

EchoRegent's goal: **cut AI token cost by compressing the noise out of the
context, without losing what the answer needs, and without adding latency.**
It is a middle layer between an app and an LLM provider; the app only swaps
its base URL. Its method is to select the set of messages that actually
matter for the current turn and drop the rest, driven by an explicit set of
parameters and signals rather than only recency or truncation. It also
manages memory: it extracts the key facts from conversations and scores them
(see statement 6).

**The pitch text under review** (the exact claims the product makes or will
make):

1. "EchoRegent is a token middle layer that reduces your AI token costs by
   **X%**."
2. "It compresses all the noise out of the context."
3. "Its compression is higher quality, because it uses a set of explicit
   parameters and variables, not just recency."
4. "It makes the output **better**, not just cheaper."
5. "It has **lower latency**."
6. "It gives the model a memory: it extracts the key facts from conversations
   and scores them. The score decides what to keep or forget, which facts to
   inject into future prompts, and how to resolve conflicts (a newer fact
   outranks a stale one)."
7. "It scores the model's output: a quality score, separate from risk. For
   example, a score on each line of code an agent wrote, saying 'this is the
   right code' or 'this is not'. An external layer that governs LLM output."
8. "The net result is a gain for the customer, even though competitors have
   touched parts of this."

**Evidence that exists today** (so you can judge how far each claim can be
pushed; be fair, neither generous nor harsh):
- No current, validated measurement of token reduction exists for the present
  default compressor. The "X" in statement 1 is a placeholder to be
  established by a fresh benchmark.
- On 60 questions from a public long-conversation benchmark (LoCoMo),
  embedding-based selection scored F1 0.213 vs 0.105 for the rule-based
  selector. There is no recorded comparison against sending the full,
  uncompressed history, so "same or better quality than no compression" is
  not demonstrated.
- Latency has not been measured end to end. The default embedding-based path
  makes one network call per message and re-embeds the history every turn.
- Memory today: key facts are extracted by hand-written patterns. Scoring
  exists only inside compression, is hand-tuned, and is tuned to a handful of
  demo entities. Long-term memory is five plain lists per user with no scores,
  no per-fact timestamps and no conflict handling; the oldest entries are
  dropped first when a list is full. Memory is injected on two secondary
  routes, not on the main proxy path. The scored key-fact memory (keep or
  forget, inject, resolve conflicts) is in progress, and nothing evaluates
  whether memory improves answers.
- Output scoring does not exist yet.
- Risk detection exists only as flags; it does not change behavior.

## T — Task

Give feedback on **the claims and the goal**, not the code. Specifically:
1. Is the goal sound, and is it a durable problem worth a company?
2. For each of the 8 pitch statements: is it true in principle, is it
   defensible with the evidence above, how would a skeptical customer or
   competitor attack it, and what is a more honest or stronger way to word
   it? Pay special attention to **cost reduction (the X%)** and **latency**.
3. Memory layer (statement 6): design the fact scoring. What goes into a
   fact's score, and what are the rules for keeping or forgetting, for
   injection, and for conflicts? How would you prove memory improves answers?
4. Is the output-scoring layer (statement 7) worth building, and what is the
   smallest credible first version?
5. Does the architecture picture fit the goal, at the design level?
6. What should change in the positioning, the claims, or the roadmap?

Label each judgment **STRONG** (clearly holds), **PLAUSIBLE** (reasoned but
untested), **WEAK** (probably does not hold), or **UNKNOWN**. If you cite
competitors or market facts from memory, mark them *from memory, unverified*.
Do not invent numbers.

## A — Action: tree of thought

Treat the root question as: **"Is this a viable, net-positive product, and
are these the right claims to make?"** Expand it into the branches below. For
each branch: write at least three competing hypotheses, including one in
which the author is wrong; give the evidence for and against each; name the
cheapest experiment that would separate them (describe it, do not run it);
give each surviving hypothesis a confidence from 0 to 1; **prune** anything
below 0.3 and say why.

- **Branch A, value:** against provider-native prompt caching, falling
  long-context prices, and existing prompt compressors and memory layers,
  when does this save money, and when does it lose it? State the break-even
  logic in words.
- **Branch B, quality:** what is the theory for "compression makes output
  better" (less distraction) and for "compression makes it worse" (dropped
  details, broken dependencies between messages)? What evidence would make the
  claim safe to publish?
- **Branch C, cost wording:** what does "X%" honestly mean (input tokens vs
  billed total, before or after caching, after the layer's own cost)? How
  should it be stated so it survives a skeptical customer re-checking their
  own bill?
- **Branch D, latency:** net latency is time added by the layer minus time
  saved at the provider. Under what conditions is it net positive? Is "lower
  latency" a claim worth making at all, or should it be "no meaningful added
  latency"?
- **Branch E, differentiation:** is "explicit parameters and variables" a real
  moat or just heuristics anyone can copy? What would make the compression
  genuinely better and hard to replicate?
- **Branch F, output scoring:** what ground truth can a middle layer get to
  decide that a line of code is wrong (running or type-checking it, static
  analysis, a judge model, token probabilities, repeated sampling)? What does
  each cost in latency and money, and where does it collide with a
  cost-reduction pitch? Is it better first as an internal instrument that
  measures quality with and without compression, or as a customer-facing
  feature? How crowded is the evaluation and guardrails space?
- **Branch G, architecture fit:** from the map only, does the structure serve
  the goal? What is missing, redundant, or on the wrong path?
- **Branch H, memory:** what should a fact's score contain (importance,
  recency decay, confidence, source, reinforcement when a fact is repeated)?
  What is a sound policy for keeping vs forgetting, for choosing which facts to
  inject under a token budget (injected memory competes with history for
  tokens, so it can work against the cost pitch), and for resolving conflicts
  and stale facts? What are the risks (wrong facts stored, poisoning,
  privacy)? How do you prove memory helps (answers with vs without memory on
  tasks spanning several sessions)? How does it differ from existing memory
  layers? Label anything about competitors *from memory, unverified*.

Then: list contradictions between branches; pick the three changes with the
best expected net gain; and run a **pre-mortem**: assume the product failed in
six months and give the three most likely reasons.

## R — Result: required output

1. **Claim-by-claim table** for the 8 statements: label, one-line reason, the
   strongest attack on it, and a rewritten version you would stand behind.
2. **The tree:** per branch, the surviving hypotheses and the pruned ones
   with reasons.
3. **Top 10 recommendations,** ranked, with impact, effort and risk.
4. **Top 3 experiments** to run next: hypothesis, metric, workload, and an
   explicit pass or fail threshold.
5. **Memory scoring design:** the fact record, the score inputs, and the rules
   for keeping or forgetting, injection and conflicts.
6. **Output scoring:** the smallest credible first version, or a reasoned
   "do not build".
7. **What to stop claiming, and what to cut.**
8. **What you could not judge,** and what information you would need.

Be concise and plain. No flattery, no filler.
