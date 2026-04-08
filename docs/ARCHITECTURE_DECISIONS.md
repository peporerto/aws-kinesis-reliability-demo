# Architecture Decision Records (ADR)

> This document captures the technical rationale behind every significant design decision in the PayStream Pipeline. Written so that future maintainers — including future me — understand not just *what* was built, but *why*.

---

## ADR-001: Kinesis Data Streams over SQS for Ingestion

**Status**: Accepted  
**Date**: 2026-03

### Context

PayStream needed a way to ingest thousands of payment events per second reliably. Two obvious candidates: SQS and Kinesis.

### Decision

Use **AWS Kinesis Data Streams** as the ingestion backbone.

### Rationale

| Requirement | Kinesis | SQS |
|-------------|---------|-----|
| Message ordering per merchant | ✅ Guaranteed within shard | ❌ Best-effort only |
| Multiple consumers reading same stream | ✅ Native support | ❌ Competing consumers |
| Event replay from a timestamp | ✅ Up to 24h retention | ❌ Once consumed, gone |
| High-throughput burst handling | ✅ Designed for streaming | ⚠️ Possible but not primary use |

For financial transactions, ordering matters. If two events arrive for the same merchant out of order and the second overwrites the first, the audit trail is corrupted. Kinesis guarantees ordering within a shard via `PartitionKey`.

### Tradeoff

Kinesis charges ~$11–15 CAD/month per shard regardless of usage. For a pure queuing use case, SQS would be cheaper. We accepted this cost because the streaming semantics and ordering guarantees justify it for a fintech context.

---

## ADR-002: DynamoDB Billing Mode — On-Demand over Provisioned

**Status**: Accepted  
**Date**: 2026-03

### Context

Initial implementation used `PROVISIONED` mode with `writeCapacity: 2`. During load testing with 5,000 transactions, DynamoDB throttled writes with `ProvisionedThroughputExceededException`, causing data loss.

### Decision

Switch to **`PAY_PER_REQUEST` (On-Demand)** billing.

### Rationale

PayStream's traffic is bursty by nature — quiet during off-hours, spikes during business hours and payment cycles. Provisioned capacity forces you to size for the peak, which means paying for idle capacity 90% of the time, and still risking throttling if the peak exceeds estimates.

On-Demand scales instantly to any throughput with no configuration. For a system where data loss is unacceptable, this is the correct default.

### Tradeoff

On-Demand costs more per request than Provisioned at sustained high volume. The crossover point is roughly 60–70% sustained utilization. For PayStream's bursty pattern, On-Demand is more cost-effective and eliminates throttling entirely.

---

## ADR-003: ULID over UUID for Transaction Identification

**Status**: Accepted  
**Date**: 2026-03

### Context

Transactions need unique identifiers. The obvious choice is UUID v4. We chose differently.

### Decision

Use **ULID** (Universally Unique Lexicographically Sortable Identifier) generated server-side by the Generator Lambda.

### Rationale

- **Lexicographic sorting**: ULIDs sort chronologically by default. This means DynamoDB's GSI naturally returns transactions in time order without an explicit sort step.
- **Server-side generation**: The client never controls the transaction ID. This prevents ID injection attacks and guarantees canonical identity assignment.
- **URL-friendly**: ULIDs are 26 characters, uppercase, no hyphens. Cleaner in API responses and logs.

### Tradeoff

ULIDs require an external library (`ulid`). UUID v4 is native in modern Node.js. The sorting benefit justifies the dependency.

---

## ADR-004: Lambda Memory — 256MB over Default 128MB

**Status**: Accepted  
**Date**: 2026-03

### Context

CDK defaults Lambda memory to 128MB. During load testing, Processor Lambda execution times averaged 400–500ms per batch.

### Decision

Set **256MB** memory on all Lambdas.

### Rationale

AWS allocates CPU proportionally to memory. Doubling memory doubles the CPU available to the function. Because Lambda billing is `memory × duration`, a function that runs twice as fast at twice the memory costs the same — but in practice, the speedup is often more than 2x due to reduced I/O wait time, resulting in net cost savings.

For the Processor Lambda handling 100-event batches with concurrent DynamoDB writes, the additional CPU meaningfully reduces p99 latency.

### Tradeoff

Higher memory means higher cost if the function is slow for reasons unrelated to CPU (e.g., network latency). Monitor execution duration before increasing memory further.

---

## ADR-005: SQS Dead Letter Queue over Kinesis Native DLQ

**Status**: Accepted  
**Date**: 2026-03

### Context

Kinesis has a native `OnFailureDestination` that can route failed batches to S3 or SQS. We could have used this without adding an explicit SQS resource.

### Decision

Define an **explicit SQS Queue as DLQ** and configure it as the `onFailure` destination for the Kinesis event source mapping.

### Rationale

- **Decoupled retry logic**: The Retrier Lambda can implement its own backoff strategy independently of the stream's retry behavior.
- **Visibility**: SQS provides `ApproximateNumberOfMessages`, making it easy to alert on DLQ growth.
- **Portfolio clarity**: Using two distinct AWS messaging services demonstrates knowledge of both patterns and when to combine them.

### Tradeoff

Adds one more resource to the CDK stack. The operational overhead is minimal given CDK manages it declaratively.

---

## ADR-006: GSI Pattern for DynamoDB List Queries

**Status**: Accepted  
**Date**: 2026-03

### Context

The query API needed to list recent transactions. The naive approach was `Scan`, which reads every record in the table. At 20M records, `Scan` is unacceptable — it consumes massive read capacity and takes seconds.

### Decision

Add a **Global Secondary Index (`GSI_ByDate`)** with `entityType` as partition key and `processedAt` as sort key. Every transaction is written with `entityType = "TRANSACTION"`.

### Rationale

This allows `QueryCommand` against the GSI, which goes directly to the index partition containing all transactions, sorted by time. At any scale, this returns results in milliseconds.

### Known Limitation

Using a single `entityType` value for all records creates a **hot partition** in the GSI. DynamoDB limits each partition to 3,000 RCUs/second. At 20M+ records with high read volume, this becomes a bottleneck.

### Production Evolution

Add a shard suffix to `entityType`:
```typescript
entityType: `TRANSACTION#${ulid().substring(0, 2)}`
```
This distributes reads across 36 GSI partitions. The query layer would then fan out across all shards and merge results. For the current demo scale, the single partition approach is sufficient.
