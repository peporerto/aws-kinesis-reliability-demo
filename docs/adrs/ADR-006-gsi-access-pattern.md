# ADR-006: GSI Access Pattern over Table Scan for List Queries

**Status**: Accepted  
**Date**: 2026-03

## Context

The Query Lambda needs to list recent transactions for the dashboard and reporting use cases. The naive implementation is a DynamoDB `Scan`, which reads every record in the table sequentially.

## Decision

Add a **Global Secondary Index (`GSI_ByDate`)** with `entityType` as partition key and `processedAt` as sort key. All transactions are written with `entityType = "TRANSACTION"`.

## Rationale

`Scan` reads every item in the table regardless of the result set size. At 20M records, a `Scan` for the 50 most recent transactions still reads all 20M — consuming massive read capacity and taking seconds. Cost and latency scale linearly with table size.

`QueryCommand` against `GSI_ByDate` goes directly to the index partition containing all transactions, sorted by `processedAt`. It returns the 50 most recent records in milliseconds at any table size. Cost and latency are constant.

This is not a micro-optimization — it is the difference between a system that works at scale and one that doesn't.

## Known Limitation: Hot Partition Risk

Using a single `entityType = "TRANSACTION"` value for all records concentrates all GSI reads and writes into a single physical partition. DynamoDB limits each partition to 3,000 RCUs/second and 1,000 WCUs/second.

At demo scale (5,000 records, low read volume), this is acceptable.

## Production Evolution

Before exceeding ~1M records with significant read load, add a shard suffix:

```typescript
entityType: `TRANSACTION#${ulid().substring(0, 2)}`
```

This produces 36 possible prefix values (`00` through `ZZ`), distributing load across 36 physical GSI partitions. The Query Lambda fans out with 36 parallel `QueryCommand` calls and merges results by `processedAt` before returning.

The fan-out adds complexity and latency. It is the correct tradeoff at scale — 36 parallel queries at 5ms each is still faster and cheaper than a full table scan.

## Tradeoff

The hot partition design is a deliberate technical debt decision: simpler now, with a documented migration path for when scale demands it. The alternative — implementing shard fan-out from day one — adds significant complexity for zero benefit at current scale.
