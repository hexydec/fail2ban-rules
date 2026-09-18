import {describe, it, expect} from "vitest";
import {readFileSync, writeFileSync, existsSync, mkdtempSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {root, filterNames, matches, stripDate} from "./helpers/filter.js";
import {available, bannedHosts} from "./helpers/fail2ban.js";

const logDir = join(root, "tests", "logs"),
		installed = available(),
		scratch = mkdtempSync(join(tmpdir(), "fail2ban-rules-"));

/**
 * Copies a sample log to the temporary directory, without its blank lines and `#` comments
 *
 * fail2ban reads the copy, so that each row of a sample can say what it is there to pin
 *
 * @param {string} name The filter the sample belongs to
 * @param {string} file The name of the sample, without the .log extension
 * @return {Object} An object holding the `log` to run fail2ban against and the `lines` it holds
 */
function readSample(name, file) {
	const lines = readFileSync(join(logDir, name, `${file}.log`), "utf8")
				.split(/\r?\n/)
				.filter(line => line.trim() !== "" && !line.startsWith("#")),
			log = join(scratch, `${name}-${file}.log`);
	writeFileSync(log, lines.join("\n") + "\n");
	return {log, lines};
}

/**
 * Reads the client IP out of each line of a sample, which is the address the filter has to capture
 *
 * It is taken from the line itself, from the first field of an access log line or the client field
 * of an error log line, so a sample needs no separate list of expected results alongside it
 *
 * @param {Array} lines The lines of a sample log
 * @return {Array} An array of IP addresses, one per line, or null where a line names no client
 */
function expectedHosts(lines) {
	return lines.map(line => {
		const host = line.match(/^(\S+) - /) ?? line.match(/client: ([^,]+),/);
		return host === null ? null : host[1];
	});
}

/**
 * Runs a filter over a sample and lists the lines fail2ban disagreed with
 *
 * A line is identified by the client it names, which is why each sample gives every line its own
 * address, so that a disagreement can be reported as the log line that caused it
 *
 * @param {string} name The filter name, without the .conf extension
 * @param {string} file The name of the sample, without the .log extension
 * @param {boolean} ban Whether the sample holds lines that should be banned
 * @return {Array} The lines that were banned when they should not have been, or the other way round
 */
function disagreements(name, file, ban) {
	const sample = readSample(name, file),
			hosts = expectedHosts(sample.lines),
			banned = new Set(bannedHosts(name, sample.log));
	return sample.lines.filter((line, index) => banned.has(hosts[index]) !== ban);
}

/**
 * Lists the lines of a sample the javascript harness disagreed with
 *
 * This asks the same question as disagreements(), of the engine the rest of the suite runs on, so
 * that a sample still earns its keep on a machine with no fail2ban installed
 *
 * @param {string} name The filter name, without the .conf extension
 * @param {string} file The name of the sample, without the .log extension
 * @param {boolean} ban Whether the sample holds lines that should be banned
 * @return {Array} The lines the harness got the wrong way round
 */
function harnessDisagreements(name, file, ban) {
	return readSample(name, file).lines.filter(line => matches(name, stripDate(line)) !== ban);
}

// The javascript harness reimplements how fail2ban applies a filter, which is what makes the rest of
// the suite quick to write against. These samples run the real thing, so a filter that only works
// under the reimplementation, or that fail2ban refuses to load at all, cannot pass unnoticed
describe("fail2ban-regex", () => {

	// A local machine without fail2ban skips the samples, so CI has to assert it is really running them
	it.runIf(process.env.CI)("is installed in CI", () => {
		expect(installed).toBe(true);
	});

	describe("samples", () => {
		for (const name of filterNames()) {
			describe(name, () => {

				it("has a sample of lines to ban and a sample to leave alone", () => {
					for (const file of ["fail", "pass"]) {
						const sample = join(logDir, name, `${file}.log`);
						expect(existsSync(sample), `${sample} is missing`).toBe(true);
					}
				});

				// A line is found again by the client it names, so a sample cannot reuse an address
				it("gives every sample line its own client", () => {
					for (const file of ["fail", "pass"]) {
						const hosts = expectedHosts(readSample(name, file).lines).filter(host => host !== null);
						expect(hosts.length, `${file}.log repeats a client address`).toBe(new Set(hosts).size);
					}
				});

				it("the harness bans the client of every line in fail.log", () => {
					expect(harnessDisagreements(name, "fail", true)).toEqual([]);
				});

				it("the harness bans nobody in pass.log", () => {
					expect(harnessDisagreements(name, "pass", false)).toEqual([]);
				});

				// Everything below runs the samples through fail2ban itself, so it only runs where
				// fail2ban is installed. The two tests above ask the same questions of the harness, so
				// the samples are still checked on a machine without it
				describe.skipIf(!installed)("through fail2ban", () => {

					it("bans the client of every line in fail.log", () => {
						expect(disagreements(name, "fail", true)).toEqual([]);
					});

					it("bans nobody in pass.log", () => {
						expect(disagreements(name, "pass", false)).toEqual([]);
					});

					// The samples are the one place both engines read the same lines, so they are also
					// where the reimplementation can be checked against fail2ban. This compares the two
					// engines rather than the sample, so it stays quiet while a filter is being brought
					// up to what its sample asks for, and only fires when the harness has drifted
					it("agrees with the javascript harness on every sample line", () => {
						for (const file of ["fail", "pass"]) {
							const sample = readSample(name, file),
									hosts = expectedHosts(sample.lines),
									banned = new Set(bannedHosts(name, sample.log));
							sample.lines.forEach((line, index) => {
								expect(matches(name, stripDate(line)), `the harness disagrees with fail2ban on:\n  ${line}`).toBe(banned.has(hosts[index]));
							});
						}
					});
				});
			});
		}
	});
});
