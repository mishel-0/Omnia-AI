#!/usr/bin/env bash
# ─── Generate Self-Signed SSL Certificate & Key ───────────────────────────
# GDPR Art. 32 compliant HTTPS for Omnia AI backend.
# Works on macOS (including LibreSSL) and Linux.
# Usage: bash scripts/generate_cert.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CERT_DIR="$PROJECT_ROOT/ssl"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

mkdir -p "$CERT_DIR"

echo "[INFO] Generating self-signed SSL certificate..."
echo "       Certificate: $CERT_FILE"
echo "       Key:         $KEY_FILE"
echo ""

# Generate self-signed certificate (RSA 4096, 365 days, SAN for localhost)
openssl req -x509 -newkey rsa:4096 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 365 \
    -nodes \
    -subj "/C=XX/ST=State/L=City/O=Omnia AI/OU=Development/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null

# Fallback for older openssl/LibreSSL without -addext support
if [ $? -ne 0 ] || [ ! -s "$CERT_FILE" ]; then
    echo "[INFO] Retrying without -addext (older openssl/LibreSSL)..."
    openssl req -x509 -newkey rsa:4096 \
        -keyout "$KEY_FILE" \
        -out "$CERT_FILE" \
        -days 365 \
        -nodes \
        -subj "/C=XX/ST=State/L=City/O=Omnia AI/OU=Development/CN=localhost"
fi

# Secure the private key
chmod 600 "$KEY_FILE"

echo ""
echo "[OK] Self-signed certificate generated successfully!"
echo "  Certificate: $CERT_FILE"
echo "  Key:         $KEY_FILE"
echo "  Valid for:   365 days"
echo ""
echo "[INFO] To enable HTTPS, set the following env vars (or use defaults):"
echo "       SSL_CERTFILE=$CERT_FILE"
echo "       SSL_KEYFILE=$KEY_FILE"
echo ""
echo "[INFO] Or simply restart the backend — it will auto-detect the cert files."
