import { basename } from 'node:path';
export const CLI_PROVIDERS={codex:'Codex',claude:'Claude Code',cursor:'Cursor',kiro:'Kiro',cli:'其他 CLI'};
const executables={codex:'codex',claude:'claude','claude-code':'claude',cursor:'cursor','cursor-agent':'cursor',kiro:'kiro','kiro-cli':'kiro'};
export function identifyCliProvider(command,requested='auto') {
  if(requested!=='auto'){
    if(!Object.hasOwn(CLI_PROVIDERS,requested))throw new Error('Unsupported CLI provider');
    return requested;
  }
  // Do not infer identity from a task title, arguments, or ambiguous names such as `agent`.
  const name=basename(command).toLowerCase().replace(/\.exe$/,'');
  return Object.hasOwn(executables,name)?executables[name]:'cli';
}
export function cliSourceLabel(provider) {
  return provider==='cli'?CLI_PROVIDERS.cli:`${CLI_PROVIDERS[provider]} · CLI`;
}
