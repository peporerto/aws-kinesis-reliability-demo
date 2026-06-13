#!/bin/bash

# ==============================================================================
# ENVIRONMENT CONFIGURATION
# ==============================================================================
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo "📝 Configuration loaded from .env"
else
  echo "⚠️  Warning: .env file not found"
fi

# ==============================================================================
# LICENSE BYPASS & STABILITY
# ==============================================================================
unset LOCALSTACK_AUTH_TOKEN
export ACTIVATE_PRO=0
export LOCALSTACK_ACTIVATE_PRO=0
export LOCALSTACK_ACKNOWLEDGE_ACCOUNT_REQUIREMENT=1
IMAGE_VERSION="localstack/localstack:3.8.1"

# ==============================================================================
# CONTAINER STARTUP
# ==============================================================================
echo "🐳 Starting LocalStack container (v3.8.1)..."

docker rm -f localstack_main 2>/dev/null || true

docker run -d --name localstack_main \
  -p 4566:4566 \
  -p 4510-4559:4510-4559 \
  -e LOCALSTACK_ACTIVATE_PRO=0 \
  -e LOCALSTACK_ACKNOWLEDGE_ACCOUNT_REQUIREMENT=1 \
  -e LAMBDA_RUNTIME_EXECUTOR=local \
  -e DEBUG=1 \
  $IMAGE_VERSION

# ==============================================================================
# HEALTHCHECK — waits for all critical services, not just DynamoDB
# ==============================================================================
echo "⏳ Waiting for critical services..."

MAX_RETRIES=30
COUNT=0

check_services() {
  local health
  health=$(curl -s http://localhost:4566/_localstack/health 2>/dev/null)

  local dynamo kinesis lambda sqs
  dynamo=$(echo "$health" | grep -o '"dynamodb": *"[a-z]*"' | grep -c 'running\|available')
  kinesis=$(echo "$health" | grep -o '"kinesis": *"[a-z]*"' | grep -c 'running\|available')
  lambda=$(echo "$health" | grep -o '"lambda": *"[a-z]*"' | grep -c 'running\|available')
  sqs=$(echo "$health" | grep -o '"sqs": *"[a-z]*"' | grep -c 'running\|available')

  [ "$dynamo" -ge 1 ] && [ "$kinesis" -ge 1 ] && [ "$lambda" -ge 1 ] && [ "$sqs" -ge 1 ]
}

until check_services; do
  sleep 2
  COUNT=$((COUNT+1))
  echo "  ↳ Attempt $COUNT/$MAX_RETRIES — waiting for DynamoDB, Kinesis, Lambda, SQS..."

  if [ $COUNT -eq $MAX_RETRIES ]; then
    echo "❌ ERROR: LocalStack took too long to start."
    echo "   Check logs with: docker logs localstack_main"
    exit 1
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ LocalStack READY — all critical services up"
echo "   DynamoDB ✔  Kinesis ✔  Lambda ✔  SQS ✔"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"