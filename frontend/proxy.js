const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '8223');
const VITE_PORT = parseInt(process.env.VITE_PORT || '8222');
const CERT_DIR = process.env.CERT_DIR || '/app/certs';
const CERT_FILE = path.join(CERT_DIR, 'frontend.crt');
const KEY_FILE = path.join(CERT_DIR, 'frontend.key');
const CA_FILE = path.join(CERT_DIR, 'ca.crt');
const CA_KEY_FILE = path.join(CERT_DIR, 'ca.key');

function ensureCerts() {
    if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) return;

    fs.mkdirSync(CERT_DIR, { recursive: true });

    let ip = '127.0.0.1';
    try { ip = execSync('hostname -i').toString().trim().split(' ')[0]; } catch {}

    const caExists = fs.existsSync(CA_FILE) && fs.existsSync(CA_KEY_FILE);

    if (caExists) {
        fs.writeFileSync('/tmp/frontend_san.cnf', `[v3_req]\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:${ip}\n`);
        execSync(`openssl genrsa -out ${KEY_FILE} 2048`, { stdio: 'pipe' });
        execSync(`openssl req -new -key ${KEY_FILE} -out /tmp/frontend.csr -subj "/CN=omniplayr-frontend"`, { stdio: 'pipe' });
        execSync(`openssl x509 -req -in /tmp/frontend.csr -CA ${CA_FILE} -CAkey ${CA_KEY_FILE} -CAcreateserial -out ${CERT_FILE} -days 3650 -sha256 -extfile /tmp/frontend_san.cnf -extensions v3_req`, { stdio: 'pipe' });
    } else {
        execSync(`openssl req -x509 -newkey rsa:2048 -keyout ${KEY_FILE} -out ${CERT_FILE} -days 3650 -nodes -subj "/CN=omniplayr-frontend" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${ip}"`, { stdio: 'pipe' });
    }

    console.log('Frontend certificate generated');
}

function handle(conn) {
    conn.once('readable', () => {
        const peek = conn.read(1);
        if (!peek) { conn.destroy(); return; }

        const isTLS = peek[0] === 0x16;
        conn.unshift(peek);

        const src = isTLS
            ? new tls.TLSSocket(conn, { isServer: true, cert, key })
            : conn;

        const dst = net.createConnection({ port: VITE_PORT, host: '127.0.0.1' });

        src.pipe(dst);
        dst.pipe(src);
        src.on('error', () => dst.destroy());
        dst.on('error', () => src.destroy());
    });
}

ensureCerts();

const cert = fs.readFileSync(CERT_FILE);
const key = fs.readFileSync(KEY_FILE);

net.createServer(handle)
    .on('error', err => console.error('Proxy error:', err.message))
    .listen(PROXY_PORT, '0.0.0.0', () => {
        console.log(`Proxy on :${PROXY_PORT} → :${VITE_PORT} (HTTP + HTTPS)`);
    });