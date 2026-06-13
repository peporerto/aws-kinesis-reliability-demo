# ADR-001: Event-Driven Architecture over Direct Database Writes

**Status**: Accepted  
**Date**: 2026-03

## Context

On Black Friday 2023, PayStream's original system wrote transactions directly from the API layer to the database. Under peak load, this caused service degradation and potential transaction loss — a regulatory incident for a payment processor.

The core problem: synchronous direct writes couple transaction acceptance tightly to database throughput. When the database slows down or becomes unavailable, the entire ingestion pipeline stalls.

## Decision

Adopt an **event-driven architecture** that decouples transaction acceptance from transaction processing.

```
Client → API Gateway → Lambda (accept) → Stream → Lambda (process) → Database
```

Transaction acceptance and transaction persistence become independent operations. The API acknowledges the client as soon as the event is published to the stream — not when it lands in the database.

## Rationale

- **Resilience**: The database can be slow, throttled, or temporarily unavailable without affecting the client-facing API. Events buffer in the stream.
- **Scalability**: Ingestion and processing scale independently. The stream absorbs bursts that would overwhelm direct writes.
- **Auditability**: Every event is immutable and replayable. The stream is the source of truth for what happened, not just the database state.
- **Failure isolation**: A processing failure does not cause a client error. It routes to the DLQ for retry. Nothing is lost.

## Tradeoff

Event-driven systems are eventually consistent. The API returns a `transactionId` before the record exists in DynamoDB. A client polling immediately after submission may get a 404. For PayStream's use case — asynchronous payment processing — this is acceptable. A synchronous read-your-write guarantee would require waiting for DynamoDB confirmation, defeating the decoupling benefit.

## Consequences

All subsequent architectural decisions (Kinesis, DLQ, Retrier, GSI) are downstream of this choice. This is the foundational decision of the system.
