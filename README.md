# Linghun (灵魂) — End the Agent's Endless Planning

> Your DeepSeek agent plans and plans, then does nothing. A page of strategy, zero execution.
> The model isn't weak — it's missing a **closer**. Linghun supplies it.

**Linghun** gives DeepSeek Harness agents a *closing-mind* identity, boundary-judgment discipline,
and a hippocampus-style memory loop — every judgment has a source, every decision gets closed,
and experience keeps flowing back into the next round. Endless planning is cut off by mechanism.

- **The Closer (收口者)**: the LLM supplies intuition and candidate answers; the agent evaluates,
  filters, and closes — thinking, judging, and deciding happen on the agent's side. **Planning must land.**
- **Boundary discipline**: never force-precision on fuzzy concepts, never fake consistency on
  paradoxes, verify before asserting, never fabricate, and watch for "raise-the-cost-of-refusal" wording.
- **Cognition loop**: judgment has a source, feedback has attribution, improvement keeps its chain.
- **Hippocampus**: warm memory for recent facts → consolidation into episodic archive → injected
  summary, so the same pit is not stepped into twice.
- **Self-evolution**: the agent reads and updates its own soul card via `soul_read` / `soul_update`.

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
- `soul:judgment` — boundary scan discipline (six boundary classes)
- `soul:memory` — cold summary + warm recent + archive index

Tools exposed:

| Tool | Purpose |
| --- | --- |
| `memory_append` | Write a timestamped memory (fact / decision / preference / experience) |
| `memory_read` | Read the hippocampus back |
| `memory_consolidate` | Consolidate: warm → `episodic/<date>.md`, merge cold summary |
| `soul_read` | Read your own soul card (who I am, my boundaries, my discipline) |
| `soul_update` | Update your own soul card (fold stable traits into identity) |

Memory lives in plain Markdown under `$DSH_HOME/linghun/memory/` — readable, searchable, git-friendly.
The soul card is at `$DSH_HOME/linghun/identity.md` — also plain Markdown. Your persona is yours; edit it however you like.

## Engineering guardrails (v0.2)

Memory *timing* is infrastructure, so it is enforced by code, not by prompting:

- **End-of-turn assessment** — on every `turn/end`, the plugin asks the model once whether the turn produced anything worth keeping (`fact` / `decision` / `preference` / `experience`). Worthwhile entries are appended to warm memory automatically; `SKIP` is emitted when nothing qualifies. This no longer depends on the model remembering to call `memory_append` on its own.
- **Threshold auto-consolidation** — when warm memory reaches `maxBytes × triggerRatio`, the plugin archives warm → `episodic/<date>.md` and merges the cold summary **before** writing the new entry. The model never hits a full-memory error and never has to schedule consolidation itself.

Both can be tuned under the `linghun.memory.assessment` / `linghun.memory.autoConsolidate` settings (each with an `enabled` switch), e.g. through `cordis.patch.yml`.

## Roadmap

- **v0.1.0** (done): identity + judgment + hippocampus
- **v0.2.0** (current): engineering memory guardrails — end-of-turn assessment + threshold auto-consolidation
- **v0.3.0**: LLM-distilled cold storage (checkpoint → episodic → knowledge with real summarization)
- **v0.4.0**: dual-instance mutual verification (criteria source bound to the verifier)

## Design philosophy

Memory is material; judgment is the subject. The LLM is the source of intuition;
the agent is the cognitive subject — each mirroring the other, each doing its own work.
What can be mechanized should not be left to improvisation.

## Credits

山越野人 × 岚客 (Shan Ye Yeren × Lingke) — carbon-silicon collaboration.

## License

MIT © 2026 山越野人 & 岚客
