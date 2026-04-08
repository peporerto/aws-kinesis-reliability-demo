#!/bin/bash

# ==============================================================================
# ENVIRONMENT CONFIGURATION
# ==============================================================================
if [ -f .env ]; then
  # Direct export to avoid Bash compatibility issues
  export $(grep -v '^#' .env | xargs)
  echo "📝 Configuration loaded from .env"
else
  echo "⚠️  Warning: .env file not found"
fi

# ==============================================================================
# LICENSE BYPASS & STABILITY
# Force Community mode and clean any Pro traces
# ==============================================================================
unset LOCALSTACK_AUTH_TOKEN
export ACTIVATE_PRO=0
export LOCALSTACK_ACTIVATE_PRO=0
export LOCALSTACK_ACKNOWLEDGE_ACCOUNT_REQUIREMENT=1
# Version already tested and known not to crash
IMAGE_VERSION="localstack/localstack:3.8.1"

# ==============================================================================
# CONTAINER STARTUP
# Use docker run to ensure socket and version are correct
# ==============================================================================
echo " Starting LocalStack container (Version 3.8.1)..."

# Delete old container if it exists to avoid conflicts
docker rm -f localstack_main 2>/dev/null || true

# Start the container with necessary mappings
docker run -d --name localstack_main \
  -p 4566:4566 \
  -p 4510-4559:4510-4559 \
  -e LOCALSTACK_ACTIVATE_PRO=0 \
  -e LOCALSTACK_ACKNOWLEDGE_ACCOUNT_REQUIREMENT=1 \
  -e DEBUG=1 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  $IMAGE_VERSION

# ==============================================================================
# HEALTHCHECK
# ==============================================================================
echo " Waiting for services to wake up..."

# Maximum wait of 60 seconds to avoid infinite loop if something fails
MAX_RETRIES=30
COUNT=0

until curl -s http://localhost:4566/_localstack/health | grep -q '"dynamodb": "available"'; do
  sleep 2
  COUNT=$((COUNT+1))
  echo "...Still waiting for DynamoDB (Attempt $COUNT/$MAX_RETRIES)"
  
  if [ $COUNT -eq $MAX_RETRIES ]; then
    echo " ERROR: LocalStack took too long to start."
    echo " Check logs with: docker logs localstack_main"
    exit 1
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ QAP ENGINE - READY FOR MILESTONE 4"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"