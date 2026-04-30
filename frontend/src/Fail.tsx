export default function Failure() {
    return (
        <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <style>
                {`
                    #root {
                        height: 100%;
                    }
                `}
            </style>
            <h1>Backend failed to start</h1>
            <p>An unexpected error occurred while booting the server.</p>
            <p>The system could not complete startup. Please try again later.</p>
            <p>If the problem persists, please contact support.</p>
        </div>
    );
}