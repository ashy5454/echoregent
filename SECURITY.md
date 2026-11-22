# Security Policy

EchoRegent is committed to providing a secure, local-first, zero-telemetry context middleware and continual memory layer for LLM applications and autonomous AI agents. We take security and privacy vulnerabilities seriously.

---

## Supported Versions

Only the latest active minor release receives security updates and vulnerability patches.

| Version | Supported          | Security Status |
| ------- | ------------------ | --------------- |
| `0.4.x` | :white_check_mark: | Active support (current release) |
| `< 0.4.0` | :x:              | End of Life (unsupported development prototypes) |

---

## Security Model & Core Invariants

EchoRegent operates on strict, deterministic security invariants designed to protect enterprise and developer workloads:

1. **Local-First & Zero Telemetry:**
   - EchoRegent packages (`@echoregent/core` and `@echoregent/cli`) make **zero outbound network connections** for analytics, telemetry, pingbacks, or usage metrics.
   - All compression, token accounting, policy checks, and memory operations execute strictly in-process on the local machine (`127.0.0.1`).
   - The CLI proxy binds exclusively to loopback interfaces.

2. **Deterministic Policy & Fail-Closed Protection:**
   - EchoRegent includes built-in domain filters for sensitive domains (**Medical, Legal, and Crisis**).
   - When a protected pattern or context is detected, compaction and memory writes are immediately suspended (`policy.protected = true`).
   - If memory storage or policy state cannot be verified, the engine **fails closed**—forwarding request payloads 100% verbatim without mutation.

3. **Filesystem Isolation & Path Traversal Prevention:**
   - Persistent memory directories and wiki stores are strictly scoped.
   - Project and session identifiers are sanitized and hashed to prevent directory traversal attacks (e.g., `../` path escapes).
   - Atomic replacement with file-locking primitives prevents race conditions and corrupted memory states.

4. **Zero Model Weight Vulnerabilities:**
   - EchoRegent packages contain **zero binary machine learning weights** (`.onnx`, `.bin`, `.pt`, `.safetensors`), eliminating arbitrary code execution risks from untrusted model deserialization (e.g., PyTorch pickle exploits).

5. **ReDoS Defense:**
   - All regex patterns in the template factoring engine and structural signature canonicalizer are formally audited to execute in linear time, preventing Regular Expression Denial of Service (ReDoS).

---

## Reporting a Vulnerability

If you discover a security vulnerability in EchoRegent, please report it privately. **Do not create a public GitHub issue.**

### Reporting Channels

1. **Email:** Send details to **`security@echoregent.ai`**.
2. **GitHub Security Advisory:** You can submit a private advisory through the [EchoRegent Security Advisory Tab](https://github.com/ashy5454/echoregent/security/advisories/new).

### What to Include

To help us triage and resolve your report quickly, please include:
- A descriptive title and summary of the issue.
- The affected component (`@echoregent/core`, `@echoregent/cli`, proxy, or memory layer).
- Step-by-step instructions or a minimal reproducible proof-of-concept (PoC).
- Potential impact (e.g., memory leakage, policy bypass, ReDoS, path escape).
- Any proposed fix or mitigation.

---

## Response & Disclosure Process

We follow a coordinated vulnerability disclosure workflow:

1. **Acknowledgement:** We will acknowledge receipt of your report within **48 hours**.
2. **Triage & Assessment:** Our core maintainers will reproduce and evaluate the severity within **7 days**.
3. **Patch Development:** A fix will be developed, tested against our regression suites, and prepared in a private fork.
4. **Release & Advisory:** A patch release (`v0.4.x`) will be published to npm and GitHub. We coordinate a public advisory release with the finder, typically within **30 to 90 days** from initial notification.

---

## Hall of Fame & Acknowledgments

We deeply appreciate security researchers and community members who practice responsible disclosure. Verified reporters will be credited in our release notes and Security Hall of Fame (unless anonymity is requested).
