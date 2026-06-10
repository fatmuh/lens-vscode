/**
 * Runs `lens scan` and parses the JSON output.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { DiagnosticsManager } from './diagnostics';
import { StatusBar } from './statusBar';

export interface LensIssue {
    rule_id: string;
    severity: string;
    message: string;
    file: string;
    start_line: number;
    end_line: number;
    start_column: number;
    end_column: number;
}

export interface LensResult {
    issues: LensIssue[];
    summary?: {
        total_files: number;
        issue_count: number;
        issues_by_severity: Record<string, number>;
    };
    scan?: {
        root: string;
        duration_ms: number;
    };
    metrics?: {
        total_loc: number;
        total_functions: number;
        total_cyclomatic_complexity: number;
    };
}

export class Scanner {
    private outputChannel: vscode.OutputChannel;
    private config: vscode.WorkspaceConfiguration;
    private diagnostics: DiagnosticsManager;
    private statusBar: StatusBar;
    private scanning = false;

    constructor(
        config: vscode.WorkspaceConfiguration,
        diagnostics: DiagnosticsManager,
        statusBar: StatusBar,
    ) {
        this.config = config;
        this.diagnostics = diagnostics;
        this.statusBar = statusBar;
        this.outputChannel = vscode.window.createOutputChannel('Lens');
    }

    updateConfig(config: vscode.WorkspaceConfiguration) {
        this.config = config;
    }

    showOutput() {
        this.outputChannel.show();
    }

    showSummary() {
        const count = this.diagnostics.totalIssues();
        if (count === 0) {
            vscode.window.showInformationMessage('Lens: No issues found ✅');
        } else {
            const breakdown = this.diagnostics.issueBreakdown();
            vscode.window.showInformationMessage(
                `Lens: ${count} issues — ${breakdown}`
            );
        }
    }

    async scanWorkspace(): Promise<void> {
        if (this.scanning) { return; }
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showWarningMessage('Lens: No workspace folder open.');
            return;
        }

        this.scanning = true;
        this.statusBar.setText('$(loading~spin) Lens scanning...');
        this.diagnostics.clearAll();

        try {
            const root = folders[0].uri.fsPath;
            const result = await this.runLens(root);

            if (result) {
                const issues = result.issues || [];
                this.diagnostics.setWorkspaceIssues(issues, root);
                const breakdown = this.diagnostics.issueBreakdown();
                this.statusBar.setIssueCount(issues.length, breakdown);
                const fileCount = new Set(issues.map(i => i.file)).size;
                this.outputChannel.appendLine(
                    `[workspace] ${issues.length} issues in ${fileCount} files (${result.scan?.duration_ms || '?'}ms)`
                );
                this.outputChannel.appendLine(
                    `[breakdown] ${breakdown}`
                );
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Lens: ${err.message}`);
            this.outputChannel.appendLine(`[error] ${err.message}`);
        } finally {
            this.scanning = false;
        }
    }

    async scanActiveFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        await this.scanFile(editor.document);
    }

    async scanFile(doc: vscode.TextDocument) {
        if (this.scanning) { return; }

        try {
            const filePath = doc.uri.fsPath;
            const result = await this.runLensSingleFile(filePath);

            if (result) {
                const issues = result.issues || [];
                this.diagnostics.setFileIssues(doc.uri, issues);
                this.statusBar.setIssueCount(
                    this.diagnostics.totalIssues(),
                    this.diagnostics.issueBreakdown()
                );
            }
        } catch (err: any) {
            this.outputChannel.appendLine(`[error] ${err.message}`);
        }
    }

    async fixActiveFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const lensBin = this.getLensBin();
        const filePath = editor.document.uri.fsPath;

        try {
            vscode.window.showInformationMessage('Lens: Running AI fix...');
            const { stdout } = await this.exec(
                `"${lensBin}" fix "${filePath}" --dry-run`,
                { cwd: path.dirname(filePath) }
            );

            const action = await vscode.window.showInformationMessage(
                'Lens: AI fix ready. Review changes?',
                'Apply', 'Show Diff', 'Cancel'
            );

            if (action === 'Apply') {
                await this.exec(
                    `"${lensBin}" fix "${filePath}"`,
                    { cwd: path.dirname(filePath) }
                );
                vscode.window.showInformationMessage('Lens: Fixes applied.');
            } else if (action === 'Show Diff') {
                this.outputChannel.show();
                this.outputChannel.append(stdout);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Lens fix: ${err.message}`);
        }
    }

    private async runLens(rootPath: string): Promise<LensResult | null> {
        const lensBin = this.getLensBin();
        const args = ['scan', rootPath, '--format', 'json', '--quiet'];

        const configPath = this.config.get<string>('configPath', '');
        if (configPath) {
            args.push('-c', configPath);
        }

        this.outputChannel.appendLine(`[scan] ${rootPath} (${lensBin})`);

        const { stdout, stderr } = await this.execFile(lensBin, args, {
            cwd: rootPath,
        });

        if (stderr) {
            for (const line of stderr.split('\n')) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.includes('INFO')) {
                    this.outputChannel.appendLine(`[config] ${trimmed}`);
                }
            }
        }

        try {
            return JSON.parse(stdout);
        } catch {
            this.outputChannel.appendLine(`[parse error] Could not parse lens output: ${stdout.slice(0, 200)}`);
            return null;
        }
    }

    private async runLensSingleFile(filePath: string): Promise<LensResult | null> {
        const lensBin = this.getLensBin();
        const dir = path.dirname(filePath);
        const args = ['scan', filePath, '--format', 'json', '--quiet'];

        const configPath = this.config.get<string>('configPath', '');
        if (configPath) {
            args.push('-c', configPath);
        }

        try {
            const { stdout } = await this.execFile(lensBin, args, { cwd: dir });

            try {
                return JSON.parse(stdout);
            } catch {
                return null;
            }
        } catch (err: any) {
            if (err.stdout) {
                try {
                    return JSON.parse(err.stdout);
                } catch { /* ignore */ }
            }
            throw err;
        }
    }

    private getLensBin(): string {
        return this.config.get<string>('path', 'lens');
    }

    private execFile(
        cmd: string, args: string[], options: cp.ExecFileOptions
    ): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            cp.execFile(cmd, args, { ...options, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
                const out = typeof stdout === 'string' ? stdout : stdout?.toString('utf8') || '';
                const errOut = typeof stderr === 'string' ? stderr : stderr?.toString('utf8') || '';
                if (err && !out) {
                    reject(new Error(errOut || err.message));
                } else {
                    resolve({ stdout: out, stderr: errOut });
                }
            });
        });
    }

    private exec(
        command: string, options: cp.ExecOptions
    ): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            cp.exec(command, { ...options, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
                const out = typeof stdout === 'string' ? stdout : stdout?.toString('utf8') || '';
                const errOut = typeof stderr === 'string' ? stderr : stderr?.toString('utf8') || '';
                if (err && !out) {
                    reject(new Error(errOut || err.message));
                } else {
                    resolve({ stdout: out, stderr: errOut });
                }
            });
        });
    }
}
