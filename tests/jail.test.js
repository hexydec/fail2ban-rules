import {describe, it, expect} from "vitest";
import {readFileSync, existsSync} from "node:fs";
import {join} from "node:path";
import {root, filterDir, filterNames} from "./helpers/filter.js";

/**
 * Parses the example jail configuration
 *
 * @return {Array} An array of objects, one per jail, each holding its name and settings
 */
function parseJails() {
	const jails = [];
	let jail = null;
	for (const line of readFileSync(join(root, "src", "jail.conf"), "utf8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed !== "" && !/^[#;]/.test(trimmed)) {
			const heading = trimmed.match(/^\[(.+)\]$/);
			if (heading !== null) {
				jail = {name: heading[1]};
				jails.push(jail);
			} else if (jail !== null) {
				const pair = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
				if (pair !== null) {
					jail[pair[1]] = pair[2];
				}
			}
		}
	}
	return jails;
}

const jails = parseJails();

describe("jail.conf", () => {

	it("declares at least one jail", () => {
		expect(jails.length).toBeGreaterThan(0);
	});

	describe("every jail references a filter that exists", () => {
		for (const jail of jails) {
			it(jail.name, () => {
				expect(jail.filter, `Jail [${jail.name}] does not set a filter`).toBeDefined();
				expect(
					existsSync(join(filterDir, `${jail.filter}.conf`)),
					`Jail [${jail.name}] uses "filter = ${jail.filter}", but src/filter.d/${jail.filter}.conf does not exist`
				).toBe(true);
			});
		}
	});

	it("provides an example jail for every filter", () => {
		const used = jails.map(jail => jail.filter);
		expect(filterNames().filter(name => !used.includes(name))).toEqual([]);
	});

	describe("every jail sets a plausible log path", () => {
		for (const jail of jails) {
			it(jail.name, () => {
				expect(jail.logpath, `Jail [${jail.name}] does not set a logpath`).toBeDefined();
				expect(jail.logpath, `Jail [${jail.name}] has an unexpected logpath`).toMatch(/^\/var\/www\/vhosts\/system\/\*\/logs\//);
			});
		}
	});

	describe("every jail is runnable", () => {
		for (const jail of jails) {
			it(jail.name, () => {
				expect(jail.enabled, `Jail [${jail.name}] does not set enabled`).toBe("true");
				expect(Number(jail.bantime), `Jail [${jail.name}] has a non numeric bantime`).toBeGreaterThan(0);
				expect(Number(jail.maxretry), `Jail [${jail.name}] has a non numeric maxretry`).toBeGreaterThan(0);
			});
		}
	});
});
