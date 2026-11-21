# Workstream 2: Continually Learning Compression Engine
## Architectural & Mathematical Research Specification

**Author:** Yudi Labs / CMP Research & EchoRegent Architecture Team  
**Status:** Approved for Implementation (v0.4.0)  
**Target Systems:** EchoRegent Context Management Layer, CMP Online Learning Rules  
**Associated Prototype:** `packages/core/src/adaptive-compressor.ts`, `audit/tests/adaptive-compressor.test.ts`

---

## 1. Executive Summary & First-Principles Biological Motivation

Autonomous AI agents frequently operate in environments producing long, structurally repetitive tool outputs: compiler error cascades, test suite execution logs, database migration output, continuous integration traces, and recursive directory tree listings. In conventional LLM workflows, these voluminous traces exhaust context windows, degrade token economics, dilute attention over critical reasoning steps, and trigger premature context eviction.

Existing mitigation strategies suffer from fundamental flaws:
1. **Static Heuristic Rules / Regex Filters:** Rigid and brittle. They either fail to capture project-specific repetitive noise or aggressively strip domain-critical diagnostics that the developer or agent needs.
2. **LLM-Based Summarization / Secondary Gating:** Introduces latency penalties ($>500\text{ms}$ per roundtrip), non-trivial token costs, hallucination risks, nondeterminism, and catastrophic failure when the summarizing model misinterprets subtle error traces.

EchoRegent Workstream 2 introduces an **online, continually learning compression engine** that dynamically discovers what patterns to compress and what patterns to preserve—operating in constant time $O(1)$ without backpropagation, gradient calculations, or secondary LLM calls.

```
       Incoming Raw Context / Tool Traces (Turn t)
                          │
                          ▼
            Canonical Structural Signature
             Extraction σ(L) -> s_k
                          │
                          ▼
         Learned Policy Gating: w_k < θ ?
                  ┌───────┴───────┐
             YES  │               │ NO
                  ▼               ▼
           Bypass Protection   Selective Compaction
           (Preserve Verbatim) (Lossless Run Collapse)
                  │               │
                  └───────┬───────┘
                          │
                          ▼
             Downstream Execution (Turn t+1)
                          │
                          ▼
            Passive Free Feedback Observer
           [Regret Signals vs. Clean Survival]
                          │
                          ▼
           Synaptic Local Delta-Rule Plasticity
              w_k <- w_k + η * (target - w_k)
```

### 1.1 Predictive Coding Grounding (Rao & Ballard; Friston)
In hierarchical biological sensory processing (Rao & Ballard 1999; Friston 2005 Free Energy Principle), the mammalian neocortex does not passively transmit raw sensory data up the cortical hierarchy. Instead, higher cortical areas generate top-down predictions of incoming sensory inputs. Lower areas compute the residual *prediction error*:

$$\epsilon = y - \hat{y}$$

Only the unpredicted residual $\epsilon$ is transmitted up the ascending pathway. When an input pattern is predictable and conforms to established internal generative schemas (e.g., standard repetitive build steps), its informational surprise is negligible, and it can be heavily compressed or filtered out without functional degradation. Conversely, when an unexpected pattern occurs (e.g., an abnormal exception or panic), high prediction error forces full sensory transmission.

### 1.2 Complementary Learning Systems (CLS Theory)
Under Complementary Learning Systems theory (McClelland, McNaughton, & O'Reilly 1995; Kumaran et al. 2016), the brain resolves the plasticity-stability dilemma through a dual-network architecture:
- **Hippocampal Fast Episodic Memory:** Rapid, one-shot acquisition of specific instances to prevent catastrophic forgetting.
- **Neocortical Slow Statistical Learning:** Gradual, interleaved accumulation of structured, invariant schemas across long temporal horizons.

EchoRegent operationalizes CLS principles for context management:
- **Episodic Immediate Protection (Hippocampal Gate):** When a compression decision immediately causes downstream regret (e.g., an agent immediately re-reads a truncated trace or a user complains of missing output), the pattern signature is flagged and rapidly depressed, preventing catastrophic data loss on subsequent steps.
- **Parametric Utility Tracking (Neocortical Weights):** Structural pattern signatures maintain a running synaptic efficacy weight $w_k \in [0, 1]$ updated via local plasticity. Signatures with persistent high utility are safely compacted, whereas signatures that provoke regret are promoted to the *Learned Protected Patterns* list.

---

## 2. Mathematical Formalization of Structural Pattern Signatures

Let raw tool output or dialogue text $T$ consist of an ordered sequence of lines:

$$T = (L_1, L_2, \dots, L_M)$$

### 2.1 Canonicalization Mapping $\sigma(L)$
Each line $L_i$ contains dynamic lexical variables (timestamps, process IDs, memory addresses, randomized GUIDs, line numbers) embedded within a structural syntactical invariant. To enable continual learning across variable instances, we define the canonicalization mapping:

$$\sigma: L \mapsto s_k \in \mathcal{S}$$

where $\mathcal{S}$ is the space of normalized structural signatures. The canonicalizer applies an ordered composition of three transformation projections:

$$\sigma = \pi_{\text{num}} \circ \pi_{\text{hex}} \circ \pi_{\text{ts}}$$

1. **Temporal Projection ($\pi_{\text{ts}}$):** Replaces ISO-8601 datetimes, bracketed timestamps, and time-of-day offsets with canonical token `"<TS>"`:
   - Matches: `\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?`
   - Bracketed formats: `\[\d{4}-\d{2}-\d{2}[ T][^\]\r\n]+\]`
   - Sub-second time codes: `\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b`
2. **Cryptographic & Address Projection ($\pi_{\text{hex}}$):** Replaces pointers, git object hashes, and UUIDs with canonical token `"<HEX>"`:
   - Hexadecimal pointer prefixes: `\b0x[0-9a-fA-F]+\b`
   - RFC 4122 UUIDs: `\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\b`
   - Git/SHA hashes: `\b(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{7,64}\b`
3. **Numeric Projection ($\pi_{\text{num}}$):** Replaces remaining integers, floats, and scientific notation with canonical token `"<NUM>"`:
   - Real numbers and integers: `\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`
   - Measured quantities: `(?<=\b|[+\-])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[a-zA-Z%])`

#### Canonicalization Invariant
Two distinct raw log lines $L_a, L_b$ generated by the same logging statement at different timestamps with different execution durations and memory pointers map to the exact same signature:

$$\sigma(\text{"[2026-11-21 10:14:02.120] [INFO] Job 0x9a4f finished in 14ms"}) = \text{"[<TS>] [INFO] Job <HEX> finished in <NUM>ms"}$$
$$\sigma(\text{"[2026-11-21 10:15:33.891] [INFO] Job 0x3b1c finished in 22ms"}) = \text{"[<TS>] [INFO] Job <HEX> finished in <NUM>ms"}$$

This achieves massive dimensional reduction from an unbounded vocabulary space to a compact set of invariant structural equivalence classes.

---

## 3. The Turn $t+1$ Free Feedback Loop

Traditional reinforcement learning in NLP requires external reward models, human evaluators, or expensive LLM judge passes. EchoRegent leverages the **Turn $t+1$ Free Feedback Loop**: the downstream behavior of the agent and user naturally emits unambiguous survival or regret signals at zero additional inference cost.

```
+─────────────────────────────────────────────────────────────────────────────+
│                                TURN t                                       │
│                                                                             │
│  Tool Output / Logs T_t ──> Compress Signatures S_t = {s_1, ..., s_m}       │
│                             Emitted to Agent / LLM Context Window           │
+─────────────────────────────────────────────────────────────────────────────+
                                       │
                                       ▼
+─────────────────────────────────────────────────────────────────────────────+
│                               TURN t+1                                      │
│                                                                             │
│  Passive Observation of Agent Actions & User Prompts:                       │
│                                                                             │
│  1. Agent Immediate Re-read:                                                │
│     - Tool call repeats identical command or target file                    │
│     - E.g., read_file(path) immediately re-executed after truncation        │
│     ──> Regret Detected (target = 0.0)                                      │
│                                                                             │
│  2. User Complaint / Omission Prompts:                                      │
│     - "show full output", "missed line", "truncated", "uncompressed"         │
│     ──> Regret Detected (target = 0.0)                                      │
│                                                                             │
│  3. Seamless Task Continuation:                                             │
│     - Agent successfully executes next reasoning step                       │
│     - User provides new forward task instruction                            │
│     ──> Survival Confirmed (reward = 1.0, target = 1.0)                     │
+─────────────────────────────────────────────────────────────────────────────+
                                       │
                                       ▼
+─────────────────────────────────────────────────────────────────────────────+
│                           LOCAL SYNAPTIC UPDATE                             │
│                                                                             │
│   For each signature s_k in S_t:                                            │
│       w_k <- w_k + η * (target - w_k)                                       │
│                                                                             │
│   If w_k < θ_protect (default 0.45):                                        │
│       Promote s_k to Learned Protected Patterns                             │
│       Permanently bypass s_k from future compression                        │
+─────────────────────────────────────────────────────────────────────────────+
```

### 3.1 Mathematical Specification of the Local Delta Rule

Each structural signature $s_k$ has an associated scalar utility weight:

$$w_k \in [0.0, 1.0], \quad \text{initialized to } w_k^{(0)} = 1.0$$

When signatures $S_t = \{s_{t,1}, s_{t,2}, \dots, s_{t,m}\}$ undergo compression on Turn $t$, their utilities are updated on Turn $t+1$ according to the local delta rule (Rescorla-Wagner / Widrow-Hoff):

$$w_k^{(t+1)} = w_k^{(t)} + \eta \cdot (y_{t+1} - w_k^{(t)})$$

where:
- $\eta \in (0, 1)$ is the learning rate (default $\eta = 0.35$).
- $y_{t+1} \in \{0.0, 1.0\}$ is the feedback target:
  - $y_{t+1} = 1.0$ when the compression survives without downstream friction.
  - $y_{t+1} = 0.0$ when downstream regret is detected.

### 3.2 Two-Turn Regret Protection Dynamics
The protection threshold is set to $\theta_{\text{protect}} = 0.45$.

Let a novel signature $s_k$ have initial weight $w_k^{(0)} = 1.0$.

#### Case 1: First Regret Turn ($t=1$, $y_1 = 0.0$)
$$w_k^{(1)} = 1.0 + 0.35 \cdot (0.0 - 1.0) = 1.0 - 0.35 = 0.65$$
Since $w_k^{(1)} = 0.65 \ge \theta_{\text{protect}} = 0.45$, the pattern remains eligible for compression. A single spurious user comment or transient retry does not prematurely disable compression.

#### Case 2: Second Consecutive Regret Turn ($t=2$, $y_2 = 0.0$)
$$w_k^{(2)} = 0.65 + 0.35 \cdot (0.0 - 0.65) = 0.65 \cdot (1 - 0.35) = 0.65 \cdot 0.65 = 0.4225$$
Since $w_k^{(2)} = 0.4225 < \theta_{\text{protect}} = 0.45$:
$$\text{isProtected}(s_k) \leftarrow \text{true}, \quad \text{shouldCompressSignature}(s_k) \leftarrow \text{false}$$

The signature is automatically promoted to the project's **Learned Protected Patterns** list. On all subsequent turns, any line matching $s_k$ is guaranteed to be preserved verbatim.

#### Case 3: Survival Recovery
If a signature experienced one regret turn ($w_k = 0.65$) followed by a successful survival turn ($y_2 = 1.0$):
$$w_k^{(2)} = 0.65 + 0.35 \cdot (1.0 - 0.65) = 0.65 + 0.1225 = 0.7725$$
The utility recovers toward $1.0$, demonstrating resilience against noisy feedback.

---

## 4. Comparative Analysis of Three Online Learning Rules

We compare three online learning paradigms suitable for real-time edge and proxy deployment:
1. **Local Delta Rule (Adopted in EchoRegent v0.4.0)**
2. **UCB1 Contextual Bandit**
3. **Online TF-IDF Logistic Head (from `src/cts-core/compact-classifier.ts`)**

| Dimension | 1. Local Delta Rule | 2. UCB1 Contextual Bandit | 3. Online TF-IDF Logistic Head |
| :--- | :--- | :--- | :--- |
| **Mathematical Formulation** | $w_k \leftarrow w_k + \eta(y - w_k)$ | $a^* = \arg\max_k \left( \bar{X}_k + c\sqrt{\frac{\ln N}{N_k}} \right)$ | $\hat{y} = \sigma(\mathbf{w}^T \mathbf{x} + b)$<br>$\mathbf{w} \leftarrow \mathbf{w} - \eta(\hat{y} - y)\mathbf{x}$ |
| **Time Complexity (Inference)** | $O(1)$ hash map lookup | $O(K)$ over $K$ action arms | $O(V)$ dot product ($V$ active features) |
| **Time Complexity (Update)** | $O(1)$ arithmetic update | $O(1)$ count and mean update | $O(V)$ vector scale and addition |
| **Memory Footprint** | $O(S)$ scalar floats ($S$ signatures) | $O(S)$ counts + means | $O(V)$ floating-point weights + vocabulary map |
| **Exploration Risk** | Zero risky exploration (Conservative Exploitation) | High: forces exploration of untested patterns, potentially dropping critical lines | Moderate: linear boundary can misclassify unseen feature combinations |
| **Sample Efficiency** | Instantaneous: 2 regrets $\to$ immediate protection | Requires $N_k$ trials to narrow confidence bound | Requires multiple gradient steps over minibatches |
| **Cold-Start Safety** | Safe: starts at $w=1.0$ (lossless repeat collapse only) | Uncertain until exploration bound shrinks | Uncalibrated logits on out-of-vocabulary terms |
| **Biological Plausibility** | High: Rescorla-Wagner / Hebbian LTD/LTP | Low: requires global counters and log operations | Moderate: perceptron-style linear integration |

### 4.1 Detailed Evaluation

#### Local Delta Rule (Selected Winner)
- **Why it wins:** In developer tooling and LLM agent proxies, safety and deterministic latency are paramount. Compressing context must never introduce latency spikes ($<0.05\text{ms}$ per line). The Local Delta Rule requires only a hash table lookup and single multiply-subtract instruction. Most importantly, it operates with **asymmetric safety**: it defaults to lossless repeated-line compaction and rapidly establishes permanent protection after 2 regret occurrences.

#### UCB1 Contextual Bandit
- **Deficiency:** Bandit algorithms are designed to maximize cumulative reward by balancing exploration and exploitation. However, in agent context management, exploratory compression is dangerous: experimenting with compressing an unknown diagnostic line to "see if the agent needs it" risks silent reasoning failure. Context optimization demands conservative, risk-averse policy bounds rather than optimistic exploration.

#### Online TF-IDF Logistic Head
- **Trade-off:** As implemented in `src/cts-core/compact-classifier.ts`, the TF-IDF logistic head excels at domain classification across 8 fixed topics (`coding`, `medical`, etc.) where documents contain rich vocabulary. However, for line-by-line log compaction:
  1. Vocabulary tracking incurs memory fragmentation and string hashing overhead.
  2. Sparse vector dot products over 512 dimensions are orders of magnitude slower than a signature hash comparison.
  3. Structural signatures already capture syntax invariance better than unigram/bigram frequency counts.

---

## 5. Line-Selective Compression Engine Architecture

The line-selective compression engine operates directly on text streams, executing the following algorithm:

```
Algorithm 1: Line-Selective Adaptive Log Compaction
Input: Text T, Minimum Repeat Count R (default 4)
Output: Compacted Text T'

1:  lines <- Split(T, newline_delimiter)
2:  output <- []
3:  index <- 0
4:  while index < Length(lines) do
5:      line <- lines[index]
6:      sig <- extractSignature(line)
7:      
8:      // Check learned protection policy
9:      if shouldCompressSignature(sig) == false then
10:         // Pattern is protected: preserve verbatim without collapsing
11:         output.Push(line)
12:         index <- index + 1
13:     else
14:         // Pattern is safe: find extent of consecutive identical lines
15:         end <- index + 1
16:         while end < Length(lines) and lines[end] == line do
17:             end <- end + 1
18:         end while
19:         
20:         runLength <- end - index
21:         output.Push(line)
22:         if runLength >= R then
23:             output.Push("[EchoRegent: previous line repeated " + (runLength - 1) + " additional times]")
24:             RecordCompressedSignature(sig)
25:         else
26:             for r = index + 1 to end - 1 do
27:                 output.Push(lines[r])
28:             end for
29:         end if
30:         index <- end
31:     end if
32: end while
33: return Join(output, newline_delimiter)
```

### 5.1 Preservation Invariant
If signature $s$ is protected (`shouldCompressSignature(s) === false`), any arbitrary sequence of identical lines conforming to $s$ will pass through untouched:

$$\forall k \ge 1, \quad \mathcal{C}_{\text{learned}}(L_s^{\times k}) = L_s^{\times k}$$

Even if $k = 10,000$ repetitions occur, the protected pattern is never collapsed, ensuring zero data loss for diagnostic traces that the user or agent has demonstrated an explicit need to inspect.

---

## 6. Persistence & Continual Learning Across Sessions

To enable lifelong learning across developer sessions, CLI runs, and agent restarts, the adaptive compressor state is serialized to project-local storage (e.g., `.echoregent/compression-state.json` or within the ScopedMemory store).

### 6.1 State Schema
```typescript
export interface AdaptiveCompressorState {
  version: number                 // Schema version (e.g., 1)
  learningRate: number            // Configured learning rate η
  protectionThreshold: number     // Configured protection threshold θ
  weights: Record<string, number> // Map of signature hash -> utility weight
  protectedSignatures: string[]   // Explicit list of promoted protected signatures
  stats?: {
    totalTurns: number            // Lifetime turns observed
    regretTurns: number           // Lifetime regret turns
    survivalTurns: number         // Lifetime survival turns
  }
}
```

### 6.2 Idempotence & Portability
- **Round-trip Equivalence:** $\text{loadState}(\text{exportState}(S)) \equiv S$.
- **Project Scope Isolation:** Signatures learned in repository $A$ (e.g., specialized Rust borrow checker traces) remain isolated from repository $B$ (e.g., Python PyTorch distributed rank logs), preventing policy contamination across distinct codebases.

---

## 7. Test and Verification Plan (TDD)

In accordance with strict Test-Driven Development (TDD), the test suite `audit/tests/adaptive-compressor.test.ts` validates five core functional requirements:

1. **Test Suite A — Signature Extraction:**
   - Normalization of ISO, bracketed, and time-of-day timestamps into `<TS>`.
   - Normalization of hexadecimal pointers (`0x...`), UUIDs, and commit hashes into `<HEX>`.
   - Normalization of integers, floats, and scientific notation into `<NUM>`.
   - Equivalence of heterogeneous log instances under signature projection.
2. **Test Suite B — Online Delta-Rule Dynamics:**
   - Single regret turn depresses utility from $1.0 \to 0.65$ ($\eta = 0.35$).
   - Survival turn increments utility: $0.65 \to 0.7725$.
   - Asymptotic convergence toward target under repeated iterations.
3. **Test Suite C — Automatic Protection Promotion:**
   - Verified state after 1 regret turn: $w = 0.65 \ge 0.45 \implies \text{shouldCompress} = \text{true}$.
   - Verified state after 2 consecutive regret turns: $w = 0.4225 < 0.45 \implies \text{shouldCompress} = \text{false}$.
   - Promoted signature present in `getProtectedSignatures()`.
4. **Test Suite D — Line-Selective Compression:**
   - Unprotected repetitive lines compacted into `[EchoRegent: previous line repeated N additional times]`.
   - Protected repetitive lines preserved verbatim in their entirety.
   - Mixed log stream validation verifying selective compaction in a single pass.
5. **Test Suite E — State Persistence & Continual Learning:**
   - State export produces compliant serializable payload.
   - Restored instance in a fresh process retains all utility weights and protected decisions.
   - Cross-restart verification confirming learned policies persist.

---
*Yudi Labs CMP Research & EchoRegent Architecture Specification — November 2026*