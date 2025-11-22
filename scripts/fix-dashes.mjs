#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Scan all .md files (except node_modules, build, .docusaurus, and build output)
const root = process.cwd();
const excludeDirs = ['node_modules', 'build', '.docusaurus', 'dist', 'public', '.vscode', '.git'];
// Targeted directories/files: only docs folder, .github AI-review checklists, and root README/AGENTS
const targetDirs = ['docs', path.join('.github', 'ai-review', 'checklists')].map(p => path.join(root, p));
const targetFiles = [path.join(root, 'README.md'), path.join(root, 'AGENTS.md')];

function walkDir(dir) {
    const files = [];
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            if (excludeDirs.includes(name) || name.startsWith('.')) continue;
            files.push(...walkDir(full));
        } else if (stat.isFile() && /\.(md|markdown)$/.test(name)) {
            // Skip files in build-like directories
            if (full.includes(path.join('build', path.sep)) || full.includes(path.join('.docusaurus', path.sep))) continue;
            files.push(full);
        }
    }
    return files;
}

function isDigit(c) { return /[0-9]/.test(c); }

function normalizeTextSegment(line) {
    // Replace pattern: space + (en-dash|em-dash) + space -> em-dash (no spaces)
    // But skip numeric ranges where digit (or punct) is on either side
    let modified = false;
    const dashRegex = /\s([\u2013\u2014])\s/g;
    const newLine = line.replace(dashRegex, (match, dash, offset) => {
        const left = line[offset - 1] || '';
        const right = line[offset + match.length] || '';
        // skip if numeric on both sides, e.g. 0.0–1.0
        if (isDigit(left) && isDigit(right)) return match; // no change
        modified = true;
        return '—'; // em-dash with no spaces
    });
    return { newLine, modified };
}

function processMarkdownFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    let inCodeFence = false;
    let changed = false;
    const newLines = [];

    // detect YAML front matter region
    let inFrontMatter = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Code fence handling
        if (/^```/.test(line)) {
            inCodeFence = !inCodeFence;
            newLines.push(line);
            continue;
        }
        if (inCodeFence) {
            newLines.push(line);
            continue;
        }
        // YAML front matter
        if (i === 0 && /^---\s*$/.test(line)) {
            inFrontMatter = true;
            newLines.push(line);
            continue;
        }
        if (inFrontMatter) {
            if (/^---\s*$/.test(line)) {
                inFrontMatter = false;
                newLines.push(line);
                continue;
            }
            // If YAML title key is present, adjust the value only
            const titleMatch = /^title:\s*(.*)$/u.exec(line);
            if (titleMatch) {
                const originalValue = titleMatch[1];
                const { newLine, modified } = normalizeTextSegment(originalValue);
                if (modified) {
                    newLines.push(`title: ${newLine}`);
                    changed = true;
                    continue;
                }
            }
            newLines.push(line);
            continue;
        }

        // Headings: lines starting with # (one or more)
        if (/^#+\s+/.test(line)) {
            const prefix = line.match(/^#+\s+/)[0];
            const rest = line.slice(prefix.length);
            const { newLine, modified } = normalizeTextSegment(rest);
            if (modified) {
                newLines.push(prefix + newLine);
                changed = true;
                continue;
            }
        }

        // For general inline text and list items, normalize mid-sentence dashes that have spaces around
        if (!inFrontMatter && !inCodeFence && /\s[\u2013\u2014]\s/.test(line)) {
            const { newLine, modified } = normalizeTextSegment(line);
            if (modified) {
                newLines.push(newLine);
                changed = true;
                continue;
            }
        }

        newLines.push(line);
    }

    if (changed) {
        fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
    }
    return changed;
}

function collectTargetFiles() {
    const list = new Set();
    for (const td of targetDirs) {
        if (fs.existsSync(td)) {
            listAdd(walkDir(td), list);
        }
    }
    for (const tf of targetFiles) {
        if (fs.existsSync(tf)) list.add(tf);
    }
    return Array.from(list);
}

function listAdd(arr, set) { for (const a of arr) set.add(a); }

function main() {
    const files = collectTargetFiles();
    const modifiedFiles = [];
    for (const file of files) {
        try {
            const changed = processMarkdownFile(file);
            if (changed) modifiedFiles.push(file);
        } catch (err) {
            console.error(`Error processing ${file}:`, err.message);
        }
    }
    if (modifiedFiles.length === 0) {
        console.log('No heading/title dash normalizations needed.');
        process.exit(0);
    }
    console.log('Modified files:');
    for (const f of modifiedFiles) console.log(' -', f);
}

// CLI: support --check (dry-run w/ exit code 1 if would change) and --root to target path
function parseArgs() {
    const args = process.argv.slice(2);
    const options = { check: false, root: process.cwd() };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--check' || a === '-c') options.check = true;
        else if (a === '--root' && i + 1 < args.length) options.root = args[++i];
    }
    return options;
}

function run() {
    const opts = parseArgs();
    const files = collectTargetFiles();
    const modifiedFiles = [];
    for (const file of files) {
        try {
            const content = fs.readFileSync(file, 'utf8');
            const res = processMarkdownFileWithOutput(file, content, opts);
            if (res.changed) modifiedFiles.push(file);
        } catch (err) {
            console.error(`Error processing ${file}:`, err.message);
        }
    }
    if (modifiedFiles.length === 0) {
        console.log('No heading/title dash normalizations needed.');
        process.exit(0);
    }
    console.log('Modified files:');
    for (const f of modifiedFiles) console.log(' -', f);
    if (opts.check) {
        console.log('Files would be changed (check mode).');
        process.exit(1);
    }
    process.exit(0);
}

// Expose a variant that takes content and returns the new content and whether changed
function processMarkdownFileWithOutput(filePath, content, opts = {}) {
    const lines = content.split(/\r?\n/);
    let inCodeFence = false;
    let changed = false;
    let inFrontMatter = false;
    const newLines = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^```/.test(line)) {
            inCodeFence = !inCodeFence;
            newLines.push(line);
            continue;
        }
        if (inCodeFence) {
            newLines.push(line);
            continue;
        }
        if (i === 0 && /^---\s*$/.test(line)) {
            inFrontMatter = true;
            newLines.push(line);
            continue;
        }
        if (inFrontMatter) {
            if (/^---\s*$/.test(line)) {
                inFrontMatter = false;
                newLines.push(line);
                continue;
            }
            const titleMatch = /^title:\s*(.*)$/u.exec(line);
            if (titleMatch) {
                const originalValue = titleMatch[1];
                const { newLine, modified } = normalizeTextSegment(originalValue);
                if (modified) {
                    newLines.push(`title: ${newLine}`);
                    changed = true;
                    continue;
                }
            }
            newLines.push(line);
            continue;
        }
        if (/^#+\s+/.test(line)) {
            const prefix = line.match(/^#+\s+/)[0];
            const rest = line.slice(prefix.length);
            const { newLine, modified } = normalizeTextSegment(rest);
            if (modified) {
                newLines.push(prefix + newLine);
                changed = true;
                continue;
            }
        }
        if (!inFrontMatter && !inCodeFence && /\s[\u2013\u2014]\s/.test(line)) {
            const { newLine, modified } = normalizeTextSegment(line);
            if (modified) {
                newLines.push(newLine);
                changed = true;
                continue;
            }
        }
        newLines.push(line);
    }
    if (!opts.check && changed) {
        fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
    }
    return { changed, content: newLines.join('\n') };
}

run();
