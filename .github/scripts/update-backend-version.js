const fs = require('fs');
const path = require('path');

const configFilePath = path.join(__dirname, '../../backend/config.json');
const config = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;

const gitRef = process.env.GITHUB_REF || 'refs/heads/dev';
const branch = gitRef.split('/').pop();

let bugfix = config.bugfix || 0;

if (config.year !== currentYear || config.month !== currentMonth) {
  bugfix = 0;
}

if (branch === 'main') {
  bugfix = 0;
  config.safeVersion = `${currentYear}.${currentMonth}.${bugfix}-release`;
} else {
  bugfix++;
  config.safeVersion = `${currentYear}.${currentMonth}.${bugfix}-dev`;
}

config.version = `${currentYear}.${currentMonth}.${bugfix}`;
config.year = currentYear;
config.month = currentMonth;
config.bugfix = bugfix;
config.branch = branch;

fs.writeFileSync(configFilePath, JSON.stringify(config, null, 4));