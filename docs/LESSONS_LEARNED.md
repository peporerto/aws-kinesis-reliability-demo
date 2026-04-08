# Lessons Learned — The War Log

> Problems encountered, root causes identified, and solutions implemented during the PayStream Pipeline build. Format: Problem → Root Cause → Solution → Production Note.

---

## 1. LocalStack DLQ Payload Structure Differs from Real AWS

**Problem**: The Retrier Lambda crashed on every DLQ message with `Cannot read properties of undefined (reading 'data')`.

**Root Cause**: When LocalStack routes a failed Kinesis batch to SQS via `onFailure`, it wraps the payload under `requestPayload.Records[0].kinesis.data`. Real AWS uses a different envelope format. Neither matches a naive `body.kinesis.data` access.

**Solution**: Implemented a defensive fallback chain covering all known envelope formats:
```typescript
const kinesisData = body.requestPayload?.Records?.[0]?.kinesis?.data
    || body.responsePayload?.Records?.[0]?.kinesis?.data
    || body.kinesis?.data
    || body.data;
```

If none of the paths resolve, the record is logged and skipped — the function does not crash.

**Production Note**: In real AWS, the DLQ message structure follows the Lambda Destinations format which differs again. Before deploying to production, log the raw SQS body in a staging environment and verify the correct path before assuming LocalStack behavior matches.

---

## 2. Payload Field Name Mismatch Between Generator and Processor

**Problem**: DynamoDB count stayed at 1 after sending 5,000 events. No errors, no DLQ messages. Silent data loss.

**Root Cause**: The Generator Lambda sent `{ id: transactionId }` but the Processor Lambda validated `payload.transactionId`. The validation check `if (!payload.transactionId)` evaluated to `true` for every record, causing all 5,000 to be silently skipped with `continue`.

**Solution**: Standardized the field name across the entire pipeline:
```typescript
// Generator — what goes into Kinesis
const transaction = {
    transactionId: transactionId,  // was: id
    amount: body.amount,
    currency: body.currency,
};

// Processor — what gets validated
if (!payload.transactionId || !payload.amount || !payload.currency) {
    console.error('Invalid payload:', rawData);
    continue;
}
```

**Lesson**: In event-driven systems, the contract between producer and consumer is implicit. There is no compiler to catch field name mismatches across Lambda boundaries. Document the event schema explicitly or use a shared TypeScript interface.

---

## 3. CDK Ghost State Blocks Redeployment

**Problem**: After manually deleting a Kinesis stream to reset state, `cdklocal deploy` reported `no changes` but the stream didn't exist. Subsequent `put-record` calls returned `ResourceNotFoundException`.

**Root Cause**: CloudFormation's state (stored in LocalStack) still showed the stream as existing. CDK diffed against this stale state and concluded nothing needed to change.

**Solution**:
```bash
cdklocal destroy   # wipes CloudFormation state
cdklocal deploy    # rebuilds from scratch
```

**Lesson**: Never manually delete resources that CDK manages. If you need to reset, always go through `cdk destroy`. Manual intervention creates state drift that is difficult to recover from without a full destroy.

---

## 4. Event Source Mapping Not Registered After Redeploy

**Problem**: After a destroy and redeploy cycle, `ConsumerCount: 0` on the Kinesis stream. Events were entering the stream but the Processor Lambda was never triggered.

**Root Cause**: LocalStack retained a ghost event source mapping UUID from the previous deployment. When CDK tried to create a new mapping, LocalStack returned `ResourceConflictException`. The deploy rolled back, leaving the stack in `ROLLBACK_COMPLETE` with no active mapping.

**Solution**:
```bash
aws --endpoint-url=http://localhost:4566 lambda delete-event-source-mapping \
  --uuid 
cdklocal destroy
cdklocal deploy
```

**Lesson**: LocalStack Community has occasional state persistence bugs across destroy/deploy cycles. The `start-dev.sh` script was created specifically to automate a clean startup sequence and avoid manual intervention.

---

## 5. DynamoDB Throttling Under Provisioned Capacity

**Problem**: Initial load test with `writeCapacity: 2` resulted in massive DLQ growth. DynamoDB was rejecting writes with `ProvisionedThroughputExceededException`.

**Root Cause**: `writeCapacity: 2` means 2 write units per second. Sending 5,000 events in under 2 minutes — roughly 42 writes per second — exceeded this by 20x.

**Solution**: Switched to `PAY_PER_REQUEST` (On-Demand) billing mode, which has no write limit.

**Lesson**: Never use Provisioned capacity in a development environment where load is unpredictable. Use On-Demand for dev/test, and only switch to Provisioned in production when you have 30+ days of traffic data to size against.

---

## 6. Lambda Bundling Fails Without Root User

**Problem**: `cdk deploy` failed with permission errors during the Docker bundling step when trying to write to `/asset-output`.

**Root Cause**: CDK's bundling Docker container runs as a non-root user by default. The build commands (`npm install`, `tsc`) create files that the non-root user cannot copy to the output volume.

**Solution**: Added `user: 'root'` to all bundling configurations:
```typescript
bundling: {
    image: lambda.Runtime.NODEJS_20_X.bundlingImage,
    user: 'root',
    command: [
        'bash', '-c',
        'npm install --cache /tmp/.npm && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/',
    ],
},
```

**Lesson**: Always set `user: 'root'` in CDK bundling configs when running on Linux. This is not needed on Mac due to Docker Desktop's volume permission handling, which is why many tutorials omit it.

---

## 7. Hot Partition Risk in GSI Design

**Problem**: The `GSI_ByDate` index uses `entityType = "TRANSACTION"` as its partition key for all records. This concentrates all reads and writes into a single GSI partition.

**Root Cause**: DynamoDB distributes data across physical partitions based on partition key. If all records share the same key, all traffic hits one partition, which is limited to 3,000 RCUs/second and 1,000 WCUs/second.

**Current Status**: Acceptable at demo scale (5,000 records, low read volume).

**Production Solution**:
```typescript
entityType: `TRANSACTION#${ulid().substring(0, 2)}`
```
This creates 36 possible prefix values, spreading load across 36 GSI partitions. The query layer fans out across all prefixes and merges results client-side.

**Lesson**: GSI design decisions made at small scale become architectural constraints at large scale. Document the limitation now, not when you're getting paged at 3am.
