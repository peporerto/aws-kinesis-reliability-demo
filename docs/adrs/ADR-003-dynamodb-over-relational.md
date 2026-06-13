# ADR-003: DynamoDB over Relational Database for Transaction Storage

**Status**: Accepted  
**Date**: 2026-03

## Context

PayStream needs to persist transaction records with the following access patterns:

1. Write a single transaction by `transactionId` (from the Processor Lambda)
2. Read a single transaction by `transactionId` (point lookup)
3. List recent transactions sorted by time (dashboard, reporting)

The system is serverless — there is no persistent compute layer to maintain a connection pool. Transactions are write-heavy with bursty traffic patterns.

## Decision

Use **AWS DynamoDB** (On-Demand billing, with a GSI for time-range queries) as the primary data store.

## Rationale

- **Serverless-native**: DynamoDB has no connection pool. Each Lambda invocation connects, writes, and disconnects without the connection exhaustion problems that plague RDS + Lambda architectures at scale.
- **Throughput scaling**: On-Demand mode scales to any write throughput instantly. RDS requires vertical scaling or read replicas, both of which require downtime or complex failover.
- **Operational overhead**: DynamoDB is fully managed. No patching, no backups to configure, no storage management. For a lean fintech pipeline, this matters.
- **Access pattern fit**: PayStream's three access patterns map cleanly to DynamoDB primitives — `PutItem` by primary key, `GetItem` by primary key, and `Query` against a GSI. There are no JOIN requirements.

## Tradeoff

DynamoDB is not suitable if requirements change to include:
- Ad-hoc queries across arbitrary fields
- Complex aggregations (sum of transactions by currency, by merchant)
- Relational integrity constraints between entities

If PayStream evolves to need merchant analytics or cross-entity reporting, a secondary read model (e.g., DynamoDB Streams → Lambda → PostgreSQL) would be the correct evolution rather than migrating primary storage.

## On-Demand vs Provisioned

Initial implementation used `PROVISIONED` mode with `writeCapacity: 2`. Load testing with 5,000 transactions triggered `ProvisionedThroughputExceededException` and data loss. Switched to `PAY_PER_REQUEST` (On-Demand).

On-Demand costs more per request at sustained high volume — the crossover is roughly 60–70% utilization. For PayStream's bursty pattern, On-Demand is more cost-effective and eliminates throttling entirely.
