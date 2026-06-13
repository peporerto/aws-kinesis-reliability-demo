# ADR-004: ULID over UUID for Transaction Identification

**Status**: Accepted  
**Date**: 2026-03

## Context

Every transaction needs a unique, immutable identifier assigned at ingestion time. The standard choice is UUID v4. We evaluated whether the standard choice was the right choice.

## Decision

Use **ULID** (Universally Unique Lexicographically Sortable Identifier) generated server-side by the Generator Lambda.

## Rationale

**Lexicographic sorting**: ULIDs encode a millisecond-precision timestamp in their first 10 characters. This means they sort chronologically by default. DynamoDB's `GSI_ByDate` index naturally returns transactions in time order without an explicit sort attribute — the ULID *is* the sort key.

**Server-side generation**: The Generator Lambda assigns the ULID before publishing to Kinesis. The client never controls the transaction ID. This prevents ID injection attacks where a malicious client could supply a crafted ID to overwrite an existing record in DynamoDB (which uses `transactionId` as the primary key).

**Readability**: ULIDs are 26 characters, uppercase alphanumeric, no hyphens. Cleaner in logs, API responses, and URLs than UUID's `550e8400-e29b-41d4-a716-446655440000`.

## Tradeoff

ULIDs require an external library (`ulid`). UUID v4 is available natively in Node.js 19+ via `crypto.randomUUID()`. The added dependency is justified by the sorting and security benefits.

ULIDs generated within the same millisecond are not strictly monotonic — the random component can produce values that sort before earlier ones within the same millisecond. For PayStream's use case (transaction ordering at second-level granularity), this is acceptable.
