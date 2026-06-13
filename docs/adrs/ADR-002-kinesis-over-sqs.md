    # ADR-002: Kinesis Data Streams over SQS for Ingestion

    **Status**: Accepted  
    **Date**: 2026-03

    ## Context

    With event-driven architecture established (ADR-001), PayStream needed a streaming backbone. Two obvious candidates: AWS SQS and AWS Kinesis Data Streams.

    ## Decision

    Use **AWS Kinesis Data Streams** as the ingestion backbone.

    ## Rationale

    | Requirement | Kinesis | SQS |
    |-------------|---------|-----|
    | Message ordering per merchant | ✅ Guaranteed within shard | ❌ Best-effort only |
    | Multiple consumers reading same stream | ✅ Native fan-out | ❌ Competing consumers |
    | Event replay from a timestamp | ✅ Up to 24h retention | ❌ Once consumed, gone |
    | High-throughput burst handling | ✅ Designed for streaming | ⚠️ Possible but not primary use |

    For financial transactions, ordering and traceability matter. Kinesis guarantees ordering within a shard via `PartitionKey` — we use `transactionId` as the partition key, guaranteeing that each transaction is processed exactly once and enabling end-to-end traceability across the pipeline.

    Event replay is a compliance requirement. If the Processor Lambda has a bug and corrupts records, Kinesis allows replaying the stream from a known-good timestamp. SQS does not.


    ## Tradeoff

   Kinesis charges ~$11–15 CAD/month per shard regardless of usage. For a pure queuing use case with no ordering or replay requirements, SQS is cheaper and simpler. We accepted the cost because the streaming semantics justify it for a fintech context.


   At very high volume (>1,000 events/second per shard), Kinesis requires shard splitting. SQS scales transparently. This is a known scaling ceiling to revisit at production volume.

