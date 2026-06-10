/**
 * Converts Lens issues to VS Code diagnostics and manages their lifecycle.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { LensIssue } from './scanner';

export class DiagnosticsManager {
    private collection: vscode.DiagnosticCollection;
    private config: vscode.WorkspaceConfiguration;
    private allIssues: Map<string, LensIssue[]> = new Map();

    constructor(config: vscode.WorkspaceConfiguration) {
        this.config = config;
        this.collection = vscode.languages.createDiagnosticCollection('lens');
    }

    updateConfig(config: vscode.WorkspaceConfiguration) {
        this.config = config;
        // Re-apply all diagnostics with new severity mapping
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
    }

    setWorkspaceIssues(issues: LensIssue[], rootPath: string) {
        // Group issues by file
        const byFile = new Map<string, LensIssue[]>();
        for (const issue of issues) {
            // Normalize file path
            const filePath = path.isAbsolute(issue.file)
                ? issue.file
                : path.join(rootPath, issue.file);

            const existing = byFile.get(filePath) || [];
            existing.push({ ...issue, file: filePath });
            byFile.set(filePath, existing);
        }

        // Set diagnostics per file
        for (const [filePath, fileIssues] of byFile) {
            const uri = vscode.Uri.file(filePath);
            this.setFileIssues(uri, fileIssues);
        }
    }

    clearAll() {
        this.collection.clear();
        this.allIssues.clear();
    }

    totalIssues(): number {
        let count = 0;
        for (const issues of this.allIssues.values()) {
            count += issues.length;
        }
        return count;
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

        // Tags for unnecessary or deprecated
        if (issue.rule_id.includes('unused') || issue.rule_id.includes('deprecated')) {
            diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
        }

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
