#!/bin/sh
# Copies the wall's database and Auth0 settings from .env.local into Vercel's production environment.
# Values are piped straight into the Vercel CLI and never printed. Run from anywhere:
#   sh ~/Annontrix/runwaylab/scripts/vercel-env.sh
cd "$(dirname "$0")/.." || exit 1
for key in DATABASE_URL AUTH0_DOMAIN AUTH0_CLIENT_ID AUTH0_CLIENT_SECRET; do
  value=$(sed -n "s/^[[:space:]]*$key[[:space:]]*=[[:space:]]*//p" .env.local | tail -1 | sed -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//")
  if [ -z "$value" ]; then echo "$key is empty in .env.local, skipped"; continue; fi
  vercel env rm "$key" production --yes >/dev/null 2>&1
  if printf '%s' "$value" | vercel env add "$key" production >/dev/null 2>&1; then echo "$key added"; else echo "$key FAILED"; fi
done
git checkout .gitignore 2>/dev/null
