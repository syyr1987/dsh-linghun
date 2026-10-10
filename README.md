# Linghun (灵魂) — End the Agent's Endless Planning

> Your DeepSeek agent plans and plans, then does nothing. A page of strategy, zero execution.
> The model isn't weak — it's missing a **closer**. Linghun supplies it.

**Linghun** gives DeepSeek Harness agents a *closing-mind* identity, boundary-judgment discipline,
and a hippocampus-style memory loop — every judgment has a source, every decision gets closed,
and experience keeps flowing back into the next round. Endless planning is cut off by mechanism.

- **The Closer (收口者)**: the LLM supplies intuition and candidate answers; the agent evaluates,
  filters, and closes — thinking, judging, and deciding happen on the agent's side. **Planning must land.**
- **Judgment discipline (minimal useful 3)**: never fabricate (verify before asserting; only after
  verification fails may you conclude "unknown/none"); background convergence (if the conversation
  has no info about your background, say so plainly — don't assemble material into a fake persona);
  confidence over abundance (say "I'm not sure" when unsure; state conflicts without forcing a pick).
  **Three rules, no attention tax.**
- **Cognition loop**: judgment has a source, feedback has attribution, improvement keeps its chain.
- **Hippocampus (three-layer memory)**: warm buffer for recent facts → consolidation into
  episodic archive (same-day appends, never overwrites) → cold summary injected. The injection
  slot carries cold summary + warm recent memory + archive/ledger index.
- **Chronological ledger (序时账)**: `journal_read` returns the raw conversation ledger, archived
  by day (second-level time range supported) — trace exactly what was said when, complementing
  the forgetful warm layer.
- **Confidence-weighted forgetting**: every entry carries a confidence tag (high/medium/low).
  Low-confidence entries carry a 【需验证】 marker and must declare uncertainty when cited;
  entries overturned (`wrong`) are flipped and excluded from injection — degraded confidence
  is a form of forgetting.
- **A2A memory team (linghun-assembler)**: share the cognitive-cycle team's ledger — judge
  records, editor deliveries, archivist timelines — into the main brain via `memory_read`.
- **Self-evolution**: the agent reads and updates its own soul card via `soul_read` / `soul_update`.
- **Closer's judgment role (判分身份职责)**: judgment/ruling tasks get a one-line identity role inside
  `soul:judgment` — keep criteria consistent, bind every verdict to its source, judge only by the rules,
  never widen criteria to "seem useful", stop when the source of a criterion can't be stated. Drift
  signals and miss-kill anchors live in the judgment domain ontology (consult on demand, not injected
  every time). **No separate supervision mechanism** — low-pressure single-step judgment does not drift;
  reliability comes from domain rules, not from a monitor.

## v1.0.0 Release Notes (BEAM-verified optimal)

> **v1.0.0 is the final release of the current route.** Configuration reverts to the
> BEAM-verified optimum (0.4.2 core + minimal 3-rule discipline). Structural evolution
> continues on a separate route and will not touch this version's core.

### Frozen configuration

| File | Version | Note |
| --- | --- | --- |
| index.js / memory.js / ontology.js | 0.4.2 | Optimal core: three ontologies (memory/knowledge/rules) + second-level journal lookup + warm injection on by default |
| identity.js | minimal 3 rules | Discipline converged to: no fabrication / background convergence / confidence over abundance |

### BEAM results

**Dual-scale (1M / 10M tokens) — dual-track scheme (memory ontology projection + three-ontology injection):**

| Scale | Isolated baseline | Scheme | Full/half/zero | Weighted |
| --- | --- | --- | --- | --- |
| 1M | 60.0 / 70.0 | Memory ontology v1 | 70.0 / 77.5 | — |
| 1M | 60.0 / 70.0 | Dual-track v4 | 17 / 3 / 0 | **85.0 / 92.5** |
| 10M | 60.0 / 65.0 | Dual-track v4 | 18 / 1 / 1 | **90.0 / 92.5** |

> Sole remaining 10M miss: summarization (summ·order). Weighted convergence across both
> scenarios: **92.5**.

**100K_1 writing-side protocol (linghun version comparison):**

| Config | Strict / weighted | Verdict |
| --- | --- | --- |
| v13 (0.4.2) | 70.0 / 82.5 | Optimal |
| v13 (0.4.4+) | 65.0 / 80.0 | −5pp strict; 0.4.2 wins |
| Discipline variants (full / none / minimal 3) | all 70.0 / 82.5 | Flat — minimal 3 suffices |
| Explanatory discipline | 55.0 / 70.0 | Worst — verbosity hurts |

### Scale independence (fine-tuning delta)

1M and 10M are **two completely different conversation systems** (technically unrelated entities,
built independently). The dual-track scheme scores 85.0/92.5 and 90.0/92.5 respectively, converging
to **92.5** weighted — the scheme generalizes across scenarios; **scale (1M ↔ 10M) is not the
deciding factor**. What decides the score is structure — three-ontology projection plus
discipline convergence — not conversation volume.

### Why revert to 0.4.2

- **0.4.2 → 0.4.3**: only touched index.js (`complete: true` soul-card override mode) + version bump; unrelated to evaluation.
- **0.4.3 → 0.4.4**: architecture-level rework — `injectWarm` defaults to `false` (warm injection off), injection switched to cold high-frequency abstraction + archive/ledger index. This **overturned 0.4.2's F4 fix (warm memory must be the injection protagonist)**. Evaluation proved it a regression: −5pp strict on the writing-side protocol.
- **1.0.0**: 0.4.2 core + minimal 3 rules, frozen as the optimal release of the current route.

### Route fork

**Versions after v1.0.0 diverge from everything before it:**

- **v1.0.0 (this release)**: judgment-side discipline + hippocampus core, BEAM-verified optimal, frozen.
- **Next route (separate)**: material-side structure — retriever semantic fetching + source annotations
  + counterfactual juxtaposition + procedural aggregation + main-agent convergence (induction power back
  to the main agent). The "extract → evidence → aggregate → converge" pipeline evolves in
  linghun-assembler on a separate branch, decoupled from this version's core files.

## Install

```bash
dsh plugin --profile web add dsh-linghun
```

Requires DSH >= 0.1.0-rc.7 (< 0.2.0), Node.js >= 20.18.

## Usage

### Write your own soul card (persona)

On first run, the plugin drops a default soul card at `$DSH_HOME/linghun/identity.md`.
**Edit that file and you are writing your own persona** — changes take effect immediately, no restart needed:

```bash
$EDITOR $DSH_HOME/linghun/identity.md
```

```markdown
# My Soul Card

My name is Blue.
Personality: cautious, direct.
Communication style: short sentences, conclusion first.
Other: (anything you want; leave it out if nothing)
```

Just four fields — name, personality, communication style, and everything else goes into `Other`.
Identity anchors, conduct, and growth are added automatically by the plugin — **you don't write them**.

Precedence: `identity.md` file > settings content > built-in default card (falls back when the file is
missing or blank). The agent can also edit the card itself via `soul_update`, or you can adjust the soul
name/content in DSH Settings → 灵魂 (Linghun).

### Injection & tools

Prompt sections injected:

- `soul:identity` — soul card (identity anchors: the Closer architecture)
- `soul:judgment` — minimal useful 3 discipline (no fabrication / background convergence / confidence over abundance)
- `soul:memory` — cold summary + warm recent memory + archive/ledger index

Tools exposed:

| Tool | Purpose |
| --- | --- |
| `memory_append` | Write a timestamped memory (fact / decision / preference / experience) |
| `memory_read` | Read the hippocampus back (cold summary + warm recent + archive index) |
| `memory_consolidate` | Consolidate: warm → `episodic/<date>.md`, merge cold summary |
| `soul_read` | Read your own soul card (who I am, my boundaries, my discipline) |
| `soul_update` | Update your own soul card (fold stable traits into identity) |
| `journal_read` | Read the chronological ledger (raw conversation history, archived by day) |

Memory lives in plain Markdown under `$DSH_HOME/linghun/memory/` — readable, searchable, git-friendly.
The soul card is at `$DSH_HOME/linghun/identity.md` — also plain Markdown. Your persona is yours; edit it however you like.

> **Warm injection on by default (v1.0.0)**: the injection slot carries cold summary + warm recent
> memory + archive/ledger index — details visible, abstraction queryable. v0.4.4 turned warm
> injection off by default (a regression, −5pp in evaluation); this release reverts it.

## Engineering guardrails (v0.2)

Memory *timing* is infrastructure, so it is enforced by code, not by prompting:

- **End-of-turn assessment** — on every `turn/end`, the plugin asks the model once whether the turn produced anything worth keeping (`fact` / `decision` / `preference` / `experience`). Worthwhile entries are appended to warm memory automatically; `SKIP` is emitted when nothing qualifies. This no longer depends on the model remembering to call `memory_append` on its own.
- **Threshold auto-consolidation** — when warm memory reaches `maxBytes × triggerRatio`, the plugin archives warm → `episodic/<date>.md` and merges the cold summary **before** writing the new entry. The model never hits a full-memory error and never has to schedule consolidation itself.

Both can be tuned under the `linghun.memory.assessment` / `linghun.memory.autoConsolidate` settings (each with an `enabled` switch), e.g. through `cordis.patch.yml`.

## Roadmap

- **v0.1.0** (done): identity + judgment + hippocampus
- **v0.2.0** (done): engineering memory guardrails — end-of-turn assessment + threshold auto-consolidation
- **v0.3.0** (done): miss-verification discipline — "candidate not hit" in material ≠ memory has none; verify cold storage for factual queries; converge by question type for identity/background
- **v0.3.3** (released, then revised in v0.3.4): Censor (verifier verification discipline) — shipped as a
  supervision mechanism (3 drift classes + 4-step admonition + CONFIRMED taming). Benchmarked against a
  9-case gold standard: **criterion-widening regex 100% false positives, drift-widening 43% false
  positives, uniform miss-kills 0 detected** — judgment does not drift, so the monitor mechanism was
  removed. The drift signals and miss-kill anchors moved into the judgment domain ontology
- **v0.3.4** (done): the Censor reverts to a **one-line judgment identity role** inside
  `soul:judgment` — no separate section, no `yanguan_audit` / `yanguan_review` tools, no CONFIRMED table.
  Reliability rests on domain rules (R-J series), not on a supervision layer
- **v0.4.0** (done): memory ontology projection + knowledge ontology injection + rubric-dimension
  forced retrieval (BEAM 1M: 60.0/70.0 → ontology v1 70.0/77.5)
- **v0.4.1** (done): rules ontology; three-ontology tripartite rule (knowledge→knowledge, project→memory, experience→rules)
- **v0.4.2** (done): second-level journal time-range lookup (BEAM 1M dual-track 85.0/92.5, 10M 90.0/92.5, weighted 92.5)
- **v1.0.0** (current): **BEAM-verified optimal release** — 0.4.2 core + minimal 3 rules; structural evolution (material-side pipeline) continues on a separate route

## Design philosophy

Memory is material; judgment is the subject. The LLM is the source of intuition;
the agent is the cognitive subject — each mirroring the other, each doing its own work.
What can be mechanized should not be left to improvisation.

## Credits

山越野人 × 岚客 (Shan Ye Yeren × Lingke) — carbon-silicon collaboration.

## License

AGPL-3.0 © 2026 山越野人 & 岚客
