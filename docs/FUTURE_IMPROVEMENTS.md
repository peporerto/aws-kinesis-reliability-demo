# Future Improvements

> What would come next if this system moved from demo to production. Ordered by impact and implementation complexity.

---

## Short Term

### API Authentication
Currently the API has no authentication. Any client can submit transactions or read data.

**Solution**: Add API Gateway API Keys for machine-to-machine access, or integrate AWS Cognito for user-level auth. CDK makes this a 10-line addition to the stack.

### Pagination on GET /transactions
The query Lambda returns a maximum of 50 transactions via `Limit: 50`. There is no cursor or pagination token.

**Solution**: Use DynamoDB's `LastEvaluatedKey` as a continuation token, return it in the API response, and accept it as a query parameter on subsequent requests.

### Input Schema Validation
The Generator Lambda validates only that `amount` and `currency` are present. It does not validate types, ranges, or allowed currency codes.

**Solution**: Add a JSON Schema validator (e.g., `ajv`) at the Generator layer before publishing to Kinesis. Reject invalid payloads at the entry point rather than letting them propagate downstream.

### SNS Anomaly Notifications
PayStream operates with specific transaction tiers. Amounts outside expected ranges should trigger an alert.

**Solution**: Add an SNS topic. The Processor Lambda publishes to SNS when `amount` falls outside allowed tiers. SNS fans out to email, Slack, and an audit Lambda. This pattern decouples the alerting logic from the processing logic.

---

## Medium Term

### GSI Partition Sharding
The current `GSI_ByDate` index uses `entityType = "TRANSACTION"` for all records, creating a hot partition risk at scale.

**Solution**:
```typescript
entityType: `TRANSACTION#${ulid().substring(0, 2)}`
```
36 possible prefixes distribute load across 36 physical partitions. The query layer fans out across all prefixes and merges results. Required before exceeding ~1M records with significant read load.

### DAX Caching Layer
For read-heavy use cases (merchant dashboards, reporting), DynamoDB direct reads add 1–10ms latency per request.

**Solution**: Add DAX (DynamoDB Accelerator) in front of DynamoDB for the Query Lambda. DAX provides microsecond latency for repeated reads. Note: DAX is not available in LocalStack Community — requires real AWS or LocalStack Pro for local testing.

### Dead Letter Queue Alerting
Currently the DLQ is monitored manually via the dashboard script. In production, DLQ growth should trigger an automated alert.

**Solution**: Add a CloudWatch Alarm on `ApproximateNumberOfMessagesVisible > 0` for the DLQ, with an SNS action that pages the on-call engineer.

---

## Long Term

### Multi-Region Replication
PayStream operates in Canada. A single-region deployment means a regional AWS outage takes down the entire payment pipeline.

**Solution**: DynamoDB Global Tables for active-active replication across `ca-central-1` and `us-east-1`. Kinesis does not support cross-region replication natively — this would require a Lambda-based replication layer or migration to EventBridge.

### CI/CD Pipeline
Currently deployment is manual via `./scripts/localstack-start.sh`. In production, every merge to `main` should trigger automated tests and deployment.

**Solution**: GitHub Actions workflow with three stages:
1. Unit tests (`npm test`)
2. CDK diff against staging environment
3. CDK deploy to production on approval

### Full Observability Stack
LocalStack's CloudWatch metrics are limited. In production, the system needs structured observability.

**Solution**:
- **Metrics**: CloudWatch custom metrics for throughput, latency, and error rate
- **Tracing**: AWS X-Ray for end-to-end request tracing across Lambda → DynamoDB
- **Logs**: Structured JSON logging with correlation IDs that trace a transaction from API Gateway through to DynamoDB write
- **Dashboards**: Grafana connected to CloudWatch for business-level visibility

### Migration to Real AWS
The entire system runs on LocalStack for cost-free development. Moving to real AWS requires:
1. Remove all `endpoint` overrides from Lambda DynamoDB/Kinesis clients
2. Replace `test/test` AWS credentials with real IAM roles
3. Update CDK environment to target a real AWS account and region
4. Run a smoke test with 100 transactions before full load

The CDK stack is already production-compatible — no structural changes required.
