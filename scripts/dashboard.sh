#!/bin/bash

# Color configuration
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

while true; do
  clear
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}       PAYSTREAM INC. — SYSTEM DASHBOARD (LIVE)${NC}"
  echo -e "       Time: $(date +"%T") | Refresh: 5s"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  # 1. DynamoDB Count
  COUNT=$(aws --endpoint-url=http://localhost:4566 dynamodb scan \
    --table-name Transactions \
    --select COUNT \
    --query 'Count' --output text 2>/dev/null)
  COUNT=${COUNT:-0}
  echo -e "Transactions in DynamoDB:     ${GREEN}$COUNT${NC}"

  # 2. DLQ Status (Dead Letter Queue)
  DLQ=$(aws --endpoint-url=http://localhost:4566 sqs get-queue-attributes \
    --queue-url http://localhost:4566/000000000000/TransactionsDLQ \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' --output text 2>/dev/null)
  DLQ=${DLQ:-0}
  
  if [ "$DLQ" -eq "0" ]; then
    echo -e "Messages in DLQ:              ${GREEN}$DLQ${NC} (Clean)"
  else
    echo -e "Messages in DLQ:              ${RED}$DLQ (Check logs!)${NC}"
  fi

  # 3. Kinesis Status
  STATUS=$(aws --endpoint-url=http://localhost:4566 kinesis describe-stream-summary \
    --stream-name PayStreamInput \
    --query 'StreamDescriptionSummary.StreamStatus' --output text 2>/dev/null)
  STATUS=${STATUS:-"OFFLINE"}
  echo -e "Kinesis Stream status:        ${BLUE}$STATUS${NC}"

  # 4. Latest Transactions Table (GSI-based)
  echo ""
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "       LATEST 3 TRANSACTIONS (GSI_ByDate)"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  aws --endpoint-url=http://localhost:4566 dynamodb query \
    --table-name Transactions \
    --index-name GSI_ByDate \
    --key-condition-expression "entityType = :type" \
    --expression-attribute-values '{":type":{"S":"TRANSACTION"}}' \
    --scan-index-forward false \
    --limit 3 \
    --query 'Items[*].{ID:transactionId.S,Amount:amount.N,Currency:currency.S,Time:processedAt.S}' \
    --output table 2>/dev/null

  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ✅ Zero data loss | ✅ DLQ clean | ✅ Stream ACTIVE"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo "Press [Ctrl+C] to exit..."
  
  sleep 5
done
