import { spawn, type ChildProcess } from 'child_process';
import * as os from 'os';

/** Default terminal columns */
const DEFAULT_COLS = 80;
/** Default terminal rows */
const DEFAULT_ROWS = 24;

interface ManagedTerminal {
	process: ChildProcess;
	sessionId: string;
	cols: number;
	rows: number;
	/** epoch 用於區分同一 sessionId 的不同 terminal 實例（避免 attach→detach→attach race） */
	epoch: number;
	/** 主動 detach 中，exit 事件不應通知前端 */
	intentionalClose: boolean;
}

export interface TerminalRelayCallbacks {
	onData: (sessionId: string, data: string) => void;
	onExit: (sessionId: string, code: number) => void;
	onReady: (sessionId: string) => void;
	onError: (sessionId: string, message: string) => void;
}

/**
 * Terminal relay — manages multiple PTY/shell processes in the sidecar,
 * using child_process.spawn (no native node-pty dependency).
 *
 * For agents with a tmux session: tries `tmux attach-session -t {name}`.
 * Otherwise: starts a shell in the agent's project directory.
 */
export class TerminalRelay {
	private terminals = new Map<string, ManagedTerminal>();
	private callbacks: TerminalRelayCallbacks;
	/** Get the project directory for a sessionId (provided externally) */
	private getProjectDir: (sessionId: string) => string | undefined;
	private epochCounter = 0;

	constructor(callbacks: TerminalRelayCallbacks, getProjectDir: (sessionId: string) => string | undefined) {
		this.callbacks = callbacks;
		this.getProjectDir = getProjectDir;
	}

	/** Create a terminal process for the specified agent */
	attach(sessionId: string, cols: number, rows: number): void {
		// If there's already a terminal for this sessionId, clean up first
		if (this.terminals.has(sessionId)) {
			this.detach(sessionId);
		}

		const effectiveCols = cols || DEFAULT_COLS;
		const effectiveRows = rows || DEFAULT_ROWS;

		// Try tmux attach (following pixel-agents-{sessionId} naming convention)
		const tmuxSessionName = `pixel-agents-${sessionId}`;
		const projectDir = this.getProjectDir(sessionId);
		const cwd = projectDir || os.homedir();

		// Check if tmux session exists first — guard against duplicate callback
		let settled = false;
		const onDone = (hasTmux: boolean) => {
			if (settled) return;
			settled = true;
			if (hasTmux) {
				this.spawnTerminal(sessionId, 'tmux', ['attach-session', '-t', tmuxSessionName], cwd, effectiveCols, effectiveRows);
			} else {
				const shell = process.env.SHELL || '/bin/bash';
				this.spawnTerminal(sessionId, shell, [], cwd, effectiveCols, effectiveRows);
			}
		};

		const checkTmux = spawn('tmux', ['has-session', '-t', tmuxSessionName], {
			stdio: ['ignore', 'ignore', 'ignore'],
		});
		checkTmux.on('close', (code) => onDone(code === 0));
		checkTmux.on('error', () => onDone(false));
	}

	/** Terminate and clean up the terminal for the specified agent */
	detach(sessionId: string): void {
		const terminal = this.terminals.get(sessionId);
		if (!terminal) return;
		// 標記為主動 detach — close 回呼會據此跳過 onExit 通知
		terminal.intentionalClose = true;
		this.terminals.delete(sessionId);

		try {
			if (terminal.process.stdin && !terminal.process.stdin.destroyed) {
				terminal.process.stdin.end();
			}
			terminal.process.kill('SIGTERM');
		} catch {
			// process may already be dead
		}
	}

	/** Write data to a terminal's stdin */
	input(sessionId: string, data: string): void {
		const terminal = this.terminals.get(sessionId);
		if (!terminal) return;
		const stdin = terminal.process.stdin;
		if (!stdin || stdin.destroyed || !stdin.writable) return;
		try {
			stdin.write(data);
		} catch {
			// 子程序可能已 exit，EPIPE 等錯誤直接忽略
		}
	}

	/** Resize a terminal (via tmux resize-window if applicable) */
	resize(sessionId: string, cols: number, rows: number): void {
		const terminal = this.terminals.get(sessionId);
		if (!terminal) return;
		terminal.cols = cols;
		terminal.rows = rows;
		// child_process.spawn has no native resize support,
		// but if the underlying process is tmux, we can resize via tmux command
		const tmuxSessionName = `pixel-agents-${sessionId}`;
		try {
			spawn('tmux', ['resize-window', '-t', tmuxSessionName, '-x', String(cols), '-y', String(rows)], {
				stdio: 'ignore',
			});
		} catch {
			// silently ignore — resize is not critical
		}
	}

	/** Clean up all terminals */
	destroy(): void {
		for (const sessionId of [...this.terminals.keys()]) {
			this.detach(sessionId);
		}
	}

	/** Get the number of active terminals */
	get activeCount(): number {
		return this.terminals.size;
	}

	private spawnTerminal(
		sessionId: string,
		command: string,
		args: string[],
		cwd: string,
		cols: number,
		rows: number,
	): void {
		try {
			const child = spawn(command, args, {
				cwd,
				env: {
					...process.env,
					TERM: 'xterm-256color',
					COLUMNS: String(cols),
					LINES: String(rows),
				},
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			const epoch = ++this.epochCounter;
			const terminal: ManagedTerminal = {
				process: child,
				sessionId,
				cols,
				rows,
				epoch,
				intentionalClose: false,
			};
			this.terminals.set(sessionId, terminal);

			child.stdout?.on('data', (chunk: Buffer) => {
				this.callbacks.onData(sessionId, chunk.toString('utf-8'));
			});

			child.stderr?.on('data', (chunk: Buffer) => {
				// stderr is also forwarded as data (many terminal programs use stderr)
				this.callbacks.onData(sessionId, chunk.toString('utf-8'));
			});

			child.on('close', (code) => {
				// 只在 map 中仍然指向本 epoch 時才清除；避免 attach→detach→attach 時誤砍新 terminal
				const current = this.terminals.get(sessionId);
				const isCurrent = current?.epoch === epoch;
				if (isCurrent) this.terminals.delete(sessionId);
				// 主動 detach 不通知前端 — 前端會回到 placeholder UI
				if (!terminal.intentionalClose && isCurrent) {
					this.callbacks.onExit(sessionId, code ?? 1);
				}
			});

			child.on('error', (err) => {
				const current = this.terminals.get(sessionId);
				const isCurrent = current?.epoch === epoch;
				if (isCurrent) this.terminals.delete(sessionId);
				if (!terminal.intentionalClose && isCurrent) {
					this.callbacks.onError(sessionId, err.message);
				}
			});

			// Notify ready
			this.callbacks.onReady(sessionId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.callbacks.onError(sessionId, `Failed to spawn terminal: ${message}`);
		}
	}
}
