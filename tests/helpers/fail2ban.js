import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {root} from "./filter.js";

// fail2ban is POSIX only, its client imports fcntl, so on windows the command is run through WSL,
// which needs the drive letter form of every path rewriting to its /mnt mount point
const wsl = process.platform === "win32";

/**
 * Builds the command and arguments used to invoke fail2ban-regex
 *
 * The FAIL2BAN_REGEX environment variable overrides the lookup, and may include arguments, so an
 * unusual installation can be pointed at without changing the suite
 *
 * @return {Object} An object holding the `command` to run and any leading `args` it requires
 */
function resolveCommand() {
	let resolved = {command: "fail2ban-regex", args: []};
	if (process.env.FAIL2BAN_REGEX) {
		const parts = process.env.FAIL2BAN_REGEX.split(" ");
		resolved = {command: parts[0], args: parts.slice(1)};
	} else if (wsl) {
		resolved = {command: "wsl.exe", args: ["-e", "fail2ban-regex"]};
	}
	return resolved;
}

const command = resolveCommand();

/**
 * Converts a windows path to the WSL mount point that refers to the same file
 *
 * @param {string} path An absolute path
 * @return {string} The path as WSL sees it
 */
function translate(path) {
	let translated = path;
	if (wsl && !process.env.FAIL2BAN_REGEX) {
		translated = path.replace(/^([A-Za-z]):/, (all, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll("\\", "/");
	}
	return translated;
}

/**
 * Runs fail2ban-regex, returning its result without throwing, so callers can report the output
 *
 * @param {Array} args The arguments to pass
 * @return {Object} An object holding the `status`, `stdout` and `stderr` of the process
 */
function run(args) {
	const result = spawnSync(command.command, [...command.args, ...args], {encoding: "utf8"});
	return {
		status: result.status,
		stdout: (result.stdout ?? "").replaceAll("\0", ""),
		stderr: (result.stderr ?? "").replaceAll("\0", ""),
		error: result.error ?? null
	};
}

/**
 * Determines whether fail2ban-regex can be run on this machine
 *
 * @return {boolean} Whether the command is available
 */
export function available() {
	const result = run(["--version"]);
	return result.error === null && result.status === 0;
}

/**
 * Runs a filter against a log file using fail2ban itself, and lists the IPs it would ban
 *
 * The filter is named rather than given as a path, with src as the config directory, so that
 * fail2ban resolves it the same way a jail's `filter = ` line does. `-r` stops it resolving
 * hostnames, and `-o ip` reduces the report to one line per failure holding only the address
 *
 * @param {string} name The filter name, without the .conf extension
 * @param {string} log The path to a log file
 * @return {Array} An array of the IP addresses fail2ban reported as failures
 */
export function bannedHosts(name, log) {
	const result = run(["-r", "-o", "ip", "-c", translate(join(root, "src")), translate(log), name]);
	if (result.status !== 0 || /^ERROR/m.test(result.stdout)) {
		throw new Error(`fail2ban-regex failed for ${name} against ${log}:\n${result.stdout}${result.stderr}`);
	}
	return result.stdout.split(/\r?\n/).filter(line => line.trim() !== "");
}
