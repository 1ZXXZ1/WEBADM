#!/usr/bin/env python3
"""
WebADC — Samba AD Web Panel Server
Async FastAPI + static SPA + API reverse proxy + HTTPS
"""

import asyncio
import ipaddress
import os
import subprocess
import sys
import datetime
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
import httpx
import uvicorn
from dotenv import load_dotenv

# Suppress InsecureRequestWarning when verify=False (backend has self-signed cert)
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ─── Load .env ───────────────────────────────────────────────────────────────

_script_dir = Path(__file__).parent.resolve()
for _env_path in [_script_dir / ".env", Path(".env")]:
    if _env_path.exists():
        load_dotenv(_env_path)
        print(f"[INFO] Loaded .env from {_env_path}")
        break

# ─── Configuration ───────────────────────────────────────────────────────────

LISTEN_ADDR = os.getenv("LISTEN_ADDR", "0.0.0.0")
LISTEN_PORT = int(os.getenv("LISTEN_PORT", "443"))
SAMBA_API_URL = os.getenv("SAMBA_API_URL", "http://192.168.104.12:8099")
CERT_FILE = str(Path(os.getenv("CERT_FILE", "cert.pem")).resolve())
KEY_FILE = str(Path(os.getenv("KEY_FILE", "key.pem")).resolve())
STATIC_DIR = os.getenv("STATIC_DIR", str(_script_dir / "static"))

# ─── Static files setup ─────────────────────────────────────────────────────

static_path = Path(STATIC_DIR)
if not static_path.exists():
    print(f"[FATAL] Static directory not found: {STATIC_DIR}")
    sys.exit(1)

index_html_path = static_path / "index.html"
if not index_html_path.exists():
    print(f"[FATAL] index.html not found in {STATIC_DIR}")
    sys.exit(1)

# Pre-load index.html into memory
_index_html_content = index_html_path.read_text(encoding="utf-8")

# ─── FastAPI trailing-slash endpoints ────────────────────────────────────────

TRAILING_SLASH_ENDPOINTS = frozenset({
    "users", "groups", "computers", "contacts",
    "ous", "sites", "sites/subnets", "fsmo",
    "gpo", "service-accounts", "shell", "batch",
    "shell/projet", "ai/chat",
})

# ─── Normalize backend URL ──────────────────────────────────────────────────

_backend_url = SAMBA_API_URL.rstrip("/")
if _backend_url.endswith("/api/v1"):
    _backend_url = _backend_url[:-7]
_backend_url = _backend_url.rstrip("/")

# ─── Shared HTTP client ─────────────────────────────────────────────────────

_http_client: httpx.AsyncClient | None = None


# ─── Lifespan (replaces deprecated on_event) ────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _http_client
    _http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(60.0, connect=10.0),
        verify=False,  # backend uses self-signed cert
    )
    yield
    if _http_client:
        await _http_client.aclose()
        _http_client = None


# ─── FastAPI App ─────────────────────────────────────────────────────────────

app = FastAPI(title="WebADC", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


# ─── API Reverse Proxy (async) ─────────────────────────────────────────────

@app.api_route("/api/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def api_proxy(path: str, request: Request):
    """Proxy /api/v1/* requests to the Samba AD API backend (async)."""

    # Build target path
    target_path = f"/api/v1/{path}"

    # Auto-add trailing slash for FastAPI base endpoints
    after_v1 = path.strip("/")
    if not target_path.endswith("/") and after_v1 in TRAILING_SLASH_ENDPOINTS:
        parts = [p for p in after_v1.split("/") if p]
        if len(parts) == 1:
            target_path += "/"

    target_url = f"{_backend_url}{target_path}"

    # Forward query parameters
    if request.url.query:
        target_url += f"?{request.url.query}"

    # Build forwarding headers
    headers = {}
    for hdr in ("authorization", "x-api-key", "content-type", "accept"):
        val = request.headers.get(hdr)
        if val:
            headers[hdr] = val

    client_ip = request.client.host if request.client else ""
    headers["X-Forwarded-For"] = client_ip
    headers["X-Forwarded-Host"] = request.headers.get("host", "")
    headers["X-Forwarded-Proto"] = "https"
    headers["X-Real-IP"] = client_ip

    # Read request body (async)
    body = await request.body()

    print(f"[PROXY] {request.method} /api/v1/{path} → {target_url}")

    try:
        accept = request.headers.get("accept", "")

        # SSE streaming
        if "text/event-stream" in accept:
            async def stream_response():
                async with _http_client.stream(
                    method=request.method,
                    url=target_url,
                    headers=headers,
                    content=body if body else None,
                ) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk

            return StreamingResponse(
                stream_response(),
                status_code=200,
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )

        # Normal (non-SSE) request
        resp = await _http_client.request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body if body else None,
        )

        # Build response headers
        resp_headers = {}
        for key, val in resp.headers.items():
            if key.lower() not in ("transfer-encoding", "content-encoding", "content-length"):
                resp_headers[key] = val

        resp_headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate"
        resp_headers["Pragma"] = "no-cache"
        resp_headers["Expires"] = "0"

        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=resp_headers,
        )

    except httpx.ConnectError:
        return JSONResponse(status_code=502, content={
            "status": "error",
            "detail": f"Cannot connect to Samba AD API backend at {_backend_url}. Ensure the backend is running.",
            "error_code": "BACKEND_UNREACHABLE",
        })
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content={
            "status": "error",
            "detail": f"Backend API timeout: {_backend_url}",
            "error_code": "BACKEND_TIMEOUT",
        })
    except Exception as e:
        return JSONResponse(status_code=500, content={
            "status": "error",
            "detail": f"API proxy error: {str(e)}",
            "error_code": "PROXY_ERROR",
        })


# ─── Health check ────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "webadc"}


# ─── SPA Fallback — must be LAST route ───────────────────────────────────────

@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    """Serve static files, fallback to index.html for SPA routing."""

    if not full_path:
        return HTMLResponse(content=_index_html_content)

    file_path = static_path / full_path

    # Try to serve exact file (run stat in thread pool)
    exists = await asyncio.to_thread(file_path.is_file)
    if exists:
        if "_next/static/" in full_path or "_next/image" in full_path:
            return FileResponse(file_path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
        return FileResponse(file_path, headers={"Cache-Control": "no-store, must-revalidate"})

    # SPA fallback
    return HTMLResponse(
        content=_index_html_content,
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


# ─── Self-signed certificate generation ─────────────────────────────────────

def generate_self_signed_cert(cert_file: str, key_file: str):
    """Generate a self-signed TLS certificate."""
    print("[INFO] Generating self-signed certificate...")

    # Try openssl first
    try:
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", key_file, "-out", cert_file,
            "-days", "365", "-nodes",
            "-subj", "/CN=webadc/O=WebADC Self-Signed",
            "-addext", "subjectAltName=DNS:localhost,DNS:webadc,IP:127.0.0.1,IP:0.0.0.0",
        ], check=True, capture_output=True)
        print(f"[INFO] Self-signed certificate saved to {cert_file} and {key_file} (valid 1 year)")
        return
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Fallback: pure Python with cryptography
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "WebADC Self-Signed"),
            x509.NameAttribute(NameOID.COMMON_NAME, "webadc"),
        ])

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.utcnow())
            .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365))
            .add_extension(
                x509.SubjectAlternativeName([
                    x509.DNSName("localhost"),
                    x509.DNSName("webadc"),
                    x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
                ]),
                critical=False,
            )
            .sign(key, hashes.SHA256())
        )

        with open(cert_file, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        with open(key_file, "wb") as f:
            f.write(key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            ))
        print(f"[INFO] Self-signed certificate saved to {cert_file} and {key_file} (valid 1 year)")

    except ImportError:
        print("[FATAL] Cannot generate certificate. Install openssl or: pip install cryptography")
        sys.exit(1)


# ─── Main ────────────────────────────────────────────────────────────────────

async def main():
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║            WebADC — Samba AD Web Panel              ║")
    print("╠══════════════════════════════════════════════════════╣")
    print(f"║  Listen:    {LISTEN_ADDR}:{LISTEN_PORT:<39}║")
    print(f"║  Backend:   {SAMBA_API_URL:<40}║")
    print(f"║  Static:    {STATIC_DIR:<40}║")
    print(f"║  TLS Cert:  {CERT_FILE:<40}║")
    print(f"║  TLS Key:   {KEY_FILE:<40}║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    # Auto-generate certificate if missing
    if not Path(CERT_FILE).exists() or not Path(KEY_FILE).exists():
        await asyncio.to_thread(generate_self_signed_cert, CERT_FILE, KEY_FILE)

    # Verify cert files exist
    if not Path(CERT_FILE).exists():
        print(f"[FATAL] Certificate file not found: {CERT_FILE}")
        sys.exit(1)
    if not Path(KEY_FILE).exists():
        print(f"[FATAL] Key file not found: {KEY_FILE}")
        sys.exit(1)

    # Display URL
    if LISTEN_PORT == 443:
        display = "https://localhost"
    else:
        display = f"https://localhost:{LISTEN_PORT}"

    print(f"[INFO] Starting HTTPS server on {LISTEN_ADDR}:{LISTEN_PORT}")
    print(f"[INFO] Access the panel at {display}")
    print(f"[INFO] SSL cert: {CERT_FILE}")
    print(f"[INFO] SSL key:  {KEY_FILE}")
    print()

    # Run uvicorn with HTTPS
    config = uvicorn.Config(
        app,
        host=LISTEN_ADDR,
        port=LISTEN_PORT,
        ssl_certfile=CERT_FILE,
        ssl_keyfile=KEY_FILE,
        log_level="info",
    )
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
