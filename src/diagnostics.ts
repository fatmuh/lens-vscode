/**
 * Converts Lens issues to VS Code diagnostics and manages their lifecycle.
 * Includes code actions for quick fix (NOSONAR, disable rule).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { LensIssue } from './scanner';

export type { LensIssue };

export class DiagnosticsManager {
    private collection: vscode.DiagnosticCollection;
    private config: vscode.WorkspaceConfiguration;
    private allIssues: Map<string, LensIssue[]> = new Map();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri | undefined>();
    readonly onDidChange = this._onDidChange.event;

    constructor(config: vscode.WorkspaceConfiguration) {
        this.config = config;
        this.collection = vscode.languages.createDiagnosticCollection('lens');
    }

    updateConfig(config: vscode.WorkspaceConfiguration) {
        this.config = config;
        for (const [uriStr, issues] of this.allIssues) {
            const uri = vscode.Uri.file(uriStr);
            this.setFileIssues(uri, issues);
        }
    }

    setFileIssues(uri: vscode.Uri, issues: LensIssue[]) {
        const maxProblems = this.config.get<number>('maxProblems', 200);
        const severityMap = this.config.get<object>('severity', {
            blocker: 'error',
            critical: 'error',
            major: 'warning',
            minor: 'information',
            info: 'hint',
        }) as Record<string, string>;

        const diagnostics: vscode.Diagnostic[] = issues
            .slice(0, maxProblems)
            .map(issue => this.toDiagnostic(issue, severityMap));

        this.collection.set(uri, diagnostics);
        this.allIssues.set(uri.fsPath, issues);
        this._onDidChange.fire(uri);
    }

    setWorkspaceIssues(issues: LensIssue[], rootPath: string) {
        const byFile = new Map<string, LensIssue[]>();
        for (const issue of issues) {
            const filePath = path.isAbsolute(issue.file)
                ? issue.file
                : path.join(rootPath, issue.file);

            const existing = byFile.get(filePath) || [];
            existing.push({ ...issue, file: filePath });
            byFile.set(filePath, existing);
        }

        for (const [filePath, fileIssues] of byFile) {
            const uri = vscode.Uri.file(filePath);
            this.setFileIssues(uri, fileIssues);
        }
    }

    clearAll() {
        this.collection.clear();
        this.allIssues.clear();
        this._onDidChange.fire(undefined);
    }

    totalIssues(): number {
        let count = 0;
        for (const issues of this.allIssues.values()) {
            count += issues.length;
        }
        return count;
    }

    fileIssueCount(uri: vscode.Uri): number {
        return this.allIssues.get(uri.fsPath)?.length || 0;
    }

    getFileIssues(uri: vscode.Uri): LensIssue[] {
        return this.allIssues.get(uri.fsPath) || [];
    }

    getAllIssues(): Map<string, LensIssue[]> {
        return this.allIssues;
    }

    issueBreakdown(): string {
        let blocker = 0, critical = 0, major = 0, minor = 0, info = 0;
        for (const issues of this.allIssues.values()) {
            for (const i of issues) {
                switch (i.severity) {
                    case 'blocker': blocker++; break;
                    case 'critical': critical++; break;
                    case 'major': major++; break;
                    case 'minor': minor++; break;
                    default: info++; break;
                }
            }
        }
        const parts: string[] = [];
        if (blocker > 0) { parts.push(`${blocker} blocker`); }
        if (critical > 0) { parts.push(`${critical} critical`); }
        if (major > 0) { parts.push(`${major} major`); }
        if (minor > 0) { parts.push(`${minor} minor`); }
        if (info > 0) { parts.push(`${info} info`); }
        return parts.join(', ') || '0';
    }

    fileIssueBreakdown(uri: vscode.Uri): string {
        const issues = this.allIssues.get(uri.fsPath) || [];
        let blocker = 0, critical = 0, major = 0, minor = 0, info = 0;
        for (const i of issues) {
            switch (i.severity) {
                case 'blocker': blocker++; break;
                case 'critical': critical++; break;
                case 'major': major++; break;
                case 'minor': minor++; break;
                default: info++; break;
            }
        }
        const parts: string[] = [];
        if (blocker > 0) { parts.push(`${blocker} blocker`); }
        if (critical > 0) { parts.push(`${critical} critical`); }
        if (major > 0) { parts.push(`${major} major`); }
        if (minor > 0) { parts.push(`${minor} minor`); }
        if (info > 0) { parts.push(`${info} info`); }
        return parts.join(', ') || '0';
    }

    private toDiagnostic(
        issue: LensIssue,
        severityMap: Record<string, string>,
    ): vscode.Diagnostic {
        const range = new vscode.Range(
            new vscode.Position(issue.start_line - 1, issue.start_column),
            new vscode.Position(issue.end_line - 1, issue.end_column || 999),
        );

        const severity = this.mapSeverity(issue.severity, severityMap);
        const diagnostic = new vscode.Diagnostic(range, issue.message, severity);

        diagnostic.source = 'lens';
        diagnostic.code = issue.rule_id;

        // Tags
        if (issue.rule_id.includes('unused') || issue.rule_id.includes('deprecated')) {
            diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
        }

        // Related information — link to rule
        // (We use the code field instead, which is clickable)

        return diagnostic;
    }

    private mapSeverity(
        lensSeverity: string,
        map: Record<string, string>,
    ): vscode.DiagnosticSeverity {
        const mapped = map[lensSeverity] || 'information';
        switch (mapped) {
            case 'error': return vscode.DiagnosticSeverity.Error;
            case 'warning': return vscode.DiagnosticSeverity.Warning;
            case 'information': return vscode.DiagnosticSeverity.Information;
            case 'hint': return vscode.DiagnosticSeverity.Hint;
            default: return vscode.DiagnosticSeverity.Information;
        }
    }

    dispose() {
        this.collection.dispose();
    }
}

/**
 * Code action provider — provides quick fixes for Lens issues.
 */
export class LensCodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diag of context.diagnostics) {
            if (diag.source !== 'lens') { continue; }

            const ruleId = typeof diag.code === 'object' ? diag.code?.value : diag.code;
            if (!ruleId) { continue; }

            // Action 1: Suppress with NOSONAR
            const suppress = new vscode.CodeAction(
                `Lens: Suppress with NOSONAR`,
                vscode.CodeActionKind.QuickFix,
            );
            suppress.diagnostics = [diag];
            suppress.isPreferred = false;
            suppress.edit = new vscode.WorkspaceEdit();

            const line = document.lineAt(diag.range.start.line);
            const currentText = line.text;
            const nosonarComment = this.getNosonarComment(document.languageId);
            const newText = currentText + nosonarComment;
            suppress.edit.replace(
                document.uri,
                new vscode.Range(
                    new vscode.Position(line.lineNumber, 0),
                    new vscode.Position(line.lineNumber, currentText.length),
                ),
                newText,
            );
            actions.push(suppress);

            // Action 2: Disable this rule
            const disable = new vscode.CodeAction(
                `Lens: Disable rule ${ruleId}`,
                vscode.CodeActionKind.QuickFix,
            );
            disable.diagnostics = [diag];
            disable.command = {
                command: 'lens.disableRule',
                title: `Disable rule ${ruleId}`,
                arguments: [ruleId],
            };
            actions.push(disable);

            // Action 3: Open rule documentation
            const docs = new vscode.CodeAction(
                `Lens: Show rule docs for ${ruleId}`,
                vscode.CodeActionKind.QuickFix,
            );
            docs.diagnostics = [diag];
            docs.command = {
                command: 'lens.openRuleDocs',
                title: `Open docs for ${ruleId}`,
                arguments: [ruleId],
            };
            actions.push(docs);
        }

        return actions;
    }

    private getNosonarComment(languageId: string): string {
        const style: Record<string, string> = {
            'typescript': ' // NOSONAR',
            'typescriptreact': ' // NOSONAR',
            'javascript': ' // NOSONAR',
            'javascriptreact': ' // NOSONAR',
            'go': ' // NOSONAR',
            'rust': ' // NOSONAR',
            'dart': ' // NOSONAR',
            'python': '  # NOSONAR',
            'ruby': ' # NOSONAR',
            'shell': ' # NOSONAR',
            'yaml': ' # NOSONAR',
            'css': ' /* NOSONAR */',
            'scss': ' /* NOSONAR */',
            'html': ' <!-- NOSONAR -->',
        };
        return style[languageId] || ' // NOSONAR';
    }
}
