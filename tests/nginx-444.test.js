import {describe, it, expect} from "vitest";
import {expectMatch, expectNoMatch, capturedHost} from "./helpers/filter.js";
import {accessLog} from "./helpers/log.js";

const filter = "nginx-444";

describe("nginx-444", () => {

	it("captures the client IP", () => {
		expect(capturedHost(filter, accessLog({ip: "203.0.113.7", status: 444}))).toBe("203.0.113.7");
	});

	it("matches a refused request", () => {
		expectMatch(filter, accessLog({status: 444}));
	});

	// nginx sends no response at all, so the byte count is zero rather than a page size
	it("matches with a zero byte count", () => {
		expectMatch(filter, accessLog({status: 444, bytes: 0}));
	});

	describe("matches whatever the request asked for", () => {
		for (const method of ["GET", "POST", "HEAD", "PUT", "DELETE"]) {
			it(method, () => {
				expectMatch(filter, accessLog({method, path: "/create-account/?location=%2525252Fx", status: 444}));
			});
		}
	});

	// The refusal is the vhost's judgement, so nothing about the client changes whether it counts
	describe("matches whoever sent it", () => {
		it("with no user agent", () => {
			expectMatch(filter, accessLog({status: 444, agent: "-"}));
		});
		it("with a forged search engine referrer", () => {
			expectMatch(filter, accessLog({status: 444, referer: "https://www.google.com/"}));
		});
		it("with a browser user agent", () => {
			expectMatch(filter, accessLog({status: 444, agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1"}));
		});
	});

	describe("ignores every other status", () => {
		for (const status of [200, 204, 301, 400, 401, 403, 404, 429, 443, 445, 500]) {
			it(`${status}`, () => {
				expectNoMatch(filter, accessLog({status}));
			});
		}
	});

	// The pattern is `" 444\s`, so 444 is only read from the field directly after the closing quote
	// of the request, and cannot be spoofed from elsewhere in the line
	describe("ignores 444 appearing outside the status field", () => {
		it("in the request path", () => {
			expectNoMatch(filter, accessLog({path: "/errors/444", status: 200}));
		});
		it("in the byte count", () => {
			expectNoMatch(filter, accessLog({status: 200, bytes: 444}));
		});
		it("in the referer", () => {
			expectNoMatch(filter, accessLog({status: 200, referer: "https://example.com/ 444 "}));
		});
		it("in the user agent", () => {
			expectNoMatch(filter, accessLog({status: 200, agent: "Thing/1.0 444 "}));
		});
	});
});
