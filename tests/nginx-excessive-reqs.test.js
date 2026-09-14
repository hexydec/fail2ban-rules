import {describe, it, expect} from "vitest";
import {expectMatch, expectNoMatch, capturedHost} from "./helpers/filter.js";
import {errorLog} from "./helpers/log.js";

const filter = "nginx-excessive-reqs";

describe("nginx-excessive-reqs", () => {

	it("captures the client IP", () => {
		expect(capturedHost(filter, errorLog({ip: "203.0.113.7"}))).toBe("203.0.113.7");
	});

	it("matches a request rate limit", () => {
		expectMatch(filter, errorLog({limit: "requests"}));
	});

	it("matches a connection rate limit", () => {
		expectMatch(filter, errorLog({limit: "connections"}));
	});

	describe("matches any excess value", () => {
		for (const excess of ["0.000", "0.700", "12.345", "1000.000"]) {
			it(excess, () => {
				expectMatch(filter, errorLog({excess}));
			});
		}
	});

	it("matches any zone name", () => {
		expectMatch(filter, errorLog({zone: "perserver-example.com"}));
	});

	describe("ignores unrelated error log lines", () => {
		const lines = [
			'2026/08/28 10:00:00 [error] 1234#0: *5678 open() "/var/www/example.com/nope" failed (2: No such file or directory), client: 1.2.3.4, server: example.com',
			'2026/08/28 10:00:00 [error] 1234#0: *5678 upstream timed out (110: Connection timed out) while reading response header from upstream, client: 1.2.3.4, server: example.com',
			'2026/08/28 10:00:00 [crit] 1234#0: *5678 SSL_do_handshake() failed, client: 1.2.3.4, server: 0.0.0.0:443',
			'2026/08/28 10:00:00 [notice] 1234#0: signal process started'
		];
		for (const line of lines) {
			it(line.slice(41, 80), () => {
				expectNoMatch(filter, line);
			});
		}
	});

	it("ignores an access log line", () => {
		expectNoMatch(filter, '1.2.3.4 - - [28/Aug/2026:10:00:00 +0000] "GET / HTTP/1.1" 429 1234 "-" "-"');
	});
});
