#!/bin/bash
# A simple double-click launcher for the Personal PA
# It ensures the correct directory and environment before starting

# Change to the directory where this script is located
cd "$(dirname "$0")"

# Load the user's terminal environment (so node and npm are available)
source ~/.bash_profile 2>/dev/null || source ~/.zshrc 2>/dev/null

echo "Starting your Digital Brain..."

# Stop any dangling instances of the bot or next.js on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null
pkill -f "poll-telegram.js" 2>/dev/null

# Start Next.js Development Server in the background securely
npm run dev > .nextjs_launcher.log 2>&1 &
NEXT_PID=$!

# Wait exactly 4 seconds for Next.js to initialize
sleep 4

# Start the Telegram Polling strictly in the background
node poll-telegram.js > .telegram_launcher.log 2>&1 &
TELEGRAM_PID=$!

echo "Dashboard is Live! Opening Browser..."
open http://localhost:3000

echo "Your Personal PA is running."
echo "Keep this window open to process Telegram commands,"
echo "or close this window to shut down the brain."

# Wait for Next.js to close naturally when you close the terminal
wait $NEXT_PID
