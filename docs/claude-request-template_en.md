# Request template for Claude — complex tasks

This template structures a request that requires medium-to-high complexity
analysis or work, so Claude can start full-speed without asking
clarification questions.

**When to use it:** designing a new feature, non-trivial refactor,
multi-file bug investigation, architecture choices. **Not needed for** a
quick question or a one-line fix.

**Priority sections** if you're short on time: 1, 2, 6, 8.

---

```markdown
# Request: <short title>

## 1. Context
<2-4 sentences: where we are, why this request is coming up now.
Ex: "v2.12.0 just shipped. I want to prepare the next step for ECCC Phase B alerts."
Include any commits / PRs / files already touched if relevant.>

## 2. Goal
<One sentence. The concrete result expected.
Ex: "Design the architecture for displaying ECCC alerts on the radar map."
If it's exploratory, say so: "I want options, not an implementation.">

## 3. Constraints & non-negotiables
- <Ex: No new external service>
- <Ex: Must work on Bullseye 32-bit>
- <Ex: No additional API keys>
- <Ex: No changes to AppContext.js>

## 4. Out of scope (do NOT do)
- <Ex: Don't touch the Settings component>
- <Ex: Don't refactor proxyCtrl.js even if tempting>

## 5. Inputs / references
- Relevant files: <path:line when possible>
- Docs: <docs/xxx.md>
- PRs / commits: <#102, 6c20f95>
- External links: <spec URL, API doc>

## 6. Expected deliverable
<Check what applies:>
- [ ] Analysis + recommendation (no code)
- [ ] Step-by-step implementation plan
- [ ] Code ready to commit
- [ ] Pull request opened
- [ ] Options comparison (1/2/3 + recommendation)

Format: <Ex: "answer in French, numbered options, max 200 words per option">

## 7. Success criteria
<How will I know it's good?
Ex: "Build passes + alert displays on the map without flicker + FR/EN/ES translations done.">

## 8. Autonomy level
<One of three:>
- 🟢 Go autonomous — decide and execute, I'll review at the end
- 🟡 Plan first — propose, I approve, then you execute
- 🔴 Step by step — confirm each sub-task

## 9. Notes / paths already explored
<What you've already tried or ruled out, to avoid me redoing the work.
Ex: "I looked at the WebSocket option — abandoned, too heavy for the Pi.">
```

---

## Practical usage rules

- Sections **1, 2, 6, 8** give the highest return. If you only have time
  for four sections, pick these.
- Section **4 (out of scope)** saves a lot of time: it prevents Claude
  from drifting into a surprise refactor.
- Section **8 (autonomy)**: omit if your usual preferences apply (Claude
  has them in memory). Fill it in explicitly only when you want to
  override the default for this request.
- For very small requests (one-line bug, quick question), skip the
  template — it's meant for medium-to-large tasks.

## Versions

- 🇫🇷 Français — [`claude-request-template_fr.md`](claude-request-template_fr.md)
- 🇬🇧 English — this document
- 🇪🇸 Español — [`claude-request-template_es.md`](claude-request-template_es.md)
