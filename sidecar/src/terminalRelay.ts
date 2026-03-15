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

		// Check if tmux session exists first
		const checkTmux = spawn('tmux', ['has-session', '-t', tmuxSessionName], {
			stdio: ['ignore', 'ignore', 'ignore'],
		});

		checkTmux.on('close', (code) => {
			if (code === 0) {
				// tmux session exists — attach to it
				this.spawnTerminal(sessionId, 'tmux', ['attach-session', '-t', tmuxSessionName], cwd, effectiveCols, effectiveRows);
			} else {
				// No tmux session — start a plain shell
				const shell = process.env.SHELL || '/bin/bash';
				this.spawnTerminal(sessionId, shell, [], cwd, effectiveCols, effectiveRows);
			}
		});

		checkTmux.on('error', () => {
			// tmux not installed — start a plain shell
			const shell = process.env.SHELL || '/bin/bash';
			this.spawnTerminal(sessionId, shell, [], cwd, effectiveCols, effectiveRows);
		});
	}

	/** Terminate and clean up the terminal for the specified agent */
	detach(sessionId: string): void {
		const terminal = this.terminals.get(sessionId);
		if (!terminal) return;
		this.terminals.delete(sessionId);

		try {
			terminal.process.kill('SIGTERM');
		} catch {
			// process may already be dead
		}
	}

	/** Write data to a terminal's stdin */
	input(sessionId: string, data: string): void {
		const terminal = this.terminals.get(sessionId);
		if (!terminal) return;
		terminal.process.stdin?.write(data);
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

			const terminal: ManagedTerminal = {
				process: child,
				sessionId,
				cols,
				rows,
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
				this.terminals.delete(sessionId);
				this.callbacks.onExit(sessionId, code ?? 1);
			});

			child.on('error', (err) => {
				this.terminals.delete(sessionId);
				this.callbacks.onError(sessionId, err.message);
			});

			// Notify ready
			this.callbacks.onReady(sessionId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.callbacks.onError(sessionId, `Failed to spawn terminal: ${message}`);
		}
	}
}
