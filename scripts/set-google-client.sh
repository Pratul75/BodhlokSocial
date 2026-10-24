#!/usr/bin/env bash
# Puts the Google sign-in client on the VM and restarts the web app.
# Asks for the values so the secret never lands in shell history or chat.
set -euo pipefail
PROJECT="${PROJECT:-absolute-water-387410}"
ZONE="${ZONE:-asia-south1-c}"
VM="${VM:-rapido-demo}"

read -r -p "Google OAuth client ID: " CID
read -r -s -p "Google OAuth client secret: " CSECRET; echo
[[ "$CID" == *.apps.googleusercontent.com ]] || { echo "That doesn't look like a client ID (…apps.googleusercontent.com)." >&2; exit 1; }
[ -n "$CSECRET" ] || { echo "The secret is empty." >&2; exit 1; }

# Sent over the SSH session's stdin, not as a command-line argument.
printf '%s\n%s\n' "$CID" "$CSECRET" | gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command '
  set -e
  read -r CID; read -r CSECRET
  F=/opt/bodh/shared/bodh.env
  sudo sed -i "s#^GOOGLE_CLIENT_ID=.*#GOOGLE_CLIENT_ID=$CID#" $F
  sudo sed -i "s#^GOOGLE_CLIENT_SECRET=.*#GOOGLE_CLIENT_SECRET=$CSECRET#" $F
  sudo systemctl restart bodh-web
  sleep 3
  curl -fsS http://127.0.0.1:3100/signin | grep -q "Sign in with Google" && echo "Sign-in is on." || echo "The web app restarted but the sign-in button is not showing; check: sudo journalctl -u bodh-web -n 50"
'
