import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import "@xterm/xterm/css/xterm.css";
import { getConfig } from '../modules/config';
import { getAccount } from '../modules/account';

function Terminal() {
    const terminalRef = useRef<HTMLDivElement>(null);
    const socket = useRef<WebSocket | null>(null);
    const fitAddon = useRef(new FitAddon());

    useEffect(() => {
        const xterm = new XTerm({
            cursorBlink: true,
            fontFamily: 'JetBrains Mono',
            fontSize: 14,
            theme: {
                background: '#0f0f0f',
                foreground: '#d0d0d0',
                cursor: '#00ff88',
            },
        });

        xterm.loadAddon(fitAddon.current);

        if (terminalRef.current) {
            xterm.open(terminalRef.current);
            setTimeout(() => fitAddon.current.fit(), 0);
        }

        const token = localStorage.getItem('access_token');
        const accountId = getAccount();

        const ws = new WebSocket(
            `${getConfig('api.terminalUrl')}/api/system/terminal/ws?token=${token}&account_id=${accountId}`
        );

        socket.current = ws;

        ws.onmessage = (event) => {
            xterm.write(event.data);
        };

        ws.onopen = () => {
            xterm.writeln('\r\n\x1b[32mConnected\x1b[0m\r\n');
        };

        ws.onerror = () => {
            xterm.writeln('\r\n\x1b[31mWebSocket error\x1b[0m\r\n');
        };

        ws.onclose = () => {
            xterm.writeln('\r\n\x1b[33mDisconnected\x1b[0m\r\n');
        };

        xterm.onData((data) => {
            const ws = socket.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            ws.send(data);
        });

        const handleResize = () => {
            fitAddon.current.fit();
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            ws.close();
            xterm.dispose();
        };
    }, []);

    return <div style={{ height: '100%', width: '100%' }} ref={terminalRef} />;
}

export default Terminal;