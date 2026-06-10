/**
 * Lens — VS Code Extension
 *
 * Runs `lens scan` and displays issues as diagnostics in the editor.
 * Supports TypeScript/JS, Python, Go, Rust, and Dart.
 */

import * as vscode from 'vscode';
import { Scanner } from './scanner';
import { DiagnosticsManager, LensCodeActionProvider } from './diagnostics';
import { StatusBar } from './statusBar';
import { IssuesProvider } from './issuesView';

let scanner: Scanner;
let diagnostics: DiagnosticsManager;
let statusBar: StatusBar;
let issuesProvider: IssuesProvider;

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('lens');

    diagnostics = new DiagnosticsManager(config);
    statusBar = new StatusBar();
    scanner = new Scanner(config, diagnostics, statusBar);
    issuesProvider = new IssuesProvider(diagnostics);

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('lens.scanWorkspace', () => scanner.scanWorkspace()),
        vscode.commands.registerCommand('lens.scanFile', () => scanner.scanActiveFile()),
        vscode.commands.registerCommand('lens.clear', () => {
            diagnostics.clearAll();
            statusBar.clear();
            issuesProvider.refresh();
        }),
        vscode.commands.registerCommand('lens.showOutput', () => scanner.showOutput()),
        vscode.commands.registerCommand('lens.fixFile', () => scanner.fixActiveFile()),
        vscode.commands.registerCommand('lens.openIssue', (issue) => {
            if (issue && issue.file && issue.start_line) {
                const uri = vscode.Uri.file(issue.file);
                vscode.workspace.openTextDocument(uri).then(doc => {
                    vscode.window.showTextDocument(doc).then(editor => {
                        const pos = new vscode.Position(issue.start_line - 1, 0);
                        editor.selection = new vscode.Selection(pos, pos);
                        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                    });
                });
            }
        }),
    );

    // Code actions — quick fix (NOSONAR, disable rule, show docs)
    const codeActionProvider = diagnostics;
    const supportedLangs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'python', 'go', 'rust', 'dart'];
    for (const lang of supportedLangs) {
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider(
                { language: lang },
                new LensCodeActionProvider(),
                { providedCodeActionKinds: LensCodeActionProvider.providedCodeActionKinds },
            )
        );
    }

    // Commands for code actions
    context.subscriptions.push(
        vscode.commands.registerCommand('lens.disableRule', (ruleId: string) => {
            vscode.window.showInformationMessage(
                `Add "${ruleId}" to [rules] disabled in quality-gate.toml to disable this rule.`
            );
        }),
        vscode.commands.registerCommand('lens.openRuleDocs', (ruleId: string) => {
            const url = `https://docs.lenscan.dev/docs/rules#${ruleId}`;
            vscode.env.openExternal(vscode.Uri.parse(url));
        }),
    );

    // Issues tree view in sidebar
    const treeView = vscode.window.createTreeView('lens.issues', {
        treeDataProvider: issuesProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // File decorations — colored badges based on issue count
    const fileDecorator = new LensFileDecorationProvider(diagnostics);
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(fileDecorator)
    );

    // Auto-scan on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (config.get<boolean>('scanOnSave') && isSupported(doc)) {
                scanner.scanFile(doc);
                issuesProvider.refresh();
            }
        })
    );

    // Analyze on type (debounced) — like SonarLint
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (!config.get<boolean>('analyzeOnType', true)) { return; }
            const doc = e.document;
            if (!isSupported(doc)) { return; }

            // Debounce: wait 1.5s after last keystroke
            if (debounceTimer) { clearTimeout(debounceTimer); }
            debounceTimer = setTimeout(() => {
                scanner.scanFile(doc);
                issuesProvider.refresh();
            }, 1500);
        })
    );

    // Auto-scan on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (config.get<boolean>('scanOnOpen', false) && isSupported(doc)) {
                scanner.scanFile(doc);
                issuesProvider.refresh();
            }
        })
    );

    // Track active editor for status bar + decorations
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && isSupported(editor.document)) {
                const count = diagnostics.fileIssueCount(editor.document.uri);
                statusBar.setFileCount(count);
            }
        })
    );

    // Re-scan when config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('lens')) {
                const newConfig = vscode.workspace.getConfiguration('lens');
                scanner.updateConfig(newConfig);
                diagnostics.updateConfig(newConfig);
            }
        })
    );

    // Status bar click → show summary
    statusBar.onClick(() => scanner.showSummary());

    // Initial status
    statusBar.setText('$(search) Lens');

    // Scan active file on activation
    const editor = vscode.window.activeTextEditor;
    if (editor && isSupported(editor.document)) {
        scanner.scanFile(editor.document);
    }

    // Full workspace scan on activation
    if (config.get<boolean>('scanOnStartup', true)) {
        scanner.scanWorkspace().then(() => issuesProvider.refresh());
    }

    console.log('Lens extension activated');
}

export function deactivate() {
    diagnostics?.clearAll();
    statusBar?.dispose();
}

function isSupported(doc: vscode.TextDocument): boolean {
    const supported = [
        'typescript', 'typescriptreact',
        'javascript', 'javascriptreact',
        'python', 'go', 'rust', 'dart'
    ];
    return supported.includes(doc.languageId);
}

/**
 * File decoration provider — colors file icons based on issue count.
 */
class LensFileDecorationProvider implements vscode.FileDecorationProvider {
    private diagnostics: DiagnosticsManager;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri | undefined>();
    onDidChangeFileDecorations = this._onDidChange.event;

    constructor(diagnostics: DiagnosticsManager) {
        this.diagnostics = diagnostics;
        this.diagnostics.onDidChange(uri => this._onDidChange.fire(uri));
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const count = this.diagnostics.fileIssueCount(uri);
        if (count === 0) { return undefined; }

        let badge: string;
        let tooltip: string;
        let color: vscode.ThemeColor;

        if (count > 99) {
            badge = '99+';
        } else {
            badge = count.toString();
        }

        const breakdown = this.diagnostics.fileIssueBreakdown(uri);
        tooltip = `Lens: ${count} issue(s) — ${breakdown}`;

        if (breakdown.includes('blocker') || breakdown.includes('critical')) {
            color = new vscode.ThemeColor('errorForeground');
        } else if (breakdown.includes('major')) {
            color = new vscode.ThemeColor('editorWarning.foreground');
        } else {
            color = new vscode.ThemeColor('editorInfo.foreground');
        }

        return { badge, tooltip, color };
    }
}
