import {describe, it, expect} from "vitest";
import {expectMatch, expectNoMatch, capturedHost} from "./helpers/filter.js";
import {accessLog} from "./helpers/log.js";

const filter = "nginx-limit-reqs";

describe("nginx-limit-reqs", () => {

	it("captures the client IP", () => {
		expect(capturedHost(filter, accessLog({ip: "203.0.113.7", status: 429}))).toBe("203.0.113.7");
	});

	it("matches a rate limited request", () => {
		expectMatch(filter, accessLog({status: 429}));
	});

	it("matches a rate limited POST", () => {
		expectMatch(filter, accessLog({method: "POST", path: "/api/search", status: 429}));
	});

	describe("ignores every other status", () => {
		for (const status of [200, 204, 301, 400, 401, 403, 404, 428, 430, 500]) {
			it(`${status}`, () => {
				expectNoMatch(filter, accessLog({status}));
			});
		}
	});

	// The pattern is `" 429\s`, so 429 is only read from the field directly after the closing quote
	// of the request, and cannot be spoofed from elsewhere in the line
	describe("ignores 429 appearing outside the status field", () => {
		it("in the request path", () => {
			expectNoMatch(filter, accessLog({path: "/errors/429", status: 200}));
		});
		it("in the byte count", () => {
			expectNoMatch(filter, accessLog({status: 200, bytes: 429}));
		});
		it("in the referer", () => {
			expectNoMatch(filter, accessLog({status: 200, referer: "https://example.com/ 429 "}));
		});
		it("in the user agent", () => {
			expectNoMatch(filter, accessLog({status: 200, agent: "Thing/1.0 429 "}));
		});
	});
});
