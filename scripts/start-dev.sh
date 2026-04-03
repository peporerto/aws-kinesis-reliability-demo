
#!/bin/bash
echo "Starting development environment..."

# Clear any auth token that forces Pro mode
unset LOCALSTACK_AUTH_TOKEN

# Start LocalStack in community mode
export LOCALSTACK_ACTIVATE_PRO=0
export LOCALSTACK_ACKNOWLEDGE_ACCOUNT_REQUIREMENT=1
localstack start -d

# Wait for LocalStack to be ready
echo "Waiting for LocalStack..."
until curl -s http://localhost:4566/_localstack/health | grep -q '"kinesis": "available"'; do
  sleep 2
  echo "Still waiting..."
done

# Bootstrap CDK
echo "Bootstrapping CDK..."
cdklocal bootstrap

# Deploy Infrastructure
echo "Deploying CDK stack..."
cdklocal deploy --require-approval never

echo "Environment is ready!"


chmod +x scripts/start-dev.sh
./scripts/start-dev.sh