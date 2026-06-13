# ADR-005: Explicit SQS Dead Letter Queue over Kinesis Native Failure Handling

**Status**: Accepted  
**Date**: 2026-03

## Context

In an event-driven pipeline, processing failures are inevitable — malformed payloads, transient DynamoDB errors, downstream timeouts. The system needs a strategy for what happens to events that cannot be processed.

Kinesis has a native `OnFailureDestination` that can route failed batches to S3 or SQS automatically. We could have relied on this without adding an explicit SQS resource to the stack.

## Decision

Define an **explicit SQS Queue as DLQ** with a dedicated **Retrier Lambda** that implements exponential backoff recovery.

```
Kinesis → Processor Lambda
                ↓ (on failure)
          SQS Dead Letter Queue
                ↓ (every 30s)
          Retrier Lambda
                ↓ (exponential backoff: 2s → 4s → 8s → 16s)
          DynamoDB
```

## Rationale

**Decoupled retry logic**: The Retrier Lambda owns its backoff strategy independently of Kinesis stream behavior. Kinesis retry semantics (bisect-on-error, retry attempts) are separate from DLQ retry semantics. Keeping them separate means each can be tuned without affecting the other.

**Observability**: SQS exposes `ApproximateNumberOfMessagesVisible` as a CloudWatch metric. A DLQ growing above zero is an operational signal that maps directly to a CloudWatch Alarm. Kinesis native failure handling does not provide this granularity.

**Zero data loss guarantee**: The explicit DLQ makes the failure path a first-class architectural concern, not an afterthought. Events that cannot be processed are never discarded — they wait in the DLQ until the Retrier recovers them.

## Tradeoff

Adds one SQS Queue and one Lambda to the CDK stack. The operational overhead is minimal — CDK manages both declaratively. The complexity cost is justified by the visibility and control gained over the failure path.

## Production Note

In production, the DLQ should have a CloudWatch Alarm on `ApproximateNumberOfMessagesVisible > 0` with an SNS notification to the on-call engineer. A growing DLQ means events are failing to process — this is a payment pipeline incident, not background noise.
