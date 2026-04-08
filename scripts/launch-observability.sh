#!/bin/bash

# 1. Open Dashboard in a new window
gnome-terminal --title="DASHBOARD" -- bash -c "./scripts/dashboard.sh; exec bash"

# 2. Open Docker Traffic in a new window
gnome-terminal --title="DOCKER TRAFFIC" -- bash -c "docker logs -f localstack_main | grep 'POST /restapis'; exec bash"

# 3. Open Processor Logs in a new window
gnome-terminal --title="PROCESSOR LOGS" -- bash -c "aws --endpoint-url=http://localhost:4566 logs tail '/aws/lambda/PayStreamProcessor' --follow; exec bash"