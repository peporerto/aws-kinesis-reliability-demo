# AGENTS.md — PayStream Pipeline

./scripts/init-check.sh

> Project constitution for AI coding agents. This file is the authoritative source of constraints, conventions, and architectural rules. Any agent working on this codebase must read this file before making changes.

---

## What this project is

PayStream Pipeline is a serverless, event-driven transaction ingestion system built on AWS. It decouples transaction acceptance from processing, guaranteeing that no payment event is lost under load or infrastructure failure.

This is a **portfolio project** demonstrating production-grade backend engineering and AI-assisted governance. It runs locally via LocalStack.

---

## Architecture constraints

All architectural decisions are documented in `/docs/adrs/`. Before making any structural change, read the relevant ADR. The ADRs are the source of truth — not comments, not the README.

### Hard rules derived from ADRs

**From ADR-001 (Event-driven architecture)**
- Never write directly from an API handler to DynamoDB
- Transaction acceptance and transaction persistence must be decoupled via the stream

**From ADR-002 (Kinesis)**
- Do not replace Kinesis with SQS for the main ingestion path
- Use `transactionId` as the Kinesis `PartitionKey` — guarantees per-transaction traceability and exactly-once processing

**From ADR-003 (DynamoDB)**
- Do not introduce a relational database for primary storage
- If analytics queries are needed, build a secondary read model — do not add JOINs

**From ADR-004 (ULID)**
- Always generate `transactionId` server-side in the Generator Lambda
- Never accept a client-supplied transaction ID
- Use the `ulid` library — do not use `crypto.randomUUID()`

**From ADR-005 (DLQ)**
- Never silently discard a failed event
- All Kinesis processing failures must route to the SQS DLQ

**From ADR-006 (GSI)**
- Never use `Scan` on the transactions table
- All list queries must go through `GSI_ByDate` via `QueryCommand`

**From ADR-007 (Model-agnostic AI)**
- Never hardcode an LLM provider SDK in the reviewer script
- Always use LiteLLM with `REVIEW_MODEL` from environment

---

## Code conventions

### Language and runtime
- TypeScript strict mode everywhere — `"strict": true` in all `tsconfig.json`
- No `any` types — use `unknown` and narrow explicitly
- Node.js 20 for all Lambda functions

### Lambda functions
- Each Lambda lives in its own directory under `/lambda/`
- Each Lambda has its own `package.json` and `tsconfig.json`
- Handler is always exported as `export const handler`
- Never share `node_modules` between Lambdas — each bundles independently

### Infrastructure
- All infrastructure is defined in CDK TypeScript — never raw CloudFormation
- No hardcoded ARNs or resource names — use CDK references
- Environment variables for all cross-resource references

### Error handling
- Lambda handlers must never throw unhandled exceptions
- All errors must be logged with `console.error` before any re-throw
- DLQ routing handles irrecoverable failures — do not implement infinite retry loops in Lambda

### Testing
- Jest for all unit tests
- Test files live in `/test/`
- Run tests with `npm test` from the project root

---

## What not to do

- Do not add a REST framework (Express, Fastify) inside a Lambda — API Gateway handles routing
- Do not use `await` inside a loop when batch operations are available — use `Promise.all`
- Do not log sensitive data (amounts, currency, transaction IDs in plaintext) in production paths
- Do not modify `cdk.out/` — it is generated, not source

---

## Security constraints

- Never log payload fields (amount, currency, transactionId) — use structured 
  logging with only the transactionId masked: log the first 4 chars only
- All resource names via environment variables — never hardcoded strings 
  referencing table names, stream names, or queue URLs
- Always validate input at the Generator Lambda boundary before publishing 
  to Kinesis — reject missing or invalid amount/currency with 400, never 
  let malformed data enter the stream

## Local development

```bash
# Start LocalStack and deploy full stack
./scripts/localstack-start.sh
./scripts/cdk-deploy.sh

# Run load test (5,000 transactions)
./scripts/load-test.sh

# Live dashboard
./scripts/dashboard.sh

# Destroy environment
cdklocal destroy && localstack stop
```

Requires: Docker, LocalStack, AWS CDK, Node.js 20+, AWS CLI configured with `test/test` credentials.

---

## ADR governance

This project includes an automated ADR reviewer that runs on every Pull Request via GitHub Actions. The reviewer uses an LLM (configured via `REVIEW_MODEL`) to detect ADR violations in code diffs.

If the reviewer flags a violation, either:
1. Fix the code to comply with the ADR, or
2. If the violation is intentional, update the relevant ADR first and explain the evolution

Never merge code that silently violates a documented architectural decision.