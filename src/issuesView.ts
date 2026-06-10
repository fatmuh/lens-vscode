/**
 * Issues tree view in the sidebar — like SonarLint's "Local Issues" panel.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DiagnosticsManager } from './diagnostics';
import type { LensIssue } from './scanner';

type IssueNode = FileNode | IssueEntry | SeverityGroup;

class FileNode {
    constructor(
        readonly file: string,
        readonly issues: LensIssue[],
    ) {}
    get label(): string { return path.basename(this.file); }
    get description(): string { return path.dirname(this.file); }
}

class SeverityGroup {
    constructor(
        readonly severity: string,
        readonly issues: LensIssue[],
    ) {}
    get label(): string {
        const icons: Record<string, string> = {
            blocker: '🔴', critical: '🟠', major: '🟡', minor: '🔵', info: '⚪',
        };
        return `${icons[this.severity] || '⚪'} ${this.severity} (${this.issues.length})`;
    }
}

class IssueEntry {
    constructor(readonly issue: LensIssue) {}
    get label(): string {
        const msg = this.issue.message.length > 80
            ? this.issue.message.slice(0, 77) + '...'
            : this.issue.message;
        return msg;
    }
    get description(): string {
        return `L${this.issue.start_line} • ${this.issue.rule_id}`;
    }
}

export class IssuesProvider implements vscode.TreeDataProvider<IssueNode> {
    private _onDidChange = new vscode.EventEmitter<void>();
    onDidChangeTreeData = this._onDidChange.event;

    private diagnostics: DiagnosticsManager;
    private groupBy: 'file' | 'severity' = 'file';

    constructor(diagnostics: DiagnosticsManager) {
        this.diagnostics = diagnostics;
    }

    refresh() {
        this._onDidChange.fire();
    }

    getTreeItem(element: IssueNode): vscode.TreeItem {
        if (element instanceof FileNode) {
            const item = new vscode.TreeItem(
                element.label,
                vscode.TreeItemCollapsibleState.Collapsed,
            );
            item.description = `${element.issues.length} issue(s)`;
            item.resourceUri = vscode.Uri.file(element.file);
            item.iconPath = vscode.ThemeIcon.File;
            item.contextValue = 'file';
            return item;
        }

        if (element instanceof SeverityGroup) {
            const item = new vscode.TreeItem(
                element.label,
                vscode.TreeItemCollapsibleState.Collapsed,
            );
            item.contextValue = 'severity';
            return item;
        }

        // IssueEntry
        const issue = (element as IssueEntry).issue;
        const item = new vscode.TreeItem(
            (element as IssueEntry).label,
            vscode.TreeItemCollapsibleState.None,
        );
        item.description = (element as IssueEntry).description;

        const sevIcons: Record<string, string> = {
            blocker: 'error', critical: 'error', major: 'warning',
            minor: 'info', info: 'lightbulb',
        };
        item.iconPath = new vscode.ThemeIcon(
            sevIcons[issue.severity] || 'lightbulb'
        );

        item.tooltip = `${issue.severity.toUpperCase()}: ${issue.message}\nRule: ${issue.rule_id}\nFile: ${issue.file}:${issue.start_line}`;
        item.contextValue = 'issue';

        // Click to navigate
        item.command = {
            command: 'lens.openIssue',
            title: 'Go to issue',
            arguments: [issue],
        };

        return item;
    }

    getChildren(element?: IssueNode): IssueNode[] {
        if (!element) {
            // Root level
            const allIssues = this.diagnostics.getAllIssues();
            const total = this.diagnostics.totalIssues();
            if (total === 0) { return []; }

            if (this.groupBy === 'file') {
                const nodes: FileNode[] = [];
                for (const [file, issues] of allIssues) {
                    if (issues.length > 0) {
                        nodes.push(new FileNode(file, issues));
                    }
                }
                // Sort by issue count descending
                nodes.sort((a, b) => b.issues.length - a.issues.length);
                return nodes;
            } else {
                // Group by severity
                const bySev = new Map<string, LensIssue[]>();
                for (const issues of allIssues.values()) {
                    for (const i of issues) {
                        const list = bySev.get(i.severity) || [];
                        list.push(i);
                        bySev.set(i.severity, list);
                    }
                }
                const order = ['blocker', 'critical', 'major', 'minor', 'info'];
                const nodes: SeverityGroup[] = [];
                for (const sev of order) {
                    const issues = bySev.get(sev);
                    if (issues && issues.length > 0) {
                        nodes.push(new SeverityGroup(sev, issues));
                    }
                }
                return nodes;
            }
        }

        // Children
        if (element instanceof FileNode) {
            return element.issues.map(i => new IssueEntry(i));
        }
        if (element instanceof SeverityGroup) {
            return element.issues.map(i => new IssueEntry(i));
        }

        return [];
    }
}
