#!/bin/bash
# PayStream Transaction Producer Script
# Purpose: Simulate 100 payment events sent to Kinesis

echo "Sending 100 transactions to PayStreamInput..."

for i in $(seq 1 100); do
  # Generate Transaction ID (e.g., tr_001)
  TRANSACTION_ID=$(printf 'tr_%03d' $i)
  
  # Generate Random Amount between 1.99 and 500.99
  AMOUNT=$(( ( RANDOM % 500 )  + 1 )).99
  
  # 1. Create the JSON payload
  PAYLOAD="{\"id\": \"$TRANSACTION_ID\", \"amount\": $AMOUNT, \"currency\": \"CAD\"}"
  
  # 2. Convert payload to Base64 (Crucial for Kinesis)
  ENCODED_DATA=$(echo -n "$PAYLOAD" | base64)

  # 3. Put record into Kinesis Stream
  aws --endpoint-url=http://localhost:4566 kinesis put-record \
    --stream-name PayStreamInput \
    --data "$ENCODED_DATA" \
    --partition-key "user_$i" \
    --output json > /dev/null

  echo "Sent transaction $TRANSACTION_ID (Base64 Encoded)"
done

echo "Done. 100 transactions successfully sent to PayStream."