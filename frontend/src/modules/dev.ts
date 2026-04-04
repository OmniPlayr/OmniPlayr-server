declare global {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test';
  }
  var process: { env: ProcessEnv };
}

function isDev() {
  return process.env.NODE_ENV === 'development';
}

export { isDev };