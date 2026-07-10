const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const isDryRun = process.argv.includes('--dry-run');
const isForce = process.argv.includes('--force');

const lineCommentPrefixes = ['//', '#', '--', ';'];
const blockCommentPairs = [
  { start: '/*', end: '*/' },
  { start: '<!--', end: '-->' },
];

function toRepoPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function listTrackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

function getCurrentBranch() {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME.trim();

  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function splitLines(content) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hasFinalNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/);
  if (hasFinalNewline) lines.pop();

  return { lines, newline, hasFinalNewline };
}

function joinLines(lines, newline, hasFinalNewline) {
  return `${lines.join(newline)}${hasFinalNewline && lines.length > 0 ? newline : ''}`;
}

function getCommentText(line) {
  const trimmed = line.trim();

  for (const prefix of lineCommentPrefixes) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }

  for (const pair of blockCommentPairs) {
    if (trimmed.startsWith(pair.start) && trimmed.endsWith(pair.end)) {
      return trimmed.slice(pair.start.length, -pair.end.length).trim();
    }
  }

  return null;
}

function readTopCommentBlock(lines) {
  const comments = [];
  let index = 0;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === '') {
      comments.push({ index, text: '' });
      index += 1;
      continue;
    }

    const oneLineComment = getCommentText(line);
    if (oneLineComment !== null) {
      comments.push({ index, text: oneLineComment });
      index += 1;
      continue;
    }

    const blockPair = blockCommentPairs.find((pair) => trimmed.startsWith(pair.start));
    if (!blockPair) break;

    const startIndex = index;
    let blockText = trimmed.slice(blockPair.start.length);

    while (index < lines.length) {
      const current = lines[index].trim();
      if (index !== startIndex) blockText += `\n${current}`;

      if (current.endsWith(blockPair.end)) {
        blockText = blockText.slice(0, -blockPair.end.length).trim();
        comments.push({ index: startIndex, endIndex: index, text: blockText });
        index += 1;
        break;
      }

      index += 1;
    }

    if (index >= lines.length && !lines[index - 1]?.trim().endsWith(blockPair.end)) break;
  }

  return comments;
}

function getParserActionInfo(lines) {
  const topComments = readTopCommentBlock(lines);
  const headerRanges = [];
  let sawParserAction = false;

  for (const comment of topComments) {
    const commentLines = comment.text.split(/\r?\n/).map((line) => line.trim());
    const hasParserAction = commentLines.includes('Parser Action');
    const action = commentLines.find((line) => {
      return line === '@devonly.look-for-start' || line === '@devonly.all';
    });

    if (hasParserAction || action) {
      headerRanges.push({
        start: comment.index,
        end: comment.endIndex ?? comment.index,
      });
    }

    if (hasParserAction) sawParserAction = true;
    if (sawParserAction && action === '@devonly.look-for-start') {
      return { action: 'look-for-start', headerRanges };
    }
    if (sawParserAction && action === '@devonly.all') {
      return { action: 'all', headerRanges };
    }
  }

  return null;
}

function parseDirective(line) {
  const text = getCommentText(line);
  if (!text) return null;

  if (text === '@devonly.start') return { type: 'start' };
  if (text === '@devonly.end') return { type: 'end' };

  const lineBeforeMatch = text.match(/^@devonly\.linebefore:\s*char\.([+-])(\d+)$/);
  if (lineBeforeMatch) {
    return {
      type: 'linebefore',
      direction: lineBeforeMatch[1],
      count: Number(lineBeforeMatch[2]),
    };
  }

  if (text === 'Parser Action' || text === '@devonly.look-for-start' || text === '@devonly.all') {
    return { type: 'header' };
  }

  return null;
}

function removeFromPreviousLine(lines, currentIndex, direction, count) {
  const targetIndex = currentIndex - 1;
  if (targetIndex < 0 || count <= 0) return;

  const line = lines[targetIndex];
  if (direction === '-') {
    const match = line.match(/^(.*?)(\s*)$/);
    const content = match[1];
    lines[targetIndex] = `${content.slice(0, Math.max(0, content.length - count))}${match[2]}`;
  } else {
    const match = line.match(/^(\s*)(.*)$/);
    const content = match[2];
    lines[targetIndex] = `${match[1]}${content.slice(Math.min(count, content.length))}`;
  }
}

function applyLookForStart(content, headerRanges) {
  const { lines, newline, hasFinalNewline } = splitLines(content);
  const kept = [];
  let index = 0;
  let changed = false;
  const headerIndexes = new Set();

  for (const range of headerRanges) {
    for (let headerIndex = range.start; headerIndex <= range.end; headerIndex += 1) {
      headerIndexes.add(headerIndex);
    }
  }

  while (index < lines.length) {
    if (headerIndexes.has(index)) {
      changed = true;
      index += 1;
      continue;
    }

    const directive = parseDirective(lines[index]);

    if (directive?.type === 'linebefore') {
      removeFromPreviousLine(kept, kept.length, directive.direction, directive.count);
      changed = true;
      index += 1;
      continue;
    }

    if (directive?.type === 'header') {
      changed = true;
      index += 1;
      continue;
    }

    if (directive?.type === 'start') {
      changed = true;
      index += 1;
      while (index < lines.length) {
        const endDirective = parseDirective(lines[index]);
        index += 1;
        if (endDirective?.type === 'end') break;
      }
      continue;
    }

    kept.push(lines[index]);
    index += 1;
  }

  return { content: joinLines(kept, newline, hasFinalNewline), changed };
}

function main() {
  const branch = getCurrentBranch();
  if (!isForce && branch && branch !== 'main') {
    console.log(`Skipping parser actions on ${branch}; this only runs on main.`);
    return;
  }

  const changedFiles = [];
  const deletedFiles = [];

  for (const relativePath of listTrackedFiles()) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;

    const content = fs.readFileSync(absolutePath, 'utf8');
    const { lines } = splitLines(content);
    const info = getParserActionInfo(lines);
    if (!info) continue;

    if (info.action === 'all') {
      deletedFiles.push(relativePath);
      if (!isDryRun) fs.unlinkSync(absolutePath);
      continue;
    }

    const result = applyLookForStart(content, info.headerRanges);
    if (result.changed && result.content !== content) {
      changedFiles.push(relativePath);
      if (!isDryRun) fs.writeFileSync(absolutePath, result.content, 'utf8');
    }
  }

  for (const file of changedFiles) console.log(`${isDryRun ? 'Would update' : 'Updated'} ${toRepoPath(file)}`);
  for (const file of deletedFiles) console.log(`${isDryRun ? 'Would delete' : 'Deleted'} ${toRepoPath(file)}`);

  if (changedFiles.length === 0 && deletedFiles.length === 0) {
    console.log('No parser actions found.');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  applyLookForStart,
  getParserActionInfo,
};
