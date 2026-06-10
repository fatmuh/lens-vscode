/**
 * Status bar integration for Lens.
 */

import * as vscode from 'vscode';

export class StatusBar {
    private item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            50
        );
        this.item.text = '$(search) Lens';
        this.item.tooltip = 'Lens: Ready';
        this.item.command = 'lens.showOutput';
        this.item.show();
    }

    setText(text: string) {
        this.item.text = text;
    }

    setIssueCount(count: number, breakdown: string) {
        if (count === 0) {
            this.item.text = '$(check) Lens';
            this.item.tooltip = 'Lens: No issues found';
            this.item.backgroundColor = undefined;
        } else {
            this.item.text = `$(warning) Lens: ${count}`;
            this.item.tooltip = `Lens: ${breakdown}\nClick for details`;

            if (breakdown.includes('blocker') || breakdown.includes('critical')) {
                this.item.backgroundColor = new vscode.ThemeColor(
                    'statusBarItem.errorBackground'
                );
            } else if (breakdown.includes('major')) {
                this.item.backgroundColor = new vscode.ThemeColor(
                    'statusBarItem.warningBackground'
                );
            } else {
                this.item.backgroundColor = undefined;
            }
        }
    }

    setFileCount(count: number) {
        // Show per-file count briefly
        if (count === 0) {
            this.item.text = '$(check) Lens';
        }
    }

    clear() {
        this.item.text = '$(search) Lens';
        this.item.tooltip = 'Lens: Ready';
        this.item.backgroundColor = undefined;
    }

    onClick(_cb: () => void) {
        // Already bound to command in constructor
    }

    dispose() {
        this.item.dispose();
    }
}
