#!/bin/bash

# ==============================================================================
# 1. BUILD CLEANUP
# ==============================================================================
echo "Cleaning previous builds (dist/)..."
rm -rf dist

# ==============================================================================
# 2. SOFTWARE BUILD
# ==============================================================================
# Critical for Milestone 4: Ensures GSI and entityType are processed
echo "Compiling TypeScript to JavaScript..."
npm run build

# Compilation error verification
if [ $? -ne 0 ]; then
    echo "ERROR: Compilation failed. Check TS errors above."
    exit 1
fi

# ==============================================================================
# 3. ENVIRONMENT BOOTSTRAP
# ==============================================================================
echo "Running CDK Bootstrap on LocalStack..."
cdklocal bootstrap

# ==============================================================================
# 4. INFRASTRUCTURE DEPLOYMENT (DEPLOY)
# ==============================================================================
echo "Deploying PayStream Stack..."

# --require-approval never: Total automation to avoid manual pauses
cdklocal deploy --require-approval never

# ==============================================================================
# FINALIZATION
# ==============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "INFRASTRUCTURE DEPLOYED AND QAP"
echo " PayStream is ready for load test (5,000 events)."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"