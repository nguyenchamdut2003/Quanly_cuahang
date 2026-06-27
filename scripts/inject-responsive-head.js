/**
 * One-time utility: inject viewport meta into all EJS HTML pages missing it.
 * UI only — no business logic.
 */
const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, '..', 'views');
const viewportLine = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const styleLink = '<link rel="stylesheet" href="/stylesheets/style.css">';
const responsiveLink = '<link rel="stylesheet" href="/stylesheets/responsive.css">';

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, files);
    else if (name.endsWith('.ejs')) files.push(full);
  }
  return files;
}

let viewportAdded = 0;
let cssAdded = 0;

for (const file of walk(viewsDir)) {
  let content = fs.readFileSync(file, 'utf8');
  const isHtml = /<!DOCTYPE html|<!doctype html/i.test(content);
  if (!isHtml) continue;

  let changed = false;

  if (!/name=["']viewport["']/i.test(content)) {
    if (/<meta charset=["']UTF-8["']\s*\/?>/i.test(content)) {
      content = content.replace(
        /(<meta charset=["']UTF-8["']\s*\/?>)/i,
        '$1\n  ' + viewportLine
      );
      viewportAdded += 1;
      changed = true;
    } else if (/<head[^>]*>/i.test(content)) {
      content = content.replace(/(<head[^>]*>)/i, '$1\n  ' + viewportLine);
      viewportAdded += 1;
      changed = true;
    }
  }

  const isPrintOnly = /print|pdf|mau\//i.test(file.replace(/\\/g, '/'));
  if (!isPrintOnly && !/stylesheets\/style\.css/i.test(content)) {
    if (/<\/head>/i.test(content)) {
      content = content.replace(/<\/head>/i, '  ' + styleLink + '\n</head>');
      cssAdded += 1;
      changed = true;
    }
  }

  if (!isPrintOnly && /stylesheets\/style\.css/i.test(content) && !/stylesheets\/responsive\.css/i.test(content)) {
    content = content.replace(
      /(<link rel="stylesheet" href="\/stylesheets\/style\.css">)/i,
      '$1\n  ' + responsiveLink
    );
    changed = true;
  }

  if (changed) fs.writeFileSync(file, content, 'utf8');
}

console.log('viewport added:', viewportAdded);
console.log('style.css added:', cssAdded);
