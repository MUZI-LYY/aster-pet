import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { resolve, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage, extractFile } from '@electron/asar';

const root = resolve(import.meta.dirname, '..');
const textExtensions = new Set(['.md','.mjs','.cjs','.js','.jsx','.ts','.tsx','.css','.json','.html','.py','.yml','.yaml','.toml','.txt','.map']);
const folders = ['core','src','electron','scripts','tests','docs'];
const user = userInfo().username;
const personalNames = user.length >= 3 && !['root','runner','admin','user','node'].includes(user.toLowerCase()) ? [user.toLowerCase()] : [];
const home = homedir().replaceAll('\\','/').toLowerCase();

// Diagnostics contain locations and rule names only, never the matched private text.
export function privacyIssues(text, { names = personalNames, personalHome = home } = {}) {
  const issues = [];
  const lower = text.toLowerCase();
  if (names.some(name => name && lower.includes(name))) issues.push('personal-identifier');
  if (personalHome && personalHome !== '/' && lower.includes(personalHome)) issues.push('personal-home');
  if (/(?:\/(?:Users|home)\/[^\s/"'`]+|[a-z]:[\\/]+Users[\\/]|\/(?:private\/)?var\/folders\/)/i.test(text)) issues.push('machine-directory');
  // Filesystem literals are forbidden; API routes and validated device syntax
  // are protocol identifiers rather than installation locations.
  for (const match of text.matchAll(/["'`]((?:\/(?!\/)[^"'`\n]+)|(?:[a-z]:\\[^"'`\n]+))["'`]/gi)) {
    const path = match[1];
    if (path === '/api/tasks' || /^\/dev\/(?:ttys\d+|pts\/\d+|\$\{tty\})$/.test(path) || path.startsWith('/dev/ttys1;')) continue;
    // Match paths, not prose in a string or a fragment of JS/regular expressions.
    if (/^\/[\w.-]+(?:\/[\w. ${}()\\-]+)*$/.test(path) || /^[a-z]:\\/i.test(path)) issues.push('fixed-filesystem-path');
  }
  return [...new Set(issues)];
}

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry => {
    const path = join(dir,entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() && textExtensions.has(extname(entry.name)) ? [path] : [];
  });
}
export function checkPrivacy({ artifacts = false } = {}) {
  const failures = [];
  let checked = 0;
  const inspect = (name, text) => {
    checked++;
    const rules = privacyIssues(text);
    if (rules.length) failures.push({ file:name, rules });
  };
  const source = [...folders.flatMap(folder=>files(join(root,folder))), ...readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isFile()&&textExtensions.has(extname(entry.name))).map(entry=>join(root,entry.name))];
  for (const path of source) inspect(relative(root,path),readFileSync(path,'utf8'));
  if (artifacts) {
    for (const path of [...files(join(root,'dist')),...files(join(root,'build','app-stage'))]) inspect(relative(root,path),readFileSync(path,'utf8'));
    const releases = join(root,'release');
    if (existsSync(releases)) for (const entry of readdirSync(releases,{withFileTypes:true})) {
      if (!entry.isDirectory()) continue;
      const archive = join(releases,entry.name,'Aster.app','Contents','Resources','app.asar');
      if (!existsSync(archive)) continue;
      for (const name of listPackage(archive)) {
        const file = name.replace(/^[/\\]+/,'');
        if (textExtensions.has(extname(file))) inspect(`${relative(root,archive)}:${file}`,extractFile(archive,file).toString('utf8'));
      }
    }
  }
  return { checked, failures };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkPrivacy({artifacts:process.argv.includes('--artifacts')});
  if (result.failures.length) {
    for (const item of result.failures) console.error(`${item.file}: ${item.rules.join(', ')}`);
    process.exitCode=1;
  } else console.log(`Privacy check passed (${result.checked} text files).`);
}
