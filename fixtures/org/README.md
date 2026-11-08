# Harbor Card: the synthetic org for the demo (`fixtures/org`)

AWS CardDemo has no tickets, wiki or chat, so the demo needs a company around it. These files are that
company's scattered knowledge, and the source of truth for seeding real tools:

| File | Seeded into | Read back by |
|---|---|---|
| `hr.json` | stays a file (a Workday-style export) | `services/people` HR connector |
| `github.json` | a private GitHub repo with authored, back-dated commits and CODEOWNERS | GitHub REST connector |
| `jira.json` | a Jira Cloud project `CARD` | Jira REST connector |
| `notion.json` | a Notion database "Harbor Card wiki" | Notion REST connector |
| `slack.json` | Slack channels in the demo workspace | Slack Web API connector |

These files are only the seeders' input (and the offline tests'). The connectors read the real tools; a tool that's
unreachable is reported and skipped, never replaced by its file.

`answer-key.md` says what each planted fact should produce. It is written first and never read by the
pipeline; tests compare the pipeline's output with it.

## Seeding the real tools

```sh
node fixtures/org/seed-github.mjs KJ14GOD/harborcard-mainframe <workdir>   # then gh repo create ... --push
npx tsx services/people/src/seed.ts slack|jira|notion|all
npx tsx services/people/src/cli.ts        # builds out/people/org.json from every source
```

- **Slack** bot scopes: `channels:manage`, `channels:read`, `channels:history`, `channels:join`,
  `chat:write.public`, `chat:write.customize`. Messages are posted under each person's name, with their
  email and original date in message metadata (Slack can't backdate).
- **Jira** assigns its own issue numbers, so each ticket keeps its planned key, reporter, assignee and date
  in a footer (`Original key: CARD-88`), which the connector reads.
- **Notion** pages are created by the integration, so the wiki database has an `Owner` email property.
