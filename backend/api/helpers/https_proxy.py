import os
import ssl
import socket
import subprocess
import threading

from api.helpers.log import log


def _ensure_certs(certfile, keyfile, cafile):
    if os.path.exists(certfile) and os.path.exists(keyfile):
        return

    os.makedirs(os.path.dirname(certfile), exist_ok=True)

    ca_key = os.path.join(os.path.dirname(certfile), "ca.key")
    csr_file = os.path.join(os.path.dirname(certfile), "server.csr")
    ext_file = os.path.join(os.path.dirname(certfile), "ext.cnf")

    subprocess.run(["openssl", "genrsa", "-out", ca_key, "2048"], check=True, capture_output=True)
    subprocess.run([
        "openssl", "req", "-x509", "-new", "-nodes",
        "-key", ca_key, "-sha256", "-days", "3650",
        "-out", cafile, "-subj", "/CN=OmniPlayr Local CA"
    ], check=True, capture_output=True)

    subprocess.run(["openssl", "genrsa", "-out", keyfile, "2048"], check=True, capture_output=True)
    subprocess.run([
        "openssl", "req", "-new", "-key", keyfile,
        "-out", csr_file, "-subj", "/CN=localhost"
    ], check=True, capture_output=True)

    with open(ext_file, "w") as f:
        f.write("subjectAltName=DNS:localhost,IP:127.0.0.1\n")

    subprocess.run([
        "openssl", "x509", "-req", "-in", csr_file,
        "-CA", cafile, "-CAkey", ca_key, "-CAcreateserial",
        "-out", certfile, "-days", "3650", "-sha256",
        "-extfile", ext_file
    ], check=True, capture_output=True)


def _forward(src, dst):
    try:
        while chunk := src.recv(4096):
            dst.sendall(chunk)
    except Exception:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except Exception:
            pass


def _proxy(conn, http_port):
    try:
        with socket.create_connection(("127.0.0.1", http_port)) as backend:
            t1 = threading.Thread(target=_forward, args=(conn, backend), daemon=True)
            t2 = threading.Thread(target=_forward, args=(backend, conn), daemon=True)
            t1.start()
            t2.start()
            t1.join()
            t2.join()
    except Exception:
        pass
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _handle(conn, http_port, ssl_ctx):
    try:
        first_byte = conn.recv(1, socket.MSG_PEEK)
        if first_byte == b'\x16':
            conn = ssl_ctx.wrap_socket(conn, server_side=True)
        _proxy(conn, http_port)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def start_https_proxy(proxy_port=8224, http_port=8226, certfile="certs/cert.pem", keyfile="certs/key.pem", cafile="certs/ca.crt"):
    _ensure_certs(certfile, keyfile, cafile)

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile, keyfile)

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", proxy_port))
    server.listen(100)

    def accept_loop():
        while True:
            try:
                conn, _ = server.accept()
                threading.Thread(target=_handle, args=(conn, http_port, ctx), daemon=True).start()
            except Exception:
                pass

    threading.Thread(target=accept_loop, daemon=True).start()
    log(f"Proxy on :{proxy_port} → :{http_port} (HTTP + HTTPS)", "info", "main")