/**
 * Lens — VS Code Extension
 *
 * Runs `lens scan` and displays issues as diagnostics in the editor.
 * Supports TypeScript/JS, Python, Go, Rust, and Dart.
 */

import * as vscode from 'vscode';
import { Scanner } from './scanner';
import { DiagnosticsManager } from './diagnostics';
import { StatusBar } from './statusBar';

let scanner: Scanner;
let diagnostics: DiagnosticsManager;
let statusBar: StatusBar;

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('lens');

    diagnostics = new DiagnosticsManager(config);
    statusBar = new StatusBar();
    scanner = new Scanner(config, diagnostics, statusBar);

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('lens.scanWorkspace', () => scanner.scanWorkspace()),
        vscode.commands.registerCommand('lens.scanFile', () => scanner.scanActiveFile()),
        vscode.commands.registerCommand('lens.clear', () => {
            diagnostics.clearAll();
            statusBar.clear();
        }),
        vscode.commands.registerCommand('lens.showOutput', () => scanner.showOutput()),
        vscode.commands.registerCommand('lens.fixFile', () => scanner.fixActiveFile()),
    );

    // Auto-scan on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (config.get<boolean>('scanOnSave') && isSupported(doc)) {
                scanner.scanFile(doc);
            }
        })
    );

    // Auto-scan on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (config.get<boolean>('scanOnOpen') && isSupported(doc)) {
                scanner.scanFile(doc);
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
