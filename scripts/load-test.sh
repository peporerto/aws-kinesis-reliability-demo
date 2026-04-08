#!/bin/bash

# 1. Load API_ID from .env
if [ -f .env ]; then
  export API_ID=$(grep API_ID .env | cut -d '=' -f2)
  echo "✅ API_ID loaded: $API_ID"
fi

# 2. If no API_ID in .env, search for it automatically
if [ -z "$API_ID" ]; then
  API_ID=$(aws --endpoint-url=http://localhost:4566 apigateway get-rest-apis --query "items[0].id" --output text)
  echo "🔍 API_ID found automatically: $API_ID"
fi

# 3. THE WINNING URL (Native LocalStack format with injected API_ID)
BASE_URL="http://localhost:4566/restapis/$API_ID/prod/_user_request_/transactions"

TOTAL=5000
BATCH=50
DELAY=0.1
SUCCESS=0
FAILED=0

echo "🚀 Starting load test: $TOTAL transactions"
echo "🔗 Destination URL: $BASE_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for ((i=1; i<=TOTAL; i++)); do
  # Generate random amount
  AMOUNT=$(awk "BEGIN {printf \"%.2f\", $RANDOM/100 + 1}")
  
  # Send event in the format expected by the Lambda
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL" \
    -H "Content-Type: application/json" \
    -d "{
      \"transactionId\": \"trans-$i-$RANDOM\", 
      \"amount\": $AMOUNT, 
      \"currency\": \"USD\",
      \"entityType\": \"TRANSACTION\",
      \"processedAt\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"
    }")

  # Validate success (200, 201 or 202)
  if [[ "$RESPONSE" =~ ^(200|201|202)$ ]]; then
    ((SUCCESS++))
  else
    ((FAILED++))
  fi

  # Progress report every 100
  if (( i % 100 == 0 )); then
    echo " Progress: $i/$TOTAL | ✅ $SUCCESS | ❌ $FAILED"
  fi

  # Small pause to avoid saturating the socket
  if (( i % BATCH == 0 )); then
    sleep $DELAY
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Test finished: $SUCCESS successes | $FAILED failures"
echo " See real count: aws --endpoint-url=http://localhost:4566 dynamodb scan --table-name Transactions --select COUNT"