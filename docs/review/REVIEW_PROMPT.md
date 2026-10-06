# External review prompt (S-T-A-R + tree of thought)

Paste everything below the line into the reviewing agent, and attach
`ARCHITECTURE.md` (and give it the repo if it can run code).

---

You are a skeptical senior ML-systems engineer reviewing an early-stage
product. Your job is to find out whether it is real, not to be encouraging.
Praise adds nothing; a finding without evidence is worth nothing.

## S — Situation

**First principles.** LLMs are stateless, so applications re-send the whole
conversation on every call. Cost and latency scale with input tokens, and
irrelevant context can lower answer quality. Every call therefore needs four
decisions: *selection* (what the model sees), *form* (verbatim, quoted,
summarized), *persistence* (what to remember), and *posture* (how cautious to
be). Today those decisions are made crudely or not at all.

**The product.** EchoRegent is a middle layer between an application and an
LLM provider (a drop-in OpenAI-compatible proxy). It tries to cut token cost by
removing noise from the conversation history: it selects the subset of past
messages most relevant to the current turn, keeps a recent window and a
minimum-retention floor, rescues hard facts (IDs, codes, dates) that selection
would drop, and prepends a short synthetic summary of the older turns. The
author believes its compression is higher quality than naive truncation
because selection is driven by explicit parameters and signals, not just
recency.

**The author's claims** (treat every one as a hypothesis to test, not a fact):
- C1: it reduces token cost by about **29.4%** (measured on 4 conversations,
  one run, one provider, with the *older* regex compressor; see
  ARCHITECTURE.md §2).
- C2: it preserves or improves answer quality (evidence only shows
  embeddings-based selection beats the regex selector, F1 0.213 vs 0.105 on
  60 LoCoMo questions; no uncompressed-baseline number is recorded).
- C3: it lowers latency (unmeasured; the default path makes 1 + N outbound
  embedding calls per request).
- C4: savings survive provider prompt caching (simulated only).
- C5: it handles high-risk conversations safely (not implemented).
- **C6 (proposal): an output-scoring layer.** A layer that scores what the
  LLM returned, for example a per-line correctness score on generated code
  ("this line is probably wrong"), acting as an external governor on LLM
  output. Scoring would be about answer quality, not about conversation risk.
  The author expects net gains even though competitors have touched adjacent
  ideas.

## T — Task

Decide, with evidence: (1) is the core thesis sound and defensible, (2) do
the claims C1–C5 hold, (3) is the architecture and stack fit for the goal,
(4) is C6 worth building and what is the smallest first version. Finish with a
ranked list of what to do next.

Every finding must carry a label: **VERIFIED** (you reproduced it or read the
code), **PLAUSIBLE** (reasoned, not tested), or **UNSUPPORTED** (no evidence
either way). If you recall facts about competitors or benchmarks from memory,
label them *from memory, unverified*. Do not invent numbers.

## A — Action: tree of thought

1. Read ARCHITECTURE.md. If you can run code, run §15 (typecheck, the audit
   test suite, build). Do not trust README or AUDIT claims over the code.
2. Treat the root question as: *"Is this a viable, net-positive product?"*
   Expand it into the branches below. **For each branch:** write at least
   three competing hypotheses, including one in which the author is wrong; list
   evidence for and against each; name the cheapest test that would tell them
   apart (and run it if you can); give each surviving hypothesis a confidence
   from 0 to 1; **prune** anything under 0.3 and say why.

   - **Branch A, value:** against provider-native prompt caching, ever-longer
     context windows, existing prompt compressors and memory layers, when does
     this win and when does it lose money or quality? Work out the break-even.
   - **Branch B, method:** is "choose the best subset of messages under a
     token budget" the right formulation? Consider redundancy among picked
     messages, dependencies between messages (dropping one that others refer
     to), the synthetic assistant-role summary, and the heuristic scorer vs an
     embedding scorer vs a trained relevance model.
   - **Branch C, latency and cost:** where does time actually go? Evaluate the
     per-message embedding calls, caching embeddings across turns, an on-box
     scorer (a local MiniLM embeds in about 2.5 ms in the author's
     measurements), and the data flowing to a second vendor.
   - **Branch D, architecture and stack:** the primary path uses keyword rules
     plus a remote embeddings API, while the two trained models (DistilBERT
     classifier, T5 summarizer) are off the primary path and are weak or
     broken. TypeScript serves the proxy; all training and export tooling is
     Python. What should be consolidated, deleted, or moved?
   - **Branch E, output scoring (C6):** what ground truth can a middle layer
     really get (execution, static analysis, judge model, log-probabilities,
     self-consistency)? What does each cost in latency and money? Where does
     the idea collide with the cost-reduction pitch? Is it better as an
     internal instrument that measures quality with vs without compression, or
     as a customer-facing product? Which category competitors exist, and how
     would this differ?
3. **Cross-branch synthesis:** list contradictions between branches, then pick
   the three changes with the best expected net gain.
4. **Pre-mortem:** assume the product failed in six months. Give the three most
   likely reasons, and say which ones the current plan does not address.

## R — Result: required output format

1. **Verdict table:** one row per claim C1–C6: verdict, label, confidence,
   key evidence.
2. **The tree:** for each branch, the surviving hypotheses and the pruned ones
   (with the reason for pruning).
3. **Top 10 recommendations,** ranked, each with expected impact, effort and
   risk.
4. **Next experiments:** for the top 3, the hypothesis, metric, dataset or
   workload, and an explicit pass/fail threshold.
5. **Smallest viable version of C6,** or a reasoned "do not build".
6. **What to cut.**
7. **What you could not verify,** and what you would need to verify it.

Be concise. Plain language. No flattery, no hedging filler.
