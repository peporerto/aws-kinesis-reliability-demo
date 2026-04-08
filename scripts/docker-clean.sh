#!/bin/bash
echo "Starting DEEP Docker cleanup..."

# 1. Stop all containers (running or stuck)
echo " Stopping containers..."
docker stop $(docker ps -aq) 2>/dev/null || true

# 2. Delete all containers (including 'Dead' states)
echo " Removing containers..."
docker rm -f $(docker ps -aq) 2>/dev/null || true

# 3. Clean up dangling images
echo " Removing unused images..."
docker image prune -f

# 4. Total cleanup of networks and volumes (releases port 4566 and data folders)
echo " Removing volumes and networks..."
docker volume prune -f
docker network prune -f

# 5. System cleanup (optional but recommended for Milestone 4)
echo "⚡ Clearing Docker system cache..."
docker system prune -f

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Docker is 100% clean (Tabula Rasa)."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"