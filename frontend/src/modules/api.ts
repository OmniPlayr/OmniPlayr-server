

const apiEndpoints = [
    {
        id: 'login',
        url: '/api/server/token',
        method: 'POST',
        data: {
            username: 'admin',
            password: 'admin'
        }
    }
];

function api(id: string, data?: any): object {
    const endpoint = apiEndpoints.find(e => e.id === id);
    if (!endpoint) throw new Error(`API endpoint "${id}" not found`);

    
}

export default api;