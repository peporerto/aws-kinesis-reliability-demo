# CLAUDE.md — PayStream Pipeline

> Instructions for Claude Code. Read AGENTS.md first — it contains the full project constitution. This file adds Claude-specific workflow preferences.

---

## Read first

Before making any change, read:
1. `AGENTS.md` — project constitution and hard architectural rules
2. The relevant ADR in `/docs/adrs/` for the area you're touching

---

## How to work on this project

### Adding a new Lambda
1. Create `/lambda/<name>/` with `index.ts`, `package.json`, `tsconfig.json`
2. Add the bundling config in `lib/paystream-pipeline-stack.ts` following the existing pattern
3. Wire the event source mapping or API Gateway integration in the same stack file
4. Write a unit test in `/test/`

### Adding a new ADR
ADRs follow this structure:
```markdown
# ADR-XXX: Title

**Status**: Accepted | Proposed | Superseded  
**Date**: YYYY-MM

## Context
## Decision
## Rationale
## Tradeoff
```

File naming: `ADR-XXX-short-description.md` in `/docs/adrs/`

### Modifying DynamoDB access
Always check ADR-006 before writing any query. If you find yourself writing `Scan`, stop and use `QueryCommand` against `GSI_ByDate` instead.

### Modifying the AI reviewer
The reviewer script lives in `.github/scripts/adr_reviewer.py`. It uses LiteLLM — never replace it with a direct provider SDK. See ADR-007.

---

## Preferred patterns

```typescript
// Batch DynamoDB writes — use Promise.all, not sequential await
const writes = records.map(record => 
  dynamo.send(new PutCommand({ TableName, Item: record }))
);
await Promise.all(writes);

// Error handling in Lambda handlers
try {
  // processing logic
} catch (error) {
  console.error('Processing failed:', { error, recordId });
  throw error; // re-throw so Kinesis routes to DLQ
}

// Environment variables — always validate at startup
const TABLE_NAME = process.env.TABLE_NAME;
if (!TABLE_NAME) throw new Error('TABLE_NAME environment variable is required');
```

---

## Running the project

```bash
./scripts/localstack-start.sh   # start LocalStack
./scripts/cdk-deploy.sh         # deploy infrastructure
./scripts/load-test.sh          # send 5,000 test transactions
./scripts/dashboard.sh          # live monitoring
```