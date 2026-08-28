import {readFileSync, existsSync, readdirSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {expect} from "vitest";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
		filterDir = join(root, "src", "filter.d");

// fail2ban expands <HOST> to its own address/CIDR/DNS alternation, this is a permissive stand-in.
// Note python's (?P<name>...) syntax is not valid in javascript, so the group is declared as (?<name>...)
const host = "(?<host>[\\w\\-.:]+)";

// The date formats fail2ban's date detector locates and removes from a line before applying failregex.
// These are deliberately specific so that other bracketed fields, e.g. nginx's [error], are left alone
const datePatterns = [
	/\[\d{2}\/[A-Za-z]{3}\/\d{4}(?::\d{2}){3} [+-]\d{4}\] /, // nginx combined access log
	/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} / // nginx error log
];

const cache = new Map();

/**
 * Lists the names of every filter in src/filter.d, without the .conf extension
 *
 * @return {Array} An array of filter names
 */
export function filterNames() {
	return readdirSync(filterDir)
		.filter(file => file.endsWith(".conf"))
		.map(file => file.slice(0, -5));
}

/**
 * Reads and parses a fail2ban filter configuration file
 *
 * Handles the subset of fail2ban's config language these filters use: an [Definition] section,
 * `key = value` pairs, `#`/`;` comments, and indented continuation lines (which fail2ban treats as
 * additional alternatives for the key, rather than as part of the preceding pattern)
 *
 * @param {string} name The filter name, without the .conf extension
 * @return {Object} An object containing `failregex` and `ignoreregex` arrays of pattern strings
 */
export function parseFilter(name) {
	const file = join(filterDir, `${name}.conf`);
	if (!existsSync(file)) {
		throw new Error(`Filter "${name}" does not exist at ${file}`);
	}
	const definition = {};
	let section = null,
			key = null;
	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed !== "" && !/^[#;]/.test(trimmed)) {
			const heading = trimmed.match(/^\[(.+)\]$/);
			if (heading !== null) {
				section = heading[1];
				key = null;
			} else if (section === "Definition") {
				const pair = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
				if (pair !== null) {
					key = pair[1];
					definition[key] = pair[2] === "" ? [] : [pair[2]];
				} else if (key !== null && /^\s/.test(line)) {
					definition[key].push(trimmed);
				}
			}
		}
	}
	return {
		failregex: definition.failregex ?? [],
		ignoreregex: definition.ignoreregex ?? []
	};
}

/**
 * Rewrites python's scoped case insensitive groups, (?i:...), into explicit character classes
 *
 * V8 has a bug in modifier groups where alternation members sharing a prefix fail to fold case, so
 * /^(?i:main|mailer|mail)$/.test("MAIN") is false in node but true in python, which is what fail2ban
 * runs. Expanding each letter to [Aa] form gives the python behaviour with no reliance on modifiers
 *
 * @param {string} pattern A regular expression as written in the filter
 * @return {string} The pattern with any (?i:...) group expanded
 */
function expandCaseInsensitive(pattern) {
	return pattern.replace(/\(\?i:([^)]*)\)/g, (all, content) => {
		if (/[^\w|-]/.test(content)) {
			throw new Error(`Cannot expand (?i:...) containing regex syntax, only literal alternations are supported: ${all}`);
		}
		return "(?:" + content.replace(/[a-z]/gi, c => `[${c.toUpperCase()}${c.toLowerCase()}]`) + ")";
	});
}

/**
 * Parses a filter and compiles its patterns to javascript regular expressions, substituting <HOST>
 *
 * Results are cached, as each filter is compiled many times across a suite
 *
 * @param {string} name The filter name, without the .conf extension
 * @return {Object} An object containing `failregex` and `ignoreregex` arrays of RegExp objects
 */
export function compileFilter(name) {
	if (!cache.has(name)) {
		const parsed = parseFilter(name),
				compile = patterns => patterns.map(pattern => new RegExp(expandCaseInsensitive(pattern.replaceAll("<HOST>", host))));
		cache.set(name, {
			failregex: compile(parsed.failregex),
			ignoreregex: compile(parsed.ignoreregex)
		});
	}
	return cache.get(name);
}

/**
 * Removes the timestamp from a log line, as fail2ban's date detector does before matching
 *
 * @param {string} line A log line
 * @return {string} The line with any recognised timestamp removed
 */
export function stripDate(line) {
	let stripped = line;
	for (const pattern of datePatterns) {
		stripped = stripped.replace(pattern, "");
	}
	return stripped;
}

/**
 * Determines whether a filter would count a log line as a failure
 *
 * Mirrors fail2ban's precedence: any failregex must match, and no ignoreregex may match
 *
 * @param {string} name The filter name, without the .conf extension
 * @param {string} line A log line
 * @return {boolean} Whether the line is a failure
 */
export function matches(name, line) {
	const filter = compileFilter(name);
	return filter.failregex.some(pattern => pattern.test(line))
		&& !filter.ignoreregex.some(pattern => pattern.test(line));
}

/**
 * Extracts the host captured by the first matching failregex, to check the ban targets the right IP
 *
 * @param {string} name The filter name, without the .conf extension
 * @param {string} line A log line
 * @return {string|null} The captured host, or null if the line does not match
 */
export function capturedHost(name, line) {
	const filter = compileFilter(name);
	let captured = null;
	for (const pattern of filter.failregex) {
		if (captured === null) {
			const found = line.match(pattern);
			if (found !== null) {
				captured = found.groups.host;
			}
		}
	}
	return captured;
}

/**
 * Asserts that a filter matches a log line, both as logged and with the timestamp removed
 *
 * Both forms are checked because fail2ban strips the date before applying failregex, so a pattern
 * that only works with the date present would be broken in production
 *
 * @param {string} name The filter name, without the .conf extension
 * @param {string} line A log line
 * @return {void}
 */
export function expectMatch(name, line) {
	expect(matches(name, line), `${name} should match:\n  ${line}`).toBe(true);
	const stripped = stripDate(line);
	expect(matches(name, stripped), `${name} should match with the date stripped, as fail2ban does:\n  ${stripped}`).toBe(true);
}

/**
 * Asserts that a filter does not match a log line, both as logged and with the timestamp removed
 *
 * @param {string} name The filter name, without the .conf extension
 * @param {string} line A log line
 * @return {void}
 */
export function expectNoMatch(name, line) {
	expect(matches(name, line), `${name} should not match:\n  ${line}`).toBe(false);
	const stripped = stripDate(line);
	expect(matches(name, stripped), `${name} should not match with the date stripped, as fail2ban does:\n  ${stripped}`).toBe(false);
}
