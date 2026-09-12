#!/bin/bash
# Generates a self-signed TLS certificate for local / internal-network use.
# For public deployments, use Let's Encrypt instead (see below).
#
# Let's Encrypt (requires a domain name):
#   certbot certonly --standalone -d yourdomain.com
#   cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem deploy/ssl/cert.pem
#   cp /etc/letsencrypt/live/yourdomain.com/privkey.pem   deploy/ssl/key.pem

set -e

CERT_DIR="$(dirname "$0")/ssl"
mkdir -p "$CERT_DIR"

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$CERT_DIR/key.pem" \
  -out    "$CERT_DIR/cert.pem" \
  -subj   "/C=US/ST=Local/L=Local/O=Redivue/CN=localhost" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"

echo ""
echo "Self-signed certificate generated:"
echo "  $CERT_DIR/cert.pem"
echo "  $CERT_DIR/key.pem"
echo ""
echo "NOTE: Browsers will show a security warning for self-signed certs."
echo "      Click 'Advanced' → 'Proceed' to access the dashboard."
echo "      For production with a domain, use Let's Encrypt (see script comments)."
