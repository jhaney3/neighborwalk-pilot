import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

// Rootless Docker maps container root to the invoking desktop user. It supplies
// WebKit's Ubuntu libraries without changing host packages or application deps.
const root=process.cwd();
const socket=resolve(root,'work/runtime/docker.sock');
if (!existsSync(socket)) throw new Error('Start the documented project rootless Docker daemon first. No system daemon or privileged container is used.');
if (Number(process.versions.node.split('.')[0])!==22) throw new Error('Run with the Node 22 version declared in mise.toml.');
execFileSync('docker',['--host',`unix://${socket}`,'run','--rm','--init','--ipc=host',
  '--mount',`type=bind,src=${root},dst=/work`,
  '--mount',`type=bind,src=${realpathSync(process.execPath)},dst=/usr/local/bin/node,readonly`,
  '--workdir','/work','mcr.microsoft.com/playwright:v1.63.0-noble',
  'node','node_modules/@playwright/test/cli.js','test','--config','playwright.mobile.config.ts',
  '--project=webkit','--output=test-results/webkit-container',...process.argv.slice(2)],{stdio:'inherit'});
