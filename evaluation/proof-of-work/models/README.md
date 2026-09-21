# Model evaluation logs

Populated by (single pass, medium reasoning, one attempt per model):

```
npm run generate -- --model claude-opus-5
npm run score    -- --target workspace/claude-opus-5
npm run generate -- --model gpt-5.6-sol
npm run score    -- --target workspace/gpt-5.6-sol
```

Each model gets a folder here containing `generation.json` (parameters, token usage, parsed files),
`raw-response.txt` (the unedited model output) and `report.json` (per-check results, score,
and failure categories by requirement). Both scores must be below 30%.

STATUS: not yet run -- requires ANTHROPIC_API_KEY / OPENAI_API_KEY (see .env.example).
