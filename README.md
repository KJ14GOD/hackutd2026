# hackutd2026: Theseus

An agent that modernizes legacy COBOL (AWS CardDemo) into Java one "pocket" at a time:
live traffic and code isolation pick what to migrate, shadow runs check each rewrite, and
when old and new disagree in a way nobody has decided, it asks the right person on Slack
and turns the answer into a test. HackUTD 2026 tracks: NVIDIA (Nemotron), SpacetimeDB, 8090.

## Try the UI (no backend needed)

```sh
cd web && npm install && npm run dev    # http://localhost:5173
```

A chip-style map of the real CardDemo codebase with Migration / Coupling / Blast radius /
Owners lenses, semantic zoom into each pocket, step-through flows, and a live shadowing
loop driven by mock data. See [web/README.md](web/README.md).

## Backend

pnpm workspace with a SpacetimeDB module, shared config, and services (segmenter, router,
agent, Slack bot) being built milestone by milestone. Setup and commands:
[CLAUDE.md](CLAUDE.md). Design docs: [docs/](docs/). Research: [research/](research/).
