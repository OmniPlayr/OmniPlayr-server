const fs = require('fs');
const path = require('path');

function parseToml(content) {
  const obj = {};
  const lines = content.split('\n');
  let currentSection = null;

  lines.forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1);
      const keys = currentSection.split('.');
      let target = obj;
      keys.forEach((key, idx) => {
        if (idx === keys.length - 1) {
          target[key] = {};
        } else {
          target[key] = target[key] || {};
          target = target[key];
        }
      });
      return;
    }

    if (currentSection && line.includes('=')) {
      const [key, ...valueParts] = line.split('=');
      const cleanKey = key.trim();
      let value = valueParts.join('=').trim();

      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (!isNaN(value)) {
        value = parseInt(value);
      }

      const keys = currentSection.split('.');
      let target = obj;
      keys.forEach(key => {
        target[key] = target[key] || {};
        target = target[key];
      });
      target[cleanKey] = value;
    }
  });

  return obj;
}

function tomlStringify(obj) {
  let result = '';

  function stringifyValue(val) {
    if (typeof val === 'string') return `"${val}"`;
    return val.toString();
  }

  function processObj(o, prefix = '') {
    Object.entries(o).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const newPrefix = prefix ? `${prefix}.${key}` : key;
        result += `[${newPrefix}]\n`;
        processObj(value, newPrefix);
      } else {
        result += `${key} = ${stringifyValue(value)}\n`;
      }
    });
  }

  processObj(obj);
  return result;
}

const versionFilePath = path.join(__dirname, '../../frontend/src/config/version.toml');
const content = fs.readFileSync(versionFilePath, 'utf-8');
const config = parseToml(content);

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;

const gitRef = process.env.GITHUB_REF || 'refs/heads/dev';
const branch = gitRef.split('/').pop();

const versionData = config.version.frontend;
let bugfix = versionData.bugfix || 0;

if (versionData.year !== currentYear || versionData.month !== currentMonth) {
  bugfix = 0;
}

if (branch === 'main') {
  bugfix = 0;
  config.version.frontend.safeVersion = `${currentYear}.${currentMonth}.${bugfix}-release`;
} else {
  bugfix++;
  config.version.frontend.safeVersion = `${currentYear}.${currentMonth}.${bugfix}-dev`;
}

config.version.frontend.year = currentYear;
config.version.frontend.month = currentMonth;
config.version.frontend.bugfix = bugfix;
config.version.frontend.branch = branch;

const newContent = tomlStringify(config);
fs.writeFileSync(versionFilePath, newContent);