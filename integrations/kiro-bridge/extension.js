const vscode = require('vscode');
const path = require('path');
const { startWindowBridge } = require('./window-bridge-server');

function activate(context) {
  const workspace = vscode.workspace.workspaceFolders?.length ? vscode.workspace.name || '' : '';
  const roots = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
  const currentWindowHint=()=>path.basename(vscode.window.activeTextEditor?.document.uri.fsPath || '')||vscode.window.tabGroups.activeTabGroup.activeTab?.label||'';
  const bridge=startWindowBridge({
    provider: 'kiro', workspace, roots,
    windowHint: currentWindowHint,
    async openTask(id) {
      if (!/^(?:sess_[A-Za-z0-9_-]{1,120}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id)) throw new Error('invalid');
      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes('kiroAgent.sessions.switch') || !commands.includes('kiroAgent.viewSession')) throw new Error('unsupported');
      await vscode.commands.executeCommand('kiroAgent.sessions.switch', id, undefined, 'local');
      await vscode.commands.executeCommand('kiroAgent.viewSession', id);
    }
  });
  context.subscriptions.push(bridge);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(()=>bridge.publish()));
  context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(()=>bridge.publish()));
}

function deactivate() {}
module.exports = { activate, deactivate };
