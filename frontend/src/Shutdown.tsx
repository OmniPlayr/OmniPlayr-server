export default function Shutdown() {
    return (
        <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <style>
                {`
                    #root {
                        height: 100%;
                    }
                `}
            </style>
            <h1>Server has shutdown</h1>
            <p>The system is currently offline. Please turn on your server to continue using OmniPlayr.</p>
        </div>
    );
}