import {describe, it, expect} from "vitest";
import {expectMatch, expectNoMatch, capturedHost} from "./helpers/filter.js";
import {accessLog} from "./helpers/log.js";

const filter = "nginx-auth";

describe("nginx-auth", () => {

	it("captures the client IP", () => {
		expect(capturedHost(filter, accessLog({ip: "203.0.113.7", path: "/login", status: 401}))).toBe("203.0.113.7");
	});

	describe("matches failed authentication", () => {
		for (const status of [401, 403]) {
			it(`${status}`, () => {
				expectMatch(filter, accessLog({path: "/login", status}));
			});
		}
	});

	it("matches a 403 on a POST to a login endpoint", () => {
		expectMatch(filter, accessLog({method: "POST", path: "/wp-login.php", status: 403}));
	});

	describe("ignores every other status", () => {
		for (const status of [200, 204, 301, 302, 400, 402, 404, 405, 410, 429, 500, 502]) {
			it(`${status}`, () => {
				expectNoMatch(filter, accessLog({path: "/login", status}));
			});
		}
	});

	// The pattern is `" 40[13]\s`, so the status code is only read from the field directly after the
	// closing quote of the request. These cases confirm it cannot be spoofed from elsewhere in the line
	describe("ignores 401 and 403 appearing outside the status field", () => {
		it("in the request path", () => {
			expectNoMatch(filter, accessLog({path: "/errors/401", status: 200}));
		});
		it("in the byte count", () => {
			expectNoMatch(filter, accessLog({path: "/", status: 200, bytes: 403}));
		});
		it("in the referer", () => {
			expectNoMatch(filter, accessLog({path: "/", status: 200, referer: "https://example.com/ 401 "}));
		});
		it("in the user agent", () => {
			expectNoMatch(filter, accessLog({path: "/", status: 200, agent: "Thing/1.0 401 "}));
		});
	});
});
